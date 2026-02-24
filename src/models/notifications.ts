import mongoose, { Document, Schema, Model } from "mongoose";

// Types de notifications possibles
export type NotificationType =
  | "contact_request" // Nouvelle demande de contact
  | "contact_accepted" // Demande de contact acceptée
  | "message" // Nouveau message
  | "group_invite" // Invitation à un groupe
  | "data_share" // Partage de données
  | "share_received" // Nouvelles données partagées reçues
  | "share_accepted" // Votre partage a été accepté
  | "share_declined" // Votre partage a été refusé
  | "share_read" // Votre partage a été lu
  | "share_expiring_soon" // Un partage va expirer dans 2 jours
  | "share_expired"; // Un partage a expiré

// Interface pour les notifications
export interface INotification extends Document {
  userId: mongoose.Types.ObjectId; // Destinataire de la notification
  type: NotificationType;

  // Références aux entités concernées
  contactId?: mongoose.Types.ObjectId; // ID du contact (pour demandes de contact)
  conversationId?: mongoose.Types.ObjectId; // ID de la conversation (pour messages/groupes)
  messageId?: mongoose.Types.ObjectId; // ID du message (pour messages)
  shareId?: mongoose.Types.ObjectId; // ID du partage concerné (si applicable)
  senderId?: mongoose.Types.ObjectId; // ID de l'émetteur (si applicable)

  // Contenu de la notification
  title: string;
  message: string;

  // Métadonnées
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  expiresAt?: Date; // Date d'expiration de la notification

  // Pour éviter les notifications en double
  relatedEntityId?: string; // ID générique de l'entité liée
}

// Schéma Mongoose
const notificationSchema: Schema<INotification> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "contact_request",
        "contact_accepted",
        "message",
        "group_invite",
        "data_share",
        "share_received",
        "share_accepted",
        "share_declined",
        "share_read",
        "share_expiring_soon",
        "share_expired",
      ],
      required: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    shareId: {
      type: Schema.Types.ObjectId,
      ref: "DataShare",
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours par défaut
    },
    relatedEntityId: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Index composites pour optimiser les requêtes
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, createdAt: -1 });

// MED-05 FIX: TTL index pour suppression automatique des notifications expirées
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Modèle Mongoose
const NotificationModel: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", notificationSchema);

export default NotificationModel;
