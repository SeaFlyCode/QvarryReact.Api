import cron from "node-cron";
import { cleanupExpiredShares } from "./dataShareService";
import NotificationModel from "../models/notifications";
import { refreshTokenService } from "./refreshTokenService";

// ─── Flags de verrouillage pour empêcher les exécutions simultanées ───
let isDataShareCleanupRunning = false;
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
      console.log("[CRON] Nettoyage des partages déjà en cours, skip");
      return;
    }
    isDataShareCleanupRunning = true;
    try {
      console.log("🧹 [CRON] Lancement du nettoyage des partages expirés...");
      const deletedCount = await cleanupExpiredShares();

      if (deletedCount > 0) {
        console.log(`✅ [CRON] ${deletedCount} partages expirés nettoyés`);
      } else {
        console.log("✅ [CRON] Aucun partage expiré à nettoyer");
      }
    } catch (error) {
      console.error(
        "❌ [CRON ERROR] Erreur lors du nettoyage des partages:",
        error,
      );
    } finally {
      isDataShareCleanupRunning = false;
    }
  });

  console.log(
    "⏰ [CRON] Job de nettoyage des partages programmé (tous les jours à 3h00)",
  );
}

/**
 * Job de nettoyage automatique des notifications expirées
 * Exécuté tous les jours à 4h du matin
 */
export function startNotificationCleanupJob(): void {
  // Cron expression: "0 4 * * *" = Tous les jours à 4h00
  cron.schedule("0 4 * * *", async () => {
    if (isNotificationCleanupRunning) {
      console.log("[CRON] Nettoyage des notifications déjà en cours, skip");
      return;
    }
    isNotificationCleanupRunning = true;
    try {
      console.log(
        "🧹 [CRON] Lancement du nettoyage des notifications expirées...",
      );
      const result = await NotificationModel.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      if (result.deletedCount > 0) {
        console.log(
          `✅ [CRON] ${result.deletedCount} notifications expirées nettoyées`,
        );
      } else {
        console.log("✅ [CRON] Aucune notification expirée à nettoyer");
      }
    } catch (error) {
      console.error(
        "❌ [CRON ERROR] Erreur lors du nettoyage des notifications:",
        error,
      );
    } finally {
      isNotificationCleanupRunning = false;
    }
  });

  console.log(
    "⏰ [CRON] Job de nettoyage des notifications programmé (tous les jours à 4h00)",
  );
}

/**
 * Job de nettoyage automatique des refresh tokens expirés
 * Exécuté tous les jours à 5h du matin
 */
export function startRefreshTokenCleanupJob(): void {
  // Cron expression: "0 5 * * *" = Tous les jours à 5h00
  cron.schedule("0 5 * * *", async () => {
    if (isRefreshTokenCleanupRunning) {
      console.log("[CRON] Nettoyage des refresh tokens déjà en cours, skip");
      return;
    }
    isRefreshTokenCleanupRunning = true;
    try {
      console.log(
        "🧹 [CRON] Lancement du nettoyage des refresh tokens expirés...",
      );
      const deletedCount = await refreshTokenService.cleanupExpiredTokens();

      if (deletedCount > 0) {
        console.log(
          `✅ [CRON] ${deletedCount} refresh tokens expirés/révoqués nettoyés`,
        );
      } else {
        console.log("✅ [CRON] Aucun refresh token expiré à nettoyer");
      }
    } catch (error) {
      console.error(
        "❌ [CRON ERROR] Erreur lors du nettoyage des refresh tokens:",
        error,
      );
    } finally {
      isRefreshTokenCleanupRunning = false;
    }
  });

  console.log(
    "⏰ [CRON] Job de nettoyage des refresh tokens programmé (tous les jours à 5h00)",
  );
}

/**
 * Job de nettoyage manuel (pour tests ou déclenchement manuel)
 */
export async function runManualCleanup(): Promise<number> {
  console.log("🧹 [MANUAL CLEANUP] Lancement du nettoyage manuel...");

  try {
    const deletedCount = await cleanupExpiredShares();
    console.log(`✅ [MANUAL CLEANUP] ${deletedCount} partages nettoyés`);
    return deletedCount;
  } catch (error) {
    console.error("❌ [MANUAL CLEANUP ERROR]", error);
    throw error;
  }
}
