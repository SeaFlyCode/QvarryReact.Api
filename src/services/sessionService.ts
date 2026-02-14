/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SERVICE DE GESTION DES SESSIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce service gère le cycle de vie des sessions utilisateur avec :
 * - Timeout automatique après inactivité
 * - Nettoyage périodique des sessions expirées
 * - Limitation du nombre de sessions par utilisateur
 * - Métriques et monitoring
 */

import { memoryStorage } from "./memoryStorageService";

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES ET TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SessionMetadata {
    userId: string;
    createdAt: Date;
    lastAccessed: Date;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'); // 1 heure par défaut
const SESSION_CLEANUP_INTERVAL_MS = parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS || '300000'); // 5 minutes
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5');

// CONF-008: Limite maximale de sessions en mémoire pour éviter l'épuisement mémoire
const MAX_TOTAL_SESSIONS = parseInt(process.env.MAX_TOTAL_SESSIONS || '10000');

// ═══════════════════════════════════════════════════════════════════════════
// STOCKAGE DES MÉTADONNÉES DE SESSION
// ═══════════════════════════════════════════════════════════════════════════

const sessionMetadata: Map<string, SessionMetadata> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE SessionService
// ═══════════════════════════════════════════════════════════════════════════

class SessionService {
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.startCleanupTask();
        console.log(`🔐 Session service started (timeout: ${SESSION_TIMEOUT_MS / 1000}s, max: ${MAX_SESSIONS_PER_USER})`);
    }

    /**
     * Créer une nouvelle session
     */
    createSession(userId: string, ipAddress?: string, userAgent?: string): void {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

        // CONF-008: Vérifier la limite globale de sessions
        if (sessionMetadata.size >= MAX_TOTAL_SESSIONS) {
            console.warn(`⚠️ [SESSION] Limite globale de sessions atteinte (${MAX_TOTAL_SESSIONS}), éviction LRU`);
            this.evictOldestSessions(Math.ceil(MAX_TOTAL_SESSIONS * 0.1)); // Évacuer 10%
        }

        // Vérifier le nombre de sessions actives pour cet utilisateur
        const userSessions = this.getUserSessionCount(userId);
        if (userSessions >= MAX_SESSIONS_PER_USER) {
            console.warn(`⚠️ [SESSION] Limite de sessions atteinte pour userId: ${userId}`);
            // Supprimer la session la plus ancienne
            this.removeOldestUserSession(userId);
        }

        sessionMetadata.set(userId, {
            userId,
            createdAt: now,
            lastAccessed: now,
            ipAddress,
            userAgent,
            expiresAt
        });

        console.log(`✅ [SESSION] Session créée pour userId: ${userId} (expire: ${expiresAt.toISOString()})`);
    }

    /**
     * Évacuer les sessions les plus anciennes (LRU - Least Recently Used)
     */
    private evictOldestSessions(count: number): void {
        const sessions = Array.from(sessionMetadata.entries())
            .sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime());

        const toEvict = sessions.slice(0, count);
        for (const [userId] of toEvict) {
            this.destroySession(userId);
        }

        console.log(`🧹 [SESSION] ${toEvict.length} session(s) évacuée(s) par LRU`);
    }

    /**
     * Mettre à jour le timestamp de dernière activité d'une session
     */
    touchSession(userId: string): void {
        const session = sessionMetadata.get(userId);
        if (!session) {
            console.warn(`⚠️ [SESSION] Tentative de touch sur session inexistante: ${userId}`);
            return;
        }

        const now = new Date();
        session.lastAccessed = now;
        session.expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);
        sessionMetadata.set(userId, session);
    }

    /**
     * Vérifier si une session est valide
     */
    isSessionValid(userId: string): boolean {
        const session = sessionMetadata.get(userId);
        if (!session) {
            return false;
        }

        const now = new Date();
        if (session.expiresAt < now) {
            console.log(`⏰ [SESSION] Session expirée pour userId: ${userId}`);
            this.destroySession(userId);
            return false;
        }

        return memoryStorage.hasSession(userId);
    }

    /**
     * Détruire une session
     */
    destroySession(userId: string): void {
        const session = sessionMetadata.get(userId);
        if (session) {
            console.log(`🗑️ [SESSION] Destruction de la session userId: ${userId}`);
            sessionMetadata.delete(userId);

            // Nettoyer aussi la session en mémoire
            if (memoryStorage.hasSession(userId)) {
                memoryStorage.endSession(userId);
            }
        }
    }

    /**
     * Obtenir les informations d'une session
     */
    getSessionInfo(userId: string): SessionMetadata | null {
        return sessionMetadata.get(userId) || null;
    }

    /**
     * Compter le nombre de sessions actives pour un utilisateur
     */
    getUserSessionCount(userId: string): number {
        // Pour l'instant, on limite à 1 session par utilisateur
        // Dans une architecture multi-device, on pourrait avoir plusieurs sessions
        return sessionMetadata.has(userId) ? 1 : 0;
    }

    /**
     * Supprimer la session la plus ancienne d'un utilisateur
     */
    private removeOldestUserSession(userId: string): void {
        const session = sessionMetadata.get(userId);
        if (session) {
            this.destroySession(userId);
        }
    }

    /**
     * Nettoyer toutes les sessions expirées
     */
    cleanupExpiredSessions(): void {
        const now = new Date();
        let cleanedCount = 0;

        for (const [userId, session] of sessionMetadata.entries()) {
            if (session.expiresAt < now) {
                this.destroySession(userId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 [SESSION CLEANUP] ${cleanedCount} session(s) expirée(s) nettoyée(s)`);
        }
    }

    /**
     * Démarrer la tâche de nettoyage périodique
     */
    private startCleanupTask(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, SESSION_CLEANUP_INTERVAL_MS);


    }

    /**
     * Arrêter la tâche de nettoyage
     */
    stopCleanupTask(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log(`⏹️ [SESSION] Tâche de nettoyage arrêtée`);
        }
    }

    /**
     * Obtenir toutes les statistiques des sessions
     */
    getStats(): {
        activeSessions: number;
        sessions: Array<{
            userId: string;
            createdAt: Date;
            lastAccessed: Date;
            expiresAt: Date;
            timeToExpiry: number;
        }>;
    } {
        const now = new Date();
        const sessions = Array.from(sessionMetadata.entries()).map(([userId, session]) => ({
            userId,
            createdAt: session.createdAt,
            lastAccessed: session.lastAccessed,
            expiresAt: session.expiresAt,
            timeToExpiry: Math.max(0, session.expiresAt.getTime() - now.getTime())
        }));

        return {
            activeSessions: sessionMetadata.size,
            sessions
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DE L'INSTANCE SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const sessionService = new SessionService();

