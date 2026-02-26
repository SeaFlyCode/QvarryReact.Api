import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE SOS EVENT (JOURNAL D'ÉVÉNEMENTS)
// ═══════════════════════════════════════════════════════════════════════════
// Log détaillé de tous les événements liés aux sessions SOS
// Utilisé pour l'audit, le debugging et l'historique
// ═══════════════════════════════════════════════════════════════════════════

// Types d'événements SOS possibles
export type SosEventType =
  | "ACTIVATED" // Session SOS démarrée
  | "HEARTBEAT" // Signe de vie reçu
  | "EXTENDED" // Timer prolongé manuellement
  | "STAGE_CHANGE" // Changement de stage d'escalade (0→1→2)
  | "SMS_SENT" // SMS envoyé à un contact d'urgence
  | "SMS_FAILED" // Échec d'envoi SMS
  | "NOTIFICATION_SENT" // Notification push envoyée
  | "RESOLVED" // Session résolue
  | "CANCELLED" // Session annulée
  | "CONTACT_CONFIRMED" // Un contact a confirmé la sécurité
  | "SURFACE_DETECTED" // Déplacement GPS significatif détecté
  | "RECONNECTION_DETECTED" // Reconnexion prolongée détectée
  | "PARTICIPANT_ADDED" // Participant ajouté à une session de groupe
  | "PARTICIPANT_LEFT" // Participant a quitté la session (désactivation scope "self")
  | "PARTICIPANT_DISCONNECTED" // Participant a perdu la connexion heartbeat
  | "SESSION_DEACTIVATED_ALL"; // Session désactivée pour tous les participants

// Interface pour les événements SOS
export interface ISosEvent extends Document {
  sessionId: mongoose.Types.ObjectId; // Session SOS associée
  userId: mongoose.Types.ObjectId; // Utilisateur concerné
  type: SosEventType;
  participantId?: mongoose.Types.ObjectId; // Participant spécifique concerné (pour sessions de groupe)
  metadata?: Record<string, any>; // Données additionnelles (stage, contactId, smsId, etc.)
  createdAt: Date;
}

const sosEventSchema: Schema<ISosEvent> = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "SosSession",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "ACTIVATED",
        "HEARTBEAT",
        "EXTENDED",
        "STAGE_CHANGE",
        "SMS_SENT",
        "SMS_FAILED",
        "NOTIFICATION_SENT",
        "RESOLVED",
        "CANCELLED",
        "CONTACT_CONFIRMED",
        "SURFACE_DETECTED",
        "RECONNECTION_DETECTED",
        "PARTICIPANT_ADDED",
        "PARTICIPANT_LEFT",
        "PARTICIPANT_DISCONNECTED",
        "SESSION_DEACTIVATED_ALL",
      ],
      required: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      set: (v: any) => {
        if (!v) return v;
        try {
          const json = JSON.stringify(v);
          if (json.length > 10000)
            return { error: "Data too large", truncated: true };
          return JSON.parse(json, (key, value) => {
            if (typeof key === "string" && key.startsWith("$"))
              return undefined;
            return value;
          });
        } catch {
          return v;
        }
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // On gère createdAt manuellement, pas besoin d'updatedAt
  },
);

// Index composites pour les requêtes fréquentes
sosEventSchema.index({ sessionId: 1, type: 1, createdAt: -1 });
sosEventSchema.index({ userId: 1, createdAt: -1 });

// TTL: Supprimer les événements après 90 jours
sosEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

const SosEventModel: Model<ISosEvent> =
  mongoose.models.SosEvent ||
  mongoose.model<ISosEvent>("SosEvent", sosEventSchema);

export default SosEventModel;
