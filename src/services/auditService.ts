// server/src/services/auditService.ts
import AuditLog, { IAuditLog } from "../models/auditLogs";
import mongoose from "mongoose";
import crypto from "crypto";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";
import { logger } from "./loggerService";

const auditLogger = logger.child({ service: "audit" });

type AuditLevel = "info" | "warning" | "error" | "critical";

// Import dynamique pour éviter les dépendances circulaires
let securityAlertService: any = null;
const getSecurityAlertService = async () => {
  if (!securityAlertService) {
    const module = await import("./securityAlertService");
    securityAlertService = module.securityAlertService;
  }
  return securityAlertService;
};

interface AuditOptions {
  userId?: string | mongoose.Types.ObjectId;
  action: string;
  level?: AuditLevel;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
}

class AuditService {
  /**
   * Hasher une adresse IP de manière irréversible avec HMAC-SHA256
   * Utilise IP_HASH_SECRET comme clé secrète
   */
  private static ipHashSecretValidated = false;

  private hashIpAddress(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      const secret = process.env.IP_HASH_SECRET;
      if (!secret || secret.length < 32) {
        if (!AuditService.ipHashSecretValidated) {
          auditLogger.error(
            "FATAL: IP_HASH_SECRET manquant ou trop court (min 32 chars). Les IPs ne seront pas hashées.",
          );
          if (process.env.NODE_ENV === "production") {
            process.exit(1);
          }
        }
        return "[IP_HASH_UNAVAILABLE]";
      }
      AuditService.ipHashSecretValidated = true;
      return crypto
        .createHmac("sha256", secret)
        .update(value)
        .digest("hex")
        .substring(0, 16);
    } catch (error) {
      auditLogger.error("Erreur de hachage IP", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return undefined;
    }
  }

  /**
   * Chiffrer une valeur si elle est définie
   */
  private encryptIfPresent(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return encrypt(value);
    } catch (error) {
      auditLogger.error("Erreur de chiffrement", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return undefined;
    }
  }

  /**
   * Déchiffrer une valeur si elle est définie
   */
  private decryptIfPresent(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return decrypt(value);
    } catch (error) {
      // Peut être une ancienne valeur non chiffrée
      auditLogger.warn("Valeur non chiffrée détectée, retour en clair");
      return value;
    }
  }

  /**
   * Enregistrer un événement dans les logs d'audit
   * Les données sensibles (IP, User-Agent, details) sont chiffrées
   * Déclenche les alertes de sécurité pour les événements critiques/error
   */
  async log(options: AuditOptions): Promise<void> {
    try {
      // Chiffrer les données sensibles
      const encryptedIp = this.hashIpAddress(options.ipAddress);
      const encryptedUserAgent = this.encryptIfPresent(options.userAgent);
      const encryptedDetails = options.details
        ? this.encryptIfPresent(JSON.stringify(options.details))
        : undefined;

      const log = new AuditLog({
        userId: options.userId
          ? new mongoose.Types.ObjectId(options.userId as string)
          : undefined,
        action: options.action,
        level: options.level || "info",
        ipAddress: encryptedIp,
        userAgent: encryptedUserAgent,
        details: encryptedDetails,
        timestamp: new Date(),
      });

      await log.save();

      // Log console pour le monitoring en temps réel (sans données sensibles)
      const emoji = this.getLevelEmoji(options.level || "info");
      auditLogger.info("Événement d'audit enregistré", {
        action: options.action,
        userId: options.userId?.toString() || "N/A",
        level: options.level || "info",
      });

      // Déclencher les alertes de sécurité pour les événements critiques ou erreur
      if (options.level === "critical" || options.level === "error") {
        try {
          const alertService = await getSecurityAlertService();
          await alertService.processSecurityEvent({
            type: options.action,
            level: options.level,
            ipAddress: options.ipAddress,
            userAgent: options.userAgent,
            userId: options.userId?.toString(),
            details: options.details,
            autoBlock: true,
          });
        } catch (alertError) {
          auditLogger.error(
            "Erreur lors du déclenchement de l'alerte de sécurité",
            {
              error:
                alertError instanceof Error
                  ? alertError.message
                  : String(alertError),
              stack: alertError instanceof Error ? alertError.stack : undefined,
            },
          );
        }
      }
    } catch (error) {
      auditLogger.error("Erreur lors de l'enregistrement du log", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Déchiffrer un log d'audit pour l'affichage
   */
  private decryptLog(log: any): any {
    return {
      ...log,
      ipAddress: this.decryptIfPresent(log.ipAddress),
      userAgent: this.decryptIfPresent(log.userAgent),
      details: log.details
        ? (() => {
            try {
              const decrypted = this.decryptIfPresent(log.details);
              return decrypted ? JSON.parse(decrypted) : log.details;
            } catch {
              // Si ce n'est pas du JSON chiffré, retourner tel quel
              return log.details;
            }
          })()
        : undefined,
    };
  }

  /**
   * Récupérer les logs d'un utilisateur (déchiffrés)
   */
  async getUserLogs(userId: string, limit: number = 50): Promise<any[]> {
    const logs = await AuditLog.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return logs.map((log) => this.decryptLog(log));
  }

  /**
   * Récupérer les événements suspects récents (déchiffrés)
   */
  async getSuspiciousEvents(hours: number = 24): Promise<any[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const logs = await AuditLog.find({
      level: { $in: ["warning", "error", "critical"] },
      timestamp: { $gte: since },
    })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    return logs.map((log) => this.decryptLog(log));
  }

  /**
   * Nettoyer les anciens logs (optionnel, car TTL index le fait déjà)
   */
  async cleanup(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const result = await AuditLog.deleteMany({
      timestamp: { $lt: cutoffDate },
    });
    return result.deletedCount || 0;
  }

  private getLevelEmoji(level: AuditLevel): string {
    switch (level) {
      case "info":
        return "ℹ️";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      case "critical":
        return "🚨";
      default:
        return "ℹ️";
    }
  }
}

export const auditService = new AuditService();
