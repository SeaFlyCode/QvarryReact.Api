import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "./loggerService";
import { safeJsonParse } from "../utils/secureJsonParser";

// Create child logger for redis-session service
const redisLogger = logger.child({ service: "redis-session" });

// ═══════════════════════════════════════════════════════════════════════════
// REDIS SESSION SERVICE - PERSISTANCE DES SESSIONS ET BLACKLIST
// ═══════════════════════════════════════════════════════════════════════════
// Correction de VULN-007: Sessions et blacklist désormais persistées dans Redis
// - Survit aux redémarrages serveur
// - Compatible avec clustering et load balancing
// - TTL automatique pour nettoyage
// ═══════════════════════════════════════════════════════════════════════════

import Redis, { Cluster } from "ioredis";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION REDIS
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";
const USE_REDIS_CLUSTER = process.env.USE_REDIS_CLUSTER === "true";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// REM-004: Redis obligatoire en production
if (IS_PRODUCTION && !REDIS_ENABLED) {
  redisLogger.critical("Redis must be enabled in production", {
    message:
      "Redis is mandatory for session persistence in production. Configure REDIS_ENABLED=true and Redis connection parameters.",
  });
  process.exit(1);
}

let redis: Redis | Cluster | null = null;

if (REDIS_ENABLED) {
  try {
    if (USE_REDIS_CLUSTER) {
      // Configuration Cluster Redis (production haute disponibilité)
      const clusterNodes =
        process.env.REDIS_CLUSTER_NODES?.split(",").map((node) => {
          const [host, port] = node.split(":");
          return { host, port: parseInt(port) };
        }) || [];

      redis = new Cluster(clusterNodes, {
        redisOptions: {
          password: process.env.REDIS_PASSWORD,
          tls: process.env.REDIS_TLS === "true" ? {} : undefined,
        },
      });
    } else {
      // Configuration Redis standard
      redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || "0"),
        retryStrategy: (times) => {
          return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: 3,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
        lazyConnect: true,
      });

      // Connexion avec gestion d'erreur
      redis
        .connect()
        .then(() => {
          redisLogger.info("Redis connected successfully");
        })
        .catch((error: any) => {
          redisLogger.error("Redis connection failed, falling back to memory", {
            error: getErrorMessage(error),
          });
          redis = null;
        });

      redis.on("error", (error: any) => {
        redisLogger.error("Redis error occurred", {
          error: getErrorMessage(error),
        });
      });

      redis.on("reconnecting", () => {
        redisLogger.info("Redis reconnecting");
      });
    }
  } catch (error: unknown) {
    redisLogger.error("Redis initialization failed, using memory storage", {
      error: getErrorMessage(error),
    });
    redis = null;
  }
} else {
  redisLogger.warn(
    "Redis disabled, using memory storage - sessions will not survive restarts",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface SessionMetadata {
  userId: string;
  tokenId?: string; // Added for per-device keying
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  lastActivity: Date;
}

interface BlacklistedToken {
  token: string;
  expiresAt: Date;
  blacklistedAt: Date;
  reason: string;
  userId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK EN MÉMOIRE (SI REDIS NON DISPONIBLE)
// ═══════════════════════════════════════════════════════════════════════════

const memorySessionStore: Map<string, SessionMetadata> = new Map();
const memoryBlacklistStore: Set<string> = new Set();
const memoryBlacklistDetails: Map<string, BlacklistedToken> = new Map();
// AUTH-006: Fallback mémoire pour les tentatives de login
const memoryLoginAttempts: Map<
  string,
  { attempts: number; lastAttempt: Date; blockedUntil?: Date }
> = new Map();
// AUTH-007: Fallback mémoire pour le stockage JTI
const memoryJtiStore: Map<string, string> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-11: TTL/CLEANUP POUR LES MEMORY FALLBACKS
// ═══════════════════════════════════════════════════════════════════════════

const MEMORY_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_MEMORY_BLACKLIST_SIZE = 10000;
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL || "3600") * 1000;
const BLACKLIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures
const LOGIN_ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures
const JTI_TTL_MS = parseInt(process.env.SESSION_TTL || "3600") * 1000;

// Tracking timestamps pour cleanup
const memorySessionTimestamps: Map<string, number> = new Map();
const memoryBlacklistTimestamps: Map<string, number> = new Map();
const memoryLoginAttemptsTimestamps: Map<string, number> = new Map();
const memoryJtiTimestamps: Map<string, number> = new Map();

function cleanupMemoryStores(): void {
  const now = Date.now();
  let cleaned = 0;

  // 1. Nettoyer les sessions expirées
  for (const [key, timestamp] of memorySessionTimestamps.entries()) {
    if (now - timestamp > SESSION_TTL_MS) {
      memorySessionStore.delete(key);
      memorySessionTimestamps.delete(key);
      cleaned++;
    }
  }

  // 2. Nettoyer la blacklist avec LRU si trop grande
  if (memoryBlacklistDetails.size > MAX_MEMORY_BLACKLIST_SIZE) {
    const entries = Array.from(memoryBlacklistTimestamps.entries());
    entries.sort((a, b) => a[1] - b[1]); // Trier par timestamp (plus ancien d'abord)

    const toRemove = Math.ceil(MAX_MEMORY_BLACKLIST_SIZE * 0.1);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      const [token] = entries[i];
      memoryBlacklistDetails.delete(token);
      memoryBlacklistStore.delete(token);
      memoryBlacklistTimestamps.delete(token);
      cleaned++;
    }
  }

  // Nettoyer les entrées expirées de la blacklist
  for (const [token, timestamp] of memoryBlacklistTimestamps.entries()) {
    if (now - timestamp > BLACKLIST_TTL_MS) {
      memoryBlacklistDetails.delete(token);
      memoryBlacklistStore.delete(token);
      memoryBlacklistTimestamps.delete(token);
      cleaned++;
    }
  }

  // 3. Nettoyer les tentatives de login expirées
  for (const [email, timestamp] of memoryLoginAttemptsTimestamps.entries()) {
    if (now - timestamp > LOGIN_ATTEMPTS_TTL_MS) {
      memoryLoginAttempts.delete(email);
      memoryLoginAttemptsTimestamps.delete(email);
      cleaned++;
    }
  }

  // 4. Nettoyer les JTI expirés
  for (const [userId, timestamp] of memoryJtiTimestamps.entries()) {
    if (now - timestamp > JTI_TTL_MS) {
      memoryJtiStore.delete(userId);
      memoryJtiTimestamps.delete(userId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    redisLogger.info("Memory cleanup completed", { entriesCleaned: cleaned });
  }
}

// Démarrer le nettoyage périodique
setInterval(cleanupMemoryStores, MEMORY_CLEANUP_INTERVAL_MS);
redisLogger.info("Automatic memory cleanup started", {
  intervalSeconds: MEMORY_CLEANUP_INTERVAL_MS / 1000,
});

// ═══════════════════════════════════════════════════════════════════════════
// REDIS SESSION SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export class RedisSessionService {
  private readonly SESSION_PREFIX = "qvarry:session:";
  private readonly BLACKLIST_PREFIX = "qvarry:blacklist:";
  private readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || "3600"); // 1 heure par défaut

  constructor() {
    // SEC-048: Vérifier la cohérence entre SESSION_TTL et JWT_EXPIRES_IN au démarrage
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "15m";
    const jwtExpiresInSeconds =
      parseInt(jwtExpiresIn.replace(/[^0-9]/g, "")) *
      (jwtExpiresIn.includes("h") ? 3600 : 60);
    if (this.SESSION_TTL < jwtExpiresInSeconds) {
      redisLogger.warn("SESSION_TTL is less than JWT_EXPIRES_IN", {
        sessionTTL: this.SESSION_TTL,
        jwtExpiresInSeconds,
        recommendation: "SESSION_TTL should be >= JWT_EXPIRES_IN",
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GESTION DES SESSIONS
  // ═══════════════════════════════════════════════════════════════════════

  async createSession(
    userId: string,
    metadata: Partial<SessionMetadata>,
  ): Promise<void> {
    const sessionData: SessionMetadata = {
      userId,
      tokenId: metadata.tokenId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    if (redis) {
      try {
        const key = metadata.tokenId
          ? `${this.SESSION_PREFIX}${userId}:${metadata.tokenId}`
          : `${this.SESSION_PREFIX}${userId}`;
        await redis.setex(key, this.SESSION_TTL, JSON.stringify(sessionData));
        redisLogger.info("Session created", {
          userId,
          tokenId: metadata.tokenId,
        });
      } catch (error: unknown) {
        redisLogger.error("Failed to create session in Redis, using memory", {
          error: getErrorMessage(error),
        });
        // Fallback en mémoire
        const memoryKey = metadata.tokenId
          ? `${userId}:${metadata.tokenId}`
          : userId;
        memorySessionStore.set(memoryKey, sessionData);
        memorySessionTimestamps.set(memoryKey, Date.now()); // HIGH-11: TTL tracking
      }
    } else {
      // Stockage en mémoire
      const memoryKey = metadata.tokenId
        ? `${userId}:${metadata.tokenId}`
        : userId;
      memorySessionStore.set(memoryKey, sessionData);
      memorySessionTimestamps.set(memoryKey, Date.now()); // HIGH-11: TTL tracking
    }
  }

  async getSession(
    userId: string,
    tokenId?: string,
  ): Promise<SessionMetadata | null> {
    if (redis) {
      try {
        const key = tokenId
          ? `${this.SESSION_PREFIX}${userId}:${tokenId}`
          : `${this.SESSION_PREFIX}${userId}`;
        const data = await redis.get(key);
        if (!data) return null;

        const session = safeJsonParse(data, {
          context: "redis-session",
          maxDepth: 5,
        });
        // Reconvertir les dates
        session.createdAt = new Date(session.createdAt);
        session.lastActivity = new Date(session.lastActivity);
        return session;
      } catch (error: unknown) {
        redisLogger.error("Failed to get session from Redis, using memory", {
          error: getErrorMessage(error),
        });
        // Fallback en mémoire
        const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
        return memorySessionStore.get(memoryKey) || null;
      }
    } else {
      const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
      return memorySessionStore.get(memoryKey) || null;
    }
  }

  async hasSession(userId: string, tokenId?: string): Promise<boolean> {
    if (redis) {
      try {
        const key = tokenId
          ? `${this.SESSION_PREFIX}${userId}:${tokenId}`
          : `${this.SESSION_PREFIX}${userId}`;
        const exists = await redis.exists(key);
        return exists === 1;
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to check session existence in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
        return memorySessionStore.has(memoryKey);
      }
    } else {
      const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
      return memorySessionStore.has(memoryKey);
    }
  }

  async deleteSession(userId: string, tokenId?: string): Promise<void> {
    if (redis) {
      try {
        const key = tokenId
          ? `${this.SESSION_PREFIX}${userId}:${tokenId}`
          : `${this.SESSION_PREFIX}${userId}`;
        await redis.del(key);
        redisLogger.info("Session deleted", {
          userId,
          tokenId,
        });
      } catch (error: unknown) {
        redisLogger.error("Failed to delete session from Redis, using memory", {
          error: getErrorMessage(error),
        });
        const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
        memorySessionStore.delete(memoryKey);
        memorySessionTimestamps.delete(memoryKey); // HIGH-11: Clean up timestamp
      }
    } else {
      const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
      memorySessionStore.delete(memoryKey);
      memorySessionTimestamps.delete(memoryKey); // HIGH-11: Clean up timestamp
    }
  }

  async touchSession(userId: string, tokenId?: string): Promise<void> {
    if (redis) {
      try {
        const key = tokenId
          ? `${this.SESSION_PREFIX}${userId}:${tokenId}`
          : `${this.SESSION_PREFIX}${userId}`;
        const exists = await redis.exists(key);

        if (exists) {
          // Prolonger le TTL et mettre à jour lastActivity
          const data = await redis.get(key);
          if (data) {
            const session = safeJsonParse(data, {
              context: "redis-session",
              maxDepth: 5,
            });
            session.lastActivity = new Date();
            await redis.setex(key, this.SESSION_TTL, JSON.stringify(session));
          }
        }
      } catch (error: unknown) {
        redisLogger.error("Failed to touch session in Redis, using memory", {
          error: getErrorMessage(error),
        });
        // Fallback en mémoire
        const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
        const session = memorySessionStore.get(memoryKey);
        if (session) {
          session.lastActivity = new Date();
          memorySessionTimestamps.set(memoryKey, Date.now()); // HIGH-11: Update TTL
        }
      }
    } else {
      const memoryKey = tokenId ? `${userId}:${tokenId}` : userId;
      const session = memorySessionStore.get(memoryKey);
      if (session) {
        session.lastActivity = new Date();
        memorySessionTimestamps.set(memoryKey, Date.now()); // HIGH-11: Update TTL
      }
    }
  }

  async getAllActiveSessions(): Promise<number> {
    if (redis) {
      try {
        // HIGH-12: Utiliser SCAN au lieu de KEYS pour éviter de bloquer Redis
        let count = 0;

        if (redis instanceof Cluster) {
          // Redis Cluster: fallback vers keys (moins optimal mais nécessaire)
          const keys = await redis.keys(`${this.SESSION_PREFIX}*`);
          return keys.length;
        } else {
          // Redis standalone: utiliser scanStream
          const stream = redis.scanStream({
            match: `${this.SESSION_PREFIX}*`,
            count: 100,
          });

          for await (const keys of stream) {
            count += keys.length;
          }

          return count;
        }
      } catch (error: unknown) {
        redisLogger.error("Failed to count sessions in Redis, using memory", {
          error: getErrorMessage(error),
        });
        return memorySessionStore.size;
      }
    } else {
      return memorySessionStore.size;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GESTION DE LA BLACKLIST
  // ═══════════════════════════════════════════════════════════════════════

  async blacklistToken(
    token: string,
    details: BlacklistedToken,
    expiresInSeconds: number,
  ): Promise<void> {
    if (redis) {
      try {
        const key = `${this.BLACKLIST_PREFIX}${token}`;
        await redis.setex(key, expiresInSeconds, JSON.stringify(details));
        redisLogger.info("Token blacklisted", {
          expiresInSeconds,
        });
      } catch (error: unknown) {
        redisLogger.error("Failed to blacklist token in Redis, using memory", {
          error: getErrorMessage(error),
        });
        // Fallback en mémoire
        memoryBlacklistStore.add(token);
        memoryBlacklistDetails.set(token, details);
        memoryBlacklistTimestamps.set(token, Date.now()); // HIGH-11: TTL tracking
      }
    } else {
      memoryBlacklistStore.add(token);
      memoryBlacklistDetails.set(token, details);
      memoryBlacklistTimestamps.set(token, Date.now()); // HIGH-11: TTL tracking
    }
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    if (redis) {
      try {
        const key = `${this.BLACKLIST_PREFIX}${token}`;
        const exists = await redis.exists(key);
        return exists === 1;
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to check token blacklist in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        return memoryBlacklistStore.has(token);
      }
    } else {
      return memoryBlacklistStore.has(token);
    }
  }

  async getBlacklistedTokenDetails(
    token: string,
  ): Promise<BlacklistedToken | null> {
    if (redis) {
      try {
        const key = `${this.BLACKLIST_PREFIX}${token}`;
        const data = await redis.get(key);
        if (!data) return null;

        const details = safeJsonParse(data, {
          context: "redis-session-details",
          maxDepth: 5,
        });
        details.expiresAt = new Date(details.expiresAt);
        details.blacklistedAt = new Date(details.blacklistedAt);
        return details;
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to get blacklisted token details from Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        return memoryBlacklistDetails.get(token) || null;
      }
    } else {
      return memoryBlacklistDetails.get(token) || null;
    }
  }

  async getBlacklistCount(): Promise<number> {
    if (redis) {
      try {
        // HIGH-12: Utiliser SCAN au lieu de KEYS pour éviter de bloquer Redis
        let count = 0;

        if (redis instanceof Cluster) {
          // Redis Cluster: fallback vers keys
          const keys = await redis.keys(`${this.BLACKLIST_PREFIX}*`);
          return keys.length;
        } else {
          // Redis standalone: utiliser scanStream
          const stream = redis.scanStream({
            match: `${this.BLACKLIST_PREFIX}*`,
            count: 100,
          });

          for await (const keys of stream) {
            count += keys.length;
          }

          return count;
        }
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to count blacklisted tokens in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        return memoryBlacklistStore.size;
      }
    } else {
      return memoryBlacklistStore.size;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STATISTIQUES ET MONITORING
  // ═══════════════════════════════════════════════════════════════════════

  async getStats(): Promise<{
    sessions: number;
    blacklisted: number;
    redisConnected: boolean;
  }> {
    const sessions = await this.getAllActiveSessions();
    const blacklisted = await this.getBlacklistCount();
    const redisConnected = redis?.status === "ready";

    return { sessions, blacklisted, redisConnected };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NETTOYAGE ET MAINTENANCE
  // ═══════════════════════════════════════════════════════════════════════

  async flushAll(): Promise<void> {
    if (redis) {
      try {
        await redis.flushdb();
        redisLogger.info("Redis database flushed");
      } catch (error: unknown) {
        redisLogger.error("Failed to flush Redis database", {
          error: getErrorMessage(error),
        });
      }
    }
    memorySessionStore.clear();
    memoryBlacklistStore.clear();
    memoryBlacklistDetails.clear();
  }

  // Getter pour savoir si Redis est utilisé
  isRedisEnabled(): boolean {
    return redis !== null && redis.status === "ready";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH-006: GESTION DES TENTATIVES DE LOGIN (PERSISTÉES)
  // ═══════════════════════════════════════════════════════════════════════
  private readonly LOGIN_ATTEMPTS_PREFIX = "qvarry:login_attempts:";
  private readonly LOGIN_ATTEMPTS_TTL = 24 * 60 * 60; // 24 heures
  private readonly TWO_FACTOR_ATTEMPTS_PREFIX = "2fa_attempts:";
  private readonly TWO_FACTOR_ATTEMPTS_TTL = 1800; // 30 min

  async getLoginAttempts(email: string): Promise<{
    attempts: number;
    lastAttempt: Date;
    blockedUntil?: Date;
  } | null> {
    if (redis) {
      try {
        const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
        const data = await redis.get(key);
        if (!data) return null;

        const parsed = safeJsonParse(data, {
          context: "redis-parsed-data",
          maxDepth: 5,
        });
        return {
          attempts: parsed.attempts,
          lastAttempt: new Date(parsed.lastAttempt),
          blockedUntil: parsed.blockedUntil
            ? new Date(parsed.blockedUntil)
            : undefined,
        };
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to get login attempts from Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        return memoryLoginAttempts.get(email) || null;
      }
    } else {
      return memoryLoginAttempts.get(email) || null;
    }
  }

  async recordLoginAttempt(
    email: string,
    blocked: boolean = false,
    blockDurationMinutes: number = 30,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.getLoginAttempts(email);

    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    let attempts = 1;

    if (existing) {
      // Réinitialiser le compteur si la dernière tentative date de plus de 15 minutes
      if (existing.lastAttempt < fifteenMinutesAgo) {
        attempts = 1;
      } else {
        attempts = existing.attempts + 1;
      }
    }

    const data = {
      attempts,
      lastAttempt: now.toISOString(),
      blockedUntil: blocked
        ? new Date(
            now.getTime() + blockDurationMinutes * 60 * 1000,
          ).toISOString()
        : undefined,
    };

    if (redis) {
      try {
        const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
        await redis.setex(key, this.LOGIN_ATTEMPTS_TTL, JSON.stringify(data));
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to record login attempt in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        memoryLoginAttempts.set(email, {
          attempts,
          lastAttempt: now,
          blockedUntil: blocked
            ? new Date(now.getTime() + blockDurationMinutes * 60 * 1000)
            : undefined,
        });
        memoryLoginAttemptsTimestamps.set(email, Date.now()); // HIGH-11: TTL tracking
      }
    } else {
      memoryLoginAttempts.set(email, {
        attempts,
        lastAttempt: now,
        blockedUntil: blocked
          ? new Date(now.getTime() + blockDurationMinutes * 60 * 1000)
          : undefined,
      });
      memoryLoginAttemptsTimestamps.set(email, Date.now()); // HIGH-11: TTL tracking
    }
  }

  async resetLoginAttempts(email: string): Promise<void> {
    if (redis) {
      try {
        const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
        await redis.del(key);
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to reset login attempts in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        memoryLoginAttempts.delete(email);
        memoryLoginAttemptsTimestamps.delete(email); // HIGH-11: Clean up timestamp
      }
    } else {
      memoryLoginAttempts.delete(email);
      memoryLoginAttemptsTimestamps.delete(email); // HIGH-11: Clean up timestamp
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH-007: STOCKAGE DU JTI EN SESSION
  // ═══════════════════════════════════════════════════════════════════════
  private readonly JTI_PREFIX = "qvarry:jti:";

  async storeSessionJti(
    userId: string,
    jti: string,
    expiresInSeconds: number,
    clientType: "web" | "mobile" = "web",
  ): Promise<void> {
    if (redis) {
      try {
        const key = `${this.JTI_PREFIX}${userId}:${clientType}`;
        await redis.setex(key, expiresInSeconds, jti);
      } catch (error: unknown) {
        redisLogger.error("Failed to store JTI in Redis, using memory", {
          error: getErrorMessage(error),
        });
        const memoryKey = `${userId}:${clientType}`;
        memoryJtiStore.set(memoryKey, jti);
        memoryJtiTimestamps.set(memoryKey, Date.now()); // HIGH-11: TTL tracking
      }
    } else {
      const memoryKey = `${userId}:${clientType}`;
      memoryJtiStore.set(memoryKey, jti);
      memoryJtiTimestamps.set(memoryKey, Date.now()); // HIGH-11: TTL tracking
    }
  }

  async getSessionJti(
    userId: string,
    clientType: "web" | "mobile" = "web",
  ): Promise<string | null> {
    if (redis) {
      try {
        const key = `${this.JTI_PREFIX}${userId}:${clientType}`;
        return await redis.get(key);
      } catch (error: unknown) {
        redisLogger.error("Failed to get JTI from Redis, using memory", {
          error: getErrorMessage(error),
        });
        const memoryKey = `${userId}:${clientType}`;
        return memoryJtiStore.get(memoryKey) || null;
      }
    } else {
      const memoryKey = `${userId}:${clientType}`;
      return memoryJtiStore.get(memoryKey) || null;
    }
  }

  async validateSessionJti(
    userId: string,
    jti: string,
    clientType: "web" | "mobile" = "web",
  ): Promise<boolean> {
    // Fix: Si Redis désactivé, fallback permissif pour mobile
    // (le Map mémoire est vidé au redémarrage → tous les tokens mobiles actifs
    // seraient invalides sans cette protection)
    if (!redis) {
      const memoryKey = `${userId}:${clientType}`;
      const stored = memoryJtiStore.get(memoryKey);
      if (!stored && clientType === "mobile") {
        // Pas de JTI stocké en mode sans Redis → on fait confiance au JWT lui-même
        return true;
      }
      return !stored || stored === jti;
    }
    const storedJti = await this.getSessionJti(userId, clientType);
    return storedJti === jti;
  }

  async deleteSessionJti(
    userId: string,
    clientType: "web" | "mobile" = "web",
  ): Promise<void> {
    if (redis) {
      try {
        const key = `${this.JTI_PREFIX}${userId}:${clientType}`;
        await redis.del(key);
        redisLogger.info("JTI deleted", {
          userId,
          clientType,
        });
      } catch (error: unknown) {
        redisLogger.error("Failed to delete JTI from Redis, using memory", {
          error: getErrorMessage(error),
        });
        const memoryKey = `${userId}:${clientType}`;
        memoryJtiStore.delete(memoryKey);
        memoryJtiTimestamps.delete(memoryKey);
      }
    } else {
      const memoryKey = `${userId}:${clientType}`;
      memoryJtiStore.delete(memoryKey);
      memoryJtiTimestamps.delete(memoryKey);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH-004/WS-TOKEN: TOKENS WEBSOCKET À USAGE UNIQUE
  // ═══════════════════════════════════════════════════════════════════════
  private readonly WS_TOKEN_PREFIX = "qvarry:ws_token:";
  private readonly WS_TOKEN_TTL = 300; // 5 minutes

  /**
   * Marquer un token WebSocket comme utilisé (à usage unique)
   * @returns true si le token était valide et a été consommé, false si déjà utilisé
   */
  async consumeWsToken(tokenJti: string): Promise<boolean> {
    if (redis) {
      try {
        const key = `${this.WS_TOKEN_PREFIX}${tokenJti}`;
        // SETNX retourne 1 si la clé n'existait pas (première utilisation)
        // Retourne 0 si la clé existait déjà (token déjà consommé)
        const result = await redis.setnx(key, "used");
        if (result === 1) {
          // Définir un TTL pour nettoyer automatiquement
          await redis.expire(key, this.WS_TOKEN_TTL);
          return true;
        }
        return false; // Token déjà utilisé
      } catch (error: unknown) {
        redisLogger.error("Failed to consume WS token in Redis, using memory", {
          error: getErrorMessage(error),
        });
        // Fallback mémoire - moins sécurisé mais fonctionnel
        return this.consumeWsTokenMemory(tokenJti);
      }
    } else {
      return this.consumeWsTokenMemory(tokenJti);
    }
  }

  // Fallback mémoire pour tokens WS
  private usedWsTokensMemory: Set<string> = new Set();

  private consumeWsTokenMemory(tokenJti: string): boolean {
    if (this.usedWsTokensMemory.has(tokenJti)) {
      return false; // Déjà utilisé
    }
    this.usedWsTokensMemory.add(tokenJti);
    // Nettoyage automatique après 5 minutes
    setTimeout(() => {
      this.usedWsTokensMemory.delete(tokenJti);
    }, this.WS_TOKEN_TTL * 1000);
    return true;
  }

  /**
   * Vérifier si un token WS a déjà été utilisé (sans le consommer)
   */
  async isWsTokenUsed(tokenJti: string): Promise<boolean> {
    if (redis) {
      try {
        const key = `${this.WS_TOKEN_PREFIX}${tokenJti}`;
        const exists = await redis.exists(key);
        return exists === 1;
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to check WS token usage in Redis, using memory",
          {
            error: getErrorMessage(error),
          },
        );
        return this.usedWsTokensMemory.has(tokenJti);
      }
    } else {
      return this.usedWsTokensMemory.has(tokenJti);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-003: RATE LIMITING MOBILE (PERSISTÉ EN REDIS)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Récupère une entrée de rate limit mobile depuis Redis
   * @param key - Clé Redis (ex: qvarry:mobile_rl:<identifier>)
   * @returns La valeur JSON sérialisée ou null si absente
   */
  async getMobileRateLimit(key: string): Promise<string | null> {
    if (redis) {
      try {
        return await redis.get(key);
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to get mobile rate limit from Redis, using memory fallback",
          { error: getErrorMessage(error), key },
        );
        return null;
      }
    }
    return null;
  }

  /**
   * Persiste une entrée de rate limit mobile dans Redis avec TTL
   * @param key - Clé Redis (ex: qvarry:mobile_rl:<identifier>)
   * @param value - Valeur JSON sérialisée
   * @param ttlSeconds - Durée de vie en secondes
   */
  async setMobileRateLimit(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (redis) {
      try {
        await redis.setex(key, ttlSeconds, value);
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to set mobile rate limit in Redis, using memory fallback",
          { error: getErrorMessage(error), key },
        );
      }
    }
  }
  // ═══════════════════════════════════════════════════════════════════════
  // RATE LIMITING 2FA (PERSISTÉ EN REDIS)
  // ═══════════════════════════════════════════════════════════════════════

  async checkTwoFactorAttempts(
    userId: string,
  ): Promise<{ allowed: boolean; waitTime?: number }> {
    const blockedKey = `${this.TWO_FACTOR_ATTEMPTS_PREFIX}blocked:${userId}`;

    if (redis) {
      try {
        const blockedTtl = await redis.ttl(blockedKey);
        if (blockedTtl > 0) {
          return { allowed: false, waitTime: Math.ceil(blockedTtl / 60) };
        }
        return { allowed: true };
      } catch (error: unknown) {
        redisLogger.error(
          "Failed to check 2FA attempts in Redis, using memory",
          { error: getErrorMessage(error) },
        );
      }
    }
    // fallback mémoire — toujours autorisé si Redis absent
    return { allowed: true };
  }

  async recordTwoFactorFailure(userId: string): Promise<void> {
    const key = `${this.TWO_FACTOR_ATTEMPTS_PREFIX}${userId}`;
    const blockedKey = `${this.TWO_FACTOR_ATTEMPTS_PREFIX}blocked:${userId}`;

    if (redis) {
      try {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, 900); // fenêtre 15 min
        }
        if (count >= 5) {
          await redis.setex(blockedKey, this.TWO_FACTOR_ATTEMPTS_TTL, "1"); // bloqué 30 min
          await redis.del(key);
        }
      } catch (error: unknown) {
        redisLogger.error("Failed to record 2FA failure in Redis", {
          error: getErrorMessage(error),
        });
      }
    }
  }

  async resetTwoFactorAttempts(userId: string): Promise<void> {
    const key = `${this.TWO_FACTOR_ATTEMPTS_PREFIX}${userId}`;
    const blockedKey = `${this.TWO_FACTOR_ATTEMPTS_PREFIX}blocked:${userId}`;

    if (redis) {
      try {
        await redis.del(key, blockedKey);
      } catch (error: unknown) {
        redisLogger.error("Failed to reset 2FA attempts in Redis", {
          error: getErrorMessage(error),
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const redisSessionService = new RedisSessionService();

// Nettoyage à la fermeture
process.on("SIGTERM", async () => {
  if (redis) {
    redisLogger.info("Closing Redis connection");
    await redis.quit();
  }
});
