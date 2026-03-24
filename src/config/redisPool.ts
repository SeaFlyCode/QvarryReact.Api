import Redis, { Cluster, RedisOptions, ClusterOptions } from "ioredis";
import { logger } from "../services/loggerService";

const poolLogger = logger.child({ service: "redis-pool" });

/**
 * PERF: Pool de connexions Redis partagé entre tous les services
 * Réduit le nombre de connexions de 4 par instance à 2 (publisher + subscriber)
 *
 * Architecture:
 * - 1 connexion publisher partagée (pour tous les writes)
 * - 1 connexion subscriber partagée (pour pub/sub seulement)
 * - Les clients read-only utilisent le publisher
 */
class RedisConnectionPool {
  private static publisherClient: Redis | Cluster | null = null;
  private static subscriberClient: Redis | Cluster | null = null;
  private static isInitialized = false;

  /**
   * Initialise le pool avec la configuration Redis
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      poolLogger.warn("[Redis Pool] Already initialized");
      return;
    }

    const isProduction = process.env.NODE_ENV === "production";
    const redisHost = process.env.REDIS_HOST || "localhost";
    const redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);
    const redisPassword = process.env.REDIS_PASSWORD;
    const redisTLS = process.env.REDIS_TLS === "true";
    const redisCluster = process.env.REDIS_CLUSTER === "true";

    const baseConfig: RedisOptions = {
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      ...(redisTLS && {
        tls: {
          rejectUnauthorized: isProduction,
        },
      }),
    };

    try {
      if (redisCluster) {
        const clusterNodes = [{ host: redisHost, port: redisPort }];
        const clusterConfig: ClusterOptions = {
          redisOptions: baseConfig,
          clusterRetryStrategy: (times: number) => {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },
          enableReadyCheck: true,
        };

        this.publisherClient = new Cluster(clusterNodes, clusterConfig);
        this.subscriberClient = new Cluster(clusterNodes, {
          ...clusterConfig,
          redisOptions: {
            ...baseConfig,
            maxRetriesPerRequest: null, // Subscriber ne timeout jamais
          },
        });
      } else {
        this.publisherClient = new Redis(baseConfig);
        this.subscriberClient = new Redis({
          ...baseConfig,
          maxRetriesPerRequest: null, // Subscriber ne timeout jamais
        });
      }

      // Attendre que les connexions soient prêtes
      await Promise.all([
        this.publisherClient.ping(),
        this.subscriberClient.ping(),
      ]);

      this.setupEventHandlers();
      this.isInitialized = true;

      poolLogger.info("[Redis Pool] Initialized successfully", {
        cluster: redisCluster,
        tls: redisTLS,
        host: redisHost,
        port: redisPort,
      });
    } catch (error) {
      poolLogger.error("[Redis Pool] Initialization failed", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Configure les event handlers pour monitoring
   */
  private static setupEventHandlers(): void {
    if (!this.publisherClient || !this.subscriberClient) return;

    // Publisher events
    this.publisherClient.on("error", (error) => {
      poolLogger.error("[Redis Pool] Publisher error", {
        error: error.message,
      });
    });

    this.publisherClient.on("connect", () => {
      poolLogger.info("[Redis Pool] Publisher connected");
    });

    this.publisherClient.on("ready", () => {
      poolLogger.info("[Redis Pool] Publisher ready");
    });

    this.publisherClient.on("reconnecting", () => {
      poolLogger.warn("[Redis Pool] Publisher reconnecting");
    });

    // Subscriber events
    this.subscriberClient.on("error", (error) => {
      poolLogger.error("[Redis Pool] Subscriber error", {
        error: error.message,
      });
    });

    this.subscriberClient.on("connect", () => {
      poolLogger.info("[Redis Pool] Subscriber connected");
    });

    this.subscriberClient.on("ready", () => {
      poolLogger.info("[Redis Pool] Subscriber ready");
    });

    this.subscriberClient.on("reconnecting", () => {
      poolLogger.warn("[Redis Pool] Subscriber reconnecting");
    });
  }

  /**
   * Retourne le client publisher (pour writes et reads)
   */
  static getPublisher(): Redis | Cluster {
    if (!this.publisherClient || !this.isInitialized) {
      throw new Error("[Redis Pool] Not initialized. Call initialize() first.");
    }
    return this.publisherClient;
  }

  /**
   * Retourne le client subscriber (pour pub/sub uniquement)
   */
  static getSubscriber(): Redis | Cluster {
    if (!this.subscriberClient || !this.isInitialized) {
      throw new Error("[Redis Pool] Not initialized. Call initialize() first.");
    }
    return this.subscriberClient;
  }

  /**
   * Retourne un nouveau client pour usage spécifique (cache, state, etc.)
   * Utilise la même config que le pool
   */
  static createClient(): Redis | Cluster {
    if (!this.isInitialized) {
      throw new Error("[Redis Pool] Not initialized. Call initialize() first.");
    }

    // Dupliquer la configuration du publisher
    return this.publisherClient!.duplicate() as Redis | Cluster;
  }

  /**
   * Ferme toutes les connexions du pool
   */
  static async close(): Promise<void> {
    poolLogger.info("[Redis Pool] Closing all connections");

    const promises: Promise<void>[] = [];

    if (this.publisherClient) {
      promises.push(
        this.publisherClient
          .quit()
          .then(() => undefined)
          .catch((err) => {
            poolLogger.error("[Redis Pool] Error closing publisher", {
              error: err.message,
            });
          }),
      );
    }

    if (this.subscriberClient) {
      promises.push(
        this.subscriberClient
          .quit()
          .then(() => undefined)
          .catch((err) => {
            poolLogger.error("[Redis Pool] Error closing subscriber", {
              error: err.message,
            });
          }),
      );
    }

    await Promise.all(promises);

    this.publisherClient = null;
    this.subscriberClient = null;
    this.isInitialized = false;

    poolLogger.info("[Redis Pool] All connections closed");
  }

  /**
   * Retourne les statistiques du pool
   */
  static getStats() {
    return {
      initialized: this.isInitialized,
      publisherStatus: this.publisherClient?.status || "disconnected",
      subscriberStatus: this.subscriberClient?.status || "disconnected",
    };
  }
}

export default RedisConnectionPool;
