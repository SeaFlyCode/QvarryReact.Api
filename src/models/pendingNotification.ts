import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE PENDING NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════
// Gère la file d'attente persistante des notifications en retry
// Permet de survivre aux redémarrages du serveur (safety-critical pour SOS)
// Les notifications échouées sont réessayées automatiquement jusqu'à MAX_ATTEMPTS
// TTL de 24h pour éviter l'accumulation de données obsolètes
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

// Statut de la notification en attente
export type PendingNotificationStatus = "pending" | "failed";

// Interface pour les notifications en attente de retry
export interface IPendingNotification extends Document {
  userId: mongoose.Types.ObjectId; // Utilisateur destinataire
  type: string; // Type de notification (NotificationType)
  title: string; // Titre de la notification
  message: string; // Message de la notification
  data?: Record<string, any>; // Données supplémentaires (optionnel)
  attempts: number; // Nombre de tentatives d'envoi effectuées
  maxAttempts: number; // Nombre maximum de tentatives
  nextRetryAt: Date; // Date de la prochaine tentative
  status: PendingNotificationStatus; // Statut actuel
  createdAt: Date; // Date de création
  updatedAt: Date; // Date de dernière mise à jour
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHÉMA MONGOOSE
// ─────────────────────────────────────────────────────────────────────────────

const pendingNotificationSchema: Schema<IPendingNotification> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
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
      enum: ["pending", "failed"],
      default: "pending",
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Gère automatiquement createdAt et updatedAt
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// INDEX
// ─────────────────────────────────────────────────────────────────────────────

// Index composé pour retrouver efficacement les notifications à réessayer
// Les notifications pending dont la nextRetryAt est dépassée doivent être traitées
pendingNotificationSchema.index({ status: 1, nextRetryAt: 1 });

// Index TTL pour suppression automatique après 24h (86400 secondes)
// Évite l'accumulation de notifications obsolètes ou définitivement échouées
// Les notifications en "failed" seront aussi supprimées automatiquement
pendingNotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 86400 }, // 24 heures
);

// Index individuel sur userId pour retrouver les notifications d'un utilisateur
// (déjà créé via le champ userId ci-dessus)

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const PendingNotificationModel: Model<IPendingNotification> =
  mongoose.models.PendingNotification ||
  mongoose.model<IPendingNotification>(
    "PendingNotification",
    pendingNotificationSchema,
  );

export default PendingNotificationModel;
