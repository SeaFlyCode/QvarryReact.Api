import mongoose from "mongoose";
import NotificationModel, {
  INotification,
  NotificationType,
} from "../models/notifications";
import PushTokenModel from "../models/pushToken";
import PendingNotificationModel from "../models/pendingNotification";
import {
  getTokensByUserId,
  getTokensByUserIds,
  removeInvalidTokens,
} from "./pushTokenService";
import { webSocketService } from "./webSocketService"; // Correction de l'import nommé
import dataArchiveService from "./dataArchiveService";
import { logger } from "./loggerService";

const notifLogger = logger.child({ service: "notification" });

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK - Import conditionnel
// ═══════════════════════════════════════════════════════════════════════════
import type * as FirebaseAdmin from "firebase-admin";
import { safeJsonParse } from "../utils/secureJsonParser";

let firebaseAdmin: typeof FirebaseAdmin | null = null;
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

// Interface supprimée - désormais gérée par le modèle PendingNotificationModel

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE DE SERVICE DE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
class NotificationService {
  private static fcmInitialized: boolean = false;
  private static retryIntervalId: NodeJS.Timeout | null = null;
  private static readonly MAX_RETRY_ATTEMPTS = 5;
  private static readonly RETRY_INTERVAL_MS = 30000; // 30 secondes

  /**
   * HIGH-001 FIX: Initialise Firebase Admin SDK pour les notifications push
   * Charge le compte de service depuis un fichier externe au lieu de .env
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

      // HIGH-001 FIX: Charger depuis fichier externe
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

      // Vérifier que le chemin est configuré
      if (!serviceAccountPath) {
        notifLogger.error(
          "[FIREBASE] FIREBASE_SERVICE_ACCOUNT_PATH not configured",
        );
        notifLogger.warn(
          "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
        );
        return;
      }

      // Résoudre le chemin (relatif ou absolu)
      const path = require("path");
      const fs = require("fs");
      const resolvedPath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.join(__dirname, "..", "..", serviceAccountPath);

      // Vérifier que le fichier existe
      if (!fs.existsSync(resolvedPath)) {
        notifLogger.error("[FIREBASE] Service account file not found", {
          path: resolvedPath,
        });
        notifLogger.warn(
          "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
        );
        return;
      }

      // Charger et parser le JSON
      const serviceAccountContent = fs.readFileSync(resolvedPath, "utf8");
      const serviceAccount = JSON.parse(serviceAccountContent);

      // Initialiser Firebase Admin SDK
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
      });

      this.fcmInitialized = true;

      // Logger (sans exposer la clé privée)
      notifLogger.info("[FIREBASE] Admin SDK initialized from file", {
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        path: resolvedPath,
      });
    } catch (error) {
      notifLogger.error("[FIREBASE] Failed to initialize", {
        error: error instanceof Error ? error.message : String(error),
      });
      notifLogger.warn(
        "[SOS-WARNING] Firebase not configured - push notifications disabled. SOS alerts will only work via WebSocket.",
      );
    }
  }

  /**
   * Envoie une notification push via Firebase Cloud Messaging
   * Supporte le multi-appareils via la collection PushToken
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
      // Récupérer tous les tokens FCM de l'utilisateur (multi-appareils)
      const tokens = await getTokensByUserId(userIdStr);

      if (tokens.length === 0) {
        notifLogger.warn(
          `[SOS-CRITICAL] Push notification could not be sent to user ${userIdStr} - No FCM tokens found`,
        );
        return {
          sent: false,
          method: "db_only",
          error: "No FCM token",
        };
      }

      // Construire les messages FCM pour chaque token/appareil
      const messages = tokens.map((tokenDoc) => ({
        token: tokenDoc.token,
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          userId: userIdStr,
        },
        ...(tokenDoc.platform === "android"
          ? {
              android: {
                priority: "high" as const,
                notification: {
                  sound: "default",
                  priority: "high" as const,
                },
              },
            }
          : {}),
        ...(tokenDoc.platform === "ios"
          ? {
              apns: {
                payload: {
                  aps: {
                    sound: "default",
                    contentAvailable: true,
                  },
                },
              },
            }
          : {}),
      }));

      // Envoi batch via sendEach (sendAll est deprecated)
      const response = await firebaseAdmin.messaging().sendEach(messages);

      // Gérer les tokens invalides
      const tokensToDelete: string[] = [];
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
            tokensToDelete.push(tokens[idx].deviceId);
          }
        }
      });

      // Supprimer les tokens invalides de la collection PushToken
      if (tokensToDelete.length > 0) {
        await removeInvalidTokens(tokensToDelete);
        notifLogger.warn("Tokens FCM invalides supprimés", {
          userId: userIdStr,
          count: tokensToDelete.length,
        });
      }

      notifLogger.info("Notifications push envoyées", {
        userId: userIdStr,
        sent: response.successCount,
        failed: response.failureCount,
        totalDevices: tokens.length,
      });

      return {
        sent: response.successCount > 0,
        method: "fcm",
      };
    } catch (error: any) {
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
   * Ajoute une notification à la file d'attente de retry (persistante via MongoDB)
   */
  private static async addToPendingQueue(
    userId: string,
    title: string,
    message: string,
    data: any,
    type: NotificationType,
  ): Promise<void> {
    try {
      // Créer un document dans MongoDB pour persister la notification
      const pendingNotification = new PendingNotificationModel({
        userId: new mongoose.Types.ObjectId(userId),
        type,
        title,
        message,
        data,
        attempts: 0,
        maxAttempts: this.MAX_RETRY_ATTEMPTS,
        nextRetryAt: new Date(Date.now() + this.RETRY_INTERVAL_MS),
        status: "pending",
      });

      await pendingNotification.save();

      // Compter les notifications en attente pour le log
      const queueSize = await PendingNotificationModel.countDocuments({
        status: "pending",
      });

      notifLogger.warn(
        "[SOS-WARNING] Notification ajoutée à la file d'attente de retry",
        {
          userId,
          type,
          queueSize,
          nextRetryAt: pendingNotification.nextRetryAt,
        },
      );

      // Démarrer le service de retry si pas déjà actif
      if (!this.retryIntervalId) {
        this.startRetryService();
      }
    } catch (error) {
      notifLogger.error(
        "Erreur lors de l'ajout d'une notification à la file de retry",
        {
          userId,
          type,
          error: error instanceof Error ? error.message : String(error),
        },
      );
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
   * Réessaie d'envoyer les notifications en attente (depuis MongoDB)
   */
  static async retryPendingNotifications(): Promise<void> {
    try {
      // Récupérer les notifications en attente dont le nextRetryAt est dépassé
      const now = new Date();
      const pendingNotifications = await PendingNotificationModel.find({
        status: "pending",
        nextRetryAt: { $lte: now },
      }).lean();

      if (pendingNotifications.length === 0) {
        return;
      }

      notifLogger.info("Tentative de renvoi des notifications en attente", {
        count: pendingNotifications.length,
      });

      for (const notification of pendingNotifications) {
        const userIdStr = notification.userId.toString();

        // Tentative WebSocket
        let wsSuccess = false;
        try {
          if (
            webSocketService &&
            typeof webSocketService.sendNotificationToUser === "function"
          ) {
            webSocketService.sendNotificationToUser(userIdStr, {
              type: "notification",
              notificationType: notification.type,
              title: notification.title,
              message: notification.message,
              ...notification.data,
            });
            wsSuccess = true;
            notifLogger.info("Notification retry réussie via WebSocket", {
              userId: userIdStr,
              attempts: notification.attempts + 1,
            });
            // Supprimer la notification de la file d'attente
            await PendingNotificationModel.deleteOne({ _id: notification._id });
            continue;
          }
        } catch (error) {
          notifLogger.debug("Retry WebSocket échoué", {
            userId: userIdStr,
            attempts: notification.attempts + 1,
          });
        }

        // Si WebSocket échoue, tenter push notification
        if (!wsSuccess) {
          const pushResult = await this.sendPushNotification(
            notification.userId,
            notification.title,
            notification.message,
            notification.data || {},
          );

          if (pushResult.sent) {
            notifLogger.info("Notification retry réussie via push", {
              userId: userIdStr,
              attempts: notification.attempts + 1,
            });
            // Supprimer la notification de la file d'attente
            await PendingNotificationModel.deleteOne({ _id: notification._id });
            continue;
          }
        }

        // Incrémenter le nombre de tentatives
        const newAttempts = notification.attempts + 1;

        // Si max tentatives atteint, marquer comme failed et logger CRITICAL
        if (newAttempts >= notification.maxAttempts) {
          notifLogger.error(
            `[SOS-CRITICAL] Notification could not be delivered after ${notification.maxAttempts} attempts`,
            {
              userId: userIdStr,
              type: notification.type,
              title: notification.title,
              elapsedTime: now.getTime() - notification.createdAt.getTime(),
            },
          );
          // Marquer comme failed (sera supprimée automatiquement par le TTL après 24h)
          await PendingNotificationModel.updateOne(
            { _id: notification._id },
            {
              $set: {
                status: "failed",
                attempts: newAttempts,
              },
            },
          );
        } else {
          // Mettre à jour le compteur de tentatives et le nextRetryAt
          await PendingNotificationModel.updateOne(
            { _id: notification._id },
            {
              $set: {
                attempts: newAttempts,
                nextRetryAt: new Date(now.getTime() + this.RETRY_INTERVAL_MS),
              },
            },
          );
        }
      }

      // Vérifier s'il reste des notifications en attente
      const remainingCount = await PendingNotificationModel.countDocuments({
        status: "pending",
      });

      // Arrêter le service si plus de notifications en attente
      if (remainingCount === 0 && this.retryIntervalId) {
        clearInterval(this.retryIntervalId);
        this.retryIntervalId = null;
        notifLogger.info(
          "Service de retry des notifications arrêté (file vide)",
        );
      }
    } catch (error) {
      notifLogger.error("Erreur lors du retry des notifications en attente", {
        error: error instanceof Error ? error.message : String(error),
      });
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
        await this.addToPendingQueue(userIdStr, title, message, data, type);
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

  /**
   * Envoie des notifications push en batch à plusieurs utilisateurs
   * Récupère tous les tokens en une seule requête MongoDB et envoie via sendEach FCM
   * Utilisé notamment pour les alertes SOS Stage 1 (tous les utilisateurs Qvarry)
   *
   * @param userIds - Liste des IDs utilisateurs destinataires
   * @param title - Titre de la notification
   * @param body - Corps de la notification
   * @param data - Données supplémentaires FCM
   * @returns Nombre de notifications envoyées et échouées
   */
  static async sendBatchPushNotifications(
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.fcmInitialized || !firebaseAdmin) {
      notifLogger.warn(
        "[SOS-WARNING] sendBatchPushNotifications: FCM non configuré, envoi annulé",
        { userCount: userIds.length },
      );
      return { sent: 0, failed: userIds.length };
    }

    if (userIds.length === 0) {
      return { sent: 0, failed: 0 };
    }

    try {
      // Récupérer tous les tokens en une seule requête MongoDB (batch)
      const tokenMap = await getTokensByUserIds(userIds);

      // Construire les messages FCM pour chaque token trouvé
      const messages: Array<{
        token: string;
        notification: { title: string; body: string };
        data: Record<string, string>;
        android?: {
          priority: "high";
          notification: { sound: string; priority: "high" };
        };
        apns?: {
          payload: { aps: { sound: string; contentAvailable: boolean } };
        };
      }> = [];

      // Associer token -> userId pour gérer les tokens invalides ensuite
      const tokenToDeviceId: Map<number, string> = new Map();

      for (const [userId, tokens] of tokenMap.entries()) {
        for (const tokenDoc of tokens) {
          const messageIndex = messages.length;
          tokenToDeviceId.set(messageIndex, tokenDoc.deviceId);

          messages.push({
            token: tokenDoc.token,
            notification: { title, body },
            data: { ...data, userId },
            ...(tokenDoc.platform === "android"
              ? {
                  android: {
                    priority: "high" as const,
                    notification: {
                      sound: "default",
                      priority: "high" as const,
                    },
                  },
                }
              : {}),
            ...(tokenDoc.platform === "ios"
              ? {
                  apns: {
                    payload: {
                      aps: {
                        sound: "default",
                        contentAvailable: true,
                      },
                    },
                  },
                }
              : {}),
          });
        }
      }

      if (messages.length === 0) {
        notifLogger.warn(
          "sendBatchPushNotifications: aucun token FCM trouvé pour les utilisateurs",
          { userCount: userIds.length },
        );
        return { sent: 0, failed: userIds.length };
      }

      // Envoi batch via sendEach (sendAll est deprecated)
      const response = await firebaseAdmin.messaging().sendEach(messages);

      // Identifier les tokens invalides à supprimer
      const tokensToDelete: string[] = [];
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
            const deviceId = tokenToDeviceId.get(idx);
            if (deviceId) {
              tokensToDelete.push(deviceId);
            }
          }
        }
      });

      // Supprimer les tokens invalides
      if (tokensToDelete.length > 0) {
        await removeInvalidTokens(tokensToDelete);
        notifLogger.warn("Tokens FCM invalides supprimés (batch)", {
          count: tokensToDelete.length,
        });
      }

      notifLogger.info("Notifications push batch envoyées", {
        userCount: userIds.length,
        tokenCount: messages.length,
        sent: response.successCount,
        failed: response.failureCount,
      });

      return {
        sent: response.successCount,
        failed: response.failureCount,
      };
    } catch (error: any) {
      notifLogger.error("Erreur lors de l'envoi batch des notifications push", {
        userCount: userIds.length,
        error: error.message,
        code: error.code,
      });
      return { sent: 0, failed: userIds.length };
    }
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
    mentionedUserIds?: mongoose.Types.ObjectId[]; // Liste des utilisateurs mentionnés
  },
): Promise<INotification | null> {
  // ═══════════════════════════════════════════════════════════════════════════
  // VÉRIFICATION MUTE : Skip notification si conversation mutée (sauf mention)
  // ═══════════════════════════════════════════════════════════════════════════
  if (data?.conversationId && type === "message") {
    try {
      const ConversationModel = (await import("../models/conversations"))
        .default;
      const conversation = await ConversationModel.findById(
        data.conversationId,
      ).lean();

      if (conversation) {
        const now = new Date();
        const mutedInfo = conversation.mutedBy?.find(
          (m: any) => m.userId.toString() === userId.toString(),
        );

        // Vérifier si conversation mutée ET pas expirée
        const isMuted =
          mutedInfo && (!mutedInfo.mutedUntil || mutedInfo.mutedUntil > now);

        if (isMuted) {
          // Vérifier si l'utilisateur est mentionné
          const isMentioned = data.mentionedUserIds?.some(
            (id) => id.toString() === userId.toString(),
          );

          // Si muted ET (pas de mention OU pas de notification sur mention)
          if (!isMentioned || !mutedInfo.notifyOnMention) {
            notifLogger.debug("Notification skippée (conversation mutée)", {
              userId: userId.toString(),
              conversationId: data.conversationId.toString(),
              isMentioned,
              notifyOnMention: mutedInfo.notifyOnMention,
            });
            return null; // Skip notification
          }
        }

        // Auto-unmute si expiré
        if (mutedInfo && mutedInfo.mutedUntil && mutedInfo.mutedUntil <= now) {
          await ConversationModel.updateOne(
            { _id: data.conversationId },
            { $pull: { mutedBy: { userId: userId } } },
          );
          notifLogger.info("Conversation auto-unmuted (mute expiré)", {
            userId: userId.toString(),
            conversationId: data.conversationId.toString(),
          });
        }
      }
    } catch (err) {
      notifLogger.error("Erreur vérification mute conversation", {
        error: err instanceof Error ? err.message : String(err),
      });
      // En cas d'erreur, on continue et on envoie la notification quand même
    }
  }

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
