// server/src/models/auditLogs.ts
import mongoose, { Schema, Document } from "mongoose";
import { sanitizeMixed } from "../utils/sanitizeUtils";

/**
 * Politique de rétention (cf. docs/audit-retention.md + AUDIT_2026-05-11 §5.5) :
 *
 *   - Logs standard : `expiresAt` = createdAt + 2 ans (RGPD "droit à l'oubli")
 *   - Logs `permanent: true` : `expiresAt` non défini → conservation indéfinie
 *     (events critiques type security breach, fraude, accès admin sensible…)
 *
 * Le TTL Mongo utilise le champ `expiresAt` (pattern "TTL on a specific date"),
 * ce qui permet de mixer per-document : si `expiresAt` est null/absent, le doc
 * n'expire jamais. Voir https://www.mongodb.com/docs/manual/tutorial/expire-data/
 */
export const DEFAULT_RETENTION_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 ans

export interface IAuditLog extends Document {
  userId?: mongoose.Types.ObjectId;
  action: string;
  level: "info" | "warning" | "error" | "critical";
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  timestamp: Date;
  /**
   * Date d'expiration TTL. Absent/null → conservation indéfinie (`permanent: true`).
   */
  expiresAt?: Date | null;
  /**
   * Marqueur métier : true = log exempté du TTL (incident sécu, fraude, etc.).
   * Utilisé par `auditService.log({ permanent: true })`.
   */
  permanent?: boolean;
}

const auditLogSchema = new Schema<IAuditLog>({
  userId: {
    type: Schema.Types.ObjectId,
    index: true,
  },
  action: {
    type: String,
    required: true,
    index: true,
  },
  level: {
    type: String,
    enum: ["info", "warning", "error", "critical"],
    default: "info",
    index: true,
  },
  ipAddress: String,
  userAgent: String,
  details: {
    type: Schema.Types.Mixed,
    set: (v: any) => {
      if (!v) return v;
      try {
        return sanitizeMixed(v, 10000);
      } catch {
        return v;
      }
    },
  },
  timestamp: {
    type: Date,
    default: Date.now,
    // Note: index géré par le TTL index ci-dessous
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  permanent: {
    type: Boolean,
    default: false,
    index: true,
  },
});

// Index composé pour recherches fréquentes
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, level: 1, timestamp: -1 });

// ─────────────────────────────────────────────────────────────────────────────
// TTL index par date : Mongo supprime les docs dont `expiresAt` est passée.
// Les docs avec `expiresAt` null/absent ne sont JAMAIS supprimés (pattern
// officiel Mongo pour rétention conditionnelle). Cf. docs/audit-retention.md.
// ─────────────────────────────────────────────────────────────────────────────
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
