// ═══════════════════════════════════════════════════════════════════════════
// CRON JOBS SOS MODE
// ═══════════════════════════════════════════════════════════════════════════
// Moteur de timer côté serveur pour le Mode SOS
// Vérifie les sessions expirées et déclenche l'escalade
// ═══════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import { sosService } from "./sosService";

// ─── Flag de verrouillage pour empêcher les exécutions simultanées ───
let isSosEscalationRunning = false;

/**
 * Job de vérification des sessions SOS expirées
 * Exécuté toutes les 60 secondes pour détecter les timers expirés
 * et déclencher l'escalade progressive (Stage 0 → 1 → 2)
 *
 * Fréquence: Toutes les minutes (* * * * *)
 * - Vérifie les sessions ACTIVE dont expiresAt < now → déclenche Stage 0
 * - Vérifie les sessions ESCALATING Stage 0 depuis >= 15min → Stage 1
 * - Vérifie les sessions ESCALATING Stage 1 depuis >= 30min → Stage 2
 */
export function startSosEscalationJob(): void {
  // Cron expression: "* * * * *" = Toutes les minutes
  cron.schedule("* * * * *", async () => {
    if (isSosEscalationRunning) {
      console.log("[CRON-SOS] Vérification escalade déjà en cours, skip");
      return;
    }
    isSosEscalationRunning = true;
    try {
      await sosService.processExpiredSessions();
    } catch (error) {
      console.error(
        "❌ [CRON-SOS ERROR] Erreur lors de la vérification des sessions SOS:",
        error,
      );
    } finally {
      isSosEscalationRunning = false;
    }
  });

  console.log(
    "⏰ [CRON-SOS] Job d'escalade SOS programmé (toutes les 60 secondes)",
  );
}

/**
 * Job de nettoyage des anciennes sessions SOS résolues
 * Exécuté tous les jours à 2h du matin
 * Archive les sessions terminées depuis plus de 90 jours
 */
export function startSosCleanupJob(): void {
  // Cron expression: "0 2 * * *" = Tous les jours à 2h00
  cron.schedule("0 2 * * *", async () => {
    try {
      console.log(
        "🧹 [CRON-SOS] Lancement du nettoyage des anciennes sessions SOS...",
      );

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Importer le modèle ici pour éviter les dépendances circulaires
      const { default: SosSessionModel } = await import("../models/sosSession");

      const result = await SosSessionModel.deleteMany({
        status: { $in: ["RESOLVED", "CANCELLED"] },
        resolvedAt: { $lte: ninetyDaysAgo },
      });

      if (result.deletedCount > 0) {
        console.log(
          `✅ [CRON-SOS] ${result.deletedCount} anciennes sessions SOS nettoyées`,
        );
      } else {
        console.log("✅ [CRON-SOS] Aucune ancienne session SOS à nettoyer");
      }
    } catch (error) {
      console.error(
        "❌ [CRON-SOS ERROR] Erreur lors du nettoyage des sessions SOS:",
        error,
      );
    }
  });

  console.log(
    "⏰ [CRON-SOS] Job de nettoyage SOS programmé (tous les jours à 2h00)",
  );
}
