import mongoose from "mongoose";
import NotificationModel, {
  INotification,
  NotificationType,
} from "../models/notifications";
import { webSocketService } from "./webSocketService"; // Correction de l'import nommé
import dataArchiveService from "./dataArchiveService";
import { logger } from "./loggerService";

const notifLogger = logger.child({ service: "notification" });

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK - Import conditionnel
// ═══════════════════════════════════════════════════════════════════════════
let firebaseAdmin: any = null;
try {
  firebaseAdmin = require("firebase-admin");
} catch (error) {
  notifLogger.warn(
    "[SOS-WARNING] firebase-admin non installé - notifications push désactivées",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES POUR LES NOTIFICATIONS PUSH
// ═══════════════════════════════════════════════════════════════════════════
interface PushNotificationResult {
  sent: boolean;
  method: "fcm" | "websocket" | "db_only";
  error?: string;
}

interface PendingNotification {
  userId: string;
  title: string;
  message: string;
  data: any;
  type: NotificationType;
  attempts: number;
  lastAttempt: Date;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE DE SERVICE DE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
class NotificationService {
  private static fcmInitialized: boolean = false;
  private static pendingNotifications: Map<string, PendingNotification> =
    new Map();
  private static retryIntervalId: NodeJS.Timeout | null = null;
  private static readonly MAX_RETRY_ATTEMPTS = 5;
  private static readonly RETRY_INTERVAL_MS = 30000; // 30 secondes

  /**
   * Initialise Firebase Admin SDK pour les notifications push
   */
  static initializePushNotifications(): void {
    if (!firebaseAdmin) {
      notifLogger.warn(
        "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
      );
      return;
    }

    try {
      // Vérifier si Firebase est déjà initialisé
      if (firebaseAdmin.apps.length > 0) {
        this.fcmInitialized = true;
        notifLogger.info("Firebase Admin SDK déjà initialisé");
        return;
      }

      // Option 1 : JSON string depuis variable d'environnement
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert(serviceAccount),
        });
        this.fcmInitialized = true;
        notifLogger.info(
          "Firebase Admin SDK initialisé via FIREBASE_SERVICE_ACCOUNT",
        );
        return;
      }

      // Option 2 : Fichier via GOOGLE_APPLICATION_CREDENTIALS
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath) {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.applicationDefault(),
        });
        this.fcmInitialized = true;
        notifLogger.info(
          "Firebase Admin SDK initialisé via GOOGLE_APPLICATION_CREDENTIALS",
        );
        return;
      }

      notifLogger.warn(
        "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
      );
    } catch (error) {
      notifLogger.error("Erreur lors de l'initialisation de Firebase Admin", {
        error: error instanceof Error ? error.message : String(error),
      });
      notifLogger.warn(
        "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
      );
    }
  }

  /**
   * Envoie une notification push via Firebase Cloud Messaging
   */
  static async sendPushNotification(
    userId: mongoose.Types.ObjectId | string,
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<PushNotificationResult> {
    const userIdStr = typeof userId === "string" ? userId : userId.toString();

    // Vérifier si Firebase est initialisé
    if (!this.fcmInitialized || !firebaseAdmin) {
      notifLogger.warn(
        `[SOS-CRITICAL] Push notification could not be sent to user ${userIdStr} - FCM not configured`,
      );
      return {
        sent: false,
        method: "db_only",
        error: "FCM not configured",
      };
    }

    try {
      // Récupérer le token FCM de l'utilisateur
      const User = mongoose.model("User");
      const user = await User.findById(userId).select("fcmToken").lean();

      if (!user || !(user as any).fcmToken) {
        notifLogger.warn(
          `[SOS-CRITICAL] Push notification could not be sent to user ${userIdStr} - FCM token not found`,
        );
        return {
          sent: false,
          method: "db_only",
          error: "No FCM token",
        };
      }

      const fcmToken = (user as any).fcmToken;

      // Construire le message FCM
      const message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          userId: userIdStr,
        },
        android: {
          priority: "high" as const,
          notification: {
            sound: "default",
            priority: "high" as const,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              contentAvailable: true,
            },
          },
        },
      };

      // Envoyer le message
      const response = await firebaseAdmin.messaging().send(message);

      notifLogger.info("Notification push envoyée avec succès", {
        userId: userIdStr,
        messageId: response,
      });

      return {
        sent: true,
        method: "fcm",
      };
    } catch (error: any) {
      // Gérer les tokens invalides
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        notifLogger.warn("Token FCM invalide ou expiré, suppression du token", {
          userId: userIdStr,
          error: error.code,
        });

        // Supprimer le token invalide
        try {
          const User = mongoose.model("User");
          await User.updateOne({ _id: userId }, { $unset: { fcmToken: "" } });
        } catch (updateError) {
          notifLogger.error("Erreur lors de la suppression du token FCM", {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
          });
        }
      }

      notifLogger.error("Erreur lors de l'envoi de la notification push", {
        userId: userIdStr,
        error: error.message,
        code: error.code,
      });

      return {
        sent: false,
        method: "db_only",
        error: error.message,
      };
    }
  }

  /**
   * Ajoute une notification à la file d'attente de retry
   */
  private static addToPendingQueue(
    userId: string,
    title: string,
    message: string,
    data: any,
    type: NotificationType,
  ): void {
    const notificationKey = `${userId}-${Date.now()}`;

    this.pendingNotifications.set(notificationKey, {
      userId,
      title,
      message,
      data,
      type,
      attempts: 0,
      lastAttempt: new Date(),
      createdAt: new Date(),
    });

    notifLogger.warn(
      "[SOS-WARNING] Notification ajoutée à la file d'attente de retry",
      {
        userId,
        type,
        queueSize: this.pendingNotifications.size,
      },
    );

    // Démarrer le service de retry si pas déjà actif
    if (!this.retryIntervalId) {
      this.startRetryService();
    }
  }

  /**
   * Démarre le service de retry des notifications en attente
   */
  private static startRetryService(): void {
    if (this.retryIntervalId) {
      return; // Déjà démarré
    }

    notifLogger.info("Démarrage du service de retry des notifications SOS");

    this.retryIntervalId = setInterval(() => {
      this.retryPendingNotifications();
    }, this.RETRY_INTERVAL_MS);
  }

  /**
   * Réessaie d'envoyer les notifications en attente
   */
  static async retryPendingNotifications(): Promise<void> {
    if (this.pendingNotifications.size === 0) {
      return;
    }

    notifLogger.info("Tentative de renvoi des notifications en attente", {
      count: this.pendingNotifications.size,
    });

    const toRemove: string[] = [];

    for (const [key, notification] of this.pendingNotifications.entries()) {
      notification.attempts++;
      notification.lastAttempt = new Date();

      // Tentative WebSocket
      let wsSuccess = false;
      try {
        if (
          webSocketService &&
          typeof webSocketService.sendNotificationToUser === "function"
        ) {
          webSocketService.sendNotificationToUser(notification.userId, {
            type: "notification",
            notificationType: notification.type,
            title: notification.title,
            message: notification.message,
            ...notification.data,
          });
          wsSuccess = true;
          notifLogger.info("Notification retry réussie via WebSocket", {
            userId: notification.userId,
            attempts: notification.attempts,
          });
          toRemove.push(key);
          continue;
        }
      } catch (error) {
        notifLogger.debug("Retry WebSocket échoué", {
          userId: notification.userId,
          attempts: notification.attempts,
        });
      }

      // Si WebSocket échoue, tenter push notification
      if (!wsSuccess) {
        const pushResult = await this.sendPushNotification(
          notification.userId,
          notification.title,
          notification.message,
          notification.data,
        );

        if (pushResult.sent) {
          notifLogger.info("Notification retry réussie via push", {
            userId: notification.userId,
            attempts: notification.attempts,
          });
          toRemove.push(key);
          continue;
        }
      }

      // Si max tentatives atteint, logger CRITICAL et supprimer
      if (notification.attempts >= this.MAX_RETRY_ATTEMPTS) {
        notifLogger.error(
          `[SOS-CRITICAL] Notification could not be delivered after ${this.MAX_RETRY_ATTEMPTS} attempts`,
          {
            userId: notification.userId,
            type: notification.type,
            title: notification.title,
            elapsedTime: Date.now() - notification.createdAt.getTime(),
          },
        );
        toRemove.push(key);
      }
    }

    // Supprimer les notifications traitées
    toRemove.forEach((key) => this.pendingNotifications.delete(key));

    // Arrêter le service si plus de notifications en attente
    if (this.pendingNotifications.size === 0 && this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
      notifLogger.info("Service de retry des notifications arrêté (file vide)");
    }
  }

  /**
   * Envoie une notification à un utilisateur (WebSocket + Push si nécessaire)
   */
  static async sendNotificationToUser(
    userId: mongoose.Types.ObjectId | string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const userIdStr = typeof userId === "string" ? userId : userId.toString();
    const isSosNotification =
      type.toLowerCase().includes("sos") ||
      title.toLowerCase().includes("sos") ||
      message.toLowerCase().includes("sos");

    let deliveryMethod: string = "db_only";
    let wsSuccess = false;

    // Tentative 1 : WebSocket
    try {
      if (
        webSocketService &&
        typeof webSocketService.sendNotificationToUser === "function"
      ) {
        webSocketService.sendNotificationToUser(userIdStr, {
          type: "notification",
          notificationType: type,
          title,
          message,
          ...data,
        });
        wsSuccess = true;
        deliveryMethod = "websocket";
      }
    } catch (error) {
      notifLogger.warn("Échec d'envoi via WebSocket", {
        userId: userIdStr,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Tentative 2 : Push notification (si WS échoue OU si SOS)
    if (!wsSuccess || isSosNotification) {
      const pushResult = await this.sendPushNotification(
        userId,
        title,
        message,
        {
          type,
          ...Object.entries(data || {}).reduce(
            (acc, [key, value]) => {
              acc[key] =
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value);
              return acc;
            },
            {} as Record<string, string>,
          ),
        },
      );

      if (pushResult.sent) {
        deliveryMethod = wsSuccess ? "websocket+fcm" : "fcm";
      } else if (!wsSuccess) {
        // Aucune méthode n'a fonctionné, ajouter à la file de retry
        this.addToPendingQueue(userIdStr, title, message, data, type);
        deliveryMethod = "queued_for_retry";
      } else if (isSosNotification) {
        // WS succeeded but FCM failed for SOS — log critical (WS delivered but no push backup)
        notifLogger.warn(
          "[SOS-WARNING] WebSocket delivered but FCM push failed - no push notification backup",
          { userId: userIdStr, type },
        );
        deliveryMethod = "websocket_only_no_push";
      }
    }

    notifLogger.info("Notification envoyée", {
      userId: userIdStr,
      type,
      isSosNotification,
      deliveryMethod,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS PUBLIQUES (LEGACY) - Maintiennent la compatibilité
// ═══════════════════════════════════════════════════════════════════════════

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

  // Utiliser le nouveau système de notification avec push + retry
  await NotificationService.sendNotificationToUser(
    userId,
    type,
    title,
    message,
    {
      notificationId: notification._id.toString(),
      conversationId: data?.conversationId?.toString(),
      createdAt: notification.createdAt.toISOString(),
      ...(data?.contactId && { contactId: data.contactId.toString() }),
      ...(data?.messageId && { messageId: data.messageId.toString() }),
      ...(data?.shareId && { shareId: data.shareId.toString() }),
      ...(data?.senderId && { senderId: data.senderId.toString() }),
      ...(data?.sosSessionId && {
        sosSessionId: data.sosSessionId.toString(),
      }),
    },
  );

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

  return NotificationModel.find(query)
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
  return NotificationModel.countDocuments({
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

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS DE LA CLASSE ET MÉTHODES STATIQUES
// ═══════════════════════════════════════════════════════════════════════════
export { NotificationService };
export default NotificationService;
