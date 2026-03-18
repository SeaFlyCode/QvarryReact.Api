import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE SMS DELIVERY RECEIPT
// ═══════════════════════════════════════════════════════════════════════════
// Stocke les confirmations de livraison des SMS envoyés via Vonage
// Utilisé pour tracer le statut de livraison des SMS d'urgence SOS
// ═══════════════════════════════════════════════════════════════════════════

// Statuts de livraison Vonage possibles
export type VonageDeliveryStatus =
  | "delivered" // SMS délivré avec succès
  | "expired" // SMS expiré (non délivré dans le délai)
  | "failed" // Échec de livraison
  | "rejected" // Rejeté par le réseau
  | "accepted" // Accepté par le réseau (en transit)
  | "buffered" // En attente dans le buffer du réseau
  | "unknown"; // Statut inconnu

// Interface pour les confirmations de livraison SMS
export interface ISmsDeliveryReceipt extends Document {
  messageId: string; // ID du message Vonage (identifiant unique)
  from: string; // Numéro d'envoi (expéditeur Vonage)
  to: string; // Numéro de destination (format E.164)
  status: VonageDeliveryStatus; // Statut de livraison
  price?: string; // Prix du SMS (optionnel)
  networkCode?: string; // Code du réseau mobile (MCC-MNC)
  errorCode?: string; // Code d'erreur Vonage (si échec)
  messageTimestamp?: string; // Timestamp du message Vonage (format ISO)
  receivedAt: Date; // Date de réception du webhook
}

const smsDeliveryReceiptSchema: Schema<ISmsDeliveryReceipt> = new Schema(
  {
    messageId: {
      type: String,
      required: true,
      index: true, // Index pour recherche rapide par messageId
    },
    from: {
      type: String,
      required: true,
    },
    to: {
      type: String,
      required: true,
      index: true, // Index pour recherche par destinataire
    },
    status: {
      type: String,
      enum: [
        "delivered",
        "expired",
        "failed",
        "rejected",
        "accepted",
        "buffered",
        "unknown",
      ],
      required: true,
    },
    price: {
      type: String,
      required: false,
    },
    networkCode: {
      type: String,
      required: false,
    },
    errorCode: {
      type: String,
      required: false,
    },
    messageTimestamp: {
      type: String,
      required: false,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: false, // On gère receivedAt manuellement, pas besoin d'updatedAt
  },
);

// Index composite pour recherche par messageId + date
smsDeliveryReceiptSchema.index({ messageId: 1, receivedAt: -1 });

// TTL: Supprimer les confirmations après 90 jours (même rétention que SosEvent)
smsDeliveryReceiptSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

const SmsDeliveryReceiptModel: Model<ISmsDeliveryReceipt> =
  mongoose.models.SmsDeliveryReceipt ||
  mongoose.model<ISmsDeliveryReceipt>(
    "SmsDeliveryReceipt",
    smsDeliveryReceiptSchema,
  );

export default SmsDeliveryReceiptModel;
