import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE SOS SESSION
// ═══════════════════════════════════════════════════════════════════════════
// Représente une session SOS active ou terminée
// Timer autoritaire côté serveur pour l'escalade des alertes
// ═══════════════════════════════════════════════════════════════════════════

// Statuts possibles d'une session SOS
export type SosSessionStatus =
  | "ACTIVE" // Session en cours, timer actif
  | "EXPIRED" // Timer expiré, en attente d'escalade
  | "ESCALATING" // Escalade en cours (stages 0-2)
  | "RESOLVED" // Session terminée normalement
  | "CANCELLED"; // Session annulée par l'utilisateur

// Méthode de résolution
export type SosResolvedBy =
  | "USER" // L'utilisateur a désactivé le SOS
  | "HEARTBEAT_AUTO" // Heartbeat reçu après expiration
  | "ADMIN" // Un administrateur a résolu
  | "CONTACT_CONFIRM"; // Un contact a confirmé que la personne est en sécurité

// Interface pour les sessions SOS
export interface ISosSession extends Document {
  userId: mongoose.Types.ObjectId;
  ficheId?: mongoose.Types.ObjectId; // Site/fiche associé (optionnel)

  // Statut
  status: SosSessionStatus;
  currentStage: number; // 0, 1, ou 2

  // Timing
  activatedAt: Date;
  expectedDuration: number; // Durée initiale en minutes
  expiresAt: Date; // Date d'expiration calculée
  lastHeartbeatAt?: Date;
  resolvedAt?: Date;

  // Escalade
  stage0TriggeredAt?: Date;
  stage1TriggeredAt?: Date;
  stage2TriggeredAt?: Date;

  // Localisation (dernière connue)
  lastKnownLat?: number;
  lastKnownLng?: number;
  lastKnownAccuracy?: number;

  // Métadonnées
  note?: string; // Note optionnelle de l'utilisateur
  heartbeatCount: number;
  extensionCount: number;
  resolvedBy?: SosResolvedBy;

  // Timestamps Mongoose
  createdAt: Date;
  updatedAt: Date;
}

const sosSessionSchema: Schema<ISosSession> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ficheId: {
      type: Schema.Types.ObjectId,
      ref: "Fiche",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "ESCALATING", "RESOLVED", "CANCELLED"],
      default: "ACTIVE",
      required: true,
      index: true,
    },
    currentStage: {
      type: Number,
      default: -1, // -1 = pas encore déclenché, 0 = stage 0, 1 = stage 1, 2 = stage 2
      min: -1,
      max: 2,
    },
    activatedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expectedDuration: {
      type: Number,
      required: true,
      min: 15, // Minimum 15 minutes
      max: 480, // Maximum 8 heures
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastHeartbeatAt: {
      type: Date,
    },
    resolvedAt: {
      type: Date,
    },
    stage0TriggeredAt: {
      type: Date,
    },
    stage1TriggeredAt: {
      type: Date,
    },
    stage2TriggeredAt: {
      type: Date,
    },
    lastKnownLat: {
      type: Number,
    },
    lastKnownLng: {
      type: Number,
    },
    lastKnownAccuracy: {
      type: Number,
    },
    note: {
      type: String,
      maxlength: 500,
    },
    heartbeatCount: {
      type: Number,
      default: 0,
    },
    extensionCount: {
      type: Number,
      default: 0,
    },
    resolvedBy: {
      type: String,
      enum: ["USER", "HEARTBEAT_AUTO", "ADMIN", "CONTACT_CONFIRM"],
    },
  },
  {
    timestamps: true,
  },
);

// Index composites pour les requêtes fréquentes
sosSessionSchema.index({ userId: 1, status: 1, createdAt: -1 });
sosSessionSchema.index({ status: 1, expiresAt: 1 }); // Pour le cron d'escalade
sosSessionSchema.index({ status: 1, currentStage: 1 }); // Pour trouver les sessions à escalader
sosSessionSchema.index({ ficheId: 1, status: 1 }); // Pour les sessions actives sur un site

const SosSessionModel: Model<ISosSession> =
  mongoose.models.SosSession ||
  mongoose.model<ISosSession>("SosSession", sosSessionSchema);

export default SosSessionModel;
