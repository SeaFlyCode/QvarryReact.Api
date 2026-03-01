// ═══════════════════════════════════════════════════════════════════════════
// CRON JOBS SOS MODE
// ═══════════════════════════════════════════════════════════════════════════
// Moteur de timer côté serveur pour le Mode SOS
// Vérifie les sessions expirées et déclenche l'escalade
// ═══════════════════════════════════════════════════════════════════════════

import os from "os";
import cron from "node-cron";
import { sosService } from "./sosService";
import { logger } from "./loggerService";
import CronLockModel from "../models/cronLock";

const sosCronLogger = logger.child({ service: "sos-cron" });

// ─── Identifiant unique de cette instance ───
// Format: hostname-pid-timestamp pour garantir l'unicité entre instances
const INSTANCE_ID = `${os.hostname()}-${process.pid}-${Date.now()}`;

// ─── Heartbeat pour monitoring de santé du cron ───
export let lastSosCronExecution: Date | null = null;

/**
 * Acquiert un verrou distribué pour exécuter le job d'escalade
 * Retourne true si le verrou a été acquis, false sinon
 */
async function acquireLock(): Promise<boolean> {
  try {
    const now = new Date();
    const lockExpiration = new Date(now.getTime() + 90000); // 90 secondes

    // Tentative d'acquisition du verrou
    // On peut acquérir si: verrou n'existe pas OU verrou expiré
    const lock = await CronLockModel.findOneAndUpdate(
      {
        lockName: "sos-escalation",
        $or: [
          { expiresAt: { $lt: now } }, // Verrou expiré
          { lockedBy: INSTANCE_ID }, // Cette instance possède déjà le verrou
        ],
      },
      {
        lockedBy: INSTANCE_ID,
        lockedAt: now,
        expiresAt: lockExpiration,
        lastHeartbeat: now,
      },
      { upsert: true, new: true },
    );

    // Vérifie que c'est bien nous qui avons le verrou
    return lock.lockedBy === INSTANCE_ID;
  } catch (error) {
    // En cas d'erreur (ex: race condition), on considère qu'on n'a pas le verrou
    sosCronLogger.warn("Erreur lors de l'acquisition du verrou", {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

/**
 * Libère le verrou distribué après exécution
 */
async function releaseLock(): Promise<void> {
  try {
    await CronLockModel.deleteOne({
      lockName: "sos-escalation",
      lockedBy: INSTANCE_ID,
    });
  } catch (error) {
    sosCronLogger.warn("Erreur lors de la libération du verrou", {
      error: error instanceof Error ? error.message : error,
    });
  }
}

/**
 * Job de vérification des sessions SOS expirées
 * Exécuté toutes les 60 secondes pour détecter les timers expirés
 * et déclencher l'escalade progressive (Stage 0 → 1 → 2)
 *
 * Fréquence: Toutes les minutes (* * * * *)
 * - Vérifie les sessions ACTIVE dont expiresAt < now → déclenche Stage 0
 * - Vérifie les sessions ESCALATING Stage 0 depuis >= 15min → Stage 1
 * - Vérifie les sessions ESCALATING Stage 1 depuis >= 30min → Stage 2
 *
 * Utilise un verrou distribué MongoDB pour éviter les exécutions simultanées
 * sur plusieurs instances (prévient les SMS et alertes en double)
 */
export function startSosEscalationJob(): void {
  // Cron expression: "* * * * *" = Toutes les minutes
  cron.schedule("* * * * *", async () => {
    // Tentative d'acquisition du verrou distribué
    const lockAcquired = await acquireLock();

    if (!lockAcquired) {
      sosCronLogger.info(
        "Verrou d'escalade détenu par une autre instance, skip",
        { instanceId: INSTANCE_ID },
      );
      return;
    }

    // Verrou acquis, on exécute le job
    try {
      sosCronLogger.debug("Démarrage de la vérification des sessions SOS", {
        instanceId: INSTANCE_ID,
      });

      await sosService.processExpiredSessions();

      // Mettre à jour le heartbeat après exécution réussie
      lastSosCronExecution = new Date();

      sosCronLogger.debug("Vérification des sessions SOS terminée", {
        instanceId: INSTANCE_ID,
      });
    } catch (error) {
      sosCronLogger.error("Erreur lors de la vérification des sessions SOS", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        instanceId: INSTANCE_ID,
      });
    } finally {
      // Libération du verrou dans tous les cas
      await releaseLock();
    }
  });

  sosCronLogger.info("Job d'escalade SOS programmé (toutes les 60 secondes)", {
    instanceId: INSTANCE_ID,
  });
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
      sosCronLogger.info(
        "Lancement du nettoyage des anciennes sessions SOS...",
      );

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Importer le modèle ici pour éviter les dépendances circulaires
      const { default: SosSessionModel } = await import("../models/sosSession");

      const result = await SosSessionModel.deleteMany({
        status: { $in: ["RESOLVED", "CANCELLED"] },
        resolvedAt: { $lte: ninetyDaysAgo },
      });

      if (result.deletedCount > 0) {
        sosCronLogger.info("Anciennes sessions SOS nettoyées", {
          deletedCount: result.deletedCount,
        });
      } else {
        sosCronLogger.info("Aucune ancienne session SOS à nettoyer");
      }
    } catch (error) {
      sosCronLogger.error("Erreur lors du nettoyage des sessions SOS", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  sosCronLogger.info("Job de nettoyage SOS programmé (tous les jours à 2h00)");
}
