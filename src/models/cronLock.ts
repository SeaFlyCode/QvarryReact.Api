import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE CRON LOCK
// ═══════════════════════════════════════════════════════════════════════════
// Gère les verrous distribués pour les tâches cron
// Empêche l'exécution simultanée sur plusieurs instances
// Supporte les heartbeats et l'expiration automatique
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ICronLock extends Document {
  lockName: string; // Nom unique du verrou (ex: "sos-escalation")
  lockedBy: string; // Identifiant de l'instance qui détient le verrou
  lockedAt: Date; // Date d'acquisition du verrou
  expiresAt: Date; // Date d'expiration du verrou
  lastHeartbeat: Date; // Dernière mise à jour du heartbeat
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHÉMA MONGOOSE
// ─────────────────────────────────────────────────────────────────────────────

const cronLockSchema: Schema<ICronLock> = new Schema(
  {
    lockName: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lockedBy: {
      type: String,
      required: true,
    },
    lockedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastHeartbeat: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false, // Pas besoin de createdAt/updatedAt, on gère nos propres dates
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// INDEX
// ─────────────────────────────────────────────────────────────────────────────

// TTL index: auto-suppression des verrous expirés après 5 minutes
// Cela garantit qu'un verrou bloqué ne reste pas indéfiniment
cronLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const CronLockModel: Model<ICronLock> =
  mongoose.models.CronLock ||
  mongoose.model<ICronLock>("CronLock", cronLockSchema);

export default CronLockModel;
