import Redis, { Cluster } from "ioredis";
import { logger } from "./loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import { hostname } from "os";
import { randomBytes } from "crypto";

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
   */
  private initialize(): void {
    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || "0"),
        retryStrategy: (times: number) => {
          if (times > MAX_RETRIES) {
            pubSubLogger.error("Redis Pub/Sub max retries reached", { times });
            return null; // Stop retrying
          }
          return Math.min(times * RECONNECT_DELAY, 5000);
        },
        maxRetriesPerRequest: null, // Important pour Pub/Sub
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
        lazyConnect: true,
      };

      if (USE_REDIS_CLUSTER) {
        // Configuration Cluster Redis
        const clusterNodes =
          process.env.REDIS_CLUSTER_NODES?.split(",").map((node) => {
            const [host, port] = node.split(":");
            return { host, port: parseInt(port) };
          }) || [];

        this.publisher = new Cluster(clusterNodes, {
          redisOptions: {
            password: process.env.REDIS_PASSWORD,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
          },
        });

        this.subscriber = new Cluster(clusterNodes, {
          redisOptions: {
            password: process.env.REDIS_PASSWORD,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
          },
        });
      } else {
        // Configuration Redis standard
        this.publisher = new Redis(redisConfig);
        this.subscriber = new Redis(redisConfig);
      }

      // Setup event handlers
      this.setupPublisherHandlers();
      this.setupSubscriberHandlers();

      // Connexion
      Promise.all([this.publisher.connect(), this.subscriber.connect()])
        .then(() => {
          this.isConnected = true;
          pubSubLogger.info("Redis Pub/Sub connected successfully", {
            instanceId: INSTANCE_ID,
            cluster: USE_REDIS_CLUSTER,
          });
        })
        .catch((error) => {
          pubSubLogger.error("Redis Pub/Sub connection failed", {
            error: getErrorMessage(error),
          });
          this.isConnected = false;
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
      const message: PubSubMessage = JSON.parse(rawMessage);

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
