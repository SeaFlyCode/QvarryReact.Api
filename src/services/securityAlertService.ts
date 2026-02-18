// server/src/services/securityAlertService.ts
import mongoose from "mongoose";
import UserModel from "../models/users";
import BlockedIpModel from "../models/blockedIps";
import AuditLogModel from "../models/auditLogs";
import { sendEmail, EmailTemplate } from "./emailService";
import { decrypt } from "../utils/masterEncryptionUtils";
import { maskEmail, anonymizeIp } from "../utils/logUtils";

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE D'ALERTES DE SÉCURITÉ - QVARRY
// ═══════════════════════════════════════════════════════════════════════════

type AlertLevel = "warning" | "error" | "critical";

interface SecurityAlert {
  type: string;
  level: AlertLevel;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  details?: any;
  autoBlock?: boolean;
}

interface ThreatScore {
  ip: string;
  score: number;
  reasons: string[];
  lastUpdated: Date;
}

const threatScoreCache = new Map<string, ThreatScore>();

const CONFIG = {
  AUTO_BLOCK_THRESHOLD: parseInt(
    process.env.SECURITY_AUTO_BLOCK_THRESHOLD || "10",
  ),
  AUTO_BLOCK_DURATION_HOURS: parseInt(
    process.env.SECURITY_AUTO_BLOCK_HOURS || "24",
  ),
  ANALYSIS_WINDOW_MINUTES: parseInt(
    process.env.SECURITY_ANALYSIS_WINDOW || "15",
  ),
  THREAT_SCORES: {
    LOGIN_FAILED: 2,
    RATE_LIMIT_TRIGGERED: 3,
    TOKEN_THEFT_DETECTED: 10,
    REFRESH_TOKEN_INVALID: 2,
    IP_CHANGE_DETECTED: 1,
    SUSPICIOUS_REQUEST: 5,
    BRUTE_FORCE_DETECTED: 8,
  } as Record<string, number>,
};

class SecurityAlertService {
  async processSecurityEvent(alert: SecurityAlert): Promise<void> {
    try {
      console.log(
        `🔒 [SECURITY] Processing event: ${alert.type} (${alert.level})`,
      );

      if (alert.ipAddress) {
        await this.updateThreatScore(alert.ipAddress, alert.type);
      }

      if (alert.ipAddress && alert.autoBlock !== false) {
        await this.checkAndAutoBlock(alert.ipAddress, alert.type);
      }

      if (alert.level === "critical" || alert.level === "error") {
        await this.notifyAdmins(alert);
      }

      if (alert.ipAddress) {
        await this.detectAttackPatterns(alert.ipAddress);
      }
    } catch (error) {
      console.error("❌ [SECURITY] Erreur traitement événement:", error);
    }
  }

  private async updateThreatScore(
    ipAddress: string,
    eventType: string,
  ): Promise<number> {
    const scoreIncrement = CONFIG.THREAT_SCORES[eventType] || 1;
    let threatData = threatScoreCache.get(ipAddress);

    if (!threatData) {
      threatData = {
        ip: ipAddress,
        score: 0,
        reasons: [],
        lastUpdated: new Date(),
      };
    }

    const timeSinceLastUpdate = Date.now() - threatData.lastUpdated.getTime();
    if (timeSinceLastUpdate > 60 * 60 * 1000) {
      threatData.score = Math.max(0, threatData.score - 2);
    }

    threatData.score += scoreIncrement;
    threatData.reasons.push(`${eventType} (+${scoreIncrement})`);
    if (threatData.reasons.length > 20) {
      threatData.reasons = threatData.reasons.slice(-20);
    }
    threatData.lastUpdated = new Date();
    threatScoreCache.set(ipAddress, threatData);

    console.log(
      `📊 [SECURITY] Threat score for ${ipAddress}: ${threatData.score}`,
    );
    return threatData.score;
  }

  private async checkAndAutoBlock(
    ipAddress: string,
    reason: string,
  ): Promise<boolean> {
    const threatData = threatScoreCache.get(ipAddress);
    if (!threatData || threatData.score < CONFIG.AUTO_BLOCK_THRESHOLD)
      return false;

    const existingBlock = await BlockedIpModel.findOne({
      ipAddress,
      isActive: true,
      $or: [{ blockedUntil: null }, { blockedUntil: { $gt: new Date() } }],
    });

    if (existingBlock) {
      existingBlock.attemptCount += 1;
      await existingBlock.save();
      return true;
    }

    const blockedUntil = new Date(
      Date.now() + CONFIG.AUTO_BLOCK_DURATION_HOURS * 60 * 60 * 1000,
    );
    const blockedIp = new BlockedIpModel({
      ipAddress,
      reason: `Auto-blocked: ${reason}`,
      blockedAt: new Date(),
      blockedUntil,
      blockedBy: "auto",
      attackType: reason,
      attemptCount: threatData.score,
      isActive: true,
      metadata: { reasons: threatData.reasons },
    });

    await blockedIp.save();
    console.log(`🚫 [SECURITY] IP auto-blocked: ${ipAddress}`);

    await this.notifyAdmins({
      type: "AUTO_IP_BLOCKED",
      level: "warning",
      ipAddress,
      details: {
        threatScore: threatData.score,
        reasons: threatData.reasons,
        blockedUntil: blockedUntil.toISOString(),
      },
    });

    return true;
  }

  private async detectAttackPatterns(ipAddress: string): Promise<void> {
    const windowStart = new Date(
      Date.now() - CONFIG.ANALYSIS_WINDOW_MINUTES * 60 * 1000,
    );
    const recentEvents = await AuditLogModel.countDocuments({
      level: { $in: ["warning", "error", "critical"] },
      timestamp: { $gte: windowStart },
    });

    if (recentEvents > 20) {
      console.warn(
        `⚠️ [SECURITY] Possible attack pattern detected: ${recentEvents} events`,
      );
      await this.notifyAdmins({
        type: "ATTACK_PATTERN_DETECTED",
        level: "critical",
        ipAddress,
        details: {
          eventCount: recentEvents,
          windowMinutes: CONFIG.ANALYSIS_WINDOW_MINUTES,
        },
      });
    }
  }

  async notifyAdmins(alert: SecurityAlert): Promise<void> {
    try {
      // Récupérer tous les admins actifs (is_blocked !== true)
      const admins = await UserModel.find({
        is_admin: true,
        is_blocked: { $ne: true },
      }).lean();

      console.log(
        `📧 [SECURITY] Recherche d'admins pour alerte ${alert.type}...`,
      );
      console.log(`📧 [SECURITY] Nombre d'admins trouvés: ${admins.length}`);

      if (admins.length === 0) {
        // Debug: compter tous les utilisateurs admin
        const allAdmins = await UserModel.find({ is_admin: true }).lean();
        console.warn(
          `⚠️ [SECURITY] Aucun admin actif trouvé. Total admins: ${allAdmins.length}`,
        );

        // Si aucun admin du tout, chercher dans toute la base
        if (allAdmins.length === 0) {
          const totalUsers = await UserModel.countDocuments();
          console.warn(
            `⚠️ [SECURITY] Total utilisateurs dans la base: ${totalUsers}`,
          );

          // Vérifier si des utilisateurs ont un champ is_admin
          const usersWithAdminField = await UserModel.find({
            is_admin: { $exists: true },
          })
            .limit(5)
            .lean();
          console.log(
            `📧 [SECURITY] Exemples de valeurs is_admin:`,
            usersWithAdminField.map((u) => ({
              id: u._id,
              is_admin: u.is_admin,
            })),
          );
        } else {
          console.log(
            `📧 [SECURITY] Admins trouvés mais probablement bloqués:`,
            allAdmins.map((a) => ({
              id: a._id,
              is_blocked: a.is_blocked,
              is_admin: a.is_admin,
            })),
          );
        }
        return;
      }

      let userEmail = "N/A";
      if (alert.userId) {
        const user = await UserModel.findById(alert.userId).lean();
        if (user) {
          try {
            userEmail = decrypt(user.email);
          } catch {
            userEmail = user.email;
          }
        }
      }

      const alertEmoji = this.getAlertEmoji(alert.level);
      const timestamp = new Date().toLocaleString("fr-FR", {
        dateStyle: "full",
        timeStyle: "long",
      });

      for (const admin of admins) {
        let adminEmail: string, adminName: string;
        try {
          adminEmail = decrypt(admin.email);
        } catch {
          adminEmail = admin.email;
        }
        try {
          adminName = decrypt(admin.name);
        } catch {
          adminName = admin.name;
        }

        console.log(`📧 [SECURITY] Envoi d'alerte à: ${maskEmail(adminEmail)}`);

        await sendEmail({
          to: adminEmail,
          subject: `${alertEmoji} Alerte Sécurité ${alert.level.toUpperCase()} - ${alert.type}`,
          template: "security-alert-admin" as EmailTemplate,
          variables: {
            ALERT_TYPE: alert.type,
            ALERT_LEVEL: alert.level.toUpperCase(),
            ALERT_EMOJI: alertEmoji,
            IP_ADDRESS: anonymizeIp(alert.ipAddress || "Non disponible"),
            USER_AGENT: alert.userAgent || "Non disponible",
            USER_ID: alert.userId || "",
            USER_EMAIL: userEmail,
            TIMESTAMP: timestamp,
            DETAILS: JSON.stringify(alert.details || {}, null, 2),
            ACTION_TAKEN: this.getAutoActionDescription(alert),
            ADMIN_PANEL_LINK: `${process.env.FRONTEND_URL || "https://qvarry.com"}/admin/audit`,
          },
        });
        console.log(
          `✅ [SECURITY] Alert email sent to admin: ${maskEmail(adminEmail)}`,
        );
      }
    } catch (error) {
      console.error("❌ [SECURITY] Erreur notification admins:", error);
    }
  }

  async isIpBlocked(
    ipAddress: string,
  ): Promise<{ blocked: boolean; reason?: string; until?: Date }> {
    const blockedIp = await BlockedIpModel.findOne({
      ipAddress,
      isActive: true,
      $or: [{ blockedUntil: null }, { blockedUntil: { $gt: new Date() } }],
    }).lean();
    if (blockedIp)
      return {
        blocked: true,
        reason: blockedIp.reason,
        until: blockedIp.blockedUntil || undefined,
      };
    return { blocked: false };
  }

  async blockIp(
    ipAddress: string,
    reason: string,
    durationHours?: number,
    adminId?: string,
  ) {
    const blockedUntil = durationHours
      ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
      : null;
    await BlockedIpModel.updateMany(
      { ipAddress, isActive: true },
      { isActive: false },
    );

    const blockedIp = new BlockedIpModel({
      ipAddress,
      reason,
      blockedAt: new Date(),
      blockedUntil,
      blockedBy: "admin",
      attackType: "ADMIN_BLOCKED",
      attemptCount: 0,
      isActive: true,
      relatedUserId: adminId ? new mongoose.Types.ObjectId(adminId) : undefined,
    });
    await blockedIp.save();
    console.log(`🚫 [ADMIN] IP blocked: ${ipAddress}`);
    return blockedIp;
  }

  async unblockIp(ipAddress: string): Promise<boolean> {
    const result = await BlockedIpModel.updateMany(
      { ipAddress, isActive: true },
      { isActive: false },
    );
    threatScoreCache.delete(ipAddress);
    console.log(`✅ [ADMIN] IP unblocked: ${ipAddress}`);
    return (result.modifiedCount || 0) > 0;
  }

  async listBlockedIps(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [ips, total] = await Promise.all([
      BlockedIpModel.find({ isActive: true })
        .sort({ blockedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlockedIpModel.countDocuments({ isActive: true }),
    ]);
    return { ips, total, totalPages: Math.ceil(total / limit) };
  }

  getThreatScore(ipAddress: string): ThreatScore | null {
    return threatScoreCache.get(ipAddress) || null;
  }

  async getSecurityStats() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      blockedIpsActive,
      blockedIpsTotal,
      blockedLast24h,
      criticalLast24h,
      criticalLast7Days,
      warningLast24h,
      topAttackTypes,
    ] = await Promise.all([
      BlockedIpModel.countDocuments({ isActive: true }),
      BlockedIpModel.countDocuments(),
      BlockedIpModel.countDocuments({ blockedAt: { $gte: last24h } }),
      AuditLogModel.countDocuments({
        level: "critical",
        timestamp: { $gte: last24h },
      }),
      AuditLogModel.countDocuments({
        level: "critical",
        timestamp: { $gte: last7Days },
      }),
      AuditLogModel.countDocuments({
        level: "warning",
        timestamp: { $gte: last24h },
      }),
      AuditLogModel.aggregate([
        {
          $match: {
            level: { $in: ["warning", "error", "critical"] },
            timestamp: { $gte: last7Days },
          },
        },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const hourlyStats = await AuditLogModel.aggregate([
      { $match: { timestamp: { $gte: last24h } } },
      {
        $group: {
          _id: { hour: { $hour: "$timestamp" }, level: "$level" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.hour": 1 } },
    ]);

    const hourlyData: any[] = [];
    for (let h = 0; h < 24; h++) {
      const hourData = { hour: h, info: 0, warning: 0, error: 0, critical: 0 };
      hourlyStats.forEach((stat: any) => {
        if (stat._id.hour === h)
          hourData[stat._id.level as keyof typeof hourData] = stat.count;
      });
      hourlyData.push(hourData);
    }

    const dailyStats = await AuditLogModel.aggregate([
      { $match: { timestamp: { $gte: last7Days } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            level: "$level",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const dailyDataMap = new Map<string, any>();
    for (let d = 6; d >= 0; d--) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split("T")[0];
      dailyDataMap.set(dateStr, {
        date: dateStr,
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      });
    }
    dailyStats.forEach((stat: any) => {
      const existing = dailyDataMap.get(stat._id.date);
      if (existing) existing[stat._id.level] = stat.count;
    });

    return {
      blockedIps: {
        active: blockedIpsActive,
        total: blockedIpsTotal,
        last24h: blockedLast24h,
      },
      events: {
        criticalLast24h: criticalLast24h,
        criticalLast7Days: criticalLast7Days,
        warningLast24h: warningLast24h,
      },
      topAttackTypes: topAttackTypes.map((t: any) => ({
        type: t._id,
        count: t.count,
      })),
      hourlyData,
      dailyData: Array.from(dailyDataMap.values()),
      threatScoreCacheSize: threatScoreCache.size,
    };
  }

  async exportAuditLogs(options: {
    format: "json" | "csv";
    startDate?: Date;
    endDate?: Date;
    level?: string;
    action?: string;
    limit?: number;
  }): Promise<string> {
    const filter: any = {};
    if (options.startDate)
      filter.timestamp = { ...filter.timestamp, $gte: options.startDate };
    if (options.endDate)
      filter.timestamp = { ...filter.timestamp, $lte: options.endDate };
    if (options.level) filter.level = options.level;
    if (options.action)
      filter.action = { $regex: options.action, $options: "i" };

    const logs = await AuditLogModel.find(filter)
      .sort({ timestamp: -1 })
      .limit(options.limit || 10000)
      .lean();

    const decryptedLogs = logs.map((log) => {
      let ipAddress = log.ipAddress,
        userAgent = log.userAgent,
        details = log.details;
      try {
        if (ipAddress) ipAddress = decrypt(ipAddress);
      } catch {}
      try {
        if (userAgent) userAgent = decrypt(userAgent);
      } catch {}
      try {
        if (details) details = JSON.parse(decrypt(details));
      } catch {}
      return { ...log, ipAddress, userAgent, details };
    });

    if (options.format === "json")
      return JSON.stringify(decryptedLogs, null, 2);

    const headers = [
      "timestamp",
      "level",
      "action",
      "userId",
      "ipAddress",
      "userAgent",
      "details",
    ];
    const csvRows = [headers.join(",")];
    for (const log of decryptedLogs) {
      csvRows.push(
        [
          new Date(log.timestamp).toISOString(),
          log.level,
          log.action,
          log.userId?.toString() || "",
          `"${(log.ipAddress || "").replace(/"/g, '""')}"`,
          `"${(log.userAgent || "").replace(/"/g, '""')}"`,
          `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`,
        ].join(","),
      );
    }
    return csvRows.join("\n");
  }

  private getAlertEmoji(level: AlertLevel): string {
    switch (level) {
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      case "critical":
        return "🚨";
      default:
        return "🔔";
    }
  }

  private getAutoActionDescription(alert: SecurityAlert): string {
    const actions: string[] = [];
    if (alert.type === "TOKEN_THEFT_DETECTED")
      actions.push("Tous les tokens de l'utilisateur ont été révoqués");
    if (alert.type === "AUTO_IP_BLOCKED")
      actions.push(
        `L'IP a été automatiquement bloquée pour ${CONFIG.AUTO_BLOCK_DURATION_HOURS} heures`,
      );
    return actions.length > 0 ? actions.join(". ") : "";
  }
}

export const securityAlertService = new SecurityAlertService();
