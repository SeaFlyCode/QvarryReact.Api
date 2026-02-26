import mongoose from "mongoose";
import NotificationModel, {
  INotification,
  NotificationType,
} from "../models/notifications";
import { webSocketService } from "./webSocketService"; // Correction de l'import nommé
import dataArchiveService from "./dataArchiveService";
import { logger } from "./loggerService";

const notifLogger = logger.child({ service: "notification" });

/**
 * Créer une nouvelle notification
 * @param userId - ID de l'utilisateur destinataire
 * @param type - Type de notification
 * @param title - Titre de la notification
 * @param message - Message de la notification
 * @param data - Données optionnelles (contactId, conversationId, messageId, shareId, senderId, sosSessionId)
 */
export async function createNotification(
  userId: mongoose.Types.ObjectId,
  type: NotificationType,
  title: string,
  message: string,
  data?: {
    contactId?: mongoose.Types.ObjectId;
    conversationId?: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId;
    shareId?: mongoose.Types.ObjectId;
    senderId?: mongoose.Types.ObjectId;
    sosSessionId?: mongoose.Types.ObjectId;
  },
): Promise<INotification> {
  const notification = new NotificationModel({
    userId,
    type,
    title,
    message,
    contactId: data?.contactId,
    conversationId: data?.conversationId,
    messageId: data?.messageId,
    shareId: data?.shareId,
    senderId: data?.senderId,
    sosSessionId: data?.sosSessionId,
    read: false,
    createdAt: new Date(),
    relatedEntityId:
      data?.shareId?.toString() ||
      data?.contactId?.toString() ||
      data?.conversationId?.toString() ||
      data?.sosSessionId?.toString(),
  });

  await notification.save();

  notifLogger.info("Notification créée", {
    userId: userId.toString(),
    type,
  });

  // Envoyer la notification via WebSocket si l'utilisateur est connecté
  if (
    webSocketService &&
    typeof webSocketService.sendNotificationToUser === "function"
  ) {
    webSocketService.sendNotificationToUser(userId.toString(), {
      type: "notification", // Ajout explicite du type pour le client
      notificationId: notification._id,
      notificationType: type,
      title,
      message,
      conversationId: data?.conversationId?.toString(), // Pour filtrer si on est sur la conversation
      createdAt: notification.createdAt,
    });
  }

  return notification;
}

/**
 * Marquer une notification comme lue
 */
export async function markNotificationAsRead(
  notificationId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
): Promise<void> {
  await NotificationModel.updateOne(
    { _id: notificationId, userId: userId },
    {
      $set: {
        read: true,
        readAt: new Date(),
      },
    },
  );

  notifLogger.info("Notification marquée comme lue", {
    notificationId: notificationId.toString(),
  });
}

/**
 * Marquer toutes les notifications comme lues pour un utilisateur
 */
export async function markAllNotificationsAsRead(
  userId: mongoose.Types.ObjectId,
): Promise<number> {
  const result = await NotificationModel.updateMany(
    { userId: userId, read: false },
    {
      $set: {
        read: true,
        readAt: new Date(),
      },
    },
  );

  notifLogger.info("Notifications marquées comme lues", {
    count: result.modifiedCount,
    userId: userId.toString(),
  });

  return result.modifiedCount;
}

/**
 * Récupérer toutes les notifications d'un utilisateur
 */
export async function getUserNotifications(
  userId: mongoose.Types.ObjectId,
  unreadOnly: boolean = false,
): Promise<any[]> {
  const query: any = { userId };

  if (unreadOnly) {
    query.read = false;
  }

  return await NotificationModel.find(query)
    .populate("senderId", "name surname pseudo showPseudo")
    .sort({ createdAt: -1 })
    .limit(50) // Limiter aux 50 dernières
    .lean()
    .maxTimeMS(5000);
}

/**
 * Supprimer une notification
 */
export async function deleteNotification(
  notificationId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
): Promise<void> {
  // Récupérer et archiver la notification avant suppression
  const notification = await NotificationModel.findOne({
    _id: notificationId,
    userId: userId,
  }).lean();

  if (notification) {
    await dataArchiveService.archiveAndRecordDeletion(
      "notification",
      notificationId,
      notification as Record<string, unknown>,
      userId,
      { reason: "Notification supprimée par utilisateur" },
    );
  }

  await NotificationModel.deleteOne({
    _id: notificationId,
    userId: userId,
  });

  notifLogger.info("Notification supprimée", {
    notificationId: notificationId.toString(),
  });
}

/**
 * Supprimer les anciennes notifications (> 30 jours)
 */
export async function cleanupOldNotifications(): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await NotificationModel.deleteMany({
    createdAt: { $lt: thirtyDaysAgo },
    read: true, // Ne supprimer que les notifications déjà lues
  });

  notifLogger.info("Nettoyage des anciennes notifications", {
    deletedCount: result.deletedCount,
  });

  return result.deletedCount;
}

/**
 * Compter les notifications non lues
 */
export async function getUnreadNotificationsCount(
  userId: mongoose.Types.ObjectId,
): Promise<number> {
  return await NotificationModel.countDocuments({
    userId: userId,
    read: false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS SPÉCIFIQUES AU PARTAGE DE DONNÉES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notifier les destinataires qu'ils ont reçu un partage
 * À appeler après shareData() dans dataShareService
 */
export async function notifyShareReceived(
  receiverIds: mongoose.Types.ObjectId[],
  senderId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  dataType: string,
  senderName: string,
): Promise<void> {
  const notifications = receiverIds.map((receiverId) =>
    createNotification(
      receiverId,
      "share_received",
      "Nouveau partage reçu",
      `${senderName} a partagé ${dataType === "fiche" ? "une fiche" : dataType === "liste" ? "une liste" : "un point"} avec vous`,
      {
        shareId,
        senderId,
      },
    ),
  );

  await Promise.all(notifications);

  notifLogger.info("Notifications de partage envoyées", {
    recipientCount: receiverIds.length,
  });
}

/**
 * Notifier l'émetteur qu'un partage a été accepté
 */
export async function notifyShareAccepted(
  senderId: mongoose.Types.ObjectId,
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  receiverName: string,
): Promise<void> {
  await createNotification(
    senderId,
    "share_accepted",
    "Partage accepté",
    `${receiverName} a accepté votre partage`,
    {
      shareId,
      senderId: receiverId,
    },
  );
}

/**
 * Notifier l'émetteur qu'un partage a été refusé
 */
export async function notifyShareDeclined(
  senderId: mongoose.Types.ObjectId,
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  receiverName: string,
): Promise<void> {
  await createNotification(
    senderId,
    "share_declined",
    "Partage refusé",
    `${receiverName} a refusé votre partage`,
    {
      shareId,
      senderId: receiverId,
    },
  );
}

/**
 * Notifier l'émetteur qu'un partage a été lu
 */
export async function notifyShareRead(
  senderId: mongoose.Types.ObjectId,
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  receiverName: string,
): Promise<void> {
  await createNotification(
    senderId,
    "share_read",
    "Partage lu",
    `${receiverName} a consulté votre partage`,
    {
      shareId,
      senderId: receiverId,
    },
  );
}
