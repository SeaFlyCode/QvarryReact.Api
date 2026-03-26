import cron from "node-cron";
import { cleanupExpiredShares } from "./dataShareService";
import NotificationModel from "../models/notifications";
import { refreshTokenService } from "./refreshTokenService";
import { cleanupOldTokens } from "./pushTokenService";
import { logger } from "./loggerService";

// Create child logger for cron service
const cronLogger = logger.child({ service: "cron" });

// ─── Flags de verrouillage pour empêcher les exécutions simultanées ───
let isDataShareCleanupRunning = false;
let isPushTokenCleanupRunning = false;
let isNotificationCleanupRunning = false;
let isRefreshTokenCleanupRunning = false;

/**
 * Job de nettoyage automatique des partages expirés
 * Exécuté tous les jours à 3h du matin
 */
export function startDataShareCleanupJob(): void {
  // Cron expression: "0 3 * * *" = Tous les jours à 3h00
  cron.schedule("0 3 * * *", async () => {
    if (isDataShareCleanupRunning) {
      cronLogger.info("Data share cleanup already running, skipping");
      return;
    }
    isDataShareCleanupRunning = true;
    try {
      cronLogger.info("Starting data share cleanup");
      const deletedCount = await cleanupExpiredShares();

      if (deletedCount > 0) {
        cronLogger.info("Data share cleanup completed", { deletedCount });
      } else {
        cronLogger.info("No expired shares to clean");
      }
    } catch (error) {
      cronLogger.error("Data share cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    } finally {
      isDataShareCleanupRunning = false;
    }
  });

  cronLogger.info("Data share cleanup job scheduled (daily at 3:00 AM)");
}

/**
 * Job de nettoyage automatique des push tokens obsolètes
 * Exécuté tous les jours à 3h30 du matin
 */
export function startPushTokenCleanupJob(): void {
  // Cron expression: "30 3 * * *" = Tous les jours à 3h30
  cron.schedule("30 3 * * *", async () => {
    if (isPushTokenCleanupRunning) {
      cronLogger.info("Push token cleanup already running, skipping");
      return;
    }
    isPushTokenCleanupRunning = true;
    try {
      cronLogger.info("Starting push token cleanup");
      const deletedCount = await cleanupOldTokens(90);

      if (deletedCount > 0) {
        cronLogger.info("Push token cleanup completed", { deletedCount });
      } else {
        cronLogger.info("No old push tokens to clean");
      }
    } catch (error) {
      cronLogger.error("Push token cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    } finally {
      isPushTokenCleanupRunning = false;
    }
  });

  cronLogger.info("Push token cleanup job scheduled (daily at 3:30 AM)");
}

/**
 * Job de nettoyage automatique des notifications expirées
 * Exécuté tous les jours à 4h du matin
 */
export function startNotificationCleanupJob(): void {
  // Cron expression: "0 4 * * *" = Tous les jours à 4h00
  cron.schedule("0 4 * * *", async () => {
    if (isNotificationCleanupRunning) {
      cronLogger.info("Notification cleanup already running, skipping");
      return;
    }
    isNotificationCleanupRunning = true;
    try {
      cronLogger.info("Starting notification cleanup");
      const result = await NotificationModel.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      if (result.deletedCount > 0) {
        cronLogger.info("Notification cleanup completed", {
          deletedCount: result.deletedCount,
        });
      } else {
        cronLogger.info("No expired notifications to clean");
      }
    } catch (error) {
      cronLogger.error("Notification cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    } finally {
      isNotificationCleanupRunning = false;
    }
  });

  cronLogger.info("Notification cleanup job scheduled (daily at 4:00 AM)");
}

/**
 * Job de nettoyage automatique des refresh tokens expirés
 * Exécuté tous les jours à 5h du matin
 */
export function startRefreshTokenCleanupJob(): void {
  // Cron expression: "0 5 * * *" = Tous les jours à 5h00
  cron.schedule("0 5 * * *", async () => {
    if (isRefreshTokenCleanupRunning) {
      cronLogger.info("Refresh token cleanup already running, skipping");
      return;
    }
    isRefreshTokenCleanupRunning = true;
    try {
      cronLogger.info("Starting refresh token cleanup");
      const deletedCount = await refreshTokenService.cleanupExpiredTokens();

      if (deletedCount > 0) {
        cronLogger.info("Refresh token cleanup completed", { deletedCount });
      } else {
        cronLogger.info("No expired/inactive refresh tokens to clean");
      }
    } catch (error) {
      cronLogger.error("Refresh token cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    } finally {
      isRefreshTokenCleanupRunning = false;
    }
  });

  cronLogger.info("Refresh token cleanup job scheduled (daily at 5:00 AM)");
}

/**
 * Job de nettoyage manuel (pour tests ou déclenchement manuel)
 */
export async function runManualCleanup(): Promise<number> {
  cronLogger.info("Starting manual cleanup");

  try {
    const deletedCount = await cleanupExpiredShares();
    cronLogger.info("Manual cleanup completed", { deletedCount });
    return deletedCount;
  } catch (error) {
    cronLogger.error("Manual cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    throw error;
  }
}
