// ═══════════════════════════════════════════════════════════════════════════
// ADMIN DIGEST SERVICE
// ═══════════════════════════════════════════════════════════════════════════
// Génère et diffuse aux admins :
//  - Un récap quotidien (24h glissantes) — niveau P3, BDD uniquement
//  - Un rapport hebdomadaire (7j glissants) — niveau P3, BDD uniquement
// ═══════════════════════════════════════════════════════════════════════════

import UserModel from "../models/users";
import SosSessionModel from "../models/sosSession";
import DataShareModel from "../models/dataShare";
import AuditLogModel from "../models/auditLogs";
import { notifyAllAdmins } from "./adminNotificationService";
import { logger } from "./loggerService";

const digestLogger = logger.child({ service: "admin-digest" });

interface DigestStats {
  newVerifiedUsers: number;
  sosSessions: number;
  shares: number;
  sentryErrors: number;
  activeUsers: number;
}

async function collectStats(since: Date): Promise<DigestStats> {
  const [
    newVerifiedUsers,
    sosSessions,
    shares,
    sentryErrors,
    activeUsers,
  ] = await Promise.all([
    UserModel.countDocuments({
      is_verified: true,
      creation_date: { $gte: since },
    }).maxTimeMS(5000),
    SosSessionModel.countDocuments({
      activatedAt: { $gte: since },
    }).maxTimeMS(5000),
    DataShareModel.countDocuments({
      createdAt: { $gte: since },
    }).maxTimeMS(5000),
    AuditLogModel.countDocuments({
      level: { $in: ["error", "critical"] },
      timestamp: { $gte: since },
    }).maxTimeMS(5000),
    UserModel.countDocuments({
      last_connection: { $gte: since },
    }).maxTimeMS(5000),
  ]);

  return {
    newVerifiedUsers,
    sosSessions,
    shares,
    sentryErrors,
    activeUsers,
  };
}

function formatStatsLines(stats: DigestStats): string {
  return [
    `• ${stats.newVerifiedUsers} nouveaux utilisateurs vérifiés`,
    `• ${stats.sosSessions} sessions SOS`,
    `• ${stats.shares} partages`,
    `• ${stats.sentryErrors} erreurs (audit error/critical)`,
    `• ${stats.activeUsers} utilisateurs actifs`,
  ].join("\n");
}

/**
 * Génère et envoie le récap quotidien aux admins.
 * Période : 24 dernières heures.
 */
export async function generateDailyDigest(): Promise<void> {
  const periodMs = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - periodMs);

  try {
    const stats = await collectStats(since);
    const message = `Activité des dernières 24h :\n${formatStatsLines(stats)}`;

    await notifyAllAdmins(
      "admin_daily_digest",
      "📊 Récap quotidien",
      message,
      {
        period: "daily",
        since: since.toISOString(),
        ...stats,
        dedupKey: `daily-${since.toISOString().slice(0, 10)}`,
      },
    );

    digestLogger.info("Digest quotidien envoyé", { stats });
  } catch (err) {
    digestLogger.error("Échec de la génération du digest quotidien", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Génère et envoie le rapport hebdomadaire aux admins.
 * Période : 7 derniers jours.
 */
export async function generateWeeklyDigest(): Promise<void> {
  const periodMs = 7 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - periodMs);

  try {
    const stats = await collectStats(since);
    const message = `Activité des 7 derniers jours :\n${formatStatsLines(stats)}`;

    await notifyAllAdmins(
      "admin_weekly_report",
      "📈 Rapport hebdomadaire",
      message,
      {
        period: "weekly",
        since: since.toISOString(),
        ...stats,
        dedupKey: `weekly-${since.toISOString().slice(0, 10)}`,
      },
    );

    digestLogger.info("Rapport hebdomadaire envoyé", { stats });
  } catch (err) {
    digestLogger.error("Échec de la génération du rapport hebdo", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
