// server/src/services/auditService.ts
import AuditLog, { DEFAULT_RETENTION_SECONDS } from "../models/auditLogs";
import mongoose from "mongoose";
import crypto from "crypto";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";
import { logger } from "./loggerService";
import { safeJsonParse } from "../utils/secureJsonParser";

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

// Import dynamique pour casser le cycle adminNotificationService -> auditService
type NotifyAllAdminsFn = (
  type: "admin_critical_audit",
  title: string,
  message: string,
  data?: Record<string, any>,
) => Promise<{ notified: number; throttled: number }>;
let notifyAllAdminsFn: NotifyAllAdminsFn | null = null;
const getNotifyAllAdmins = async (): Promise<NotifyAllAdminsFn> => {
  if (!notifyAllAdminsFn) {
    const module = await import("./adminNotificationService");
    notifyAllAdminsFn = module.notifyAllAdmins as NotifyAllAdminsFn;
  }
  return notifyAllAdminsFn;
};

interface AuditOptions {
  userId?: string | mongoose.Types.ObjectId;
  action: string;
  level?: AuditLevel;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  /**
   * Si true, exempte ce log du TTL (rétention indéfinie).
   * Cf. docs/audit-retention.md — réservé aux events sécurité critiques
   * (security breach, fraude avérée, accès non-autorisé prouvé, etc.).
   * Défaut : false → expiration après DEFAULT_RETENTION_SECONDS (2 ans).
   */
  permanent?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT BATCHER (Phase G — P1 DoS fix)
//
// Sur les routes rate-limitées (Vonage webhook, /auth/login, etc.), le hit
// `auditService.log(...)` génère 100+ inserts/min en pointe (1 doc par save()).
// Solution : buffer en mémoire + flush groupé (insertMany) toutes les 5s OU si
// le buffer atteint 100 entrées. Logs critiques/permanents → flush immédiat
// pour zero data loss sur les events de sécurité.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingAuditDoc {
  payload: Record<string, any>;
  retries: number;
}

const BATCH_FLUSH_INTERVAL_MS = 5_000;
const BATCH_MAX_SIZE = 100;
const BATCH_MAX_RETRIES = 3;
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

class AuditService {
  /**
   * Hasher une adresse IP de manière irréversible avec HMAC-SHA256
   * Utilise IP_HASH_SECRET comme clé secrète
   */
  private static ipHashSecretValidated = false;

  // ── Batch state ──
  private pendingLogs: PendingAuditDoc[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private shuttingDown = false;

  constructor() {
    this.ensureFlushTimer();
  }

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
        // HIGH-001: stack trace supprimé pour sécurité,
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
        // HIGH-001: stack trace supprimé pour sécurité,
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
    } catch (_error) {
      // Peut être une ancienne valeur non chiffrée
      auditLogger.warn("Valeur non chiffrée détectée, retour en clair");
      return value;
    }
  }

  /**
   * Programme le flush périodique du buffer (toutes les 5s).
   * Idempotent : ne crée pas plusieurs timers.
   */
  private ensureFlushTimer(): void {
    if (this.flushTimer || this.shuttingDown) return;
    this.flushTimer = setInterval(() => {
      if (this.pendingLogs.length > 0) {
        void this.flush().catch((err) => {
          auditLogger.error("Erreur durant le flush périodique", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }, BATCH_FLUSH_INTERVAL_MS);
    // unref() pour ne pas empêcher l'event loop de se vider (graceful shutdown)
    if (typeof this.flushTimer.unref === "function") {
      this.flushTimer.unref();
    }
  }

  /**
   * Construit le document AuditLog à partir des options publiques.
   * Effectue le chiffrement/hashing — coût CPU léger, accepté en sync.
   */
  private buildDoc(options: AuditOptions): Record<string, any> {
    const encryptedIp = this.hashIpAddress(options.ipAddress);
    const encryptedUserAgent = this.encryptIfPresent(options.userAgent);
    const encryptedDetails = options.details
      ? this.encryptIfPresent(JSON.stringify(options.details))
      : undefined;

    const now = new Date();
    const isPermanent = options.permanent === true;
    const expiresAt = isPermanent
      ? null
      : new Date(now.getTime() + DEFAULT_RETENTION_SECONDS * 1000);

    return {
      userId: options.userId
        ? new mongoose.Types.ObjectId(options.userId as string)
        : undefined,
      action: options.action,
      level: options.level || "info",
      ipAddress: encryptedIp,
      userAgent: encryptedUserAgent,
      details: encryptedDetails,
      timestamp: now,
      expiresAt,
      permanent: isPermanent,
    };
  }

  /**
   * Déclenche les side-effects (alertes sécurité + notif admin) pour les events
   * sensibles. Extrait pour pouvoir être appelé après buildDoc, indépendamment
   * du chemin (batch / immediate).
   */
  private async runSecuritySideEffects(options: AuditOptions): Promise<void> {
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
          },
        );
      }
    }

    if (options.level === "critical") {
      try {
        const notifyAllAdmins = await getNotifyAllAdmins();
        await notifyAllAdmins(
          "admin_critical_audit",
          "🚨 Audit critique",
          `Action critique : ${options.action}${
            options.userId ? ` (user ${options.userId.toString()})` : ""
          }`,
          {
            action: options.action,
            userId: options.userId?.toString(),
            dedupKey: `audit-critical:${options.action}:${
              options.userId?.toString() ?? "system"
            }`,
          },
        );
      } catch (notifyErr) {
        auditLogger.warn(
          "Échec de la notification admin pour audit critique",
          {
            error:
              notifyErr instanceof Error
                ? notifyErr.message
                : String(notifyErr),
          },
        );
      }
    }
  }

  /**
   * Sauvegarde immédiate (single doc) — fallback pour les events critiques /
   * permanents. On utilise `new AuditLog(...).save()` pour rester compatible
   * avec les mocks existants (tests qui mockent le constructeur).
   */
  private async saveImmediate(payload: Record<string, any>): Promise<void> {
    try {
      const doc = new AuditLog(payload as any);
      await doc.save();
    } catch (error) {
      auditLogger.error("Erreur lors de l'enregistrement immédiat du log", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback : on ne perd pas le log, on l'enfile dans le buffer pour retry
      this.pendingLogs.push({ payload, retries: 0 });
    }
  }

  /**
   * Flush le buffer en un seul `insertMany`. Replace les entrées en cas d'échec
   * (jusqu'à BATCH_MAX_RETRIES tentatives) pour éviter la perte silencieuse.
   * Idempotent et concurrent-safe : si déjà en train de flusher, return.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pendingLogs.length === 0) return;

    this.flushing = true;
    const batch = this.pendingLogs.splice(0, this.pendingLogs.length);

    try {
      const payloads = batch.map((entry) => entry.payload);
      // insertMany avec ordered=false pour ne pas abort sur un seul doc invalide
      await (AuditLog as any).insertMany(payloads, { ordered: false });
    } catch (error) {
      auditLogger.error("Erreur lors du flush batch audit logs", {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
      });
      // Remettre dans le buffer pour retry — jusqu'à BATCH_MAX_RETRIES
      const retryable = batch
        .map((entry) => ({ ...entry, retries: entry.retries + 1 }))
        .filter((entry) => {
          if (entry.retries >= BATCH_MAX_RETRIES) {
            auditLogger.error("Audit log dropped after max retries", {
              action: entry.payload.action,
              retries: entry.retries,
            });
            return false;
          }
          return true;
        });
      // Prepend pour préserver l'ordre approximatif et garantir un retry rapide
      this.pendingLogs.unshift(...retryable);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Enregistrer un événement dans les logs d'audit.
   *
   * Les données sensibles (IP, User-Agent, details) sont chiffrées.
   * Comportement (Phase G P1) :
   *   - level "info"/"warning" : buffer en mémoire, flush groupé (5s ou 100 entrées)
   *   - level "error"/"critical" OU permanent=true : insertion immédiate
   *
   * Backward-compat : la signature reste `async` → tous les call sites
   * `await auditService.log(...)` continuent de fonctionner.
   */
  async log(options: AuditOptions): Promise<void> {
    try {
      const payload = this.buildDoc(options);
      const isImmediate =
        options.permanent === true ||
        options.level === "critical" ||
        options.level === "error";

      if (isImmediate) {
        // Chemin direct : on persiste tout de suite (aucun risque de perte)
        await this.saveImmediate(payload);
        auditLogger.info("Événement d'audit enregistré (immediate)", {
          action: options.action,
          userId: options.userId?.toString() || "N/A",
          level: options.level || "info",
        });
      } else {
        // Chemin batch : push dans le buffer, flush async
        this.pendingLogs.push({ payload, retries: 0 });
        this.ensureFlushTimer();

        // Flush immédiat si on atteint la taille max (back-pressure)
        if (this.pendingLogs.length >= BATCH_MAX_SIZE) {
          void this.flush().catch((err) => {
            auditLogger.error("Erreur durant le flush size-triggered", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        auditLogger.info("Événement d'audit bufferisé", {
          action: options.action,
          userId: options.userId?.toString() || "N/A",
          level: options.level || "info",
          bufferSize: this.pendingLogs.length,
        });
      }

      // Side-effects (alertes sécu + notif admin) — déclenchés systématiquement
      // pour les events sensibles, indépendamment du chemin save/batch.
      await this.runSecuritySideEffects(options);
    } catch (error) {
      auditLogger.error("Erreur lors de l'enregistrement du log", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
    }
  }

  /**
   * Graceful shutdown : flush le buffer pending avant exit.
   * Time-boxed à SHUTDOWN_FLUSH_TIMEOUT_MS pour ne pas bloquer l'arrêt.
   * Appelé depuis server.ts sur SIGTERM/SIGINT.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Arrêter le timer périodique
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingLogs.length === 0) {
      auditLogger.info("Audit shutdown: rien à flusher");
      return;
    }

    auditLogger.info("Audit shutdown: flush du buffer pending", {
      pendingCount: this.pendingLogs.length,
    });

    try {
      await Promise.race([
        this.flush(),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error("Audit shutdown flush timeout")),
            SHUTDOWN_FLUSH_TIMEOUT_MS,
          ),
        ),
      ]);
      auditLogger.info("Audit shutdown: flush terminé");
    } catch (error) {
      auditLogger.warn(
        "Audit shutdown: flush incomplet (timeout ou erreur), arrêt forcé",
        {
          error: error instanceof Error ? error.message : String(error),
          remaining: this.pendingLogs.length,
        },
      );
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
              return decrypted
                ? safeJsonParse(decrypted, {
                    context: "audit-log-details",
                    maxDepth: 5,
                  })
                : log.details;
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

  /**
   * Helpers de test (exposés en bas du fichier via getters) — non destinés au
   * code de prod. Permettent aux tests de forcer un flush ou d'inspecter l'état.
   */
  // @ts-ignore - test-only accessor
  __test_getPendingCount(): number {
    return this.pendingLogs.length;
  }
  // @ts-ignore - test-only accessor
  __test_resetState(): void {
    this.pendingLogs = [];
    this.flushing = false;
    this.shuttingDown = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.ensureFlushTimer();
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
