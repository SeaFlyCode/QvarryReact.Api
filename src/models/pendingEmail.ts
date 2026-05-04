import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE PENDING EMAIL
// ═══════════════════════════════════════════════════════════════════════════
// File d'attente persistante pour les emails critiques (approbation /
// refus de compte par admin, etc.). Survit aux redémarrages SMTP / serveur.
// Cf. fix.md backend #4 — supprime les fire-and-forget des admin emails.
// Modèle calqué sur `PendingNotificationModel` pour cohérence.
// ═══════════════════════════════════════════════════════════════════════════

export type PendingEmailStatus = "pending" | "completed" | "failed";

export type PendingEmailKind =
  | "account_approved"
  | "account_rejected";

export interface IPendingEmail extends Document {
  /** Identifiant utilisateur destinataire (pour audit / révocation). */
  userId?: mongoose.Types.ObjectId;
  /** Type d'email — détermine le handler côté pendingEmailService. */
  kind: PendingEmailKind;
  /** Adresse email du destinataire (en clair, déjà déchiffré côté caller). */
  to: string;
  /** Données discriminées par `kind`. Validation côté handler. */
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  status: PendingEmailStatus;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const pendingEmailSchema: Schema<IPendingEmail> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    kind: {
      type: String,
      enum: ["account_approved", "account_rejected"],
      required: true,
    },
    to: {
      type: String,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    nextRetryAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    lastError: {
      type: String,
    },
  },
  { timestamps: true },
);

// Index composé : retrouver vite les emails à réessayer.
pendingEmailSchema.index({ status: 1, nextRetryAt: 1 });

// TTL : 7 jours (les emails completed/failed sont nettoyés automatiquement).
pendingEmailSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);

const PendingEmailModel: Model<IPendingEmail> =
  mongoose.models.PendingEmail ||
  mongoose.model<IPendingEmail>("PendingEmail", pendingEmailSchema);

export default PendingEmailModel;
