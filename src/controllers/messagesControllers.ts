import { Request, Response } from "express";
import Message, { IMessageReply } from "../models/messages";
import Conversation from "../models/conversations";
import { Types } from "mongoose";
import {
  encrypt as encryptCommunication,
  decrypt as decryptCommunication,
} from "../utils/communicationEncryptionUtils";
import { createNotification } from "../services/notificationService";
import { webSocketService } from "../services/webSocketService";
import { memoryStorage } from "../services/memoryStorageService";
import User from "../models/users";
import { logger } from "../services/loggerService";

const messagesLogger = logger.child({ service: "messages" });

/**
 * Fonction utilitaire pour obtenir le nom d'affichage d'un utilisateur
 * Respecte le paramètre showPseudo : si activé et pseudo défini, utilise le pseudo
 */
async function getDisplayName(userId: string): Promise<string> {
  const { decrypt } = await import("../utils/masterEncryptionUtils");
  const user = await User.findById(userId).select(
    "name surname pseudo showPseudo",
  );

  if (!user) return "Un utilisateur";

  // Si showPseudo est activé et pseudo existe, utiliser le pseudo
  if (user.showPseudo && user.pseudo) {
    try {
      return decrypt(user.pseudo);
    } catch (_e) {
      // Fallback sur le nom si erreur de déchiffrement du pseudo
    }
  }

  // Sinon, utiliser le nom complet
  try {
    const name = decrypt(user.name);
    const surname = decrypt(user.surname);
    return `${name} ${surname}`;
  } catch (_e) {
    return "Un utilisateur";
  }
}

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
    // Vérifier que l'utilisateur est bien dans la conversation
    const conversation = await Conversation.findById(conversationId);
    if (
      !conversation ||
      !conversation.participants.some(
        (p: any) => p.userId.toString() === userId,
      )
    ) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }
    // Chiffrer le contenu du message
    const encryptedContent = encryptCommunication(content);
    // Chiffrer les mentions si présentes
    let encryptedMetadata = undefined;
    if (metadata && metadata.mentions) {
      encryptedMetadata = {
        ...metadata,
        mentions: metadata.mentions.map((id: string) =>
          encryptCommunication(id),
        ),
      };
    } else if (metadata) {
      encryptedMetadata = metadata;
    }
    const message = await Message.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(userId),
      content: encryptedContent,
      type: type || "text",
      readBy: [userId],
      replies: [],
      metadata: encryptedMetadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Mettre à jour le lastMessage de la conversation
    conversation.lastMessage = message._id;
    conversation.updatedAt = new Date();
    await conversation.save();

    // ═══════════════════════════════════════════════════════════════════════════
    // MISE À JOUR DU CACHE MÉMOIRE
    // ═══════════════════════════════════════════════════════════════════════════
    // Mettre à jour le lastMessage dans le cache pour tous les participants
    const participantIds = conversation.participants.map((p: any) =>
      p.userId.toString(),
    );
    memoryStorage.updateConversationLastMessage(
      conversationId,
      message._id,
      participantIds,
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉACTIVATION DES CONVERSATIONS MASQUÉES
    // ═══════════════════════════════════════════════════════════════════════════
    // Si des participants ont "supprimé" (masqué) cette conversation,
    // on les réactive pour qu'ils voient le nouveau message
    const reactivatedUserIds: string[] = [];

    if (conversation.deletedBy && conversation.deletedBy.length > 0) {
      // Retirer tous les utilisateurs de deletedBy (sauf l'expéditeur s'il y était)
      const usersToReactivate = conversation.deletedBy.filter(
        (id: Types.ObjectId) => id.toString() !== userId,
      );

      if (usersToReactivate.length > 0) {
        await Conversation.updateOne(
          { _id: conversation._id },
          { $pull: { deletedBy: { $in: usersToReactivate } } },
        );

        // Préparer les données de conversation pour la notification WebSocket
        const conversationData = {
          _id: conversation._id,
          name: conversation.name,
          isGroup: conversation.isGroup,
          creatorId: conversation.creatorId,
          participants: conversation.participants,
          lastMessage: message._id,
          createdAt: conversation.createdAt,
          updatedAt: new Date(),
        };

        // Notifier les utilisateurs réactivés via WebSocket
        for (const reactivatedUserId of usersToReactivate) {
          const userIdStr = reactivatedUserId.toString();
          reactivatedUserIds.push(userIdStr);

          messagesLogger.info("Conversation reactivated", {
            conversationId: conversation._id.toString(),
            userId: userIdStr,
          });

          // Envoyer un événement new_conversation pour que la conv réapparaisse
          webSocketService.notifyNewConversation(
            [userIdStr],
            conversationData,
            "", // Pas de créateur à exclure, on veut notifier cet utilisateur
          );
        }
      }
    }

    // Créer des notifications pour les autres participants
    // Note: Les utilisateurs connectés au WebSocket de la conversation
    // recevront le message en temps réel via conversation_update
    const otherParticipants = conversation.participants.filter(
      (p: any) => p.userId.toString() !== userId,
    );

    const displayName = await getDisplayName(userId);

    // Déchiffrer le nom de la conversation pour les groupes
    let conversationName = "un groupe";
    if (conversation.isGroup && conversation.name) {
      try {
        conversationName = decryptCommunication(conversation.name);
      } catch (e) {
        messagesLogger.error("Decrypt conversation name error", {
          error: e instanceof Error ? e.message : String(e),
        });
        conversationName = "un groupe";
      }
    }

    // Créer une notification pour chaque participant (sauf l'expéditeur)
    // Note: Même si l'utilisateur est connecté à la conversation, on crée la notification
    // car la déconnexion WebSocket peut avoir un délai. La notification sera marquée comme lue
    // quand l'utilisateur ouvrira la conversation.
    for (const participant of otherParticipants) {
      await createNotification(
        participant.userId as Types.ObjectId,
        "message",
        conversation.isGroup
          ? `Nouveau message dans ${conversationName}`
          : "Nouveau message",
        `${displayName} vous a envoyé un message`,
        {
          conversationId: new Types.ObjectId(conversationId),
          messageId: message._id as Types.ObjectId,
          senderId: new Types.ObjectId(userId),
        },
      );
    }

    res.status(201).json({ messageId: message._id });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Erreur lors de l'envoi du message", details: err });
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
    const conversation = await Conversation.findById(conversationId);
    if (
      !conversation ||
      !conversation.participants.some(
        (p: any) => p.userId.toString() === userId,
      )
    ) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Paramètres de pagination
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50); // Max 50, défaut 20
    const offset = parseInt(req.query.offset as string) || 0;
    const beforeId = req.query.beforeId as string; // Pour charger les messages avant un certain ID

    // Construire la requête
    const query: any = { conversationId: new Types.ObjectId(conversationId) };

    // Si beforeId est fourni, on récupère les messages plus anciens que ce message
    if (beforeId) {
      const beforeMessage = await Message.findById(beforeId);
      if (beforeMessage) {
        query.createdAt = { $lt: beforeMessage.createdAt };
      }
    }

    // Compter le total de messages pour savoir s'il y en a plus
    const totalCount = await Message.countDocuments({
      conversationId: new Types.ObjectId(conversationId),
    }).maxTimeMS(5000);

    // Récupérer les messages (du plus récent au plus ancien)
    const messages = await Message.find(query)
      .sort({ createdAt: -1 }) // Du plus récent au plus ancien
      .skip(beforeId ? 0 : offset) // Si beforeId, pas de skip
      .limit(limit)
      .lean()
      .maxTimeMS(5000);

    // Inverser pour avoir l'ordre chronologique (du plus ancien au plus récent)
    const orderedMessages = messages.reverse();

    // Adapter la réponse pour les messages supprimés et déchiffrer
    const result = orderedMessages.map((msg) => {
      if (msg.metadata?.deleted) {
        return {
          _id: msg._id,
          createdAt: msg.createdAt,
          senderId: msg.senderId,
          deleted: true,
        };
      }
      return {
        ...msg,
        content: decryptCommunication(msg.content),
        replies:
          msg.replies?.map((r: IMessageReply) => ({
            ...r,
            content: decryptCommunication(r.content),
          })) || [],
        metadata: msg.metadata,
      };
    });

    // Calculer s'il y a plus de messages à charger
    const currentPosition = offset + messages.length;
    const hasMore = beforeId
      ? messages.length === limit // Si on utilise beforeId, hasMore = on a reçu le max demandé
      : currentPosition < totalCount;

    res.json({
      messages: result,
      pagination: {
        offset,
        limit,
        total: totalCount,
        hasMore,
        oldestMessageId: result.length > 0 ? result[0]._id : null,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Erreur lors de la récupération des messages",
      details: err,
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
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message non trouvé" });

    // Vérifier si le message n'est pas déjà lu par cet utilisateur
    const alreadyRead = message.readBy
      .map((id: string | Types.ObjectId) => id.toString())
      .includes(userId);

    if (!alreadyRead) {
      message.readBy.push(new Types.ObjectId(userId));
      message.updatedAt = new Date();
      await message.save();

      // Notifier les participants de la conversation que ce message a été lu
      const conversation = await Conversation.findById(message.conversationId);
      if (conversation) {
        const participantIds = conversation.participants.map((p: any) =>
          p.userId.toString(),
        );
        webSocketService.notifyMessagesRead(
          message.conversationId.toString(),
          userId,
          [messageId],
          participantIds,
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Erreur lors du marquage comme lu", details: err });
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
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message non trouvé" });
    // Chiffrer la réponse
    const encryptedContent = encryptCommunication(content);
    const reply: IMessageReply = {
      userId: new Types.ObjectId(userId),
      content: encryptedContent,
      createdAt: new Date(),
    };
    message.replies.push(reply);
    message.updatedAt = new Date();
    await message.save();
    res.status(201).json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Erreur lors de la réponse", details: err });
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
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message non trouvé" });
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({ error: "Non autorisé" });
    }
    message.content = encryptCommunication(content);
    message.metadata = { ...message.metadata, edited: true };
    message.updatedAt = new Date();
    await message.save();
    res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Erreur lors de la modification", details: err });
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
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message non trouvé" });
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({ error: "Non autorisé" });
    }
    message.metadata = { ...message.metadata, deleted: true };
    message.updatedAt = new Date();
    await message.save();
    res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Erreur lors de la suppression", details: err });
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
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
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
    }

    res.json({ success: true, markedAsRead: result.modifiedCount });
  } catch (err) {
    messagesLogger.error("Mark messages as read batch error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return res
      .status(500)
      .json({ error: "Erreur lors du marquage comme lu", details: err });
  }
}
