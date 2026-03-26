import { Request, Response } from "express";
import Conversation from "../models/conversations";
import { webSocketService } from "../services/webSocketService";
import { logger } from "../services/loggerService";
import {
  createMessageOp,
  getMessagesOp,
  markMessageAsReadOp,
  replyToMessageOp,
  editMessageOp,
  deleteMessageOp,
} from "../services/messageOperationsService";
import Message from "../models/messages";
import { Types } from "mongoose";

const messagesLogger = logger.child({ service: "messages" });

// Envoyer un message
export async function sendMessage(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { conversationId, content, type, metadata } = req.body;
    if (!conversationId || !content) {
      return res
        .status(400)
        .json({ error: "conversationId et content requis" });
    }

    const result = await createMessageOp(
      userId,
      conversationId,
      content,
      type,
      metadata,
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉACTIVATION DES CONVERSATIONS MASQUÉES — Notifier via WebSocket
    // ═══════════════════════════════════════════════════════════════════════════
    for (const reactivatedUserId of result.reactivatedUserIds) {
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        messagesLogger.info("Conversation reactivated", {
          conversationId,
          userId: reactivatedUserId,
        });
        webSocketService.notifyNewConversation(
          [reactivatedUserId],
          {
            _id: conversation._id,
            name: conversation.name,
            isGroup: conversation.isGroup,
            creatorId: conversation.creatorId,
            participants: conversation.participants,
            lastMessage: conversation.lastMessage,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          },
          "", // Pas de créateur à exclure, on veut notifier cet utilisateur
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BROADCAST WEBSOCKET — ENVOI DEPUIS API REST (ex : app mobile)
    // ═══════════════════════════════════════════════════════════════════════════
    // Notifie en temps réel tous les clients WS connectés à cette conversation
    // (IHM web) afin qu'ils affichent le nouveau message sans rechargement.
    // L'expéditeur est exclu du broadcast WS (il reçoit le message complet
    // directement dans la réponse REST ci-dessous).
    try {
      webSocketService.broadcastNewMessage(
        conversationId,
        result.message,
        userId,
      );
    } catch (wsError) {
      // Non bloquant : le broadcast WS ne doit pas faire échouer l'envoi du message
      messagesLogger.warn(
        "Broadcast WS après envoi REST échoué (non-bloquant)",
        {
          error: wsError instanceof Error ? wsError.message : String(wsError),
          conversationId,
          messageId: result.messageId,
        },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉPONSE COMPLÈTE — permet au frontend mobile d'afficher le message
    // immédiatement sans faire de GET /api/messages/:conversationId
    // ═══════════════════════════════════════════════════════════════════════════
    messagesLogger.info("Message envoyé avec succès", {
      userId,
      conversationId,
      messageId: result.messageId,
      action: "send_message",
      type: type || "text",
      reactivated: result.reactivatedUserIds.length > 0,
    });

    res.status(201).json({
      messageId: result.messageId,
      message: result.message,
    });
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    messagesLogger.error("Erreur envoi message", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors de l'envoi du message" });
  }
}

// Lister les messages d'une conversation avec pagination (20 messages par page)
export async function getMessages(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { conversationId } = req.params;
    if (!conversationId)
      return res.status(400).json({ error: "conversationId requis" });

    const result = await getMessagesOp(userId, conversationId, {
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
      beforeId: req.query.beforeId as string | undefined,
    });

    messagesLogger.debug("Messages récupérés avec succès", {
      userId,
      conversationId,
      count: result.messages?.length || 0,
      action: "read_messages",
    });

    res.json(result);
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    messagesLogger.error("Erreur récupération messages", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      error: "Erreur lors de la récupération des messages",
    });
  }
}

// Marquer un message comme lu
export async function markMessageAsRead(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { messageId } = req.params;
    if (!messageId) return res.status(400).json({ error: "messageId requis" });

    const result = await markMessageAsReadOp(userId, messageId);

    if (!result.alreadyRead) {
      // Notifier les participants de la conversation que ce message a été lu
      // Note: conversationId est récupéré depuis le message dans le service
      const msg = (await Message.findById(messageId).lean()) as any;
      if (msg) {
        webSocketService.notifyMessagesRead(
          msg.conversationId.toString(),
          userId,
          [messageId],
          result.participantIds,
        );
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    if (err.statusCode === 403)
      return res
        .status(403)
        .json({ error: "Accès non autorisé à cette conversation" });
    messagesLogger.error("Erreur marquage message comme lu", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors du marquage comme lu" });
  }
}

// Répondre à un message (thread)
export async function replyToMessage(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { messageId } = req.params;
    const { content } = req.body;
    if (!messageId || !content)
      return res.status(400).json({ error: "messageId et content requis" });

    await replyToMessageOp(userId, messageId, content);
    res.status(201).json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    if (err.statusCode === 403)
      return res
        .status(403)
        .json({ error: "Accès non autorisé à cette conversation" });
    messagesLogger.error("Erreur réponse message", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors de la réponse" });
  }
}

// Modifier un message
export async function editMessage(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { messageId } = req.params;
    const { content } = req.body;
    if (!messageId || !content)
      return res.status(400).json({ error: "messageId et content requis" });

    await editMessageOp(userId, messageId, content);
    res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    if (err.statusCode === 403)
      return res.status(403).json({ error: "Non autorisé" });
    messagesLogger.error("Erreur modification message", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors de la modification" });
  }
}

// Supprimer un message
export async function deleteMessage(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { messageId } = req.params;

    await deleteMessageOp(userId, messageId);
    res.json({ success: true });
  } catch (err: any) {
    if (err.statusCode === 404)
      return res.status(404).json({ error: err.message });
    if (err.statusCode === 403)
      return res.status(403).json({ error: "Non autorisé" });
    messagesLogger.error("Erreur suppression message", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors de la suppression" });
  }
}

// Marquer plusieurs messages comme lus en une seule requête (batch)
export async function markMessagesAsRead(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });

    const { messageIds, conversationId } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: "messageIds requis (tableau)" });
    }
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId requis" });
    }

    // SEC-AUDIT: Vérification d'appartenance à la conversation AVANT l'opération d'écriture
    const conversation = await Conversation.findOne({
      _id: conversationId,
      "participants.userId": userId,
    });
    if (!conversation) {
      return res
        .status(403)
        .json({ error: "Accès non autorisé à cette conversation" });
    }

    const userObjectId = new Types.ObjectId(userId);

    // Marquer tous les messages comme lus en une seule opération
    const result = await Message.updateMany(
      {
        _id: { $in: messageIds.map((id: string) => new Types.ObjectId(id)) },
        conversationId: new Types.ObjectId(conversationId),
        readBy: { $ne: userObjectId },
      },
      {
        $addToSet: { readBy: userObjectId },
        $set: { updatedAt: new Date() },
      },
    );

    // Marquer aussi les notifications de ces messages comme lues
    const NotificationModel = (await import("../models/notifications")).default;
    const notifResult = await NotificationModel.updateMany(
      {
        userId: userObjectId,
        type: "message",
        messageId: {
          $in: messageIds.map((id: string) => new Types.ObjectId(id)),
        },
        read: false,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
    );

    if (notifResult.modifiedCount > 0) {
      messagesLogger.info("Notifications marked as read", {
        count: notifResult.modifiedCount,
      });
    }

    // Si des messages ont été marqués comme lus, notifier les participants
    if (result.modifiedCount > 0) {
      const participantIds = conversation.participants.map((p: any) =>
        p.userId.toString(),
      );
      webSocketService.notifyMessagesRead(
        conversationId,
        userId,
        messageIds,
        participantIds,
      );
      messagesLogger.info("Messages marked as read", {
        count: result.modifiedCount,
        userId,
      });
    }

    res.json({ success: true, markedAsRead: result.modifiedCount });
  } catch (err) {
    messagesLogger.error("Mark messages as read batch error", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors du marquage comme lu" });
  }
}
