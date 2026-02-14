import { getErrorMessage } from '../utils/errorUtils';
// ═══════════════════════════════════════════════════════════════════════════
// REDIS SESSION SERVICE - PERSISTANCE DES SESSIONS ET BLACKLIST
// ═══════════════════════════════════════════════════════════════════════════
// Correction de VULN-007: Sessions et blacklist désormais persistées dans Redis
// - Survit aux redémarrages serveur
// - Compatible avec clustering et load balancing
// - TTL automatique pour nettoyage
// ═══════════════════════════════════════════════════════════════════════════

import Redis, { Cluster } from 'ioredis';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION REDIS
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';
const USE_REDIS_CLUSTER = process.env.USE_REDIS_CLUSTER === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// REM-004: Redis obligatoire en production
if (IS_PRODUCTION && !REDIS_ENABLED) {
    console.error('❌ [SECURITY] REDIS_ENABLED doit être activé en production!');
    console.error('❌ [SECURITY] Redis est obligatoire pour la persistance des sessions en production.');
    console.error('❌ [SECURITY] Configurez REDIS_ENABLED=true et les paramètres de connexion Redis.');
    process.exit(1);
}

let redis: Redis | Cluster | null = null;

if (REDIS_ENABLED) {
    try {
        if (USE_REDIS_CLUSTER) {
            // Configuration Cluster Redis (production haute disponibilité)
            const clusterNodes = process.env.REDIS_CLUSTER_NODES?.split(',').map(node => {
                const [host, port] = node.split(':');
                return { host, port: parseInt(port) };
            }) || [];

            redis = new Cluster(clusterNodes, {
                redisOptions: {
                    password: process.env.REDIS_PASSWORD,
                    tls: process.env.NODE_ENV === 'production' ? {} : undefined
                }
            });
        } else {
            // Configuration Redis standard
            redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD,
                db: parseInt(process.env.REDIS_DB || '0'),
                retryStrategy: (times) => {
                    return Math.min(times * 50, 2000);
                },
                maxRetriesPerRequest: 3,
                tls: process.env.NODE_ENV === 'production' && process.env.REDIS_TLS === 'true' ? {} : undefined,
                lazyConnect: true
            });

            // Connexion avec gestion d'erreur
            redis.connect().then(() => {
                console.log('✅ [REDIS] Connecté avec succès');
            }).catch((error: any) => {
                console.error('❌ [REDIS] Erreur de connexion:', getErrorMessage(error));
                console.warn('⚠️ [REDIS] Fallback vers stockage en mémoire');
                redis = null;
            });

            redis.on('error', (error: any) => {
                console.error('❌ [REDIS] Erreur:', getErrorMessage(error));
            });

            redis.on('reconnecting', () => {
                console.log('🔄 [REDIS] Reconnexion en cours...');
            });
        }
    } catch (error: unknown) {
        console.error('❌ [REDIS] Erreur d\'initialisation:', getErrorMessage(error));
        console.warn('⚠️ [REDIS] Utilisation du stockage en mémoire comme fallback');
        redis = null;
    }
} else {
    console.warn('⚠️ [REDIS] Redis désactivé, utilisation du stockage en mémoire');
    console.warn('⚠️ [SECURITY] Les sessions ne survivront pas aux redémarrages');
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface SessionMetadata {
    userId: string;
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
const memoryLoginAttempts: Map<string, { attempts: number; lastAttempt: Date; blockedUntil?: Date }> = new Map();
// AUTH-007: Fallback mémoire pour le stockage JTI
const memoryJtiStore: Map<string, string> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// REDIS SESSION SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export class RedisSessionService {
    private readonly SESSION_PREFIX = 'qvarry:session:';
    private readonly BLACKLIST_PREFIX = 'qvarry:blacklist:';
    private readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600'); // 1 heure par défaut

    // ═══════════════════════════════════════════════════════════════════════
    // GESTION DES SESSIONS
    // ═══════════════════════════════════════════════════════════════════════

    async createSession(userId: string, metadata: Partial<SessionMetadata>): Promise<void> {
        const sessionData: SessionMetadata = {
            userId,
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            createdAt: new Date(),
            lastActivity: new Date()
        };

        if (redis) {
            try {
                const key = `${this.SESSION_PREFIX}${userId}`;
                await redis.setex(key, this.SESSION_TTL, JSON.stringify(sessionData));
                console.log(`✅ [REDIS SESSION] Session créée pour userId: ${userId}`);
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur création session:`, getErrorMessage(error));
                // Fallback en mémoire
                memorySessionStore.set(userId, sessionData);
            }
        } else {
            // Stockage en mémoire
            memorySessionStore.set(userId, sessionData);
        }
    }

    async getSession(userId: string): Promise<SessionMetadata | null> {
        if (redis) {
            try {
                const key = `${this.SESSION_PREFIX}${userId}`;
                const data = await redis.get(key);
                if (!data) return null;

                const session = JSON.parse(data);
                // Reconvertir les dates
                session.createdAt = new Date(session.createdAt);
                session.lastActivity = new Date(session.lastActivity);
                return session;
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur récupération session:`, getErrorMessage(error));
                // Fallback en mémoire
                return memorySessionStore.get(userId) || null;
            }
        } else {
            return memorySessionStore.get(userId) || null;
        }
    }

    async hasSession(userId: string): Promise<boolean> {
        if (redis) {
            try {
                const key = `${this.SESSION_PREFIX}${userId}`;
                const exists = await redis.exists(key);
                return exists === 1;
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur vérification session:`, getErrorMessage(error));
                return memorySessionStore.has(userId);
            }
        } else {
            return memorySessionStore.has(userId);
        }
    }

    async deleteSession(userId: string): Promise<void> {
        if (redis) {
            try {
                const key = `${this.SESSION_PREFIX}${userId}`;
                await redis.del(key);
                console.log(`🗑️ [REDIS SESSION] Session supprimée pour userId: ${userId}`);
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur suppression session:`, getErrorMessage(error));
                memorySessionStore.delete(userId);
            }
        } else {
            memorySessionStore.delete(userId);
        }
    }

    async touchSession(userId: string): Promise<void> {
        if (redis) {
            try {
                const key = `${this.SESSION_PREFIX}${userId}`;
                const exists = await redis.exists(key);

                if (exists) {
                    // Prolonger le TTL et mettre à jour lastActivity
                    const data = await redis.get(key);
                    if (data) {
                        const session = JSON.parse(data);
                        session.lastActivity = new Date();
                        await redis.setex(key, this.SESSION_TTL, JSON.stringify(session));
                    }
                }
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur touch session:`, getErrorMessage(error));
                // Fallback en mémoire
                const session = memorySessionStore.get(userId);
                if (session) {
                    session.lastActivity = new Date();
                }
            }
        } else {
            const session = memorySessionStore.get(userId);
            if (session) {
                session.lastActivity = new Date();
            }
        }
    }

    async getAllActiveSessions(): Promise<number> {
        if (redis) {
            try {
                const keys = await redis.keys(`${this.SESSION_PREFIX}*`);
                return keys.length;
            } catch (error: unknown) {
                console.error(`❌ [REDIS SESSION] Erreur comptage sessions:`, getErrorMessage(error));
                return memorySessionStore.size;
            }
        } else {
            return memorySessionStore.size;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GESTION DE LA BLACKLIST
    // ═══════════════════════════════════════════════════════════════════════

    async blacklistToken(token: string, details: BlacklistedToken, expiresInSeconds: number): Promise<void> {
        if (redis) {
            try {
                const key = `${this.BLACKLIST_PREFIX}${token}`;
                await redis.setex(key, expiresInSeconds, JSON.stringify(details));
                console.log(`🚫 [REDIS BLACKLIST] Token blacklisté (expire dans ${expiresInSeconds}s)`);
            } catch (error: unknown) {
                console.error(`❌ [REDIS BLACKLIST] Erreur blacklist token:`, getErrorMessage(error));
                // Fallback en mémoire
                memoryBlacklistStore.add(token);
                memoryBlacklistDetails.set(token, details);
            }
        } else {
            memoryBlacklistStore.add(token);
            memoryBlacklistDetails.set(token, details);
        }
    }

    async isTokenBlacklisted(token: string): Promise<boolean> {
        if (redis) {
            try {
                const key = `${this.BLACKLIST_PREFIX}${token}`;
                const exists = await redis.exists(key);
                return exists === 1;
            } catch (error: unknown) {
                console.error(`❌ [REDIS BLACKLIST] Erreur vérification blacklist:`, getErrorMessage(error));
                return memoryBlacklistStore.has(token);
            }
        } else {
            return memoryBlacklistStore.has(token);
        }
    }

    async getBlacklistedTokenDetails(token: string): Promise<BlacklistedToken | null> {
        if (redis) {
            try {
                const key = `${this.BLACKLIST_PREFIX}${token}`;
                const data = await redis.get(key);
                if (!data) return null;

                const details = JSON.parse(data);
                details.expiresAt = new Date(details.expiresAt);
                details.blacklistedAt = new Date(details.blacklistedAt);
                return details;
            } catch (error: unknown) {
                console.error(`❌ [REDIS BLACKLIST] Erreur récupération détails:`, getErrorMessage(error));
                return memoryBlacklistDetails.get(token) || null;
            }
        } else {
            return memoryBlacklistDetails.get(token) || null;
        }
    }

    async getBlacklistCount(): Promise<number> {
        if (redis) {
            try {
                const keys = await redis.keys(`${this.BLACKLIST_PREFIX}*`);
                return keys.length;
            } catch (error: unknown) {
                console.error(`❌ [REDIS BLACKLIST] Erreur comptage blacklist:`, getErrorMessage(error));
                return memoryBlacklistStore.size;
            }
        } else {
            return memoryBlacklistStore.size;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATISTIQUES ET MONITORING
    // ═══════════════════════════════════════════════════════════════════════

    async getStats(): Promise<{ sessions: number; blacklisted: number; redisConnected: boolean }> {
        const sessions = await this.getAllActiveSessions();
        const blacklisted = await this.getBlacklistCount();
        const redisConnected = redis?.status === 'ready';

        return { sessions, blacklisted, redisConnected };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NETTOYAGE ET MAINTENANCE
    // ═══════════════════════════════════════════════════════════════════════

    async flushAll(): Promise<void> {
        if (redis) {
            try {
                await redis.flushdb();
                console.log('🗑️ [REDIS] Base de données nettoyée');
            } catch (error: unknown) {
                console.error(`❌ [REDIS] Erreur flush:`, getErrorMessage(error));
            }
        }
        memorySessionStore.clear();
        memoryBlacklistStore.clear();
        memoryBlacklistDetails.clear();
    }

    // Getter pour savoir si Redis est utilisé
    isRedisEnabled(): boolean {
        return redis !== null && redis.status === 'ready';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AUTH-006: GESTION DES TENTATIVES DE LOGIN (PERSISTÉES)
    // ═══════════════════════════════════════════════════════════════════════
    private readonly LOGIN_ATTEMPTS_PREFIX = 'qvarry:login_attempts:';
    private readonly LOGIN_ATTEMPTS_TTL = 24 * 60 * 60; // 24 heures

    async getLoginAttempts(email: string): Promise<{ attempts: number; lastAttempt: Date; blockedUntil?: Date } | null> {
        if (redis) {
            try {
                const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
                const data = await redis.get(key);
                if (!data) return null;

                const parsed = JSON.parse(data);
                return {
                    attempts: parsed.attempts,
                    lastAttempt: new Date(parsed.lastAttempt),
                    blockedUntil: parsed.blockedUntil ? new Date(parsed.blockedUntil) : undefined
                };
            } catch (error: unknown) {
                console.error(`❌ [REDIS LOGIN] Erreur récupération tentatives:`, getErrorMessage(error));
                return memoryLoginAttempts.get(email) || null;
            }
        } else {
            return memoryLoginAttempts.get(email) || null;
        }
    }

    async recordLoginAttempt(email: string, blocked: boolean = false, blockDurationMinutes: number = 30): Promise<void> {
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
            blockedUntil: blocked ? new Date(now.getTime() + blockDurationMinutes * 60 * 1000).toISOString() : undefined
        };

        if (redis) {
            try {
                const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
                await redis.setex(key, this.LOGIN_ATTEMPTS_TTL, JSON.stringify(data));
            } catch (error: unknown) {
                console.error(`❌ [REDIS LOGIN] Erreur enregistrement tentative:`, getErrorMessage(error));
                memoryLoginAttempts.set(email, {
                    attempts,
                    lastAttempt: now,
                    blockedUntil: blocked ? new Date(now.getTime() + blockDurationMinutes * 60 * 1000) : undefined
                });
            }
        } else {
            memoryLoginAttempts.set(email, {
                attempts,
                lastAttempt: now,
                blockedUntil: blocked ? new Date(now.getTime() + blockDurationMinutes * 60 * 1000) : undefined
            });
        }
    }

    async resetLoginAttempts(email: string): Promise<void> {
        if (redis) {
            try {
                const key = `${this.LOGIN_ATTEMPTS_PREFIX}${email}`;
                await redis.del(key);
            } catch (error: unknown) {
                console.error(`❌ [REDIS LOGIN] Erreur réinitialisation tentatives:`, getErrorMessage(error));
                memoryLoginAttempts.delete(email);
            }
        } else {
            memoryLoginAttempts.delete(email);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AUTH-007: STOCKAGE DU JTI EN SESSION
    // ═══════════════════════════════════════════════════════════════════════
    private readonly JTI_PREFIX = 'qvarry:jti:';

    async storeSessionJti(userId: string, jti: string, expiresInSeconds: number): Promise<void> {
        if (redis) {
            try {
                const key = `${this.JTI_PREFIX}${userId}`;
                await redis.setex(key, expiresInSeconds, jti);
            } catch (error: unknown) {
                console.error(`❌ [REDIS JTI] Erreur stockage JTI:`, getErrorMessage(error));
                memoryJtiStore.set(userId, jti);
            }
        } else {
            memoryJtiStore.set(userId, jti);
        }
    }

    async getSessionJti(userId: string): Promise<string | null> {
        if (redis) {
            try {
                const key = `${this.JTI_PREFIX}${userId}`;
                return await redis.get(key);
            } catch (error: unknown) {
                console.error(`❌ [REDIS JTI] Erreur récupération JTI:`, getErrorMessage(error));
                return memoryJtiStore.get(userId) || null;
            }
        } else {
            return memoryJtiStore.get(userId) || null;
        }
    }

    async validateSessionJti(userId: string, jti: string): Promise<boolean> {
        const storedJti = await this.getSessionJti(userId);
        return storedJti === jti;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AUTH-004/WS-TOKEN: TOKENS WEBSOCKET À USAGE UNIQUE
    // ═══════════════════════════════════════════════════════════════════════
    private readonly WS_TOKEN_PREFIX = 'qvarry:ws_token:';
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
                const result = await redis.setnx(key, 'used');
                if (result === 1) {
                    // Définir un TTL pour nettoyer automatiquement
                    await redis.expire(key, this.WS_TOKEN_TTL);
                    return true;
                }
                return false; // Token déjà utilisé
            } catch (error: unknown) {
                console.error(`❌ [REDIS WS_TOKEN] Erreur consommation token:`, getErrorMessage(error));
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
                console.error(`❌ [REDIS WS_TOKEN] Erreur vérification token:`, getErrorMessage(error));
                return this.usedWsTokensMemory.has(tokenJti);
            }
        } else {
            return this.usedWsTokensMemory.has(tokenJti);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const redisSessionService = new RedisSessionService();

// Nettoyage à la fermeture
process.on('SIGTERM', async () => {
    if (redis) {
        console.log('🔌 [REDIS] Fermeture de la connexion...');
        await redis.quit();
    }
});
