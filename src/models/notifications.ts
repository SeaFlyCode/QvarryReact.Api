import mongoose, { Document, Schema, Model } from "mongoose";

// Types de notifications possibles
export type NotificationType =
  | "contact_request" // Nouvelle demande de contact
  | "contact_accepted" // Demande de contact acceptée
  | "message" // Nouveau message
  | "group_invite" // Invitation à un groupe
  | "share_received" // Nouvelles données partagées reçues
  | "share_accepted" // Votre partage a été accepté
  | "share_declined" // Votre partage a été refusé
  | "share_read" // Votre partage a été lu
  | "share_expiring_soon" // Un partage va expirer dans 2 jours
  | "share_expired" // Un partage a expiré
  | "sos_alert" // Alerte SOS générique (stage 0)
  | "sos_stage1_alert" // Alerte SOS stage 1 (notification à tous les users)
  | "contact_refused" // Demande de contact refusée
  | "group_member_added" // Ajouté à un groupe existant
  | "group_member_removed" // Retiré d'un groupe
  | "group_deleted" // Groupe supprimé
  | "sos_confirmed_safe" // Un contact a confirmé que la personne est en sécurité
  | "sos_session_cancelled" // Session SOS annulée par le créateur
  | "sos_participant_left" // Un participant a quitté la session SOS
  | "sos_surface_detected" // Détection de déplacement en surface
  | "sos_reconnection_detected" // Reconnexion stable détectée
  | "sos_sms_triggered" // SMS d'urgence envoyés (stage 2)
  | "login_new_device" // Connexion depuis un nouvel appareil
  | "admin_notification" // Notification admin générique
  // ─── Notifications admin dédiées ───────────────────────────────────────
  | "admin_sos_unresolved" // P0 — SOS stage 2 sans confirmation safe après 30 min
  | "admin_security_breach" // P0 — pic de logins échoués
  | "admin_service_down" // P0 — FCM/Vonage/DB indispo > 2 min
  | "admin_critical_audit" // P0 — action critique (suppression masse, modif privilèges)
  | "admin_user_report" // P1 — signalement user (TODO: pas de système de report user en place ; brancher quand /reports sera créé via notifyAllAdmins('admin_user_report', ..., { dedupKey: 'report:{reportId}' }))
  | "admin_abuse_pattern" // P1 — pattern abusif détecté
  | "admin_quota_exceeded" // P1 — user dépasse quota
  | "admin_verification_pending" // P1 — user à valider
  | "admin_sos_failed_sms" // P1 — Vonage failed sur Stage 2
  | "admin_sentry_high" // P2 — bug Sentry severity ≥ error
  | "admin_cron_failed" // P2 — cron en échec
  | "admin_metrics_anomaly" // P2 — métrique hors seuil
  | "admin_daily_digest" // P3 — digest 9h
  | "admin_weekly_report"; // P3 — rapport hebdo

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
  sosSessionId?: mongoose.Types.ObjectId; // ID de la session SOS (si applicable)

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
        "share_received",
        "share_accepted",
        "share_declined",
        "share_read",
        "share_expiring_soon",
        "share_expired",
        "sos_alert",
        "sos_stage1_alert",
        "contact_refused",
        "group_member_added",
        "group_member_removed",
        "group_deleted",
        "sos_confirmed_safe",
        "sos_session_cancelled",
        "sos_participant_left",
        "sos_surface_detected",
        "sos_reconnection_detected",
        "sos_sms_triggered",
        "login_new_device",
        "admin_notification",
        "admin_sos_unresolved",
        "admin_security_breach",
        "admin_service_down",
        "admin_critical_audit",
        "admin_user_report",
        "admin_abuse_pattern",
        "admin_quota_exceeded",
        "admin_verification_pending",
        "admin_sos_failed_sms",
        "admin_sentry_high",
        "admin_cron_failed",
        "admin_metrics_anomaly",
        "admin_daily_digest",
        "admin_weekly_report",
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
    sosSessionId: {
      type: Schema.Types.ObjectId,
      ref: "SosSession",
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
