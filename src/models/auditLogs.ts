// server/src/models/auditLogs.ts
import mongoose, { Schema, Document } from "mongoose";
import { sanitizeMixed } from "../utils/sanitizeUtils";

export interface IAuditLog extends Document {
  userId?: mongoose.Types.ObjectId;
  action: string;
  level: "info" | "warning" | "error" | "critical";
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  timestamp: Date;
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
});

// Index composé pour recherches fréquentes
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, level: 1, timestamp: -1 });

// TTL index - garder les logs pendant 90 jours
auditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

export default mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
