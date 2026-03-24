import Redis, { Cluster } from "ioredis";
import { logger } from "./loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import { safeJsonParse } from "../utils/secureJsonParser";

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET STATE SERVICE - PERSISTANCE ET RÉCUPÉRATION D'ÉTAT
// ═══════════════════════════════════════════════════════════════════════════
// Ce service gère la persistance des états WebSocket pour permettre la reprise
// de connexion après une déconnexion, un crash ou un redémarrage serveur.
// ═══════════════════════════════════════════════════════════════════════════

const stateLogger = logger.child({ service: "websocket-state" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";
const WS_STATE_ENABLED = process.env.WS_STATE_ENABLED !== "false"; // Activé par défaut si Redis activé
const WS_STATE_TTL_HOURS = parseInt(
  process.env.WS_STATE_TTL_HOURS || "168",
  10,
); // 7 jours
const WS_STATE_SAVE_INTERVAL = parseInt(
  process.env.WS_STATE_SAVE_INTERVAL || "30000",
  10,
); // 30 secondes
const WS_MESSAGE_DELIVERY_TTL = parseInt(
  process.env.WS_MESSAGE_DELIVERY_TTL || "86400",
  10,
); // 24 heures

// Redis client (sera initialisé avec le pool)
let redis: Redis | Cluster | null = null;

/**
 * PERF: Initialise Redis avec le pool partagé
 * Doit être appelé après l'initialisation du pool dans server.ts
 */
export async function initializeRedisWithPool(): Promise<void> {
  if (!REDIS_ENABLED || !WS_STATE_ENABLED) {
    stateLogger.info(
      "WebSocket State persistence disabled - reconnections will not restore previous state",
      {
        REDIS_ENABLED,
        WS_STATE_ENABLED,
      },
    );
    return;
  }

  try {
    // PERF: Utiliser le pool Redis partagé
    const RedisConnectionPool = (await import("../config/redisPool")).default;
    redis = RedisConnectionPool.createClient();

    redis.on("error", (error) => {
      stateLogger.error("WebSocket State - Redis error", {
        error: getErrorMessage(error),
      });
    });

    stateLogger.info("WebSocket State - Redis initialized with shared pool", {
      status: redis.status,
    });
  } catch (error) {
    stateLogger.error(
      "WebSocket State - Redis initialization failed, state persistence disabled",
      {
        error: getErrorMessage(error),
      },
    );
    redis = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  senderId: string;
  timestamp: Date;
  type: string;
  [key: string]: any;
}

export interface ClientState {
  userId: string;
  deviceId: string;
  subscriptions: string[]; // IDs de conversations
  lastSeenMessageIds: Record<string, string>; // conversationId -> lastMessageId
  pendingMessages: Message[];
  lastActivityAt: Date;
  connectionMetadata: {
    userAgent?: string;
    ipAddress?: string;
    platform?: string;
  };
}

export interface DeliveryTracking {
  messageId: string;
  conversationId: string;
  userId: string;
  deviceId: string;
  attempts: number;
  lastAttempt: Date;
  acknowledged: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK EN MÉMOIRE (SI REDIS NON DISPONIBLE)
// ═══════════════════════════════════════════════════════════════════════════

const memoryStateStore: Map<string, ClientState> = new Map();
const memoryDeliveryStore: Map<string, DeliveryTracking> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET STATE SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class WebSocketStateService {
  private readonly STATE_PREFIX = "ws:state:";
  private readonly DELIVERY_PREFIX = "ws:delivery:";
  private readonly STATE_TTL_SECONDS = WS_STATE_TTL_HOURS * 3600;
  private readonly DELIVERY_TTL_SECONDS = WS_MESSAGE_DELIVERY_TTL;

  // Métriques
  private saveCount = 0;
  private restoreCount = 0;
  private missCount = 0;
  private queuedCount = 0;
  private deliveredCount = 0;

  /**
   * Sauvegarder l'état d'un client
   */
  async saveClientState(
    userId: string,
    deviceId: string,
    state: ClientState,
  ): Promise<void> {
    const key = `${this.STATE_PREFIX}${userId}:${deviceId}`;

    // Enrichir avec timestamp
    const stateToSave: ClientState = {
      ...state,
      lastActivityAt: new Date(),
    };

    if (redis) {
      try {
        await redis.setex(
          key,
          this.STATE_TTL_SECONDS,
          JSON.stringify(stateToSave),
        );
        this.saveCount++;
        stateLogger.debug("Client state saved", {
          userId,
          deviceId,
          subscriptions: state.subscriptions.length,
          pendingMessages: state.pendingMessages.length,
        });
      } catch (error) {
        stateLogger.error("Failed to save client state, using memory", {
          userId,
          deviceId,
          error: getErrorMessage(error),
        });
        memoryStateStore.set(key, stateToSave);
      }
    } else {
      memoryStateStore.set(key, stateToSave);
    }
  }

  /**
   * Récupérer l'état d'un client
   */
  async getClientState(
    userId: string,
    deviceId: string,
  ): Promise<ClientState | null> {
    const key = `${this.STATE_PREFIX}${userId}:${deviceId}`;

    if (redis) {
      try {
        const data = await redis.get(key);
        if (!data) {
          this.missCount++;
          return null;
        }

        const state = safeJsonParse(data, {
          context: "websocket-state",
          maxDepth: 5,
        });
        // Reconvertir les dates
        state.lastActivityAt = new Date(state.lastActivityAt);
        state.pendingMessages = state.pendingMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));

        this.restoreCount++;
        stateLogger.info("Client state restored", {
          userId,
          deviceId,
          subscriptions: state.subscriptions.length,
          pendingMessages: state.pendingMessages.length,
          lastActivity: state.lastActivityAt,
        });

        return state;
      } catch (error) {
        stateLogger.error("Failed to get client state from Redis", {
          userId,
          deviceId,
          error: getErrorMessage(error),
        });
        return memoryStateStore.get(key) || null;
      }
    } else {
      const state = memoryStateStore.get(key) || null;
      if (state) {
        this.restoreCount++;
      } else {
        this.missCount++;
      }
      return state;
    }
  }

  /**
   * Supprimer l'état d'un client
   */
  async deleteClientState(userId: string, deviceId: string): Promise<void> {
    const key = `${this.STATE_PREFIX}${userId}:${deviceId}`;

    if (redis) {
      try {
        await redis.del(key);
        stateLogger.debug("Client state deleted", { userId, deviceId });
      } catch (error) {
        stateLogger.error("Failed to delete client state", {
          userId,
          deviceId,
          error: getErrorMessage(error),
        });
      }
    }

    memoryStateStore.delete(key);
  }

  /**
   * Mettre à jour le dernier message vu pour une conversation
   */
  async updateLastSeen(
    userId: string,
    deviceId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const state = await this.getClientState(userId, deviceId);
    if (!state) {
      stateLogger.warn("Cannot update lastSeen - state not found", {
        userId,
        deviceId,
        conversationId,
      });
      return;
    }

    state.lastSeenMessageIds[conversationId] = messageId;
    await this.saveClientState(userId, deviceId, state);

    stateLogger.debug("LastSeen updated", {
      userId,
      deviceId,
      conversationId,
      messageId: messageId.substring(0, 8) + "...",
    });
  }

  /**
   * Ajouter un message à la file d'attente (client hors ligne)
   */
  async queueMessage(
    userId: string,
    deviceId: string,
    message: Message,
  ): Promise<void> {
    const state = await this.getClientState(userId, deviceId);
    if (!state) {
      stateLogger.warn(
        "Cannot queue message - state not found, creating new state",
        {
          userId,
          deviceId,
        },
      );

      // Créer un état minimal
      const newState: ClientState = {
        userId,
        deviceId,
        subscriptions: [message.conversationId],
        lastSeenMessageIds: {},
        pendingMessages: [message],
        lastActivityAt: new Date(),
        connectionMetadata: {},
      };

      await this.saveClientState(userId, deviceId, newState);
      this.queuedCount++;
      return;
    }

    // Limiter la taille de la file (max 100 messages)
    const MAX_PENDING = 100;
    if (state.pendingMessages.length >= MAX_PENDING) {
      stateLogger.warn("Pending message queue full, dropping oldest", {
        userId,
        deviceId,
        queueSize: state.pendingMessages.length,
      });
      state.pendingMessages.shift(); // Supprimer le plus ancien
    }

    state.pendingMessages.push(message);
    await this.saveClientState(userId, deviceId, state);

    this.queuedCount++;
    stateLogger.debug("Message queued for offline client", {
      userId,
      deviceId,
      messageId: message.id,
      queueSize: state.pendingMessages.length,
    });
  }

  /**
   * Récupérer les messages en attente
   */
  async getPendingMessages(
    userId: string,
    deviceId: string,
  ): Promise<Message[]> {
    const state = await this.getClientState(userId, deviceId);
    if (!state) {
      return [];
    }

    return state.pendingMessages || [];
  }

  /**
   * Vider la file de messages en attente
   */
  async clearPendingMessages(userId: string, deviceId: string): Promise<void> {
    const state = await this.getClientState(userId, deviceId);
    if (!state) {
      return;
    }

    const clearedCount = state.pendingMessages.length;
    state.pendingMessages = [];
    await this.saveClientState(userId, deviceId, state);

    stateLogger.info("Pending messages cleared", {
      userId,
      deviceId,
      clearedCount,
    });
  }

  /**
   * Marquer un message comme livré (après ACK du client)
   */
  async markMessageDelivered(
    messageId: string,
    userId: string,
    deviceId: string,
  ): Promise<void> {
    const key = `${this.DELIVERY_PREFIX}${messageId}:${userId}:${deviceId}`;

    if (redis) {
      try {
        const tracking: DeliveryTracking = {
          messageId,
          conversationId: "", // Optionnel pour tracking
          userId,
          deviceId,
          attempts: 1,
          lastAttempt: new Date(),
          acknowledged: true,
        };

        await redis.setex(
          key,
          this.DELIVERY_TTL_SECONDS,
          JSON.stringify(tracking),
        );
        this.deliveredCount++;

        stateLogger.debug("Message marked as delivered", {
          messageId: messageId.substring(0, 8) + "...",
          userId,
          deviceId,
        });
      } catch (error) {
        stateLogger.error("Failed to mark message as delivered", {
          messageId,
          error: getErrorMessage(error),
        });
      }
    } else {
      memoryDeliveryStore.set(key, {
        messageId,
        conversationId: "",
        userId,
        deviceId,
        attempts: 1,
        lastAttempt: new Date(),
        acknowledged: true,
      });
      this.deliveredCount++;
    }
  }

  /**
   * Vérifier si un message a été livré
   */
  async isMessageDelivered(
    messageId: string,
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    const key = `${this.DELIVERY_PREFIX}${messageId}:${userId}:${deviceId}`;

    if (redis) {
      try {
        const exists = await redis.exists(key);
        return exists === 1;
      } catch (error) {
        stateLogger.error("Failed to check message delivery status", {
          messageId,
          error: getErrorMessage(error),
        });
        return memoryDeliveryStore.has(key);
      }
    } else {
      return memoryDeliveryStore.has(key);
    }
  }

  /**
   * Nettoyer les états obsolètes (older than maxAgeHours)
   */
  async cleanupStaleStates(maxAgeHours: number): Promise<number> {
    if (!redis) {
      stateLogger.warn("Cannot cleanup - Redis not available");
      return 0;
    }

    const cutoffTime = new Date(Date.now() - maxAgeHours * 3600 * 1000);
    let cleaned = 0;

    try {
      // Scan tous les états
      const pattern = `${this.STATE_PREFIX}*`;
      let cursor = "0";

      do {
        const result = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = result[0];
        const keys = result[1];

        for (const key of keys) {
          try {
            const data = await redis.get(key);
            if (!data) continue;

            const state = safeJsonParse(data, {
              context: "websocket-state",
              maxDepth: 5,
            });
            const lastActivity = new Date(state.lastActivityAt);

            if (lastActivity < cutoffTime) {
              await redis.del(key);
              cleaned++;
              stateLogger.debug("Stale state cleaned", {
                key,
                lastActivity,
              });
            }
          } catch (error) {
            stateLogger.error("Error cleaning state", {
              key,
              error: getErrorMessage(error),
            });
          }
        }
      } while (cursor !== "0");

      stateLogger.info("Stale states cleanup complete", {
        cleaned,
        maxAgeHours,
      });

      return cleaned;
    } catch (error) {
      stateLogger.error("Failed to cleanup stale states", {
        error: getErrorMessage(error),
      });
      return 0;
    }
  }

  /**
   * Obtenir toutes les clés d'état (pour admin/debug)
   */
  async getAllStateKeys(): Promise<string[]> {
    if (!redis) {
      return Array.from(memoryStateStore.keys());
    }

    try {
      const pattern = `${this.STATE_PREFIX}*`;
      const keys: string[] = [];
      let cursor = "0";

      do {
        const result = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== "0");

      return keys;
    } catch (error) {
      stateLogger.error("Failed to get all state keys", {
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  /**
   * Compter le nombre d'états persistés
   */
  async countStates(): Promise<number> {
    const keys = await this.getAllStateKeys();
    return keys.length;
  }

  /**
   * Obtenir les métriques du service
   */
  getMetrics() {
    return {
      enabled: this.isEnabled(),
      saves: this.saveCount,
      restores: this.restoreCount,
      misses: this.missCount,
      queued: this.queuedCount,
      delivered: this.deliveredCount,
      stateTTL: WS_STATE_TTL_HOURS,
      deliveryTTL: WS_MESSAGE_DELIVERY_TTL,
    };
  }

  /**
   * Vérifier si le service est activé
   */
  isEnabled(): boolean {
    return REDIS_ENABLED && WS_STATE_ENABLED && redis !== null;
  }

  /**
   * Fermer les connexions
   */
  async shutdown(): Promise<void> {
    stateLogger.info("Shutting down WebSocket State service");

    if (redis) {
      await redis.quit();
    }

    memoryStateStore.clear();
    memoryDeliveryStore.clear();

    stateLogger.info("WebSocket State service stopped");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const webSocketStateService = new WebSocketStateService();

// Log de l'état au démarrage (Redis sera initialisé plus tard via initializeRedisWithPool)
stateLogger.info("WebSocket State Service created", {
  enabled: REDIS_ENABLED && WS_STATE_ENABLED,
  stateTTL: `${WS_STATE_TTL_HOURS}h`,
  saveInterval: `${WS_STATE_SAVE_INTERVAL}ms`,
  note: "Redis will be initialized via initializeRedisWithPool()",
});

/**
 * Démarre le nettoyage périodique des états obsolètes
 * Appelé après l'initialisation de Redis
 */
export function startStateCleanup(): void {
  if (!redis) {
    stateLogger.warn("Cannot start state cleanup - Redis not initialized");
    return;
  }

  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 heures
  setInterval(async () => {
    const cleaned =
      await webSocketStateService.cleanupStaleStates(WS_STATE_TTL_HOURS);
    if (cleaned > 0) {
      stateLogger.info("Automatic state cleanup executed", { cleaned });
    }
  }, CLEANUP_INTERVAL);

  stateLogger.info("State cleanup scheduled", {
    interval: `${CLEANUP_INTERVAL}ms`,
  });
}

// Nettoyage à la fermeture
process.on("SIGTERM", async () => {
  await webSocketStateService.shutdown();
});

process.on("SIGINT", async () => {
  await webSocketStateService.shutdown();
});
