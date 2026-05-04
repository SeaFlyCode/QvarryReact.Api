import cron from "node-cron";
import { cleanupExpiredShares } from "./dataShareService";
import NotificationModel from "../models/notifications";
import SosSessionModel from "../models/sosSession";
import { refreshTokenService } from "./refreshTokenService";
import { cleanupOldTokens } from "./pushTokenService";
import { processPendingEmails } from "./pendingEmailService";
import {
  notifyExpiringShares,
  notifyExpiredShares,
} from "./shareExpirationService";
import {
  generateDailyDigest,
  generateWeeklyDigest,
} from "./adminDigestService";
import { notifyAllAdmins } from "./adminNotificationService";
import { logger } from "./loggerService";

// Create child logger for cron service
const cronLogger = logger.child({ service: "cron" });

/**
 * Wrapper utilitaire pour reporter les erreurs de crons aux admins.
 * Wrap chaque cron pour que toute exception non gérée déclenche
 * `admin_cron_failed` (P2, throttle 5 min via dedupKey: cron-failed:{name}).
 */
export function withCronErrorReporting<Args extends any[]>(
  jobName: string,
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      cronLogger.error(`Cron '${jobName}' échoué`, { error: errMsg });
      try {
        const { notifyAllAdmins } = await import("./adminNotificationService");
        await notifyAllAdmins(
          "admin_cron_failed",
          "⚙️ Cron en échec",
          `Le cron '${jobName}' a échoué : ${errMsg.slice(0, 200)}`,
          {
            jobName,
            error: errMsg,
            dedupKey: `cron-failed:${jobName}`,
          },
        );
      } catch (notifyErr) {
        cronLogger.warn("Échec notif admin_cron_failed", {
          jobName,
          error:
            notifyErr instanceof Error
              ? notifyErr.message
              : String(notifyErr),
        });
      }
    }
  };
}

// ─── Flags de verrouillage pour empêcher les exécutions simultanées ───
let isDataShareCleanupRunning = false;
let isPushTokenCleanupRunning = false;
let isNotificationCleanupRunning = false;
let isRefreshTokenCleanupRunning = false;
let isPendingEmailRetryRunning = false;
let isExpiringSharesNotifyRunning = false;
let isExpiredSharesNotifyRunning = false;
let isAdminDailyDigestRunning = false;
let isAdminWeeklyDigestRunning = false;
let isAdminSosUnresolvedCheckRunning = false;
let isAdminMetricsAnomalyCheckRunning = false;

/**
 * Job de nettoyage automatique des partages expirés
 * Exécuté tous les jours à 3h du matin
 */
export function startDataShareCleanupJob(): void {
  // Cron expression: "0 3 * * *" = Tous les jours à 3h00
  cron.schedule(
    "0 3 * * *",
    withCronErrorReporting("dataShareCleanup", async () => {
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
      } finally {
        isDataShareCleanupRunning = false;
      }
    }),
  );

  cronLogger.info("Data share cleanup job scheduled (daily at 3:00 AM)");
}

/**
 * Job de nettoyage automatique des push tokens obsolètes
 * Exécuté tous les jours à 3h30 du matin
 */
export function startPushTokenCleanupJob(): void {
  // Cron expression: "30 3 * * *" = Tous les jours à 3h30
  cron.schedule(
    "30 3 * * *",
    withCronErrorReporting("pushTokenCleanup", async () => {
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
      } finally {
        isPushTokenCleanupRunning = false;
      }
    }),
  );

  cronLogger.info("Push token cleanup job scheduled (daily at 3:30 AM)");
}

/**
 * Job de nettoyage automatique des notifications expirées
 * Exécuté tous les jours à 4h du matin
 */
export function startNotificationCleanupJob(): void {
  // Cron expression: "0 4 * * *" = Tous les jours à 4h00
  cron.schedule(
    "0 4 * * *",
    withCronErrorReporting("notificationCleanup", async () => {
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
      } finally {
        isNotificationCleanupRunning = false;
      }
    }),
  );

  cronLogger.info("Notification cleanup job scheduled (daily at 4:00 AM)");
}

/**
 * Job de nettoyage automatique des refresh tokens expirés
 * Exécuté tous les jours à 5h du matin
 */
export function startRefreshTokenCleanupJob(): void {
  // Cron expression: "0 5 * * *" = Tous les jours à 5h00
  cron.schedule(
    "0 5 * * *",
    withCronErrorReporting("refreshTokenCleanup", async () => {
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
      } finally {
        isRefreshTokenCleanupRunning = false;
      }
    }),
  );

  cronLogger.info("Refresh token cleanup job scheduled (daily at 5:00 AM)");
}

/**
 * Job de nettoyage manuel (pour tests ou déclenchement manuel)
 */
/**
 * Retry des emails admin en attente — toutes les 5 minutes (cf. fix.md backend #4).
 * Le service `pendingEmailService` filtre lui-même les items dont
 * `nextRetryAt <= now` et applique un backoff exponentiel.
 */
export function startPendingEmailRetryJob(): void {
  cron.schedule(
    "*/5 * * * *",
    withCronErrorReporting("pendingEmailRetry", async () => {
      if (isPendingEmailRetryRunning) {
        cronLogger.debug("Pending email retry already running, skipping");
        return;
      }
      isPendingEmailRetryRunning = true;
      try {
        const processed = await processPendingEmails();
        if (processed > 0) {
          cronLogger.info("Pending emails processed", { processed });
        }
      } finally {
        isPendingEmailRetryRunning = false;
      }
    }),
  );
  cronLogger.info("Pending email retry job started (toutes les 5 min)");
}

/**
 * Notifie les partages dont l'expiration est imminente (J+0 → J+2).
 * Exécuté tous les jours à 9h00.
 */
export function startExpiringSharesNotifyJob(): void {
  cron.schedule(
    "0 9 * * *",
    withCronErrorReporting("expiringSharesNotify", async () => {
      if (isExpiringSharesNotifyRunning) {
        cronLogger.info("Expiring shares notify already running, skipping");
        return;
      }
      isExpiringSharesNotifyRunning = true;
      try {
        cronLogger.info("Starting expiring shares notification");
        const count = await notifyExpiringShares();
        if (count > 0) {
          cronLogger.info("Expiring shares notification completed", { count });
        } else {
          cronLogger.info("No expiring shares to notify");
        }
      } finally {
        isExpiringSharesNotifyRunning = false;
      }
    }),
  );

  cronLogger.info("Expiring shares notify job scheduled (daily at 9:00 AM)");
}

/**
 * Notifie les partages effectivement expirés.
 * Exécuté tous les jours à 9h05.
 */
export function startExpiredSharesNotifyJob(): void {
  cron.schedule(
    "5 9 * * *",
    withCronErrorReporting("expiredSharesNotify", async () => {
      if (isExpiredSharesNotifyRunning) {
        cronLogger.info("Expired shares notify already running, skipping");
        return;
      }
      isExpiredSharesNotifyRunning = true;
      try {
        cronLogger.info("Starting expired shares notification");
        const count = await notifyExpiredShares();
        if (count > 0) {
          cronLogger.info("Expired shares notification completed", { count });
        } else {
          cronLogger.info("No expired shares to notify");
        }
      } finally {
        isExpiredSharesNotifyRunning = false;
      }
    }),
  );

  cronLogger.info("Expired shares notify job scheduled (daily at 9:05 AM)");
}

/**
 * Job de génération du digest admin quotidien.
 * Exécuté tous les jours à 9h00.
 */
export function startAdminDailyDigestJob(): void {
  cron.schedule(
    "0 9 * * *",
    withCronErrorReporting("adminDailyDigest", async () => {
      if (isAdminDailyDigestRunning) {
        cronLogger.info("Admin daily digest already running, skipping");
        return;
      }
      isAdminDailyDigestRunning = true;
      try {
        cronLogger.info("Starting admin daily digest");
        await generateDailyDigest();
        cronLogger.info("Admin daily digest completed");
      } finally {
        isAdminDailyDigestRunning = false;
      }
    }),
  );

  cronLogger.info("Admin daily digest job scheduled (daily at 9:00 AM)");
}

/**
 * Job de génération du rapport admin hebdomadaire.
 * Exécuté tous les lundis à 9h00.
 */
export function startAdminWeeklyDigestJob(): void {
  cron.schedule(
    "0 9 * * 1",
    withCronErrorReporting("adminWeeklyDigest", async () => {
      if (isAdminWeeklyDigestRunning) {
        cronLogger.info("Admin weekly digest already running, skipping");
        return;
      }
      isAdminWeeklyDigestRunning = true;
      try {
        cronLogger.info("Starting admin weekly digest");
        await generateWeeklyDigest();
        cronLogger.info("Admin weekly digest completed");
      } finally {
        isAdminWeeklyDigestRunning = false;
      }
    }),
  );

  cronLogger.info("Admin weekly digest job scheduled (Monday at 9:00 AM)");
}

/**
 * Job de surveillance des sessions SOS Stage 2 non résolues.
 * Exécuté toutes les 5 minutes — détecte les sessions ESCALATING/ACTIVE
 * dont stage2TriggeredAt est antérieur à 30 min ET qui n'ont pas été
 * résolues (statut != RESOLVED). Notifie les admins (P0).
 */
export function startAdminSosUnresolvedCheckJob(): void {
  cron.schedule(
    "*/5 * * * *",
    withCronErrorReporting("adminSosUnresolvedCheck", async () => {
      if (isAdminSosUnresolvedCheckRunning) {
        cronLogger.debug(
          "Admin SOS unresolved check already running, skipping",
        );
        return;
      }
      isAdminSosUnresolvedCheckRunning = true;
      try {
        const threshold = new Date(Date.now() - 30 * 60 * 1000);

        // On cherche les sessions stage 2 non résolues, soit au niveau session
        // (stage2TriggeredAt root) soit au niveau d'au moins un participant.
        const unresolvedSessions = await SosSessionModel.find({
          status: { $in: ["ACTIVE", "ESCALATING"] },
          currentStage: { $gte: 2 },
          $or: [
            { stage2TriggeredAt: { $lt: threshold } },
            { "participants.stage2TriggeredAt": { $lt: threshold } },
          ],
          resolvedAt: { $exists: false },
        })
          .select("_id userId currentStage stage2TriggeredAt activatedAt")
          .lean()
          .maxTimeMS(5000);

        if (unresolvedSessions.length === 0) {
          return;
        }

        cronLogger.warn(
          "Sessions SOS Stage 2 non résolues détectées (> 30 min)",
          { count: unresolvedSessions.length },
        );

        for (const session of unresolvedSessions) {
          const sessionId = session._id.toString();
          const triggeredAt = session.stage2TriggeredAt ?? session.activatedAt;
          const elapsedMin = Math.floor(
            (Date.now() - new Date(triggeredAt).getTime()) / 60000,
          );

          await notifyAllAdmins(
            "admin_sos_unresolved",
            "🆘 Session SOS non résolue",
            `Une session SOS Stage 2 est non résolue depuis ${elapsedMin} min (sessionId ${sessionId}).`,
            {
              sessionId,
              userId: session.userId.toString(),
              elapsedMinutes: elapsedMin,
              stage2TriggeredAt: triggeredAt,
              // dedupKey : un admin = une notif par session toutes les 5 min
              dedupKey: sessionId,
            },
          );
        }
      } finally {
        isAdminSosUnresolvedCheckRunning = false;
      }
    }),
  );

  cronLogger.info(
    "Admin SOS unresolved check job scheduled (every 5 minutes)",
  );
}

/**
 * Vérification périodique des métriques HTTP (latence p95 + taux d'erreur).
 * Notifie les admins (P2) si :
 *  - p95 > 2000 ms (latence dégradée)
 *  - taux d'erreur > 5 %
 * Exécuté toutes les 5 minutes.
 *
 * Limitations : prom-client n'expose que des compteurs cumulés depuis le
 * boot — pas de fenêtre glissante. Le seuil sera donc atteint plus
 * lentement à mesure que le volume cumulé grandit. Pour une vraie alerte
 * temps réel, brancher Prometheus + Alertmanager (TODO infra).
 */
export function startAdminMetricsAnomalyCheckJob(): void {
  cron.schedule(
    "*/5 * * * *",
    withCronErrorReporting("adminMetricsAnomalyCheck", async () => {
      if (isAdminMetricsAnomalyCheckRunning) {
        cronLogger.debug(
          "Admin metrics anomaly check already running, skipping",
        );
        return;
      }
      isAdminMetricsAnomalyCheckRunning = true;
      try {
        const { getMetricsSnapshot } = await import("../config/metrics");
        const snap = await getMetricsSnapshot();

        // Pas assez de trafic pour conclure
        if (snap.totalRequests < 100) return;

        const P95_THRESHOLD_S = 2;
        const ERROR_RATE_THRESHOLD = 0.05;

        if (snap.p95Seconds !== null && snap.p95Seconds > P95_THRESHOLD_S) {
          await notifyAllAdmins(
            "admin_metrics_anomaly",
            "📈 Latence HTTP dégradée",
            `p95 = ${(snap.p95Seconds * 1000).toFixed(0)} ms (seuil ${P95_THRESHOLD_S * 1000} ms).`,
            {
              metric: "p95",
              value: snap.p95Seconds,
              threshold: P95_THRESHOLD_S,
              dedupKey: "metrics:p95",
            },
          );
        }

        if (
          snap.errorRate !== null &&
          snap.errorRate > ERROR_RATE_THRESHOLD
        ) {
          await notifyAllAdmins(
            "admin_metrics_anomaly",
            "📉 Taux d'erreur HTTP élevé",
            `Taux 5xx = ${(snap.errorRate * 100).toFixed(2)}% (seuil ${(ERROR_RATE_THRESHOLD * 100).toFixed(0)}%).`,
            {
              metric: "error-rate",
              value: snap.errorRate,
              threshold: ERROR_RATE_THRESHOLD,
              dedupKey: "metrics:error-rate",
            },
          );
        }
      } finally {
        isAdminMetricsAnomalyCheckRunning = false;
      }
    }),
  );

  cronLogger.info(
    "Admin metrics anomaly check job scheduled (every 5 minutes)",
  );
}

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
