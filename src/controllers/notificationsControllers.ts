import { Request, Response } from "express";
import NotificationModel from "../models/notifications";
import { NotificationType } from "../models/notifications";
import mongoose from "mongoose";
import {
  createNotification,
  deleteNotification as deleteNotificationService,
} from "../services/notificationService";
import dataArchiveService from "../services/dataArchiveService";
import { logger } from "../services/loggerService";
import { webSocketService } from "../services/webSocketService";

const notifCtrlLogger = logger.child({ service: "notifications-controller" });

/**
 * Helper : récupère le deviceId origin depuis le header `x-device-id`.
 * Sert à filtrer les broadcasts notification_read côté client (le device
 * qui a déclenché le mark_read n'a pas besoin d'être notifié).
 */
function getOriginDeviceId(req: Request): string | undefined {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 128) {
    return raw;
  }
  return undefined;
}

/**
 * Récupère toutes les notifications de l'utilisateur connecté
 */
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    // Pagination standard
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 15),
      100,
    );
    const skip = (page - 1) * limit;

    // Supprimer les notifications expirées
    await NotificationModel.deleteMany({
      userId: new mongoose.Types.ObjectId(userId),
      expiresAt: { $lt: new Date() },
    });

    const [notifications, total, unreadCount] = await Promise.all([
      NotificationModel.find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .populate("senderId", "name surname")
        .lean(),
      NotificationModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
      }),
      NotificationModel.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
        read: false,
      }),
    ]);

    notifCtrlLogger.debug("Notifications récupérées avec succès", {
      userId,
      count: notifications.length,
      total,
      unreadCount,
      action: "read_notifications",
    });

    res.json({
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      unreadCount,
    });
  } catch (error) {
    notifCtrlLogger.error("Get notifications error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Récupère le nombre de notifications non lues
 */
export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const unreadCount = await NotificationModel.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      read: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    notifCtrlLogger.error("Get unread count error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Marque une notification comme lue
 */
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const { notificationId } = req.params;

    const notification = await NotificationModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(notificationId),
        userId: new mongoose.Types.ObjectId(userId),
      },
      {
        read: true,
        readAt: new Date(),
      },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification non trouvée" });
    }

    notifCtrlLogger.info("Notification marquée comme lue", {
      userId,
      notificationId,
      action: "mark_notification_read",
    });

    // 2026-05-04 §4.6: notification_read multi-device
    webSocketService.broadcastNotificationRead(
      userId,
      notificationId,
      getOriginDeviceId(req),
    );

    res.json({ message: "Notification marquée comme lue" });
  } catch (error) {
    notifCtrlLogger.error("Mark as read error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Marque toutes les notifications comme lues
 */
export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    await NotificationModel.updateMany(
      {
        userId: new mongoose.Types.ObjectId(userId),
        read: false,
      },
      {
        read: true,
        readAt: new Date(),
      },
    );

    notifCtrlLogger.info("Toutes les notifications marquées comme lues", {
      userId,
      action: "mark_all_notifications_read",
    });

    // 2026-05-04 §4.6: notification_read multi-device (mark-all)
    webSocketService.broadcastNotificationRead(
      userId,
      "all",
      getOriginDeviceId(req),
    );

    res.json({
      message: "Toutes les notifications ont été marquées comme lues",
    });
  } catch (error) {
    notifCtrlLogger.error("Mark all as read error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Supprime une notification
 */
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const { notificationId } = req.params;

    // Vérifier que la notification appartient bien à l'utilisateur avant de déléguer
    const exists = await NotificationModel.findOne({
      _id: new mongoose.Types.ObjectId(notificationId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!exists) {
      return res.status(404).json({ message: "Notification non trouvée" });
    }

    // Déléguer au service qui gère l'archivage avant suppression
    await deleteNotificationService(
      new mongoose.Types.ObjectId(notificationId),
      new mongoose.Types.ObjectId(userId),
    );

    notifCtrlLogger.info("Notification supprimée avec succès", {
      userId,
      notificationId,
      action: "delete_notification",
    });

    res.json({ message: "Notification supprimée" });
  } catch (error) {
    notifCtrlLogger.error("Delete notification error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Supprime toutes les notifications lues
 */
export const deleteAllRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Récupérer toutes les notifications lues avant suppression pour les archiver
    const readNotifications = await NotificationModel.find({
      userId: userObjectId,
      read: true,
    }).lean();

    // Archiver chaque notification lue avant suppression
    for (const notification of readNotifications) {
      await dataArchiveService.archiveAndRecordDeletion(
        "notification",
        notification._id as mongoose.Types.ObjectId,
        notification as Record<string, unknown>,
        userObjectId,
        {
          reason:
            "Suppression en masse des notifications lues par l'utilisateur",
        },
      );
    }

    await NotificationModel.deleteMany({
      userId: userObjectId,
      read: true,
    });

    notifCtrlLogger.info("Toutes les notifications lues supprimées", {
      userId,
      count: readNotifications.length,
      action: "delete_all_read_notifications",
    });

    res.json({ message: "Toutes les notifications lues ont été supprimées" });
  } catch (error) {
    notifCtrlLogger.error("Delete all read error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};

/**
 * Créer une notification (fonction utilitaire)
 * Délègue au service pour déclencher WebSocket/FCM/retry
 */
export const createNotificationUtil = async (
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  data?: {
    contactId?: string;
    conversationId?: string;
    messageId?: string;
    shareId?: string;
    senderId?: string;
    sosSessionId?: string;
  },
) => {
  return createNotification(
    new mongoose.Types.ObjectId(userId),
    type,
    title,
    message,
    {
      contactId: data?.contactId
        ? new mongoose.Types.ObjectId(data.contactId)
        : undefined,
      conversationId: data?.conversationId
        ? new mongoose.Types.ObjectId(data.conversationId)
        : undefined,
      messageId: data?.messageId
        ? new mongoose.Types.ObjectId(data.messageId)
        : undefined,
      shareId: data?.shareId
        ? new mongoose.Types.ObjectId(data.shareId)
        : undefined,
      senderId: data?.senderId
        ? new mongoose.Types.ObjectId(data.senderId)
        : undefined,
      sosSessionId: data?.sosSessionId
        ? new mongoose.Types.ObjectId(data.sosSessionId)
        : undefined,
    },
  );
};

/**
 * Créer une notification de test (pour le développement)
 * ⚠️ À SUPPRIMER EN PRODUCTION
 */
export const createTestNotification = async (req: Request, res: Response) => {
  // Protection: désactiver en production
  if (process.env.NODE_ENV?.toLowerCase() === "production") {
    return res.status(404).json({ message: "Endpoint non disponible" });
  }

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Non authentifié" });
    }

    const { type, title, message } = req.body;

    const notification = await createNotification(
      new mongoose.Types.ObjectId(userId),
      type || "share_received",
      title || "Notification de test",
      message ||
        "Ceci est une notification de test pour vérifier le système WebSocket",
    );

    res.json({
      success: true,
      message: "Notification de test créée",
      notification,
    });
  } catch (error) {
    notifCtrlLogger.error("Create test notification error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ message: "Erreur serveur" });
  }
};
