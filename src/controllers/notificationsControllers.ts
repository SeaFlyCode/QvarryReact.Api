import { Request, Response } from "express";
import NotificationModel from "../models/notifications";
import mongoose from "mongoose";
import { createNotification } from "../services/notificationService";

/**
 * Récupère toutes les notifications de l'utilisateur connecté
 */
export const getNotifications = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Non authentifié" });
        }

        const limit = parseInt(req.query.limit as string) || 15;
        const offset = parseInt(req.query.offset as string) || 0;

        // Supprimer les notifications expirées
        await NotificationModel.deleteMany({
            userId: new mongoose.Types.ObjectId(userId),
            expiresAt: { $lt: new Date() }
        });

        const [notifications, total, unreadCount] = await Promise.all([
            NotificationModel.find({ userId: new mongoose.Types.ObjectId(userId) })
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(offset)
                .populate('senderId', 'name surname')
                .lean(),
            NotificationModel.countDocuments({ userId: new mongoose.Types.ObjectId(userId) }),
            NotificationModel.countDocuments({
                userId: new mongoose.Types.ObjectId(userId),
                read: false
            })
        ]);

        res.json({
            notifications,
            total,
            unreadCount
        });
    } catch (error) {
        console.error("[getNotifications] Erreur:", error);
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
            read: false
        });

        res.json({ unreadCount });
    } catch (error) {
        console.error("[getUnreadCount] Erreur:", error);
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
                userId: new mongoose.Types.ObjectId(userId)
            },
            {
                read: true,
                readAt: new Date()
            },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: "Notification non trouvée" });
        }

        res.json({ message: "Notification marquée comme lue" });
    } catch (error) {
        console.error("[markAsRead] Erreur:", error);
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
                read: false
            },
            {
                read: true,
                readAt: new Date()
            }
        );

        res.json({ message: "Toutes les notifications ont été marquées comme lues" });
    } catch (error) {
        console.error("[markAllAsRead] Erreur:", error);
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

        const notification = await NotificationModel.findOneAndDelete({
            _id: new mongoose.Types.ObjectId(notificationId),
            userId: new mongoose.Types.ObjectId(userId)
        });

        if (!notification) {
            return res.status(404).json({ message: "Notification non trouvée" });
        }

        res.json({ message: "Notification supprimée" });
    } catch (error) {
        console.error("[deleteNotification] Erreur:", error);
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

        await NotificationModel.deleteMany({
            userId: new mongoose.Types.ObjectId(userId),
            read: true
        });

        res.json({ message: "Toutes les notifications lues ont été supprimées" });
    } catch (error) {
        console.error("[deleteAllRead] Erreur:", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};

/**
 * Créer une notification (fonction utilitaire)
 */
export const createNotificationUtil = async (
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: {
        contactId?: string;
        conversationId?: string;
        messageId?: string;
        shareId?: string;
        senderId?: string;
    }
) => {
    try {
        const notification = new NotificationModel({
            userId: new mongoose.Types.ObjectId(userId),
            type,
            title,
            message,
            contactId: data?.contactId ? new mongoose.Types.ObjectId(data.contactId) : undefined,
            conversationId: data?.conversationId ? new mongoose.Types.ObjectId(data.conversationId) : undefined,
            messageId: data?.messageId ? new mongoose.Types.ObjectId(data.messageId) : undefined,
            shareId: data?.shareId ? new mongoose.Types.ObjectId(data.shareId) : undefined,
            senderId: data?.senderId ? new mongoose.Types.ObjectId(data.senderId) : undefined,
        });

        await notification.save();
        return notification;
    } catch (error) {
        console.error("[createNotification] Erreur:", error);
        throw error;
    }
};

/**
 * Créer une notification de test (pour le développement)
 * ⚠️ À SUPPRIMER EN PRODUCTION
 */
export const createTestNotification = async (req: Request, res: Response) => {
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
            message || "Ceci est une notification de test pour vérifier le système WebSocket"
        );

        res.json({
            success: true,
            message: "Notification de test créée",
            notification
        });
    } catch (error) {
        console.error("[createTestNotification] Erreur:", error);
        res.status(500).json({ message: "Erreur serveur" });
    }
};
