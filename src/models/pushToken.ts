import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE PUSH TOKEN
// ═══════════════════════════════════════════════════════════════════════════
// Gère les tokens FCM (Firebase Cloud Messaging) pour les notifications push
// Un utilisateur peut avoir plusieurs tokens (plusieurs appareils)
// Chaque appareil est identifié de manière unique par deviceId
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

// Plateformes supportées
export type PushTokenPlatform = "ios" | "android";

// Interface pour les tokens de notification push
export interface IPushToken extends Document {
  userId: mongoose.Types.ObjectId; // Utilisateur propriétaire du token
  deviceId: string; // Identifiant unique de l'appareil
  token: string; // Token FCM pour les notifications push
  platform: PushTokenPlatform; // Plateforme de l'appareil
  createdAt: Date; // Date de création du token
  updatedAt: Date; // Date de dernière mise à jour
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHÉMA MONGOOSE
// ─────────────────────────────────────────────────────────────────────────────

const pushTokenSchema: Schema<IPushToken> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
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

// Index composé pour retrouver un token par userId et deviceId
// Assure qu'un utilisateur ne peut avoir qu'un seul token par appareil
pushTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

// Index individuel sur userId pour retrouver tous les tokens d'un utilisateur
// (déjà créé via le champ userId ci-dessus)

// Index individuel sur deviceId avec contrainte d'unicité
// (déjà créé via le champ deviceId ci-dessus)

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const PushTokenModel: Model<IPushToken> =
  mongoose.models.PushToken ||
  mongoose.model<IPushToken>("PushToken", pushTokenSchema);

export default PushTokenModel;
