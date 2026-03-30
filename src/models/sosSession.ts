import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE SOS SESSION
// ═══════════════════════════════════════════════════════════════════════════
// Représente une session SOS active ou terminée
// Timer autoritaire côté serveur pour l'escalade des alertes
// Support des sessions de groupe avec participants multiples
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & STATUTS
// ─────────────────────────────────────────────────────────────────────────────

// Statuts possibles d'une session SOS
export type SosSessionStatus =
  | "ACTIVE" // Session en cours, timer actif
  | "EXPIRED" // Timer expiré, stage 0 (alarme locale, participant déconnecté)
  | "ESCALATING" // Escalade en cours (stages 1-2: alerte communauté, SMS contacts)
  | "RESOLVED" // Session terminée normalement
  | "CANCELLED"; // Session annulée par l'utilisateur

// Statuts possibles d'un participant dans une session
export type SosParticipantStatus =
  | "ACTIVE" // Participant actif dans la session
  | "DISCONNECTED" // Participant déconnecté (perte de signal)
  | "ESCALATING" // Participant en cours d'escalade
  | "LEFT"; // Participant a quitté la session

// Méthode de résolution
export type SosResolvedBy =
  | "USER" // L'utilisateur a désactivé le SOS
  | "HEARTBEAT_AUTO" // Heartbeat reçu après expiration
  | "ADMIN" // Un administrateur a résolu
  | "CONTACT_CONFIRM"; // Un contact a confirmé que la personne est en sécurité

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

// Interface pour un participant dans une session SOS
export interface ISosParticipant {
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
  leftAt?: Date | null; // Quand le participant a désactivé/quitté
  status: SosParticipantStatus;
  currentStage: number; // -1 à 2

  // Timing d'escalade par participant
  stage0TriggeredAt?: Date | null;
  stage1TriggeredAt?: Date | null;
  stage2TriggeredAt?: Date | null;

  // Heartbeat par participant
  lastHeartbeatAt?: Date | null;

  // Localisation par participant (dernière connue)
  lastKnownLat?: number | null;
  lastKnownLng?: number | null;
  lastKnownAccuracy?: number | null;

  // Tracking de reconnexion par participant
  consecutiveHeartbeats: number;
  firstReconnectionAt?: Date | null;
  surfaceDetectionSent: boolean;
  reconnectionDetectionSent: boolean;
}

// Interface pour les sessions SOS
export interface ISosSession extends Document {
  userId: mongoose.Types.ObjectId; // Créateur de la session (backward compat)

  // Statut
  status: SosSessionStatus;
  currentStage: number; // 0, 1, ou 2 (niveau session global)

  // Timing
  activatedAt: Date;
  expectedDuration: number; // Durée initiale en minutes
  expiresAt: Date; // Date d'expiration calculée
  lastHeartbeatAt?: Date; // Session-level heartbeat (backward compat)
  resolvedAt?: Date;

  // Escalade (session-level, backward compat)
  stage0TriggeredAt?: Date;
  stage1TriggeredAt?: Date;
  stage2TriggeredAt?: Date;

  // Localisation (dernière connue, backward compat)
  lastKnownLat?: number;
  lastKnownLng?: number;
  lastKnownAccuracy?: number;

  // GPS initial (position à l'activation, pour comparer les déplacements)
  entryLat?: number;
  entryLng?: number;

  // Tracking de reconnexion (session-level, backward compat)
  consecutiveHeartbeats: number;
  firstReconnectionAt?: Date;
  surfaceDetectionSent: boolean;
  reconnectionDetectionSent: boolean;

  // ─── NOUVEAUX CHAMPS GROUPE ───
  participants: ISosParticipant[]; // Participants de la session (un ou plusieurs)
  resolvedByUserId?: mongoose.Types.ObjectId; // Qui a résolu (traçabilité pour scope "all")

  // Contacts de session (override v2)
  sessionContactIds?: mongoose.Types.ObjectId[]; // IDs des contacts sélectionnés pour cette session
  useDefaultContacts: boolean; // true = utilise tous les contacts permanents

  // Métadonnées
  note?: string; // Note optionnelle de l'utilisateur (max 500 chars)

  // Zone / Localisation détaillée (v2)
  siteName?: string; // Nom du site / carrière (ex: "Carrière de Pont-Réan")
  zone?: string; // Zone dans le site (ex: "Galerie Nord", "Secteur B")
  depth?: number; // Profondeur estimée en mètres (optionnel)

  heartbeatCount: number;
  extensionCount: number;
  resolvedBy?: SosResolvedBy;

  // Timestamps Mongoose
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHÉMA MONGOOSE
// ─────────────────────────────────────────────────────────────────────────────

// Schéma pour un participant
const participantSchema = new Schema<ISosParticipant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "DISCONNECTED", "ESCALATING", "LEFT"],
      default: "ACTIVE",
      required: true,
    },
    currentStage: {
      type: Number,
      default: -1,
      min: -1,
      max: 2,
    },
    stage0TriggeredAt: {
      type: Date,
      default: null,
    },
    stage1TriggeredAt: {
      type: Date,
      default: null,
    },
    stage2TriggeredAt: {
      type: Date,
      default: null,
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
    },
    lastKnownLat: {
      type: Number,
      default: null,
    },
    lastKnownLng: {
      type: Number,
      default: null,
    },
    lastKnownAccuracy: {
      type: Number,
      default: null,
    },
    consecutiveHeartbeats: {
      type: Number,
      default: 0,
    },
    firstReconnectionAt: {
      type: Date,
      default: null,
    },
    surfaceDetectionSent: {
      type: Boolean,
      default: false,
    },
    reconnectionDetectionSent: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }, // Pas besoin d'_id pour les subdocuments
);

// Schéma principal de la session SOS
const sosSessionSchema: Schema<ISosSession> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
    entryLat: {
      type: Number,
    },
    entryLng: {
      type: Number,
    },
    consecutiveHeartbeats: {
      type: Number,
      default: 0,
    },
    firstReconnectionAt: {
      type: Date,
    },
    surfaceDetectionSent: {
      type: Boolean,
      default: false,
    },
    reconnectionDetectionSent: {
      type: Boolean,
      default: false,
    },
    // ─── NOUVEAUX CHAMPS GROUPE ───
    participants: {
      type: [participantSchema],
      default: [],
    },
    resolvedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // ───────────────────────────────
    sessionContactIds: {
      type: [Schema.Types.ObjectId],
      ref: "SosContact",
      required: false,
    },
    useDefaultContacts: {
      type: Boolean,
      default: true,
    },
    note: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    siteName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    zone: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    depth: {
      type: Number,
      min: 0,
      max: 5000, // 5km max de profondeur
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

// ─────────────────────────────────────────────────────────────────────────────
// INDEX
// ─────────────────────────────────────────────────────────────────────────────

// Index composites pour les requêtes fréquentes
sosSessionSchema.index({ userId: 1, status: 1, createdAt: -1 });
sosSessionSchema.index({ status: 1, expiresAt: 1 }); // Pour le cron d'escalade
sosSessionSchema.index({ status: 1, currentStage: 1 }); // Pour trouver les sessions à escalader

// Nouveaux index pour les participants
sosSessionSchema.index({ "participants.userId": 1, status: 1 }); // Recherche par participant
sosSessionSchema.index({ "participants.status": 1 }); // Cron queries sur statut participant

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const SosSessionModel: Model<ISosSession> =
  mongoose.models.SosSession ||
  mongoose.model<ISosSession>("SosSession", sosSessionSchema);

export default SosSessionModel;
