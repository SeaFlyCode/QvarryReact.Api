import { logger } from "./loggerService";

// ═══════════════════════════════════════════════════════════════════════════
// USER STATUS SERVICE - GESTION DU STATUT UTILISATEUR (ONLINE/AWAY/OFFLINE)
// ═══════════════════════════════════════════════════════════════════════════
// Service simple en mémoire pour gérer les statuts de présence des utilisateurs
// avec nettoyage automatique des entrées obsolètes (TTL 24h)
// ═══════════════════════════════════════════════════════════════════════════

const statusLogger = logger.child({ service: "user-status" });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type UserStatus = "online" | "away" | "offline";

interface UserStatusData {
  status: UserStatus;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class UserStatusService {
  private statusMap = new Map<string, UserStatusData>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 heures
  private readonly CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

  /**
   * Démarrer le service avec nettoyage automatique
   */
  start(): void {
    if (this.cleanupInterval) {
      statusLogger.warn("User status service already started");
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleEntries();
    }, this.CLEANUP_INTERVAL_MS);

    statusLogger.info("User status service started", {
      ttl: `${this.TTL_MS / 1000 / 60 / 60}h`,
      cleanupInterval: `${this.CLEANUP_INTERVAL_MS / 1000 / 60}min`,
    });
  }

  /**
   * Arrêter le service
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      statusLogger.info("User status service stopped");
    }
  }

  /**
   * Marquer un utilisateur comme "away"
   */
  async markAsAway(userId: string): Promise<void> {
    try {
      this.statusMap.set(userId, {
        status: "away",
        updatedAt: new Date(),
      });

      statusLogger.debug("User marked as away", { userId });
    } catch (error) {
      statusLogger.error("Failed to mark user as away", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Marquer un utilisateur comme "online"
   */
  async markAsOnline(userId: string): Promise<void> {
    try {
      this.statusMap.set(userId, {
        status: "online",
        updatedAt: new Date(),
      });

      statusLogger.debug("User marked as online", { userId });
    } catch (error) {
      statusLogger.error("Failed to mark user as online", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Marquer un utilisateur comme "offline"
   */
  async markAsOffline(userId: string): Promise<void> {
    try {
      this.statusMap.set(userId, {
        status: "offline",
        updatedAt: new Date(),
      });

      statusLogger.debug("User marked as offline", { userId });
    } catch (error) {
      statusLogger.error("Failed to mark user as offline", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Récupérer le statut d'un utilisateur
   */
  async getStatus(userId: string): Promise<UserStatus> {
    try {
      const statusData = this.statusMap.get(userId);

      if (!statusData) {
        return "offline"; // Statut par défaut si aucune entrée
      }

      // Vérifier si l'entrée n'est pas trop ancienne (TTL)
      const age = Date.now() - statusData.updatedAt.getTime();
      if (age > this.TTL_MS) {
        this.statusMap.delete(userId);
        return "offline";
      }

      return statusData.status;
    } catch (error) {
      statusLogger.error("Failed to get user status", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "offline"; // Fallback sûr
    }
  }

  /**
   * Récupérer tous les statuts (pour debug/admin)
   */
  getAllStatuses(): Map<string, UserStatusData> {
    return new Map(this.statusMap);
  }

  /**
   * Nettoyer les entrées obsolètes (TTL dépassé)
   */
  private cleanupStaleEntries(): void {
    try {
      const now = Date.now();
      let removedCount = 0;

      for (const [userId, statusData] of this.statusMap.entries()) {
        const age = now - statusData.updatedAt.getTime();
        if (age > this.TTL_MS) {
          this.statusMap.delete(userId);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        statusLogger.info("Cleaned up stale user status entries", {
          removed: removedCount,
          remaining: this.statusMap.size,
        });
      } else {
        statusLogger.debug("No stale entries to cleanup", {
          total: this.statusMap.size,
        });
      }
    } catch (error) {
      statusLogger.error("Failed to cleanup stale entries", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Obtenir les métriques du service
   */
  getMetrics() {
    const statusCounts = {
      online: 0,
      away: 0,
      offline: 0,
    };

    for (const statusData of this.statusMap.values()) {
      statusCounts[statusData.status]++;
    }

    return {
      totalUsers: this.statusMap.size,
      statusCounts,
      ttl: `${this.TTL_MS / 1000 / 60 / 60}h`,
      cleanupInterval: `${this.CLEANUP_INTERVAL_MS / 1000 / 60}min`,
      isRunning: this.cleanupInterval !== null,
    };
  }

  /**
   * Réinitialiser toutes les données (pour tests)
   */
  reset(): void {
    this.statusMap.clear();
    statusLogger.info("User status data reset");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const userStatusService = new UserStatusService();

// Démarrage automatique du service
userStatusService.start();

// Log de l'état au démarrage
statusLogger.info("User Status Service initialized");
