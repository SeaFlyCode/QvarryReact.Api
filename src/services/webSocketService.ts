import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import url from "url";
import Redis, { Cluster } from "ioredis";
import { LRUCache } from "lru-cache";
import {
  createMessageOp,
  getMessagesOp,
  markMessageAsReadOp,
  replyToMessageOp,
  editMessageOp,
  deleteMessageOp,
} from "./messageOperationsService";
import ConversationModel from "../models/conversations";
import { decrypt } from "../utils/masterEncryptionUtils";
import UserModel from "../models/users";
import { redisSessionService } from "./redisSessionService";
import { logger } from "./loggerService";
import { anonymizeIp } from "../utils/logUtils";
import { z } from "zod";
import {
  redisPubSubService,
  NotificationPayload,
  MessagePayload,
} from "./redisPubSubService";
import { webSocketStateService, ClientState } from "./webSocketStateService";
import { randomBytes } from "crypto";
import { safeJsonParse } from "../utils/secureJsonParser";
import { getAppCheck } from "firebase-admin/app-check";
import admin from "firebase-admin";

const wsLogger = logger.child({ service: "websocket" });

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  conversationId?: string;
  deviceId?: string; // PHASE 4: Device ID for state persistence
  isAlive?: boolean;
  messageCount?: number;
  messageCountResetTime?: number;
  lastStateSave?: number; // PHASE 4: Last time state was saved
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION SÉCURITÉ WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

const NODE_ENV = process.env.NODE_ENV || "development";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3001";

// WS-004: Origins autorisées pour WebSocket
const ALLOWED_WS_ORIGINS =
  NODE_ENV === "production"
    ? [CLIENT_URL]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://localhost:3000",
        "https://localhost:3001",
        CLIENT_URL,
      ];

// WS-003: Rate limiting par message
const MAX_MESSAGES_PER_MINUTE = 60;
const MESSAGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// SCHÉMAS DE VALIDATION ZOD PAR TYPE DE MESSAGE
// ═══════════════════════════════════════════════════════════════════════════

const MessageContentSchema = z.string().min(1).max(10000);
const MessageIdSchema = z.string().min(1);

// PHASE 4: Nouveaux types de messages pour la reprise de connexion
const WsMessageSchemas: Record<string, z.ZodTypeAny> = {
  message: z.object({
    type: z.literal("message"),
    content: MessageContentSchema,
    messageType: z.string().optional(),
    metadata: z.any().optional(),
  }),
  getMessages: z.object({
    type: z.literal("getMessages"),
    query: z
      .object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        before: z.string().optional(),
      })
      .optional(),
  }),
  markMessageAsRead: z.object({
    type: z.literal("markMessageAsRead"),
    messageId: MessageIdSchema,
  }),
  replyToMessage: z.object({
    type: z.literal("replyToMessage"),
    messageId: MessageIdSchema,
    content: MessageContentSchema,
  }),
  editMessage: z.object({
    type: z.literal("editMessage"),
    messageId: MessageIdSchema,
    content: MessageContentSchema,
  }),
  deleteMessage: z.object({
    type: z.literal("deleteMessage"),
    messageId: MessageIdSchema,
  }),
  // PHASE 4: Resume connection with previous state
  resume: z.object({
    type: z.literal("resume"),
    deviceId: z.string().min(1),
    lastMessageIds: z.record(z.string(), z.string()).optional(),
  }),
  // PHASE 4: Acknowledge message received
  ack: z.object({
    type: z.literal("ack"),
    messageId: MessageIdSchema,
    conversationId: z.string().optional(),
  }),
};

// WS-HEARTBEAT: Intervalle configurable via env var
const WS_HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WS_HEARTBEAT_INTERVAL_MS || "30000",
  10,
);

// PHASE 4: Intervalle de sauvegarde d'état
const WS_STATE_SAVE_INTERVAL_MS = parseInt(
  process.env.WS_STATE_SAVE_INTERVAL || "30000",
  10,
);

// PHASE 4: Timeout pour ACK des messages
const WS_MESSAGE_ACK_TIMEOUT_MS = parseInt(
  process.env.WS_MESSAGE_ACK_TIMEOUT || "30000",
  10,
);

// PHASE 4: Timeout de shutdown gracieux
const WS_GRACEFUL_SHUTDOWN_TIMEOUT_MS = parseInt(
  process.env.WS_GRACEFUL_SHUTDOWN_TIMEOUT || "10000",
  10,
);

// ═══════════════════════════════════════════════════════════════════════════
// PERF: HEARTBEAT ADAPTATIF SELON L'ACTIVITÉ
// ═══════════════════════════════════════════════════════════════════════════
// Connexions actives (< 2 min) : 30s
// Connexions idle (> 2 min) : 90s
const HEARTBEAT_ACTIVE_MS = 30000; // 30s pour connexions actives
const HEARTBEAT_IDLE_MS = 90000; // 90s pour connexions inactives
const IDLE_THRESHOLD_MS = 120000; // 2 minutes sans activité = idle

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING POUR WEBSOCKET (CONNEXIONS)
// ═══════════════════════════════════════════════════════════════════════════

interface ConnectionAttempt {
  count: number;
  firstAttempt: Date;
  blockedUntil?: Date;
}

const MAX_CONNECTIONS_PER_MINUTE = 10;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TRACKED_IPS = 10000; // CRIT-08: Limite du nombre d'IPs trackées pour éviter une fuite mémoire

// ═══════════════════════════════════════════════════════════════════════════
// REDIS INSTANCE POUR CACHE BLOCKING STATUS
// ═══════════════════════════════════════════════════════════════════════════
let redisCache: Redis | Cluster | null = null;
const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";

if (REDIS_ENABLED) {
  (async () => {
    try {
      const USE_REDIS_CLUSTER = process.env.USE_REDIS_CLUSTER === "true";

      if (USE_REDIS_CLUSTER) {
        const clusterNodes =
          process.env.REDIS_CLUSTER_NODES?.split(",").map((node) => {
            const [host, port] = node.split(":");
            return { host, port: parseInt(port) };
          }) || [];

        redisCache = new Cluster(clusterNodes, {
          redisOptions: {
            password: process.env.REDIS_PASSWORD,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
          },
        });
      } else {
        // PERF: Utiliser le pool Redis partagé pour le cache
        const RedisConnectionPool = (await import("../config/redisPool"))
          .default;
        redisCache = RedisConnectionPool.createClient(); // Clone du publisher

        wsLogger.info("[WS] Using shared Redis pool for cache", {
          status: redisCache.status,
        });
      }

      redisCache?.on("error", (error) => {
        wsLogger.error("WebSocket Service - Redis cache error", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (error) {
      wsLogger.error(
        "WebSocket Service - Redis cache initialization failed, will fallback to direct MongoDB queries",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      redisCache = null;
    }
  })();
} else {
  wsLogger.info(
    "WebSocket Service - Redis cache disabled, using direct MongoDB queries for blocking status",
  );
}

class WebSocketService {
  private notificationsWss: WebSocketServer | null = null;
  private messagesWss: WebSocketServer | null = null;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private messageClients: Map<
    string,
    Map<string, Set<AuthenticatedWebSocket>>
  > = new Map(); // userId -> conversationId -> clients

  // PERF: Index inversé pour broadcasts rapides (O(participants) au lieu de O(total_users))
  private conversationClients = new Map<
    string, // conversationId
    Set<AuthenticatedWebSocket>
  >();

  // PERF: Cache LRU pour participation aux conversations (avec TTL automatique)
  private readonly conversationParticipationCache = new LRUCache<
    string, // clé: `${userId}:${conversationId}`
    boolean // isParticipant
  >({
    max: 10000, // Maximum 10K entrées
    ttl: 5 * 60 * 1000, // TTL 5 minutes
    updateAgeOnGet: true, // Refresh TTL à chaque lecture
    allowStale: false, // Ne pas retourner les entrées expirées
  });

  // R-5: Map de rate limiting des connexions (encapsulée dans la classe)
  private readonly connectionAttempts = new Map<string, ConnectionAttempt>();

  // R-5: Référence au timer de nettoyage périodique pour pouvoir le stopper proprement
  private connectionAttemptsCleanupInterval: ReturnType<
    typeof setInterval
  > | null = null;

  // PHASE 4: Référence au timer de sauvegarde périodique d'état
  private stateSaveInterval: ReturnType<typeof setInterval> | null = null;

  // PHASE 4: Flag de shutdown gracieux
  private isShuttingDown = false;

  // PERF: Debouncing pour state saves - évite écritures Redis excessives
  private dirtyStates = new Set<string>(); // userIds avec état modifié
  private saveDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly STATE_SAVE_DEBOUNCE_MS = 10000; // 10 secondes

  // PERF: Heartbeat adaptatif - tracking de l'activité des clients
  private clientLastActivity = new Map<AuthenticatedWebSocket, number>();
  private heartbeatIntervals: ReturnType<typeof setInterval>[] = [];

  /**
   * FIX-1: Helper sécurisé pour envoyer des messages aux clients WS
   * Évite qu'une erreur sur un client crashe toute l'itération d'un broadcast
   */
  private safeSend(client: AuthenticatedWebSocket, payload: string): void {
    try {
      client.send(payload);
    } catch (err) {
      wsLogger.error("safeSend - échec envoi au client", {
        userId: client.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * R-5: Vérifie si un utilisateur est participant d'une conversation (avec cache LRU)
   * PERF: Utilise LRUCache pour gestion automatique du TTL et éviction
   */
  private async checkConversationParticipation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    // PERF: Utiliser LRU cache avec clé composite
    const cacheKey = `${userId}:${conversationId}`;

    // Vérifier le cache (avec TTL automatique)
    const cached = this.conversationParticipationCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Cache miss - requête DB
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "participants.userId": userId,
    }).lean();

    const isParticipant = !!conversation;

    // Mettre en cache (TTL et LRU gérés automatiquement)
    this.conversationParticipationCache.set(cacheKey, isParticipant);

    return isParticipant;
  }

  /**
   * R-5: Invalider le cache de participation pour une conversation
   * (à appeler quand les membres changent)
   */
  invalidateConversationCache(conversationId: string): void {
    for (const key of this.conversationParticipationCache.keys()) {
      if (key.endsWith(`:${conversationId}`)) {
        this.conversationParticipationCache.delete(key);
      }
    }
  }

  /**
   * PERF: Retourne les statistiques du cache de participation
   * Utile pour monitoring et debugging
   */
  getCacheStats() {
    return {
      size: this.conversationParticipationCache.size,
      max: this.conversationParticipationCache.max,
      calculatedSize: this.conversationParticipationCache.calculatedSize,
    };
  }

  /**
   * PERF: Retourne les stats d'activité des clients pour monitoring du heartbeat adaptatif
   */
  getClientActivityStats() {
    const now = Date.now();
    let activeCount = 0;
    let idleCount = 0;

    for (const [client, lastActivity] of this.clientLastActivity.entries()) {
      const timeSinceActivity = now - lastActivity;
      if (timeSinceActivity > IDLE_THRESHOLD_MS) {
        idleCount++;
      } else {
        activeCount++;
      }
    }

    return {
      total: this.clientLastActivity.size,
      active: activeCount,
      idle: idleCount,
      activeHeartbeatMs: HEARTBEAT_ACTIVE_MS,
      idleHeartbeatMs: HEARTBEAT_IDLE_MS,
      idleThresholdMs: IDLE_THRESHOLD_MS,
      estimatedCpuReduction:
        idleCount > 0
          ? Math.round((idleCount / (activeCount + idleCount)) * 66)
          : 0,
    };
  }

  /**
   * PERF: Ajouter un client à une conversation (avec index inversé)
   */
  private addClientToConversation(
    client: AuthenticatedWebSocket,
    conversationId: string,
  ): void {
    const userId = client.userId;
    if (!userId) {
      return;
    }

    // Structure existante (userId -> conversationId -> clients)
    if (!this.messageClients.has(userId)) {
      this.messageClients.set(userId, new Map());
    }

    const userConversations = this.messageClients.get(userId)!;
    if (!userConversations.has(conversationId)) {
      userConversations.set(conversationId, new Set());
    }

    const conversationClients = userConversations.get(conversationId)!;
    conversationClients.add(client);

    // PERF: Ajouter au reverse index (conversationId -> clients)
    if (!this.conversationClients.has(conversationId)) {
      this.conversationClients.set(conversationId, new Set());
    }
    this.conversationClients.get(conversationId)!.add(client);

    wsLogger.debug("[WS] Client added to conversation", {
      userId,
      conversationId,
      conversationClientsCount: conversationClients.size,
    });
  }

  /**
   * PERF: Retirer un client d'une conversation (avec index inversé)
   */
  private removeClientFromConversation(
    client: AuthenticatedWebSocket,
    conversationId: string,
  ): void {
    const userId = client.userId;
    if (!userId) {
      return;
    }

    const userConversations = this.messageClients.get(userId);
    if (!userConversations) {
      return;
    }

    const conversationClients = userConversations.get(conversationId);
    if (!conversationClients) {
      return;
    }

    conversationClients.delete(client);

    // PERF: Retirer du reverse index
    const reverseClients = this.conversationClients.get(conversationId);
    if (reverseClients) {
      reverseClients.delete(client);

      // Si plus aucun client, supprimer le Set
      if (reverseClients.size === 0) {
        this.conversationClients.delete(conversationId);
      }
    }

    if (conversationClients.size === 0) {
      userConversations.delete(conversationId);
    }

    if (userConversations.size === 0) {
      this.messageClients.delete(userId);
    }

    wsLogger.debug("[WS] Client removed from conversation", {
      userId,
      conversationId,
    });
  }

  /**
   * R-5: Vérifie si une IP peut se connecter (rate limiting WebSocket natif).
   *
   * NOTE FIX-3 : Le middleware Express `wsConnectionLimiter` (express-rate-limit)
   * a été supprimé car il était inefficace pour les WebSockets.
   * Les upgrades WS sont traités via `server.on("upgrade")` AVANT le pipeline
   * Express, donc un `app.use("/ws", wsConnectionLimiter)` n'interceptait jamais
   * les connexions WS réelles. Le rate limiting WS est géré ici directement,
   * au niveau du handler `server.on("upgrade")`.
   */
  private canConnect(ip: string): { allowed: boolean; reason?: string } {
    const now = new Date();

    // CRIT-08: Protection mémoire — limiter le nombre d'IPs trackées
    if (
      this.connectionAttempts.size >= MAX_TRACKED_IPS &&
      !this.connectionAttempts.has(ip)
    ) {
      // Purger les entrées non bloquées les plus anciennes
      for (const [trackedIp, attempt] of this.connectionAttempts.entries()) {
        if (!attempt.blockedUntil || attempt.blockedUntil < now) {
          this.connectionAttempts.delete(trackedIp);
        }
        if (this.connectionAttempts.size < MAX_TRACKED_IPS * 0.8) break;
      }
    }

    const attempt = this.connectionAttempts.get(ip);

    if (!attempt) {
      this.connectionAttempts.set(ip, { count: 1, firstAttempt: now });
      return { allowed: true };
    }

    // Si bloqué
    if (attempt.blockedUntil && attempt.blockedUntil > now) {
      const remainingMinutes = Math.ceil(
        (attempt.blockedUntil.getTime() - now.getTime()) / 60000,
      );
      return {
        allowed: false,
        reason: `Trop de tentatives de connexion. Réessayez dans ${remainingMinutes} minute(s).`,
      };
    }

    // Réinitialiser si plus d'une minute s'est écoulée
    const timeSinceFirst = now.getTime() - attempt.firstAttempt.getTime();
    if (timeSinceFirst > 60000) {
      this.connectionAttempts.set(ip, { count: 1, firstAttempt: now });
      return { allowed: true };
    }

    // Incrémenter le compteur
    attempt.count++;

    if (attempt.count > MAX_CONNECTIONS_PER_MINUTE) {
      attempt.blockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS);
      this.connectionAttempts.set(ip, attempt);
      wsLogger.warn("WS RATE LIMIT - IP bloquée", {
        ip: anonymizeIp(ip),
        blockDurationMin: BLOCK_DURATION_MS / 60000,
        attemptCount: attempt.count,
      });
      return {
        allowed: false,
        reason: `Trop de tentatives de connexion. Bloqué pour ${BLOCK_DURATION_MS / 60000} minutes.`,
      };
    }

    this.connectionAttempts.set(ip, attempt);
    return { allowed: true };
  }

  /**
   * PHASE 4: Générer ou extraire un deviceId pour le client
   */
  private getOrGenerateDeviceId(request: any): string {
    const query = url.parse(request.url, true).query;
    const deviceId = query.deviceId as string;

    if (deviceId && typeof deviceId === "string" && deviceId.length > 0) {
      return deviceId;
    }

    // Générer un deviceId aléatoire si non fourni
    return randomBytes(16).toString("hex");
  }

  /**
   * PHASE 4: Sauvegarder l'état d'un client
   */
  private async saveClientState(client: AuthenticatedWebSocket): Promise<void> {
    if (!client.userId || !client.deviceId) {
      return;
    }

    if (!webSocketStateService.isEnabled()) {
      return;
    }

    // Collecter les subscriptions (conversations)
    const subscriptions: string[] = [];
    const userConversations = this.messageClients.get(client.userId);
    if (userConversations) {
      subscriptions.push(...userConversations.keys());
    }

    // Récupérer l'état existant ou créer un nouveau
    let state = await webSocketStateService.getClientState(
      client.userId,
      client.deviceId,
    );

    if (!state) {
      state = {
        userId: client.userId,
        deviceId: client.deviceId,
        subscriptions,
        lastSeenMessageIds: {},
        pendingMessages: [],
        lastActivityAt: new Date(),
        connectionMetadata: {
          userAgent: undefined,
          ipAddress: undefined,
          platform: undefined,
        },
      };
    } else {
      // Mettre à jour les subscriptions
      state.subscriptions = subscriptions;
      state.lastActivityAt = new Date();
    }

    await webSocketStateService.saveClientState(
      client.userId,
      client.deviceId,
      state,
    );
    client.lastStateSave = Date.now();
  }

  /**
   * PERF: Marque un état comme modifié et planifie une sauvegarde différée
   * Évite les écritures Redis multiples sur une courte période
   */
  private markStateDirty(userId: string): void {
    this.dirtyStates.add(userId);

    // Annuler le timer existant si présent
    const existingTimer = this.saveDebounceTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Planifier sauvegarde après debounce delay
    const timer = setTimeout(async () => {
      if (this.dirtyStates.has(userId)) {
        // Trouver le client associé à ce userId
        const client = this.findClientByUserId(userId);
        if (client) {
          await this.saveClientState(client);
          wsLogger.debug("[WS-PERF] Debounced state save executed", {
            userId,
          });
        }
        this.dirtyStates.delete(userId);
      }
      this.saveDebounceTimers.delete(userId);
    }, this.STATE_SAVE_DEBOUNCE_MS);

    this.saveDebounceTimers.set(userId, timer);
  }

  /**
   * PERF: Annule le timer debounce en attente et purge dirtyStates pour un userId.
   * Appelé lors de la déconnexion du dernier client d'un user pour éviter qu'un
   * timer orphelin ne tente de sauver un état sans client associé.
   */
  private cancelDebouncedSave(userId: string): void {
    const timer = this.saveDebounceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.saveDebounceTimers.delete(userId);
    }
    this.dirtyStates.delete(userId);
  }

  /**
   * Helper: Trouve un client WebSocket par userId
   */
  private findClientByUserId(userId: string): AuthenticatedWebSocket | null {
    // Chercher dans les clients de messages
    const userConversations = this.messageClients.get(userId);
    if (userConversations) {
      for (const clients of userConversations.values()) {
        for (const client of clients) {
          return client; // Retourne le premier client trouvé pour cet utilisateur
        }
      }
    }

    // Chercher dans les clients de notifications
    const notifClients = this.clients.get(userId);
    if (notifClients && notifClients.size > 0) {
      return Array.from(notifClients)[0];
    }

    return null;
  }

  /**
   * PHASE 4: Restaurer l'état d'un client à la reconnexion
   */
  private async restoreClientState(
    client: AuthenticatedWebSocket,
    deviceId: string,
  ): Promise<boolean> {
    if (!client.userId || !webSocketStateService.isEnabled()) {
      return false;
    }

    const state = await webSocketStateService.getClientState(
      client.userId,
      deviceId,
    );

    if (!state) {
      wsLogger.info("No previous state found for client", {
        userId: client.userId,
        deviceId,
      });
      return false;
    }

    wsLogger.info("Restoring client state", {
      userId: client.userId,
      deviceId,
      subscriptions: state.subscriptions.length,
      pendingMessages: state.pendingMessages.length,
      lastActivity: state.lastActivityAt,
    });

    // Restaurer les subscriptions (rejoindre les conversations)
    for (const conversationId of state.subscriptions) {
      // Vérifier que l'utilisateur est toujours participant
      const isParticipant = await this.checkConversationParticipation(
        client.userId,
        conversationId,
      );

      if (isParticipant) {
        // S'abonner aux messages de cette conversation
        await this.subscribeToConversation(conversationId);
        // Ajouter le client à la conversation (avec index inversé)
        this.addClientToConversation(client, conversationId);
      } else {
        wsLogger.warn("User no longer participant, skipping subscription", {
          userId: client.userId,
          conversationId,
        });
      }
    }

    // Envoyer les messages en attente
    const pendingMessages = state.pendingMessages;
    if (pendingMessages.length > 0) {
      wsLogger.info("Delivering pending messages", {
        userId: client.userId,
        count: pendingMessages.length,
      });

      for (const msg of pendingMessages) {
        // Ne pas ajouter "type" car msg contient déjà un type
        this.safeSend(
          client,
          JSON.stringify({
            ...msg,
            isPending: true, // Marquer comme message en attente
          }),
        );
      }

      // Vider la file après envoi
      await webSocketStateService.clearPendingMessages(client.userId, deviceId);
    }

    // Envoyer l'événement resumed au client
    this.safeSend(
      client,
      JSON.stringify({
        type: "resumed",
        subscriptions: state.subscriptions,
        lastSeenMessageIds: state.lastSeenMessageIds,
        missedMessagesCount: pendingMessages.length,
        lastActivity: state.lastActivityAt,
      }),
    );

    return true;
  }

  /**
   * PERF: Cache Redis pour blocking status - évite requêtes MongoDB répétées
   * Invalide automatiquement après 5 min (TTL)
   */
  private async getConversationBlockingStatus(
    conversationId: string,
  ): Promise<{ blockedBy: any[] }> {
    const cacheKey = `conversation:${conversationId}:blocking`;

    try {
      // Tenter de récupérer depuis Redis si disponible
      if (redisCache) {
        const cached = await redisCache.get(cacheKey);

        if (cached) {
          const parsed = JSON.parse(cached);
          // Convertir les dates de string vers Date
          return {
            blockedBy: parsed.blockedBy.map((b: any) => ({
              userId: b.userId,
              blockedAt: new Date(b.blockedAt),
            })),
          };
        }
      }

      // Cache miss → requête MongoDB
      const conversation = await ConversationModel.findById(conversationId)
        .select("blockedBy")
        .lean();

      if (!conversation) {
        return { blockedBy: [] };
      }

      const blockingStatus = {
        blockedBy: (conversation.blockedBy || []).map((b: any) => ({
          userId: b.userId.toString(),
          blockedAt: b.blockedAt,
        })),
      };

      // Mettre en cache pour 5 minutes si Redis disponible
      if (redisCache) {
        await redisCache.setex(cacheKey, 300, JSON.stringify(blockingStatus));
      }

      return blockingStatus;
    } catch (error) {
      wsLogger.error("Error fetching conversation blocking status from cache", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback : requête directe sans cache
      const conversation = await ConversationModel.findById(conversationId)
        .select("blockedBy")
        .lean();

      return {
        blockedBy: (conversation?.blockedBy || []).map((b: any) => ({
          userId: b.userId.toString(),
          blockedAt: b.blockedAt,
        })),
      };
    }
  }

  /**
   * Invalide le cache de blocking status (appelé lors de block/unblock)
   */
  private async invalidateConversationBlockingCache(
    conversationId: string,
  ): Promise<void> {
    const cacheKey = `conversation:${conversationId}:blocking`;
    try {
      if (redisCache) {
        await redisCache.del(cacheKey);
      }
    } catch (error) {
      wsLogger.warn("Failed to invalidate conversation blocking cache", {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * PHASE 4: Shutdown gracieux - sauvegarder tous les états et fermer les connexions
   */
  async gracefulShutdown(
    timeoutMs: number = WS_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  ): Promise<void> {
    this.isShuttingDown = true;

    wsLogger.warn("WebSocket graceful shutdown initiated", {
      timeout: `${timeoutMs}ms`,
      connectedClients: this.getConnectedClientsCount(),
    });

    // Arrêter d'accepter de nouvelles connexions
    if (this.notificationsWss) {
      this.notificationsWss.close();
    }
    if (this.messagesWss) {
      this.messagesWss.close();
    }

    // Envoyer un message de shutdown à tous les clients
    const shutdownMessage = JSON.stringify({
      type: "server_shutdown",
      message:
        process.env.WS_SHUTDOWN_MESSAGE ||
        "Le serveur redémarre pour maintenance",
      reconnect: true,
      timestamp: new Date().toISOString(),
    });

    // Notifier tous les clients (notifications)
    this.clients.forEach((userClients) => {
      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, shutdownMessage);
        }
      });
    });

    // Notifier tous les clients (messages)
    this.messageClients.forEach((userConversations) => {
      userConversations.forEach((conversationClients) => {
        conversationClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            this.safeSend(client, shutdownMessage);
          }
        });
      });
    });

    // PERF: Annuler tous les timers de debouncing
    for (const timer of this.saveDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.saveDebounceTimers.clear();

    // Sauvegarder immédiatement tous les états dirty
    for (const userId of this.dirtyStates) {
      const client = this.findClientByUserId(userId);
      if (client) {
        await this.saveClientState(client);
      }
    }
    this.dirtyStates.clear();

    // Sauvegarder tous les états en parallèle
    const savePromises: Promise<void>[] = [];

    this.messageClients.forEach((_, userId) => {
      // Pour chaque utilisateur, sauvegarder l'état de chaque device
      const deviceIds = new Set<string>();

      // Collecter les deviceIds uniques
      const userConversations = this.messageClients.get(userId);
      if (userConversations) {
        userConversations.forEach((conversationClients) => {
          conversationClients.forEach((client) => {
            if (client.deviceId) {
              deviceIds.add(client.deviceId);
            }
          });
        });
      }

      // Sauvegarder l'état de chaque device
      deviceIds.forEach((deviceId) => {
        const savePromise = (async () => {
          // Trouver un client pour ce device
          let clientToSave: AuthenticatedWebSocket | undefined;

          userConversations?.forEach((conversationClients) => {
            conversationClients.forEach((client) => {
              if (client.deviceId === deviceId && !clientToSave) {
                clientToSave = client;
              }
            });
          });

          if (clientToSave) {
            await this.saveClientState(clientToSave);
          }
        })();

        savePromises.push(savePromise);
      });
    });

    // Attendre que tous les états soient sauvegardés (avec timeout)
    await Promise.race([
      Promise.all(savePromises),
      new Promise((resolve) => setTimeout(resolve, timeoutMs / 2)),
    ]);

    wsLogger.info("All client states saved", {
      savedCount: savePromises.length,
    });

    // Attendre que les clients se déconnectent (avec timeout)
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const remainingClients = this.getConnectedClientsCount();

        if (remainingClients === 0) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);

      // Force resolve après timeout
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(true);
      }, timeoutMs);
    });

    // Fermer les connexions restantes
    this.clients.forEach((userClients) => {
      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, "Server shutdown");
        }
      });
    });

    this.messageClients.forEach((userConversations) => {
      userConversations.forEach((conversationClients) => {
        conversationClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(1001, "Server shutdown");
          }
        });
      });
    });

    // Arrêter les timers
    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
      this.stateSaveInterval = null;
    }

    if (this.connectionAttemptsCleanupInterval) {
      clearInterval(this.connectionAttemptsCleanupInterval);
      this.connectionAttemptsCleanupInterval = null;
    }

    // PERF: Arrêter les heartbeat intervals
    for (const interval of this.heartbeatIntervals) {
      clearInterval(interval);
    }
    this.heartbeatIntervals = [];

    wsLogger.info("WebSocket graceful shutdown complete");
  }

  /**
   * PERF: Heartbeat adaptatif - fréquence selon l'activité
   * Active (< 2min) : 30s
   * Idle (> 2min) : 90s (skip si pas encore temps)
   * Réduit la charge CPU/réseau de ~66% pour les connexions idle
   */
  private startAdaptiveHeartbeat(): void {
    // Heartbeat notifications (lecture seule - peut être moins fréquent)
    const notificationInterval = setInterval(() => {
      const now = Date.now();

      this.notificationsWss?.clients.forEach((ws: WebSocket) => {
        const client = ws as AuthenticatedWebSocket;

        // Vérifier si le client est vivant
        if (client.isAlive === false) {
          wsLogger.info("Notifications - Client non réactif, fermeture", {
            userId: client.userId,
          });
          return client.terminate();
        }

        // Déterminer si le client est actif ou idle
        const lastActivity = this.clientLastActivity.get(client) || now;
        const timeSinceActivity = now - lastActivity;
        const isIdle = timeSinceActivity > IDLE_THRESHOLD_MS;

        // Skip heartbeat si idle et dernière vérification récente
        if (
          isIdle &&
          timeSinceActivity % HEARTBEAT_IDLE_MS > HEARTBEAT_ACTIVE_MS
        ) {
          return;
        }

        try {
          client.isAlive = false;
          client.ping();
        } catch (error) {
          wsLogger.error("[WS] Heartbeat notification ping failed", {
            userId: client.userId,
            error: error instanceof Error ? error.message : error,
          });
        }
      });
    }, HEARTBEAT_ACTIVE_MS); // Check toutes les 30s, mais skip si idle

    // Heartbeat messages (actif - fréquence normale)
    const messageInterval = setInterval(() => {
      this.messagesWss?.clients.forEach((ws: WebSocket) => {
        const client = ws as AuthenticatedWebSocket;

        // Vérifier si le client est vivant
        if (client.isAlive === false) {
          wsLogger.info("Messages - Client non réactif, fermeture", {
            userId: client.userId,
            conversationId: client.conversationId,
          });
          return client.terminate();
        }

        // Messages clients sont généralement plus actifs, garder 30s
        try {
          client.isAlive = false;
          client.ping();
        } catch (error) {
          wsLogger.error("[WS] Heartbeat message ping failed", {
            userId: client.userId,
            conversationId: client.conversationId,
            error: error instanceof Error ? error.message : error,
          });
        }
      });
    }, HEARTBEAT_ACTIVE_MS);

    // Store intervals pour cleanup
    this.heartbeatIntervals.push(notificationInterval, messageInterval);

    // Cleanup intervals lors de la fermeture des WebSocket servers
    this.notificationsWss?.on("close", () => {
      clearInterval(notificationInterval);
    });

    this.messagesWss?.on("close", () => {
      clearInterval(messageInterval);
    });

    wsLogger.info("[WS] Adaptive heartbeat started", {
      activeInterval: HEARTBEAT_ACTIVE_MS,
      idleInterval: HEARTBEAT_IDLE_MS,
      idleThreshold: IDLE_THRESHOLD_MS,
    });
  }

  /**
   * Initialiser le serveur WebSocket
   */
  initialize(server: Server): void {
    // WebSocket pour les notifications (noServer: true pour gérer manuellement l'upgrade)
    this.notificationsWss = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
    });

    // WebSocket pour les messages
    this.messagesWss = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
    });

    wsLogger.info("WebSocket Server initialized", {
      paths: ["/ws/notifications", "/ws/messages"],
      instanceId: redisPubSubService.getInstanceId(),
      pubSubEnabled: redisPubSubService.isEnabled(),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // REDIS PUB/SUB - S'ABONNER AUX MESSAGES DES AUTRES INSTANCES
    // ═══════════════════════════════════════════════════════════════════════════
    if (redisPubSubService.isEnabled()) {
      this.setupPubSubHandlers();
      wsLogger.info(
        "Redis Pub/Sub handlers configured for WebSocket clustering",
      );
    } else {
      wsLogger.warn(
        "Redis Pub/Sub disabled - running in single-instance mode (no clustering support)",
      );
    }

    // Gérer manuellement l'upgrade HTTP vers WebSocket
    server.on("upgrade", async (request, socket, head) => {
      const parsedUrl = url.parse(request.url || "", true);
      const pathname = parsedUrl.pathname;

      // WS-007: Masquer le token dans les logs pour éviter le token leakage
      const safeUrl =
        pathname +
        (parsedUrl.query.conv ? `?conv=${parsedUrl.query.conv}` : "");
      wsLogger.info("Upgrade request received", {
        url: safeUrl,
      });

      // WS-004: Validation CORS pour WebSocket
      // En développement : pas de vérification d'origin (clients mobiles sur réseau local
      // peuvent avoir n'importe quelle IP LAN). La sécurité est assurée par le handshake JWT
      // applicatif obligatoire (premier message { type: "auth", token: "..." }).
      // En production : vérification stricte de l'origin dans ALLOWED_WS_ORIGINS.
      const origin = request.headers.origin;
      if (NODE_ENV === "development" && origin) {
        wsLogger.debug("WS upgrade origin (dev mode, non bloquée)", {
          origin,
          pathname,
        });
      }
      if (
        NODE_ENV !== "development" &&
        origin &&
        !ALLOWED_WS_ORIGINS.includes(origin)
      ) {
        wsLogger.error("Origin non autorisée", {
          origin,
        });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // App Check WebSocket : vérification du token passé en query param
      if (NODE_ENV !== "development") {
        const appCheckToken = parsedUrl.query.appcheck as string | undefined;

        if (!appCheckToken) {
          wsLogger.warn("App Check WS absent", { pathname });
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        if (admin.apps.length === 0) {
          if (NODE_ENV === "production") {
            wsLogger.error(
              "[SECURITY] Firebase non initialisé en production — WS refusé",
              { pathname },
            );
            socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
            socket.destroy();
            return;
          }
          wsLogger.warn(
            "Firebase non initialisé — App Check WS ignoré (non-production)",
            { pathname },
          );
        } else {
          try {
            await getAppCheck().verifyToken(appCheckToken);
            wsLogger.debug("App Check WS validé", { pathname });
          } catch {
            wsLogger.warn("App Check WS invalide", { pathname });
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        }
      }

      if (pathname === "/ws/notifications") {
        wsLogger.info("Redirection vers /ws/notifications");
        this.notificationsWss?.handleUpgrade(request, socket, head, (ws) => {
          this.notificationsWss?.emit("connection", ws, request);
        });
      } else if (pathname === "/ws/messages") {
        wsLogger.info("Redirection vers /ws/messages");
        this.messagesWss?.handleUpgrade(request, socket, head, (ws) => {
          this.messagesWss?.emit("connection", ws, request);
        });
      } else {
        wsLogger.error("Chemin inconnu, connexion rejetée", {
          pathname,
        });
        socket.destroy();
      }
    });

    this.notificationsWss.on(
      "connection",
      this.handleNotificationConnection.bind(this),
    );
    this.messagesWss.on("connection", this.handleMessageConnection.bind(this));

    // PERF: Heartbeat adaptatif - démarre les intervals
    this.startAdaptiveHeartbeat();

    // R-5: Nettoyage périodique des tentatives de connexion anciennes
    this.connectionAttemptsCleanupInterval = setInterval(
      () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        for (const [ip, attempt] of this.connectionAttempts.entries()) {
          if (
            attempt.firstAttempt < oneHourAgo &&
            (!attempt.blockedUntil || attempt.blockedUntil < now)
          ) {
            this.connectionAttempts.delete(ip);
          }
        }
      },
      60 * 60 * 1000,
    ); // Toutes les heures

    // PHASE 4: Sauvegarde périodique de l'état des clients connectés (Safety net)
    // PERF: Augmenté à 5 minutes car le debouncing gère les sauvegardes principales
    if (webSocketStateService.isEnabled()) {
      const SAFETY_NET_SAVE_INTERVAL = 300000; // 5 minutes
      this.stateSaveInterval = setInterval(async () => {
        let savedCount = 0;
        const savePromises: Promise<void>[] = [];

        // Sauvegarder l'état de tous les clients messages connectés
        this.messageClients.forEach((userConversations, userId) => {
          const deviceIds = new Set<string>();

          // Collecter les deviceIds uniques
          userConversations.forEach((conversationClients) => {
            conversationClients.forEach((client) => {
              if (client.deviceId && client.readyState === WebSocket.OPEN) {
                deviceIds.add(client.deviceId);
              }
            });
          });

          // Sauvegarder chaque device
          deviceIds.forEach((deviceId) => {
            // Trouver un client pour ce device
            let clientToSave: AuthenticatedWebSocket | undefined;

            userConversations.forEach((conversationClients) => {
              conversationClients.forEach((client) => {
                if (
                  client.deviceId === deviceId &&
                  !clientToSave &&
                  client.readyState === WebSocket.OPEN
                ) {
                  clientToSave = client;
                }
              });
            });

            if (clientToSave) {
              const lastSave = clientToSave.lastStateSave || 0;
              const now = Date.now();

              // Sauvegarder seulement si suffisamment de temps s'est écoulé
              if (now - lastSave >= SAFETY_NET_SAVE_INTERVAL) {
                savePromises.push(this.saveClientState(clientToSave));
                savedCount++;
              }
            }
          });
        });

        // Attendre toutes les sauvegardes
        if (savePromises.length > 0) {
          await Promise.all(savePromises);
          wsLogger.debug("Periodic state save (safety net) complete", {
            savedCount,
          });
        }
      }, SAFETY_NET_SAVE_INTERVAL);

      wsLogger.info("WebSocket state persistence enabled", {
        debounceSave: `${this.STATE_SAVE_DEBOUNCE_MS}ms`,
        safetyNetInterval: `${SAFETY_NET_SAVE_INTERVAL}ms`,
      });
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * REDIS PUB/SUB HANDLERS - CLUSTERING WEBSOCKET
   * ═══════════════════════════════════════════════════════════════════════════
   * Configuration des handlers pour recevoir les messages des autres instances
   * ═══════════════════════════════════════════════════════════════════════════
   */
  private setupPubSubHandlers(): void {
    // Handler pour les notifications
    redisPubSubService.subscribe(
      "websocket:notifications",
      (payload: NotificationPayload) => {
        this.handleRemoteNotification(payload);
      },
    );

    // Handler pour les messages (pattern matching sur les conversations)
    // Note: On s'abonne dynamiquement quand des clients se connectent à une conversation
    // Voir handleMessageConnection() pour l'abonnement dynamique

    // Handler pour les broadcasts système
    redisPubSubService.subscribe("websocket:broadcast", (payload: any) => {
      this.handleRemoteBroadcast(payload);
    });

    wsLogger.info("Subscribed to Redis Pub/Sub channels", {
      channels: ["websocket:notifications", "websocket:broadcast"],
    });
  }

  /**
   * Traiter une notification reçue d'une autre instance
   */
  private handleRemoteNotification(payload: NotificationPayload): void {
    const { userId, notification } = payload;

    wsLogger.debug("Received remote notification", {
      userId,
      fromInstance: redisPubSubService.getInstanceId(),
    });

    // Envoyer aux clients locaux uniquement
    this.sendNotificationToUserLocal(userId, notification);
  }

  /**
   * Traiter un message de conversation reçu d'une autre instance
   */
  private handleRemoteMessage(payload: MessagePayload): void {
    const {
      conversationId,
      message,
      excludeUserId,
      participantIds,
      senderName,
    } = payload;

    wsLogger.debug("Received remote message", {
      conversationId,
      fromInstance: redisPubSubService.getInstanceId(),
    });

    // Diffuser aux clients locaux uniquement
    this.broadcastToConversationLocal(
      conversationId,
      message,
      excludeUserId,
      participantIds,
      senderName,
    );
  }

  /**
   * Traiter un broadcast système reçu d'une autre instance
   */
  private handleRemoteBroadcast(payload: any): void {
    const { event, data } = payload;

    wsLogger.info("Received remote broadcast", {
      event,
      fromInstance: redisPubSubService.getInstanceId(),
    });

    // Implémenter selon les besoins (maintenance, restart, etc.)
  }

  /**
   * S'abonner dynamiquement aux messages d'une conversation
   */
  private async subscribeToConversation(conversationId: string): Promise<void> {
    if (!redisPubSubService.isEnabled()) return;

    const channel = `websocket:messages:${conversationId}`;
    await redisPubSubService.subscribe(channel, (payload: MessagePayload) => {
      this.handleRemoteMessage(payload);
    });

    wsLogger.debug("Subscribed to conversation channel", {
      conversationId,
      channel,
    });
  }

  /**
   * Gérer une nouvelle connexion WebSocket pour les notifications
   */
  private async handleNotificationConnection(
    ws: WebSocket,
    request: any,
  ): Promise<void> {
    const client = ws as AuthenticatedWebSocket;
    client.isAlive = true;

    // Vérifier le rate limiting par IP
    const ip = request.socket.remoteAddress || "unknown";
    const rateLimitCheck = this.canConnect(ip);

    if (!rateLimitCheck.allowed) {
      wsLogger.warn("Notifications - Connexion refusée (rate limit)", {
        ip: anonymizeIp(ip),
        reason: rateLimitCheck.reason,
      });
      client.close(4029, rateLimitCheck.reason);
      return;
    }

    // Heartbeat
    client.on("pong", () => {
      client.isAlive = true;
    });

    // FIX-7: Listener d'erreur pour éviter les uncaught exceptions sur le client
    client.on("error", (err) => {
      wsLogger.error("Notifications - Erreur client WebSocket", {
        userId: client.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // FIX-2: Auth handshake via premier message applicatif (token JWT)
    // Le token arrive dans le premier message { type: "auth", token: "..." }
    // Timeout 5s → fermeture avec 4001 "Auth timeout"
    const AUTH_TIMEOUT_MS = 5000;
    const authTimeout = setTimeout(() => {
      wsLogger.warn("Notifications - Auth timeout, fermeture", {
        ip: anonymizeIp(ip),
      });
      client.close(4001, "Auth timeout");
    }, AUTH_TIMEOUT_MS);

    client.once("message", async (rawMsg: Buffer) => {
      clearTimeout(authTimeout);

      let authData: any;
      try {
        authData = safeJsonParse(rawMsg.toString(), {
          context: "websocket-auth",
          maxDepth: 3,
        });
      } catch {
        wsLogger.error("Notifications - Premier message non JSON");
        client.close(4001, "Auth required");
        return;
      }

      if (!authData || authData.type !== "auth" || !authData.token) {
        wsLogger.error("Notifications - Premier message n'est pas un auth");
        client.close(4001, "Auth required");
        return;
      }

      const token: string = authData.token;

      try {
        // Vérifier le token JWT
        if (!process.env.JWT_SECRET) {
          wsLogger.error("SECURITY - JWT_SECRET non défini");
          throw new Error("Configuration de sécurité manquante");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ["HS256"],
        }) as {
          id: string;
          type?: string;
          jti?: string;
          wsType?: string;
        };

        // WS-008: Vérifier que le token est bien de type 'websocket'
        if (decoded.type !== "websocket") {
          wsLogger.error(
            'Notifications - Token invalide: type attendu "websocket"',
          );
          client.close(4002, "Invalid token type");
          return;
        }

        // Vérifier que le token est destiné aux notifications
        if (decoded.wsType && decoded.wsType !== "notifications") {
          wsLogger.error(
            'Notifications - Token invalide: wsType attendu "notifications"',
            {
              wsType: decoded.wsType,
            },
          );
          client.close(4002, "Invalid token type for this connection");
          return;
        }

        // AUTH-004 CORRIGÉ: Vérifier que le token est à usage unique
        // R-1: Rejeter explicitement les tokens sans JTI
        if (!decoded.jti) {
          wsLogger.error("Notifications - Token invalide: JTI manquant");
          client.close(4002, "Invalid token: missing JTI");
          return;
        }
        const isTokenValid = await redisSessionService.consumeWsToken(
          decoded.jti,
        );
        if (!isTokenValid) {
          wsLogger.error("Notifications - Token déjà utilisé", {
            jti: decoded.jti.substring(0, 8) + "...",
          });
          client.close(4003, "Token already used");
          return;
        }
        wsLogger.info("Notifications - Token à usage unique validé", {
          jti: decoded.jti.substring(0, 8) + "...",
        });

        client.userId = decoded.id;

        // PHASE 4: Extraire ou générer le deviceId
        client.deviceId = this.getOrGenerateDeviceId(request);

        // PERF: Initialiser l'activité pour heartbeat adaptatif
        this.clientLastActivity.set(client, Date.now());

        // Ajouter le client à la map
        if (!this.clients.has(client.userId)) {
          this.clients.set(client.userId, new Set());
        }
        const userClientsSet = this.clients.get(client.userId);
        if (userClientsSet) {
          userClientsSet.add(client);
        }

        wsLogger.info("Notifications - Client connecté", {
          userId: client.userId,
          deviceId: client.deviceId,
        });

        // Envoyer un message de confirmation
        client.send(
          JSON.stringify({
            type: "connected",
            message: "WebSocket notifications connecté avec succès",
            userId: client.userId,
            deviceId: client.deviceId,
          }),
        );

        // Gérer la fermeture
        client.on("close", () => {
          // PERF: Cleanup activity tracking
          this.clientLastActivity.delete(client);

          if (client.userId) {
            const userClients = this.clients.get(client.userId);
            if (userClients) {
              userClients.delete(client);
              if (userClients.size === 0) {
                this.clients.delete(client.userId);
                // PERF: plus aucun client pour ce user → purger les timers orphelins
                if (!this.findClientByUserId(client.userId)) {
                  this.cancelDebouncedSave(client.userId);
                }
              }
            }
            wsLogger.info("Notifications - Client déconnecté", {
              userId: client.userId,
            });
          }
        });

        // R-8: Canal notifications en lecture seule — retourner une erreur explicite
        client.on("message", () => {
          this.safeSend(
            client,
            JSON.stringify({
              type: "error",
              code: "CHANNEL_READONLY",
              message: "Le canal notifications est en lecture seule",
            }),
          );
        });
      } catch (error) {
        wsLogger.error("Notifications - Token invalide", { error });
        client.close(4002, "Invalid token");
      }
    });
  }

  /**
   * Gérer une nouvelle connexion WebSocket pour les messages
   */
  private async handleMessageConnection(
    ws: WebSocket,
    request: any,
  ): Promise<void> {
    const client = ws as AuthenticatedWebSocket;
    client.isAlive = true;
    client.messageCount = 0;
    client.messageCountResetTime = Date.now();

    // Vérifier le rate limiting par IP
    const ip = request.socket.remoteAddress || "unknown";
    const rateLimitCheck = this.canConnect(ip);

    if (!rateLimitCheck.allowed) {
      wsLogger.warn("Messages - Connexion refusée (rate limit)", {
        ip: anonymizeIp(ip),
        reason: rateLimitCheck.reason,
      });
      client.close(4029, rateLimitCheck.reason);
      return;
    }

    // Heartbeat
    client.on("pong", () => {
      client.isAlive = true;
    });

    // FIX-7: Listener d'erreur pour éviter les uncaught exceptions sur le client
    client.on("error", (err) => {
      wsLogger.error("Messages - Erreur client WebSocket", {
        userId: client.userId,
        conversationId: client.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // FIX-2: conv reste en query string, user disparaît, token via premier message
    const query = url.parse(request.url, true).query;
    const conversationId = query.conv as string;

    if (!conversationId) {
      wsLogger.error("Messages - Connexion refusée : paramètre conv manquant");
      client.close(4001, "Missing parameters");
      return;
    }

    // FIX-2: Auth handshake via premier message applicatif (token JWT)
    // Timeout 5s → fermeture avec 4001 "Auth timeout"
    const AUTH_TIMEOUT_MS = 5000;
    const authTimeout = setTimeout(() => {
      wsLogger.warn("Messages - Auth timeout, fermeture", {
        ip: anonymizeIp(ip),
      });
      client.close(4001, "Auth timeout");
    }, AUTH_TIMEOUT_MS);

    client.once("message", async (rawMsg: Buffer) => {
      clearTimeout(authTimeout);

      let authData: any;
      try {
        authData = safeJsonParse(rawMsg.toString(), {
          context: "websocket-auth",
          maxDepth: 3,
        });
      } catch {
        wsLogger.error("Messages - Premier message non JSON");
        client.close(4001, "Auth required");
        return;
      }

      if (!authData || authData.type !== "auth" || !authData.token) {
        wsLogger.error("Messages - Premier message n'est pas un auth");
        client.close(4001, "Auth required");
        return;
      }

      const token: string = authData.token;

      try {
        // Vérifier le token JWT
        if (!process.env.JWT_SECRET) {
          wsLogger.error("SECURITY - JWT_SECRET non défini");
          throw new Error("Configuration de sécurité manquante");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ["HS256"],
        }) as {
          id: string;
          type?: string;
          jti?: string;
          wsType?: string;
        };

        // WS-008: Vérifier que le token est bien de type 'websocket'
        if (decoded.type !== "websocket") {
          wsLogger.error('Messages - Token invalide: type attendu "websocket"');
          client.close(4002, "Invalid token type");
          return;
        }

        // Vérifier que le token est destiné aux messages
        if (decoded.wsType && decoded.wsType !== "messages") {
          wsLogger.error(
            'Messages - Token invalide: wsType attendu "messages"',
            {
              wsType: decoded.wsType,
            },
          );
          client.close(4002, "Invalid token type for this connection");
          return;
        }

        // AUTH-004 CORRIGÉ: Vérifier que le token est à usage unique
        // R-1: Rejeter explicitement les tokens sans JTI
        if (!decoded.jti) {
          wsLogger.error("Messages - Token invalide: JTI manquant");
          client.close(4002, "Invalid token: missing JTI");
          return;
        }
        const isTokenValid = await redisSessionService.consumeWsToken(
          decoded.jti,
        );
        if (!isTokenValid) {
          wsLogger.error("Messages - Token déjà utilisé", {
            jti: decoded.jti.substring(0, 8) + "...",
          });
          client.close(4003, "Token already used");
          return;
        }
        wsLogger.info("Messages - Token à usage unique validé", {
          jti: decoded.jti.substring(0, 8) + "...",
        });

        client.userId = decoded.id;
        client.conversationId = conversationId;

        // PHASE 4: Extraire ou générer le deviceId
        client.deviceId = this.getOrGenerateDeviceId(request);

        // WS-001: Vérifier que l'utilisateur est bien participant de la conversation
        // Note: participants est un tableau de sous-documents avec userId, pas de simples ObjectIds
        const conversation = await ConversationModel.findOne({
          _id: conversationId,
          "participants.userId": client.userId,
        }).lean();

        if (!conversation) {
          wsLogger.error(
            "Messages - Accès refusé: utilisateur n'est pas participant de la conversation",
            {
              userId: client.userId,
              conversationId,
            },
          );
          client.close(4003, "Not a participant");
          return;
        }

        // PHASE 4: Vérifier si c'est une reconnexion avec état existant
        const existingState = await webSocketStateService.getClientState(
          client.userId,
          client.deviceId,
        );

        // CLUSTERING: S'abonner aux messages de cette conversation depuis les autres instances
        await this.subscribeToConversation(conversationId);

        // Ajouter le client à la conversation (avec index inversé)
        this.addClientToConversation(client, conversationId);

        // PERF: Initialiser l'activité pour heartbeat adaptatif
        this.clientLastActivity.set(client, Date.now());

        wsLogger.info("Messages - Client connecté", {
          userId: client.userId,
          conversationId,
          deviceId: client.deviceId,
          hasExistingState: !!existingState,
        });

        // PHASE 4: Si état existant, restaurer automatiquement
        if (existingState) {
          await this.restoreClientState(client, client.deviceId);
        } else {
          // Envoyer un message de confirmation standard
          client.send(
            JSON.stringify({
              type: "connected",
              message: "WebSocket messages connecté avec succès",
              userId: client.userId,
              conversationId: conversationId,
              deviceId: client.deviceId,
            }),
          );
        }

        // PHASE 4: Marquer l'état comme dirty (sauvegarde différée via debouncing)
        if (client.userId) {
          this.markStateDirty(client.userId);
        }

        // Gérer les messages entrants
        client.on("message", async (message: Buffer) => {
          // PERF: Tracker l'activité pour heartbeat adaptatif
          this.clientLastActivity.set(client, Date.now());

          try {
            // WS-003: Rate limiting par message
            const now = Date.now();
            if (
              now - (client.messageCountResetTime || 0) >
              MESSAGE_RATE_LIMIT_WINDOW_MS
            ) {
              client.messageCount = 0;
              client.messageCountResetTime = now;
            }

            client.messageCount = (client.messageCount || 0) + 1;

            if (client.messageCount > MAX_MESSAGES_PER_MINUTE) {
              wsLogger.warn("Messages - Rate limit atteint", {
                userId: client.userId,
                messagesPerMin: client.messageCount,
              });
              client.send(
                JSON.stringify({
                  type: "error",
                  code: "RATE_LIMIT_EXCEEDED",
                  message: "Trop de messages envoyés. Veuillez ralentir.",
                }),
              );
              return;
            }

            // Limite de taille des messages (WS-005 préventif)
            const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
            if (message.length > MAX_MESSAGE_SIZE) {
              wsLogger.warn("Messages - Message trop volumineux", {
                userId: client.userId,
                sizeBytes: message.length,
              });
              client.send(
                JSON.stringify({
                  type: "error",
                  code: "MESSAGE_TOO_LARGE",
                  message: "Message trop volumineux",
                }),
              );
              return;
            }

            let data: any;
            try {
              data = safeJsonParse(message.toString(), {
                context: "websocket-message-data",
                maxDepth: 5,
              });
            } catch (_parseError) {
              wsLogger.warn("Messages - JSON invalide", {
                userId: client.userId,
              });
              client.send(
                JSON.stringify({
                  type: "error",
                  code: "INVALID_JSON",
                  message: "Format JSON invalide",
                }),
              );
              return;
            }

            // WS-006: Validation de schéma - types de message autorisés
            const ALLOWED_MESSAGE_TYPES = [
              "message",
              "getMessages",
              "markMessageAsRead",
              "replyToMessage",
              "editMessage",
              "deleteMessage",
              "resume", // PHASE 4
              "ack", // PHASE 4
            ];
            if (
              !data ||
              typeof data !== "object" ||
              !data.type ||
              !ALLOWED_MESSAGE_TYPES.includes(data.type)
            ) {
              wsLogger.warn("Messages - Type de message invalide", {
                userId: client.userId,
                messageType: data?.type,
              });
              client.send(
                JSON.stringify({
                  type: "error",
                  code: "INVALID_MESSAGE_TYPE",
                  message: "Type de message non supporté",
                }),
              );
              return;
            }

            // ZOD: Validation du schéma par type de message
            const schema = WsMessageSchemas[data.type];
            if (schema) {
              const result = schema.safeParse(data);
              if (!result.success) {
                const firstError = result.error.issues[0];
                wsLogger.warn("Messages - Validation zod échouée", {
                  userId: client.userId,
                  messageType: data.type,
                  error: firstError?.message,
                });
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: "VALIDATION_ERROR",
                    message: firstError?.message || "Données invalides",
                    field: firstError?.path?.join("."),
                  }),
                );
                return;
              }
              // Remplacer data par les données validées et typées
              data = result.data;
            }

            // WS-001 CORRIGÉ + HIGH-6: Vérification de participation à CHAQUE message (avec cache)
            // Cela empêche un utilisateur retiré d'une conversation de continuer à envoyer des messages
            if (!client.userId) {
              wsLogger.error("Messages - userId manquant");
              client.close(4002, "Invalid session");
              return;
            }

            const isParticipant = await this.checkConversationParticipation(
              client.userId,
              conversationId,
            );

            if (!isParticipant) {
              wsLogger.warn(
                "Messages - Accès révoqué: utilisateur n'est plus participant",
                {
                  userId: client.userId,
                  conversationId,
                },
              );
              client.send(
                JSON.stringify({
                  type: "error",
                  code: "ACCESS_REVOKED",
                  message: "Vous n'êtes plus participant de cette conversation",
                }),
              );
              // Fermer la connexion car l'utilisateur n'a plus accès
              client.close(4003, "Access revoked");
              return;
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // VÉRIFICATION BLOCAGE : Empêcher l'envoi/réception si conversation bloquée
            // PERF: Utilise cache Redis (TTL 5min) pour réduire requêtes MongoDB de 90%
            // ═══════════════════════════════════════════════════════════════════════════
            if (data.type === "message") {
              try {
                const blockingStatus =
                  await this.getConversationBlockingStatus(conversationId);

                const isBlocked = blockingStatus.blockedBy?.some(
                  (b: any) => b.userId === client.userId,
                );

                if (isBlocked) {
                  wsLogger.warn("Messages - Conversation bloquée", {
                    userId: client.userId,
                    conversationId,
                  });
                  client.send(
                    JSON.stringify({
                      type: "error",
                      code: "CONVERSATION_BLOCKED",
                      message: "Cette conversation est bloquée",
                    }),
                  );
                  return;
                }
              } catch (err) {
                wsLogger.error("Messages - Erreur vérification blocage", {
                  error: err instanceof Error ? err.message : String(err),
                });
                // En cas d'erreur, on continue pour ne pas bloquer la messagerie
              }
            }

            wsLogger.info("Messages - Message reçu", {
              userId: client.userId,
              conversationId,
              messageType: data.type,
            });

            // FIX-4: Appels directs aux fonctions du service (suppression des fake req/res)
            if (data.type === "message") {
              // Envoi d'un message
              try {
                const result = await createMessageOp(
                  client.userId,
                  conversationId,
                  data.content,
                  data.messageType || "text",
                  data.metadata || undefined,
                );
                // Le message retourné contient le content en clair — broadcast direct
                const { type: msgType, ...msgWithoutType } = result.message;
                this.broadcastToConversation(
                  conversationId,
                  {
                    type: "new_message",
                    messageType: msgType,
                    ...msgWithoutType,
                  },
                  undefined,
                  result.participantIds,
                  result.message.content,
                );
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "getMessages") {
              // Récupération des messages
              try {
                const result = await getMessagesOp(
                  client.userId,
                  conversationId,
                  data.query || {},
                );
                client.send(JSON.stringify({ type: "messages", ...result }));
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "markMessageAsRead") {
              // Marquer un message comme lu
              try {
                const result = await markMessageAsReadOp(
                  client.userId,
                  data.messageId,
                  conversationId,
                );
                client.send(
                  JSON.stringify({ type: "message_read", ...result }),
                );
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "replyToMessage") {
              // Répondre à un message
              try {
                await replyToMessageOp(
                  client.userId,
                  data.messageId,
                  data.content,
                );
                client.send(
                  JSON.stringify({ type: "message_reply", success: true }),
                );
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "editMessage") {
              // Modifier un message
              try {
                await editMessageOp(
                  client.userId,
                  data.messageId,
                  data.content,
                );
                client.send(
                  JSON.stringify({ type: "message_edited", success: true }),
                );
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "deleteMessage") {
              // Supprimer un message
              try {
                await deleteMessageOp(client.userId, data.messageId);
                client.send(
                  JSON.stringify({ type: "message_deleted", success: true }),
                );
              } catch (err) {
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: err instanceof Error && err.message.startsWith("NOT_") ? err.message : "OPERATION_FAILED",
                    message: "Opération impossible",
                  }),
                );
              }
            } else if (data.type === "resume") {
              // PHASE 4: Resume connection avec état sauvegardé
              wsLogger.info("Messages - Resume request", {
                userId: client.userId,
                deviceId: data.deviceId,
              });

              try {
                const restored = await this.restoreClientState(
                  client,
                  data.deviceId,
                );

                if (!restored) {
                  // Pas d'état existant - envoyer sync_required
                  client.send(
                    JSON.stringify({
                      type: "sync_required",
                      reason: "no_previous_state",
                      message:
                        "Aucun état précédent trouvé, synchronisation complète requise",
                    }),
                  );
                }
              } catch (err) {
                wsLogger.error("Messages - Resume failed", {
                  userId: client.userId,
                  error: err instanceof Error ? err.message : String(err),
                });
                client.send(
                  JSON.stringify({
                    type: "error",
                    code: "RESUME_FAILED",
                    message: "Échec de la reprise de connexion",
                  }),
                );
              }
            } else if (data.type === "ack") {
              // PHASE 4: Acknowledge message delivery
              if (!client.userId || !client.deviceId) {
                return;
              }

              wsLogger.debug("Messages - ACK received", {
                userId: client.userId,
                messageId: data.messageId,
                conversationId: data.conversationId || conversationId,
              });

              // Marquer le message comme livré
              await webSocketStateService.markMessageDelivered(
                client.userId,
                client.deviceId,
                data.messageId,
              );

              // Optionnel: Confirmer l'ACK au client
              // (le client n'attend généralement pas de confirmation)
            } else {
              client.send(
                JSON.stringify({
                  type: "error",
                  details: "Type de message non supporté",
                }),
              );
            }
          } catch (error) {
            wsLogger.error("Messages - Erreur parsing message", { error });
          }
        });

        // Gérer la fermeture
        client.on("close", async () => {
          // PERF: Cleanup activity tracking
          this.clientLastActivity.delete(client);

          // PHASE 4: Sauvegarder l'état avant déconnexion
          try {
            if (client.userId && client.deviceId) {
              await this.saveClientState(client);
              wsLogger.info("Messages - État sauvegardé avant déconnexion", {
                userId: client.userId,
                deviceId: client.deviceId,
              });
            }
          } catch (error) {
            wsLogger.error("Messages - Échec sauvegarde état avant déconnexion", { error });
          } finally {
            if (client.userId) {
              // Retirer le client de la conversation (avec index inversé)
              this.removeClientFromConversation(client, conversationId);

              // PERF: si plus aucun socket pour ce user, purger les timers orphelins
              if (!this.findClientByUserId(client.userId)) {
                this.cancelDebouncedSave(client.userId);
              }

              wsLogger.info("Messages - Client déconnecté", {
                userId: client.userId,
                conversationId,
              });
            }
          }
        });
      } catch (error) {
        wsLogger.error("Messages - Token invalide", { error });
        client.close(4002, "Invalid token");
      }
    });
  }

  /**
   * Diffuser un message à tous les participants d'une conversation
   * WS-002: Ne diffuse qu'aux clients qui ont été validés comme participants
   * lors de leur connexion (voir WS-001 dans handleMessageConnection)
   *
   * FIX-5: cachedParticipantIds et cachedSenderName optionnels pour éviter
   * des requêtes MongoDB supplémentaires dans notifyConversationUpdate
   *
   * CLUSTERING: Publie aussi via Redis Pub/Sub pour les autres instances
   */
  private broadcastToConversation(
    conversationId: string,
    message: any,
    excludeUserId?: string,
    cachedParticipantIds?: string[],
    cachedSenderName?: string,
  ): void {
    // Diffuser localement
    this.broadcastToConversationLocal(
      conversationId,
      message,
      excludeUserId,
      cachedParticipantIds,
      cachedSenderName,
    );

    // Publier pour les autres instances (si clustering activé)
    if (redisPubSubService.isEnabled()) {
      redisPubSubService.publishMessage(
        conversationId,
        message,
        excludeUserId,
        cachedParticipantIds,
        cachedSenderName,
      );
    }
  }

  /**
   * Version locale uniquement (sans Redis Pub/Sub)
   * PERF: Utilise le reverse index pour itérer seulement sur les participants
   */
  private broadcastToConversationLocal(
    conversationId: string,
    message: any,
    excludeUserId?: string,
    cachedParticipantIds?: string[],
    cachedSenderName?: string,
  ): number {
    let sentCount = 0;
    const startTime = Date.now();

    // PERF: Utiliser le reverse index pour itérer seulement sur les participants
    const conversationClients = this.conversationClients.get(conversationId);

    if (!conversationClients || conversationClients.size === 0) {
      wsLogger.debug("[WS] No clients found for conversation (local)", {
        conversationId,
        duration: Date.now() - startTime,
      });

      // Notifier quand même les participants via le WebSocket de notifications
      if (message.type === "new_message") {
        this.notifyConversationUpdate(
          conversationId,
          message,
          excludeUserId,
          cachedParticipantIds,
          cachedSenderName,
        );
      }

      return 0;
    }

    // Itérer directement sur les clients de la conversation (O(N) au lieu de O(total_users))
    for (const client of conversationClients) {
      const userId = client.userId;

      // Exclure l'expéditeur si demandé
      if (excludeUserId && userId === excludeUserId) {
        continue;
      }

      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(message));
          sentCount++;
        } catch (error) {
          wsLogger.error("[WS] Error sending message to client (local)", {
            userId,
            conversationId,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    }

    const duration = Date.now() - startTime;

    wsLogger.debug("[WS] Broadcast to conversation completed (local)", {
      conversationId,
      sentCount,
      clientsCount: conversationClients.size,
      duration,
    });

    // Notifier TOUS les participants de la conversation via le WebSocket de notifications
    // pour qu'ils puissent mettre à jour leur liste de conversations
    if (message.type === "new_message") {
      this.notifyConversationUpdate(
        conversationId,
        message,
        excludeUserId,
        cachedParticipantIds,
        cachedSenderName,
      );
    }

    return sentCount;
  }

  /**
   * Notifier tous les participants d'une conversation qu'il y a eu une mise à jour
   * Utilisé pour mettre à jour la liste des conversations en temps réel
   *
   * FIX-5: cachedParticipantIds et cachedSenderName optionnels pour éviter
   * 2 requêtes MongoDB par broadcast si les données sont déjà disponibles.
   */
  async notifyConversationUpdate(
    conversationId: string,
    message: any,
    excludeUserId?: string,
    cachedParticipantIds?: string[],
    cachedSenderName?: string,
  ): Promise<void> {
    try {
      let participantIds: string[];
      let senderName: string;

      if (cachedParticipantIds) {
        // FIX-5: Utiliser les participantIds déjà disponibles (évite 1 requête MongoDB)
        participantIds = cachedParticipantIds.filter(
          (id) => id !== excludeUserId,
        );
      } else {
        // Récupérer tous les participants de la conversation
        const conversation =
          await ConversationModel.findById(conversationId).lean();
        if (!conversation) return;
        participantIds = conversation.participants
          .map((p: any) => p.userId.toString())
          .filter((id: string) => id !== excludeUserId);
      }

      if (cachedSenderName !== undefined) {
        // FIX-5: Utiliser le nom d'expéditeur déjà disponible (évite 1 requête MongoDB)
        senderName = cachedSenderName;
      } else {
        // Récupérer le nom d'affichage de l'expéditeur
        senderName = "Un utilisateur";
        if (message.senderId) {
          try {
            const sender = await UserModel.findById(message.senderId)
              .select("name surname pseudo showPseudo")
              .lean();

            if (sender) {
              // Si showPseudo est activé et pseudo existe, utiliser le pseudo
              if ((sender as any).showPseudo && (sender as any).pseudo) {
                try {
                  senderName = decrypt((sender as any).pseudo);
                } catch {
                  // Fallback sur le prénom
                  senderName = decrypt((sender as any).name);
                }
              } else {
                // Utiliser le prénom
                senderName = decrypt((sender as any).name);
              }
            }
          } catch (e) {
            wsLogger.error("Failed to retrieve sender name", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      // Envoyer une notification de mise à jour à chaque participant connecté au WS notifications
      // Note: On n'utilise PAS sendNotificationToUser car il ajoute type: 'notification'
      // qui serait écrasé par notre type: 'conversation_update'
      participantIds.forEach((userId: string) => {
        const userClients = this.clients.get(userId);

        if (!userClients || userClients.size === 0) {
          wsLogger.info(
            "No clients connected for user in conversation update",
            {
              userId,
            },
          );
          return;
        }

        const updateMessage = JSON.stringify({
          type: "conversation_update",
          conversationId,
          lastMessage: message.content,
          senderId: message.senderId,
          senderName: senderName,
          createdAt: message.createdAt,
          incrementUnread: userId !== message.senderId,
        });

        userClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            this.safeSend(client, updateMessage);
            wsLogger.info("Conversation update sent to user", { userId });
          }
        });
      });

      wsLogger.info("Conversation update notification sent", {
        conversationId,
        participantCount: participantIds.length,
      });
    } catch (error) {
      wsLogger.error("Failed to notify conversation update", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    }
  }

  /**
   * Envoyer un message à un utilisateur dans une conversation spécifique
   */
  sendMessageToUserInConversation(
    userId: string,
    conversationId: string,
    message: any,
  ): void {
    const userConversations = this.messageClients.get(userId);
    if (!userConversations) {
      wsLogger.info("User not connected to messages WebSocket", { userId });
      return;
    }

    const conversationClients = userConversations.get(conversationId);
    if (!conversationClients || conversationClients.size === 0) {
      wsLogger.info("User not connected to conversation", {
        userId,
        conversationId,
      });
      return;
    }

    const messageStr = JSON.stringify({
      type: "message",
      ...message,
    });

    conversationClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, messageStr);
        wsLogger.info("Message sent to user in conversation", {
          userId,
          conversationId,
        });
      }
    });
  }

  /**
   * Envoyer une notification à un utilisateur spécifique
   * CLUSTERING: Publie aussi via Redis Pub/Sub pour les autres instances
   */
  sendNotificationToUser(userId: string, notification: any): void {
    // Envoyer localement
    this.sendNotificationToUserLocal(userId, notification);

    // Publier pour les autres instances (si clustering activé)
    if (redisPubSubService.isEnabled()) {
      redisPubSubService.publishNotification(userId, notification);
    }
  }

  /**
   * Version locale uniquement (sans Redis Pub/Sub)
   */
  private sendNotificationToUserLocal(userId: string, notification: any): void {
    const userClients = this.clients.get(userId);

    if (!userClients || userClients.size === 0) {
      wsLogger.info("No clients connected for user notification", { userId });
      return;
    }

    const message = JSON.stringify({
      type: "notification",
      ...notification,
    });

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, message);
        wsLogger.info("Notification sent to user (local)", { userId });
      }
    });
  }

  /**
   * Envoyer une notification à plusieurs utilisateurs
   */
  sendNotificationToUsers(userIds: string[], notification: any): void {
    userIds.forEach((userId) => {
      this.sendNotificationToUser(userId, notification);
    });
  }

  /**
   * Notifier un utilisateur que le mobile a poussé des changements
   * Permet au PC de rafraîchir ses données en temps réel
   */
  notifySyncUpdate(
    userId: string,
    changes: {
      points: number;
      fiches: number;
      lists: number;
      sosContacts: number;
    },
  ): void {
    const userClients = this.clients.get(userId);

    if (!userClients || userClients.size === 0) {
      wsLogger.info(
        "User not connected for sync update, will refresh on next focus",
        { userId },
      );
      return;
    }

    const message = JSON.stringify({
      type: "sync_update",
      data: {
        source: "mobile",
        changes: {
          points: changes.points,
          fiches: changes.fiches,
          lists: changes.lists,
          sosContacts: changes.sosContacts,
        },
        timestamp: new Date().toISOString(),
      },
    });

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, message);
      }
    });

    wsLogger.info("Sync update sent to user", {
      userId,
      points: changes.points,
      fiches: changes.fiches,
      lists: changes.lists,
      sosContacts: changes.sosContacts,
    });
  }

  /**
   * Notifier qu'une notification a été lue
   */
  notifyNotificationRead(userId: string, notificationId: string): void {
    this.sendNotificationToUser(userId, {
      type: "notification_read",
      notificationId,
    });
  }

  /**
   * Notifier que des messages ont été lus dans une conversation
   * @param conversationId - ID de la conversation
   * @param readByUserId - ID de l'utilisateur qui a lu les messages
   * @param messageIds - IDs des messages lus
   * @param participantUserIds - IDs des participants à notifier
   */
  notifyMessagesRead(
    conversationId: string,
    readByUserId: string,
    messageIds: string[],
    participantUserIds: string[],
  ): void {
    wsLogger.info("Notifying messages read", {
      conversationId,
      readByUserId,
    });

    const message = JSON.stringify({
      type: "message_read",
      conversationId,
      userId: readByUserId,
      messageIds,
    });

    // Envoyer à tous les autres participants
    for (const userId of participantUserIds) {
      if (userId === readByUserId) continue; // Ne pas notifier l'utilisateur qui a lu

      const userClients = this.clients.get(userId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, message);
          wsLogger.info("Message read notification sent", { userId });
        }
      });
    }
  }

  /**
   * Obtenir le nombre de clients connectés (notifications + messages)
   */
  getConnectedClientsCount(): number {
    const notificationCount = this.notificationsWss?.clients.size || 0;
    const messageCount = this.messagesWss?.clients.size || 0;
    return notificationCount + messageCount;
  }

  /**
   * Obtenir le nombre d'utilisateurs connectés (notifications)
   */
  getConnectedUsersCount(): number {
    return this.clients.size;
  }

  /**
   * Vérifier si un utilisateur est connecté
   */
  isUserConnected(userId: string): boolean {
    const userClients = this.clients.get(userId);
    return userClients !== undefined && userClients.size > 0;
  }

  /**
   * Vérifier si un utilisateur est connecté à une conversation spécifique (WebSocket messages)
   */
  isUserConnectedToConversation(
    userId: string,
    conversationId: string,
  ): boolean {
    const userConversations = this.messageClients.get(userId);
    if (!userConversations) {
      wsLogger.debug("User not connected to any conversation", {
        userId,
        conversationId,
      });
      return false;
    }

    const conversationClients = userConversations.get(conversationId);
    if (!conversationClients || conversationClients.size === 0) {
      wsLogger.debug("User has no clients for conversation", {
        userId,
        conversationId,
      });
      return false;
    }

    // Vérifier qu'au moins un client est vraiment connecté
    let openCount = 0;
    for (const client of conversationClients) {
      if (client.readyState === WebSocket.OPEN) {
        openCount++;
      }
    }

    const isConnected = openCount > 0;
    wsLogger.debug("Checked user connection to conversation", {
      userId,
      conversationId,
      isConnected,
      openCount,
      totalClients: conversationClients.size,
    });
    return isConnected;
  }

  /**
   * Notifier les utilisateurs d'une nouvelle conversation créée
   * @param participantIds - IDs des participants à notifier
   * @param conversation - Données de la conversation
   * @param creatorId - ID du créateur (ne sera pas notifié)
   */
  notifyNewConversation(
    participantIds: string[],
    conversation: any,
    creatorId: string,
  ): void {
    wsLogger.info("Notifying new conversation to participants", {
      conversationId: conversation._id,
    });

    const message = JSON.stringify({
      type: "new_conversation",
      conversation: {
        _id: conversation._id,
        name: conversation.name,
        isGroup: conversation.isGroup,
        creatorId: conversation.creatorId,
        participants: conversation.participants,
        lastMessage: conversation.lastMessage,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });

    for (const userId of participantIds) {
      // Ne pas notifier le créateur (il a déjà la conversation)
      if (userId === creatorId) continue;

      const userClients = this.clients.get(userId);
      if (!userClients || userClients.size === 0) {
        wsLogger.info("User not connected for new conversation notification", {
          userId,
        });
        continue;
      }

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, message);
          wsLogger.info("New conversation notification sent", { userId });
        }
      });
    }
  }

  /**
   * Notifier les participants qu'un groupe a été supprimé
   * @param conversationId - ID du groupe supprimé
   * @param participantIds - IDs des participants à notifier
   * @param deletedByUserId - ID de l'admin qui a supprimé (ne sera pas notifié)
   */
  notifyGroupDeleted(
    conversationId: string,
    participantIds: string[],
    deletedByUserId: string,
  ): void {
    wsLogger.info("Notifying group deletion to participants", {
      conversationId,
    });

    const message = JSON.stringify({
      type: "group_deleted",
      conversationId,
    });

    for (const odId of participantIds) {
      // Ne pas notifier celui qui a supprimé
      if (odId === deletedByUserId) continue;

      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, message);
          wsLogger.info("Group deleted notification sent", { userId: odId });
        }
      });
    }
  }

  /**
   * Notifier les participants d'une mise à jour du groupe (membres, rôles, nom)
   * @param conversationId - ID du groupe
   * @param participantIds - IDs des participants à notifier
   * @param updateType - Type de mise à jour ('member_added', 'member_removed', 'role_changed', 'name_changed')
   * @param data - Données de la mise à jour
   */
  notifyGroupUpdate(
    conversationId: string,
    participantIds: string[],
    updateType: string,
    data: any,
  ): void {
    wsLogger.info("Notifying group update to participants", {
      conversationId,
      updateType,
    });

    const message = JSON.stringify({
      ...data,
      type: "group_update",
      conversationId,
      updateType,
    });

    for (const odId of participantIds) {
      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, message);
          wsLogger.info("Group update notification sent", {
            userId: odId,
            updateType,
          });
        }
      });
    }
  }

  /**
   * Notifier un membre qu'il a été retiré d'un groupe
   * Le groupe disparaîtra immédiatement de son écran
   * RÉVOCATION TEMPS RÉEL: Ferme aussi les connexions WebSocket messages pour cette conversation
   * @param conversationId - ID du groupe
   * @param removedUserId - ID de l'utilisateur retiré
   */
  notifyMemberRemoved(conversationId: string, removedUserId: string): void {
    wsLogger.info("Notifying member removed from group", {
      conversationId,
      removedUserId,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉVOCATION TEMPS RÉEL: Fermer les connexions WebSocket messages pour cette conversation
    // ═══════════════════════════════════════════════════════════════════════════
    const userMessageConversations = this.messageClients.get(removedUserId);
    if (userMessageConversations) {
      const conversationClients = userMessageConversations.get(conversationId);
      if (conversationClients) {
        conversationClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            // Envoyer un message d'erreur avant de fermer
            this.safeSend(
              client,
              JSON.stringify({
                type: "error",
                code: "ACCESS_REVOKED",
                message: "Vous avez été retiré de cette conversation",
              }),
            );
            // Fermer la connexion avec le code 4003 (Access revoked)
            client.close(4003, "Access revoked - removed from conversation");
            wsLogger.info("Message connection closed for removed member", {
              userId: removedUserId,
              conversationId,
            });
          }
          // Retirer du reverse index
          this.removeClientFromConversation(client, conversationId);
        });
      }
    }

    // Envoyer la notification via WebSocket notifications
    const userClients = this.clients.get(removedUserId);
    if (!userClients || userClients.size === 0) {
      wsLogger.info("User not connected for member removed notification", {
        userId: removedUserId,
      });
      return;
    }

    const message = JSON.stringify({
      type: "member_removed",
      conversationId,
    });

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.safeSend(client, message);
        wsLogger.info("Member removed notification sent", {
          userId: removedUserId,
        });
      }
    });
  }

  /**
   * Diffuser un nouveau message à tous les clients WebSocket d'une conversation.
   * Appelé depuis le contrôleur REST (envoi mobile) pour notifier l'IHM web en temps réel.
   * Reproduit exactement le comportement du handler WS interne.
   *
   * @param conversationId - ID de la conversation
   * @param message        - Objet message déchiffré (content en clair)
   * @param senderUserId   - ID de l'expéditeur (exclu du broadcast WS messages
   *                         car il a déjà le message côté client)
   */
  broadcastNewMessage(
    conversationId: string,
    message: any,
    senderUserId: string,
  ): void {
    this.broadcastToConversation(
      conversationId,
      { type: "new_message", ...message },
      senderUserId,
    );
  }

  /**
   * Notifier tous les participants qu'un groupe a changé de nom
   * @param conversationId - ID du groupe
   * @param newName - Nouveau nom du groupe
   * @param participantIds - IDs des participants à notifier
   */
  notifyGroupNameChanged(
    conversationId: string,
    newName: string,
    participantIds: string[],
  ): void {
    wsLogger.info("Notifying group name change to participants", {
      conversationId,
      newName,
    });

    const message = JSON.stringify({
      type: "group_name_changed",
      conversationId,
      newName,
    });

    for (const odId of participantIds) {
      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.safeSend(client, message);
          wsLogger.info("Group name change notification sent", {
            userId: odId,
          });
        }
      });
    }
  }
}

// Export d'une instance singleton
export const webSocketService = new WebSocketService();

// R-5: Export standalone pour rétrocompatibilité avec les imports directs
// (ex: import { invalidateConversationCache } from "./webSocketService")
export function invalidateConversationCache(conversationId: string): void {
  webSocketService.invalidateConversationCache(conversationId);
}
