import Redis, { Cluster } from "ioredis";
import { logger } from "./loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import { hostname } from "os";
import { randomBytes } from "crypto";
import { safeJsonParse } from "../utils/secureJsonParser";

// ═══════════════════════════════════════════════════════════════════════════
// REDIS PUB/SUB SERVICE - CLUSTERING WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════
// Ce service permet de diffuser les messages WebSocket entre plusieurs instances
// de l'API en utilisant Redis Pub/Sub. Essentiel pour le load balancing.
// ═══════════════════════════════════════════════════════════════════════════

const pubSubLogger = logger.child({ service: "redis-pubsub" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";
const REDIS_PUBSUB_ENABLED = process.env.REDIS_PUBSUB_ENABLED !== "false"; // Activé par défaut si Redis est activé
const USE_REDIS_CLUSTER = process.env.USE_REDIS_CLUSTER === "true";
const RECONNECT_DELAY = parseInt(
  process.env.REDIS_PUBSUB_RECONNECT_DELAY || "1000",
  10,
);
const MAX_RETRIES = parseInt(process.env.REDIS_PUBSUB_MAX_RETRIES || "10", 10);

// Instance ID unique pour éviter les boucles d'écho
const INSTANCE_ID = `${hostname()}-${randomBytes(4).toString("hex")}`;

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface PubSubMessage {
  instanceId: string; // ID de l'instance émettrice
  messageId: string; // ID unique du message pour déduplication
  timestamp: number; // Timestamp d'émission
  payload: any; // Données métier
}

export interface NotificationPayload {
  userId: string;
  notification: any;
}

export interface MessagePayload {
  conversationId: string;
  message: any;
  excludeUserId?: string;
  participantIds?: string[];
  senderName?: string;
}

export interface BroadcastPayload {
  event: string;
  data: any;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE REDIS PUB/SUB SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class RedisPubSubService {
  private publisher: Redis | Cluster | null = null;
  private subscriber: Redis | Cluster | null = null;
  private messageHandlers: Map<string, Set<Function>> = new Map();
  private reconnectAttempts = 0;
  private isConnected = false;

  // Métriques
  private publishedCount = 0;
  private receivedCount = 0;
  private errorCount = 0;

  // Déduplication des messages (cache simple basé sur messageId)
  private processedMessages: Set<string> = new Set();
  private readonly MAX_PROCESSED_CACHE = 10000;
  private readonly PROCESSED_TTL = 60000; // 60 secondes

  constructor() {
    if (!REDIS_ENABLED || !REDIS_PUBSUB_ENABLED) {
      pubSubLogger.warn(
        "Redis Pub/Sub disabled - WebSocket clustering will NOT work across multiple instances",
        {
          REDIS_ENABLED,
          REDIS_PUBSUB_ENABLED,
        },
      );
      return;
    }

    this.initialize();
  }

  /**
   * Initialiser les connexions Redis Pub/Sub
   * PERF: Utilise le pool Redis partagé
   */
  private async initialize(): Promise<void> {
    try {
      // PERF: Utiliser le pool Redis partagé
      const RedisConnectionPool = (await import("../config/redisPool")).default;
      this.publisher = RedisConnectionPool.getPublisher();
      this.subscriber = RedisConnectionPool.getSubscriber();

      pubSubLogger.info("[Redis Pub/Sub] Using shared Redis pool", {
        publisherStatus: this.publisher.status,
        subscriberStatus: this.subscriber.status,
      });

      // Setup event handlers
      this.setupPublisherHandlers();
      this.setupSubscriberHandlers();

      // Le pool est déjà connecté, pas besoin de connect()
      this.isConnected = true;
      pubSubLogger.info("Redis Pub/Sub initialized with shared pool", {
        instanceId: INSTANCE_ID,
        publisherStatus: this.publisher.status,
        subscriberStatus: this.subscriber.status,
      });
    } catch (error) {
      pubSubLogger.error("Redis Pub/Sub initialization failed", {
        error: getErrorMessage(error),
      });
      this.publisher = null;
      this.subscriber = null;
    }
  }

  /**
   * Configurer les handlers du publisher
   */
  private setupPublisherHandlers(): void {
    if (!this.publisher) return;

    this.publisher.on("connect", () => {
      pubSubLogger.info("Redis Publisher connected");
    });

    this.publisher.on("ready", () => {
      pubSubLogger.info("Redis Publisher ready");
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.publisher.on("error", (error) => {
      pubSubLogger.error("Redis Publisher error", {
        error: getErrorMessage(error),
      });
      this.errorCount++;
    });

    this.publisher.on("close", () => {
      pubSubLogger.warn("Redis Publisher connection closed");
      this.isConnected = false;
    });

    this.publisher.on("reconnecting", () => {
      this.reconnectAttempts++;
      pubSubLogger.info("Redis Publisher reconnecting", {
        attempt: this.reconnectAttempts,
      });
    });
  }

  /**
   * Configurer les handlers du subscriber
   */
  private setupSubscriberHandlers(): void {
    if (!this.subscriber) return;

    this.subscriber.on("connect", () => {
      pubSubLogger.info("Redis Subscriber connected");
    });

    this.subscriber.on("ready", () => {
      pubSubLogger.info("Redis Subscriber ready");
    });

    this.subscriber.on("error", (error) => {
      pubSubLogger.error("Redis Subscriber error", {
        error: getErrorMessage(error),
      });
      this.errorCount++;
    });

    this.subscriber.on("close", () => {
      pubSubLogger.warn("Redis Subscriber connection closed");
    });

    this.subscriber.on("reconnecting", () => {
      pubSubLogger.info("Redis Subscriber reconnecting");
    });

    // Handler des messages
    this.subscriber.on("message", (channel: string, message: string) => {
      this.handleMessage(channel, message);
    });
  }

  /**
   * Traiter un message reçu
   */
  private handleMessage(channel: string, rawMessage: string): void {
    try {
      const message: PubSubMessage = safeJsonParse(rawMessage, {
        context: "redis-pubsub-message",
        maxDepth: 5,
      });

      // Ignorer les messages de notre propre instance (éviter l'écho)
      if (message.instanceId === INSTANCE_ID) {
        return;
      }

      // Déduplication basée sur messageId
      if (this.processedMessages.has(message.messageId)) {
        pubSubLogger.debug("Duplicate message ignored", {
          messageId: message.messageId,
        });
        return;
      }

      // Marquer comme traité
      this.processedMessages.add(message.messageId);
      this.receivedCount++;

      // Nettoyer le cache si trop grand (LRU simple)
      if (this.processedMessages.size > this.MAX_PROCESSED_CACHE) {
        const toDelete = Array.from(this.processedMessages).slice(
          0,
          Math.floor(this.MAX_PROCESSED_CACHE * 0.2),
        );
        toDelete.forEach((id) => this.processedMessages.delete(id));
      }

      // Auto-nettoyage après TTL
      setTimeout(() => {
        this.processedMessages.delete(message.messageId);
      }, this.PROCESSED_TTL);

      // Appeler les handlers enregistrés pour ce channel
      const handlers = this.messageHandlers.get(channel);
      if (handlers && handlers.size > 0) {
        handlers.forEach((handler) => {
          try {
            handler(message.payload);
          } catch (error) {
            pubSubLogger.error("Error in message handler", {
              channel,
              error: getErrorMessage(error),
            });
          }
        });
      }

      pubSubLogger.debug("Message processed", {
        channel,
        messageId: message.messageId,
        fromInstance: message.instanceId,
      });
    } catch (error) {
      pubSubLogger.error("Error parsing pub/sub message", {
        channel,
        error: getErrorMessage(error),
      });
      this.errorCount++;
    }
  }

  /**
   * Publier un message sur un channel
   */
  private async publish(channel: string, payload: any): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    if (!this.publisher || !this.isConnected) {
      pubSubLogger.warn("Publisher not connected, message not sent", {
        channel,
      });
      return false;
    }

    try {
      const message: PubSubMessage = {
        instanceId: INSTANCE_ID,
        messageId: `${INSTANCE_ID}-${Date.now()}-${randomBytes(4).toString("hex")}`,
        timestamp: Date.now(),
        payload,
      };

      await this.publisher.publish(channel, JSON.stringify(message));
      this.publishedCount++;

      pubSubLogger.debug("Message published", {
        channel,
        messageId: message.messageId,
      });

      return true;
    } catch (error) {
      pubSubLogger.error("Failed to publish message", {
        channel,
        error: getErrorMessage(error),
      });
      this.errorCount++;
      return false;
    }
  }

  /**
   * PERF: Batch publish pour réduire les round-trips réseau
   * Utilise un pipeline Redis pour envoyer plusieurs messages en une seule fois
   */
  async batchPublish(
    messages: Array<{ channel: string; payload: any }>,
  ): Promise<boolean[]> {
    if (messages.length === 0) {
      return [];
    }

    if (!this.isEnabled()) {
      return messages.map(() => false);
    }

    if (!this.publisher || !this.isConnected) {
      pubSubLogger.warn("Publisher not connected, batch messages not sent", {
        count: messages.length,
      });
      return messages.map(() => false);
    }

    const startTime = Date.now();

    try {
      // Créer un pipeline
      const pipeline = this.publisher.pipeline();

      // Préparer les messages avec métadonnées
      const preparedMessages: PubSubMessage[] = messages.map(
        ({ channel, payload }) => ({
          instanceId: INSTANCE_ID,
          messageId: `${INSTANCE_ID}-${Date.now()}-${randomBytes(4).toString("hex")}`,
          timestamp: Date.now(),
          payload,
        }),
      );

      // Ajouter tous les publish au pipeline
      for (let i = 0; i < messages.length; i++) {
        const message = preparedMessages[i];
        const channel = messages[i].channel;
        pipeline.publish(channel, JSON.stringify(message));
      }

      // Exécuter le pipeline en une seule fois
      const results = await pipeline.exec();

      // Traiter les résultats
      const successResults: boolean[] = [];

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [error, result] = results[i];
          if (error) {
            pubSubLogger.error("[Redis Pub/Sub] Batch publish error", {
              channel: messages[i].channel,
              error: getErrorMessage(error),
            });
            this.errorCount++;
            successResults.push(false);
          } else {
            this.publishedCount++;
            successResults.push(true);
          }
        }
      }

      const duration = Date.now() - startTime;

      pubSubLogger.debug("[Redis Pub/Sub] Batch publish successful", {
        count: messages.length,
        channels: messages.map((m) => m.channel),
        duration,
        successCount: successResults.filter((s) => s).length,
      });

      return successResults;
    } catch (error) {
      pubSubLogger.error("[Redis Pub/Sub] Batch publish failed", {
        error: getErrorMessage(error),
        count: messages.length,
      });
      this.errorCount++;
      return messages.map(() => false);
    }
  }

  /**
   * Helper: Batch publish pour plusieurs messages dans différentes conversations
   * Utilise le pipeline Redis pour optimiser les performances
   */
  async batchPublishMessages(
    messages: Array<{
      conversationId: string;
      message: any;
      excludeUserId?: string;
      participantIds?: string[];
      senderName?: string;
    }>,
  ): Promise<boolean[]> {
    const batchMessages = messages.map((msg) => ({
      channel: `websocket:messages:${msg.conversationId}`,
      payload: {
        conversationId: msg.conversationId,
        message: msg.message,
        excludeUserId: msg.excludeUserId,
        participantIds: msg.participantIds,
        senderName: msg.senderName,
      } as MessagePayload,
    }));

    return this.batchPublish(batchMessages);
  }

  /**
   * Helper: Batch publish pour plusieurs notifications utilisateurs
   * Utilise le pipeline Redis pour optimiser les performances
   */
  async batchPublishNotifications(
    notifications: Array<{
      userId: string;
      notification: any;
    }>,
  ): Promise<boolean[]> {
    const batchMessages = notifications.map((notif) => ({
      channel: `websocket:notifications`,
      payload: {
        userId: notif.userId,
        notification: notif.notification,
      } as NotificationPayload,
    }));

    return this.batchPublish(batchMessages);
  }

  /**
   * S'abonner à un channel
   */
  async subscribe(channel: string, handler: Function): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (!this.subscriber) {
      pubSubLogger.error("Subscriber not initialized");
      return;
    }

    try {
      // Enregistrer le handler
      if (!this.messageHandlers.has(channel)) {
        this.messageHandlers.set(channel, new Set());
        // S'abonner seulement si c'est le premier handler pour ce channel
        await this.subscriber.subscribe(channel);
        pubSubLogger.info("Subscribed to channel", { channel });
      }

      const handlers = this.messageHandlers.get(channel);
      if (handlers) {
        handlers.add(handler);
      }
    } catch (error) {
      pubSubLogger.error("Failed to subscribe to channel", {
        channel,
        error: getErrorMessage(error),
      });
      this.errorCount++;
    }
  }

  /**
   * Se désabonner d'un channel
   */
  async unsubscribe(channel: string, handler?: Function): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    if (!this.subscriber) {
      return;
    }

    try {
      const handlers = this.messageHandlers.get(channel);
      if (!handlers) {
        return;
      }

      if (handler) {
        // Supprimer un handler spécifique
        handlers.delete(handler);
      } else {
        // Supprimer tous les handlers
        handlers.clear();
      }

      // Si plus de handlers, se désabonner du channel Redis
      if (handlers.size === 0) {
        await this.subscriber.unsubscribe(channel);
        this.messageHandlers.delete(channel);
        pubSubLogger.info("Unsubscribed from channel", { channel });
      }
    } catch (error) {
      pubSubLogger.error("Failed to unsubscribe from channel", {
        channel,
        error: getErrorMessage(error),
      });
      this.errorCount++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PUBLIQUE - WEBSOCKET CLUSTERING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Publier une notification pour un utilisateur
   * Note: Pour envoyer plusieurs notifications, utiliser batchPublishNotifications()
   * pour de meilleures performances (réduit la latency de ~50%)
   */
  async publishNotification(
    userId: string,
    notification: any,
  ): Promise<boolean> {
    const channel = `websocket:notifications`;
    const payload: NotificationPayload = {
      userId,
      notification,
    };
    return this.publish(channel, payload);
  }

  /**
   * Publier un message dans une conversation
   * Note: Pour envoyer plusieurs messages, utiliser batchPublishMessages()
   * pour de meilleures performances (réduit la latency de ~50%)
   */
  async publishMessage(
    conversationId: string,
    message: any,
    excludeUserId?: string,
    participantIds?: string[],
    senderName?: string,
  ): Promise<boolean> {
    const channel = `websocket:messages:${conversationId}`;
    const payload: MessagePayload = {
      conversationId,
      message,
      excludeUserId,
      participantIds,
      senderName,
    };
    return this.publish(channel, payload);
  }

  /**
   * Publier un événement broadcast (système)
   */
  async publishBroadcast(event: string, data: any): Promise<boolean> {
    const channel = `websocket:broadcast`;
    const payload: BroadcastPayload = {
      event,
      data,
    };
    return this.publish(channel, payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Vérifier si le service est activé et prêt
   */
  isEnabled(): boolean {
    return REDIS_ENABLED && REDIS_PUBSUB_ENABLED && this.isConnected;
  }

  /**
   * Obtenir l'ID de l'instance
   */
  getInstanceId(): string {
    return INSTANCE_ID;
  }

  /**
   * Obtenir les métriques
   */
  getMetrics() {
    return {
      instanceId: INSTANCE_ID,
      enabled: this.isEnabled(),
      connected: this.isConnected,
      published: this.publishedCount,
      received: this.receivedCount,
      errors: this.errorCount,
      subscribedChannels: this.messageHandlers.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Fermer les connexions
   */
  async shutdown(): Promise<void> {
    pubSubLogger.info("Shutting down Redis Pub/Sub service");

    if (this.subscriber) {
      await this.subscriber.quit();
    }

    if (this.publisher) {
      await this.publisher.quit();
    }

    this.messageHandlers.clear();
    this.processedMessages.clear();
    this.isConnected = false;

    pubSubLogger.info("Redis Pub/Sub service stopped");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const redisPubSubService = new RedisPubSubService();

// Log de l'instance ID au démarrage
pubSubLogger.info("Redis Pub/Sub Service initialized", {
  instanceId: INSTANCE_ID,
  enabled: REDIS_ENABLED && REDIS_PUBSUB_ENABLED,
});

// Nettoyage à la fermeture
process.on("SIGTERM", async () => {
  await redisPubSubService.shutdown();
});

process.on("SIGINT", async () => {
  await redisPubSubService.shutdown();
});
