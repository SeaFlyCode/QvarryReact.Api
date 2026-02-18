import { Request, Response } from "express";
import Conversation, { IConversation } from "../models/conversations";
import Message from "../models/messages";
import mongoose, { Types } from "mongoose";
import {
  memoryStorage,
  MemoryStorageService,
} from "../services/memoryStorageService";
import {
  encrypt as encryptCommunication,
  decrypt as decryptCommunication,
} from "../utils/communicationEncryptionUtils";
import { createNotification } from "../services/notificationService";
import { webSocketService } from "../services/webSocketService";
import User from "../models/users";
import dataArchiveService from "../services/dataArchiveService";

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
    } catch (e) {
      // Fallback sur le nom si erreur de déchiffrement du pseudo
    }
  }

  // Sinon, utiliser le nom complet
  try {
    const name = decrypt(user.name);
    const surname = decrypt(user.surname);
    return `${name} ${surname}`;
  } catch (e) {
    return "Un utilisateur";
  }
}

// POST /conversations/private - Créer une conversation privée (automatique au 1er message)
export async function createPrivateConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }
    const { participantId, name } = req.body;
    if (!participantId) {
      return res.status(400).json({ error: "Participant id requis" });
    }
    const userObjectId = new Types.ObjectId(userId);
    const participantObjectId = new Types.ObjectId(participantId);
    // Vérification du lien de contact (status 'accepted') dans les deux sens
    const Contact = require("../models/contacts").default;
    const contact = await Contact.findOne({
      $or: [
        {
          userId: userObjectId,
          contactId: participantObjectId,
          status: "accepted",
          isBlocked: false,
        },
        {
          userId: participantObjectId,
          contactId: userObjectId,
          status: "accepted",
          isBlocked: false,
        },
      ],
    });
    if (!contact) {
      return res.status(403).json({
        error:
          "Vous devez être contacts pour démarrer une conversation privée.",
      });
    }
    // Vérifier si une conversation privée existe déjà entre les deux utilisateurs
    let conversation = await Conversation.findOne({
      isGroup: false,
      participants: {
        $all: [
          { $elemMatch: { userId: userObjectId } },
          { $elemMatch: { userId: participantObjectId } },
        ],
        $size: 2,
      },
    });
    if (conversation) {
      // Vérifier si le créateur a masqué cette conversation
      const wasDeletedByUser = conversation.deletedBy?.some(
        (id: Types.ObjectId) => id.toString() === userId,
      );

      if (wasDeletedByUser) {
        // Réactiver la conversation pour le créateur
        await Conversation.updateOne(
          { _id: conversation._id },
          { $pull: { deletedBy: userObjectId } },
        );

        console.log(
          `🔄 [CONVERSATIONS] Réactivation de la conversation ${conversation._id} pour l'utilisateur ${userId}`,
        );

        // Recharger la conversation mise à jour
        conversation = await Conversation.findById(conversation._id);

        // Stocker en mémoire
        const conversationToStore = {
          _id: conversation!._id,
          name: conversation!.name ?? null,
          isGroup: conversation!.isGroup,
          creatorId: conversation!.creatorId ?? null,
          participants: conversation!.participants,
          lastMessage: conversation!.lastMessage ?? null,
          deletedBy: conversation!.deletedBy ?? [],
          createdAt: conversation!.createdAt,
          updatedAt: conversation!.updatedAt,
        };
        memoryStorage.storeConversation(
          userId,
          conversationToStore as IConversation,
        );

        return res.status(200).json({
          conversationId: conversation!._id.toString(),
          existing: true,
          reactivated: true,
          message: "Conversation réactivée",
        });
      }

      // Retourner la conversation existante avec un code 200 au lieu d'une erreur
      return res.status(200).json({
        conversationId: conversation._id.toString(),
        existing: true,
        message: "Conversation existante",
      });
    }
    // Chiffrer le nom de la conversation si fourni
    let encryptedName = null;
    if (name) {
      encryptedName = await encryptCommunication(name);
    }
    conversation = await Conversation.create({
      name: encryptedName,
      isGroup: false,
      creatorId: userObjectId,
      participants: [
        {
          userId: userObjectId,
          role: "member",
          joinedAt: new Date(),
          leftAt: null,
        },
        {
          userId: participantObjectId,
          role: "member",
          joinedAt: new Date(),
          leftAt: null,
        },
      ],
      lastMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const conversationToStore = {
      _id: conversation._id,
      name: conversation.name ?? null,
      isGroup: conversation.isGroup,
      creatorId: conversation.creatorId ?? null,
      participants: conversation.participants,
      lastMessage: conversation.lastMessage ?? null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
    memoryStorage.storeConversation(
      userId,
      conversationToStore as IConversation,
    );
    memoryStorage.storeConversation(
      participantId,
      conversationToStore as IConversation,
    );

    // Notifier l'autre participant via WebSocket
    webSocketService.notifyNewConversation(
      [userId, participantId],
      conversationToStore,
      userId,
    );

    res.status(201).json({ conversationId: conversation._id });
  } catch (err) {
    res.status(500).json({
      error: "Erreur lors de la création de la conversation privée",
      details: err,
    });
  }
}

// POST /conversations/group - Créer un groupe
export async function createGroupConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }
    const { name, participantIds } = req.body;
    if (
      !name ||
      !participantIds ||
      !Array.isArray(participantIds) ||
      participantIds.length === 0
    ) {
      return res.status(400).json({ error: "Nom et participantIds requis" });
    }
    // Chiffrer le nom du groupe avec communicationEncryption
    const encryptedName = encryptCommunication(name);
    // Construire la liste des participants (le créateur est admin)
    const allParticipantIds = [
      userId,
      ...participantIds.filter((id: string) => id !== userId),
    ];
    const now = new Date();
    const participants = allParticipantIds.map((id: string) => ({
      userId: new Types.ObjectId(id),
      role: id === userId ? "admin" : "member",
      joinedAt: now,
      leftAt: null,
    }));
    // Créer la conversation groupe
    const conversation = await Conversation.create({
      name: encryptedName,
      isGroup: true,
      creatorId: new Types.ObjectId(userId),
      participants,
      lastMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    // Données de la conversation à stocker et notifier
    const conversationToStore = {
      _id: conversation._id,
      name: conversation.name,
      isGroup: conversation.isGroup,
      creatorId: conversation.creatorId,
      participants: conversation.participants,
      lastMessage: conversation.lastMessage,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    } as IConversation;

    // Stocker en mémoire pour tous les participants
    allParticipantIds.forEach((id: string) => {
      memoryStorage.storeConversation(id, conversationToStore);
    });

    // Notifier tous les participants via WebSocket (sauf le créateur)
    webSocketService.notifyNewConversation(
      allParticipantIds,
      conversationToStore,
      userId,
    );

    // Créer des notifications pour les participants (sauf le créateur)
    const displayName = await getDisplayName(userId);

    for (const participantId of participantIds) {
      if (participantId !== userId) {
        await createNotification(
          new Types.ObjectId(participantId),
          "group_invite",
          "Invitation à un groupe",
          `${displayName} vous a ajouté au groupe "${name}"`,
          {
            conversationId: conversation._id as Types.ObjectId,
            senderId: new Types.ObjectId(userId),
          },
        );
      }
    }

    res.status(201).json({ conversationId: conversation._id });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors de la création du groupe", details: err });
  }
}

// GET /conversations - Lister toutes les conversations de l'utilisateur
export async function listConversations(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const userObjectId = new Types.ObjectId(userId);

    let conversations = memoryStorage.getAllConversations(userId);
    if (!conversations || conversations.length === 0) {
      // Filtrer les conversations où l'utilisateur n'a pas fait de soft delete
      const dbConversations = await Conversation.find({
        "participants.userId": userObjectId,
        deletedBy: { $ne: userObjectId }, // Exclure les conversations supprimées par l'utilisateur
      })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();
      dbConversations.forEach((conv: any) => {
        const conversationToStore = {
          _id: conv._id,
          name: conv.name ?? null,
          isGroup: conv.isGroup,
          creatorId: conv.creatorId ?? null,
          participants: conv.participants,
          lastMessage: conv.lastMessage ?? null,
          deletedBy: conv.deletedBy ?? [],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        };
        memoryStorage.storeConversation(
          userId!,
          conversationToStore as import("../models/conversations").IConversation,
        );
      });
      conversations = dbConversations.map(
        (conv: any) =>
          ({
            _id: conv._id,
            name: conv.name ?? null,
            isGroup: conv.isGroup,
            creatorId: conv.creatorId ?? null,
            participants: conv.participants,
            lastMessage: conv.lastMessage ?? null,
            deletedBy: conv.deletedBy ?? [],
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          }) as import("../models/conversations").IConversation,
      );
    } else {
      // Filtrer les conversations en mémoire également
      conversations = conversations.filter(
        (conv: any) =>
          !conv.deletedBy?.some((id: any) => id.toString() === userId),
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGRÉGATION UNIQUE : Récupérer le dernier message et le nombre de non-lus
    // pour TOUTES les conversations en une seule requête (fix N+1)
    // ═══════════════════════════════════════════════════════════════════════════
    const conversationIds = conversations.map(
      (c: any) => new mongoose.Types.ObjectId(c._id.toString()),
    );

    const lastMessagesAgg = await Message.aggregate([
      { $match: { conversationId: { $in: conversationIds } } },
      { $sort: { createdAt: -1 as const } },
      {
        $group: {
          _id: "$conversationId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [{ $not: { $in: [userObjectId, "$readBy"] } }, 1, 0],
            },
          },
        },
      },
    ]).option({ maxTimeMS: 5000 });

    const messageMap = new Map(
      lastMessagesAgg.map((m: any) => [m._id.toString(), m]),
    );

    const result = await Promise.all(
      conversations.map(
        async (conv: import("../models/conversations").IConversation) => {
          let lastMessageContent = null;
          let decryptedName = null;

          if (conv.name) {
            try {
              decryptedName = await decryptCommunication(conv.name);
            } catch (e) {
              decryptedName = null;
            }
          }

          // Récupérer le dernier message et unreadCount depuis l'agrégation
          const aggData = messageMap.get(conv._id.toString());
          const lastMsg = aggData?.lastMessage || null;
          const unreadCount = aggData?.unreadCount || 0;

          if (lastMsg && lastMsg.content) {
            try {
              // Déchiffrer le contenu du message
              const decryptedContent = await decryptCommunication(
                lastMsg.content as string,
              );

              // Format simplifié : "Vous : msg" si c'est moi, sinon juste "msg"
              const senderId = lastMsg.senderId?.toString();

              if (senderId === userId) {
                lastMessageContent = `Vous : ${decryptedContent}`;
              } else {
                lastMessageContent = decryptedContent;
              }
            } catch (e) {
              console.error(
                `[CONVERSATIONS] Erreur lors du déchiffrement du dernier message:`,
                e,
              );
              lastMessageContent = null;
            }
          }

          return {
            _id: conv._id,
            name: decryptedName,
            isGroup: conv.isGroup,
            participants: conv.participants,
            creatorId: conv.creatorId,
            lastMessage: lastMessageContent, // ✅ Toujours à jour depuis la BDD (agrégation unique)
            unreadCount,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          };
        },
      ),
    );
    res.json({ conversations: result });
  } catch (err) {
    res.status(500).json({
      error: "Erreur lors de la récupération des conversations",
      details: err,
    });
  }
}

// GET /conversations/:id - Détails d'une conversation (déchiffrer le nom si groupe)
export async function getConversationDetails(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }
    const conversation = await Conversation.findById(id).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }
    // Vérification de l'appartenance de l'utilisateur à la conversation
    const isParticipant = conversation.participants.some(
      (p: any) => p.userId.toString() === userId,
    );
    if (!isParticipant) {
      // Pour éviter de donner trop d'information, retourner 404 si l'utilisateur n'est pas membre
      return res.status(404).json({ error: "Conversation non trouvée" });
    }
    let name = conversation.name;
    if (conversation.isGroup && name) {
      try {
        name = decryptCommunication(name);
      } catch {
        name = null;
      }
    }
    res.json({
      _id: conversation._id,
      name,
      isGroup: conversation.isGroup,
      participants: conversation.participants.map((p: any) => ({
        userId: p.userId,
        role: p.role,
      })),
      createdAt: conversation.createdAt,
    });
  } catch (err) {
    res.status(500).json({
      error: "Erreur lors de la récupération des détails",
      details: err,
    });
  }
}

// POST /conversations/:id/members - Ajouter un ou plusieurs membres à un groupe (admin seulement)
export async function addGroupMembers(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { id } = req.params;
    const { userIds } = req.body;
    if (!id || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res
        .status(400)
        .json({ error: "ID de conversation et userIds requis" });
    }
    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }
    // Vérifier que l'utilisateur est admin
    const me = conversation.participants.find(
      (p: any) => p.userId.toString() === userId,
    );
    if (!me || me.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul un admin peut ajouter des membres" });
    }
    // Ajouter les nouveaux membres
    const now = new Date();
    let added = false;
    userIds.forEach((uid: string) => {
      if (
        !conversation.participants.some((p: any) => p.userId.toString() === uid)
      ) {
        conversation.participants.push({
          userId: new Types.ObjectId(uid),
          role: "member",
          joinedAt: now,
          leftAt: null,
        });
        added = true;
      }
    });
    if (!added)
      return res.status(400).json({ error: "Aucun nouveau membre à ajouter" });
    conversation.updatedAt = now;
    await conversation.save();
    // Synchronisation mémoire pour tous les membres
    await updateMemoryForAllParticipants(
      conversation.participants.map((p: any) => p.userId.toString()),
      conversation as IConversation,
      memoryStorage,
    );
    res.json({ success: true, conversation: conversation.toObject() });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors de l'ajout de membres", details: err });
  }
}

// DELETE /conversations/:id/members/:userId - Supprimer un membre d'un groupe (admin seulement)
export async function removeGroupMember(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { id, userId: memberId } = req.params;
    if (!id || !memberId)
      return res
        .status(400)
        .json({ error: "ID de conversation et userId requis" });
    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }
    // Vérifier que l'utilisateur est admin
    const me = conversation.participants.find(
      (p: any) => p.userId.toString() === userId,
    );
    if (!me || me.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul un admin peut retirer des membres" });
    }
    // Ne pas retirer le dernier admin
    if (
      memberId === userId &&
      conversation.participants.filter((p: any) => p.role === "admin")
        .length === 1
    ) {
      return res
        .status(400)
        .json({ error: "Impossible de retirer le dernier admin" });
    }
    const idx = conversation.participants.findIndex(
      (p: any) => p.userId.toString() === memberId,
    );
    if (idx === -1) return res.status(404).json({ error: "Membre non trouvé" });
    conversation.participants.splice(idx, 1);
    conversation.updatedAt = new Date();
    await conversation.save();

    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATION AU MEMBRE RETIRÉ
    // ═══════════════════════════════════════════════════════════════════════════
    // Notifier le membre retiré pour que le groupe disparaisse de son écran
    webSocketService.notifyMemberRemoved(id, memberId);

    // Synchronisation mémoire pour tous les membres restants
    await updateMemoryForAllParticipants(
      conversation.participants.map((p: any) => p.userId.toString()),
      conversation as IConversation,
      memoryStorage,
    );
    // Nettoyer la mémoire du membre retiré
    const session = memoryStorage.getSession(memberId);
    if (session && session.conversations) {
      session.conversations.delete(id);
    }

    console.log(
      `👋 [GROUPE] Membre ${memberId} retiré du groupe ${id} par ${userId}`,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: "Erreur lors de la suppression du membre",
      details: err instanceof Error ? err.message : err,
    });
  }
}

// DELETE /conversations/:id/leave - Quitter un groupe (membre)
export async function leaveGroup(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { id } = req.params;
    if (!id)
      return res.status(400).json({ error: "ID de conversation requis" });
    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }
    const idx = conversation.participants.findIndex(
      (p: any) => p.userId.toString() === userId,
    );
    if (idx === -1)
      return res
        .status(404)
        .json({ error: "Vous n'êtes pas membre de ce groupe" });
    // Ne pas laisser le dernier admin quitter
    if (
      conversation.participants[idx].role === "admin" &&
      conversation.participants.filter((p: any) => p.role === "admin")
        .length === 1
    ) {
      return res
        .status(400)
        .json({ error: "Impossible de quitter, vous êtes le dernier admin" });
    }
    conversation.participants.splice(idx, 1);
    conversation.updatedAt = new Date();
    await conversation.save();

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉVOCATION TEMPS RÉEL: Fermer les connexions WebSocket du membre qui quitte
    // ═══════════════════════════════════════════════════════════════════════════
    webSocketService.notifyMemberRemoved(id, userId);

    // Synchronisation mémoire pour tous les membres restants
    await updateMemoryForAllParticipants(
      conversation.participants.map((p: any) => p.userId.toString()),
      conversation as IConversation,
      memoryStorage,
    );
    // Nettoyer la mémoire du membre retiré
    memoryStorage.getSession(userId)?.conversations.delete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors du quit", details: err });
  }
}

// DELETE /conversations/:id/group - Supprimer un groupe (admin seulement)
export async function deleteGroup(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });

    const { id } = req.params;
    if (!id)
      return res.status(400).json({ error: "ID de conversation requis" });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }

    // Vérifier que l'utilisateur est admin du groupe
    const me = conversation.participants.find(
      (p: any) => p.userId.toString() === userId,
    );
    if (!me || me.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul un admin peut supprimer le groupe" });
    }

    // Récupérer tous les participants avant suppression pour nettoyer leurs mémoires
    const participantIds = conversation.participants.map((p: any) =>
      p.userId.toString(),
    );

    // Archiver la conversation avant suppression (données chiffrées)
    await dataArchiveService.archiveAndRecordDeletion(
      "conversation",
      id,
      conversation.toObject() as unknown as Record<string, unknown>,
      userId,
      { reason: "Groupe supprimé par admin" },
    );

    // Archiver tous les messages avant suppression (données chiffrées)
    const messagesToArchive = await Message.find({
      conversationId: new Types.ObjectId(id),
    }).lean();
    for (const msg of messagesToArchive) {
      await dataArchiveService.archiveEntity(
        "message",
        msg._id as Types.ObjectId,
        msg as Record<string, unknown>,
        userId,
        {
          reason: "Message supprimé avec le groupe",
          parentEntityType: "conversation",
          parentEntityId: new Types.ObjectId(id),
        },
      );
    }

    // Supprimer tous les messages du groupe
    const deletedMessages = await Message.deleteMany({
      conversationId: new Types.ObjectId(id),
    });

    // Supprimer le groupe
    await Conversation.deleteOne({ _id: new Types.ObjectId(id) });

    // Nettoyer la mémoire de tous les participants
    for (const participantId of participantIds) {
      try {
        const session = memoryStorage.getSession(participantId);
        if (session && session.conversations) {
          session.conversations.delete(id);
        }
      } catch (err) {
        console.error(`Erreur nettoyage mémoire pour ${participantId}:`, err);
      }
    }

    // Notifier tous les participants que le groupe a été supprimé
    webSocketService.notifyGroupDeleted(id, participantIds, userId);

    console.log(
      `🗑️ [GROUPE] Groupe ${id} supprimé par ${userId} (${deletedMessages.deletedCount} messages supprimés)`,
    );

    res.json({
      success: true,
      message: "Groupe supprimé",
      deletedMessages: deletedMessages.deletedCount,
    });
  } catch (err) {
    console.error("[GROUPE] Erreur lors de la suppression:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression du groupe", details: err });
  }
}

// PATCH /conversations/:id/name - Modifier le nom d'un groupe (admin seulement)
export async function updateGroupName(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { id } = req.params;
    const { name } = req.body;
    if (!id || !name)
      return res.status(400).json({ error: "ID et nom requis" });
    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }
    // Vérifier que l'utilisateur est admin
    const me = conversation.participants.find(
      (p: any) => p.userId.toString() === userId,
    );
    if (!me || me.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul un admin peut modifier le nom" });
    }
    conversation.name = encryptCommunication(name);
    conversation.updatedAt = new Date();
    await conversation.save();

    // ═══════════════════════════════════════════════════════════════════════════
    // NOTIFICATION TEMPS RÉEL DU CHANGEMENT DE NOM
    // ═══════════════════════════════════════════════════════════════════════════
    const participantIds = conversation.participants.map((p: any) =>
      p.userId.toString(),
    );
    webSocketService.notifyGroupNameChanged(id, name, participantIds);

    // Synchronisation mémoire pour tous les membres
    await updateMemoryForAllParticipants(
      participantIds,
      conversation as IConversation,
      memoryStorage,
    );

    console.log(
      `✏️ [GROUPE] Nom du groupe ${id} modifié en "${name}" par ${userId}`,
    );
    res.json({ success: true, conversation: conversation.toObject() });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors du changement de nom", details: err });
  }
}

// PATCH /conversations/:id/role - Changer le rôle d'un membre (admin seulement)
export async function updateGroupMemberRole(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId)
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    const { id } = req.params;
    const { userId: memberId, role } = req.body;
    if (!id || !memberId || !role)
      return res.status(400).json({ error: "ID, userId et role requis" });
    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ error: "Groupe non trouvé" });
    }
    // Vérifier que l'utilisateur est admin
    const me = conversation.participants.find(
      (p: any) => p.userId.toString() === userId,
    );
    if (!me || me.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Seul un admin peut changer les rôles" });
    }
    const member = conversation.participants.find(
      (p: any) => p.userId.toString() === memberId,
    );
    if (!member) return res.status(404).json({ error: "Membre non trouvé" });
    member.role = role;
    conversation.updatedAt = new Date();
    await conversation.save();
    // Synchronisation mémoire pour tous les membres
    await updateMemoryForAllParticipants(
      conversation.participants.map((p: any) => p.userId.toString()),
      conversation as IConversation,
      memoryStorage,
    );
    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors du changement de rôle", details: err });
  }
}

/**
 * Met à jour la mémoire pour tous les participants connectés (sessions en ligne uniquement)
 * @param participantIds Liste des IDs des participants
 * @param conversation   Conversation à stocker
 * @param memoryStorage  Instance du service de mémoire
 */
async function updateMemoryForAllParticipants(
  participantIds: string[],
  conversation: IConversation,
  memoryStorage: MemoryStorageService,
) {
  for (const participantId of participantIds) {
    try {
      // Vérifie si la session existe avant de stocker
      const session = memoryStorage.getSession(participantId);
      if (session) {
        await memoryStorage.storeConversation(participantId, conversation);
      } else {
        // Log si la session n'existe pas, mais ne lève pas d'erreur
        console.log(
          `\u26A0\uFE0F [MemoryStorage] Pas de session en ligne pour l'utilisateur ${participantId}, la mémoire sera mise à jour à la prochaine connexion.`,
        );
      }
    } catch (err) {
      // Log l'erreur mais ne bloque pas le processus
      console.error(
        `\u274C Erreur lors de la mise à jour mémoire pour l'utilisateur ${participantId}:`,
        err,
      );
    }
  }
}

// PATCH /conversations/:id/read - Marquer tous les messages d'une conversation comme lus
export async function markConversationAsRead(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    const userObjectId = new Types.ObjectId(userId);
    const conversationId = new Types.ObjectId(id);

    // Vérifier que l'utilisateur est participant de la conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    const isParticipant = conversation.participants.some(
      (p: any) => p.userId.toString() === userId,
    );
    if (!isParticipant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Récupérer les IDs des messages non lus AVANT de les marquer comme lus
    const unreadMessages = (await Message.find({
      conversationId: conversationId,
      readBy: { $ne: userObjectId },
    })
      .select("_id")
      .lean()) as { _id: Types.ObjectId }[];

    const unreadMessageIds = unreadMessages.map((m) => m._id.toString());

    // Marquer tous les messages non lus de cette conversation comme lus
    const result = await Message.updateMany(
      {
        conversationId: conversationId,
        readBy: { $ne: userObjectId },
      },
      {
        $addToSet: { readBy: userObjectId },
        $set: { updatedAt: new Date() },
      },
    );

    // Marquer aussi les notifications de message de cette conversation comme lues
    const NotificationModel = (await import("../models/notifications")).default;
    const notifResult = await NotificationModel.updateMany(
      {
        userId: userObjectId,
        type: "message",
        conversationId: conversationId,
        read: false,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
    );

    console.log(
      `✅ [CONVERSATIONS] ${result.modifiedCount} messages et ${notifResult.modifiedCount} notifications marqués comme lus pour l'utilisateur ${userId} dans la conversation ${id}`,
    );

    // Notifier les autres participants via WebSocket que les messages ont été lus
    if (unreadMessageIds.length > 0) {
      const { webSocketService } = await import("../services/webSocketService");
      const participantIds = conversation.participants.map((p: any) =>
        p.userId.toString(),
      );

      webSocketService.notifyMessagesRead(
        id,
        userId,
        unreadMessageIds,
        participantIds,
      );
    }

    res.json({
      success: true,
      markedAsRead: result.modifiedCount,
    });
  } catch (err) {
    console.error("[CONVERSATIONS] Erreur lors du marquage comme lu:", err);
    res.status(500).json({
      error: "Erreur lors du marquage de la conversation comme lue",
      details: err,
    });
  }
}

// DELETE /conversations/:id - Supprimer/Masquer une conversation (soft delete pour l'utilisateur)
// Note: Les conversations privées ne sont JAMAIS supprimées définitivement pour conserver l'historique
// Elles peuvent être réactivées si l'autre participant envoie un message
export async function deleteConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    const userObjectId = new Types.ObjectId(userId);
    const conversationId = new Types.ObjectId(id);

    // Récupérer la conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant de la conversation
    const isParticipant = conversation.participants.some(
      (p: any) => p.userId.toString() === userId,
    );
    if (!isParticipant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si c'est une conversation de groupe
    if (conversation.isGroup) {
      return res.status(400).json({
        error:
          'Utilisez la fonction "quitter le groupe" pour les conversations de groupe',
        code: "USE_LEAVE_GROUP",
      });
    }

    // Ajouter l'utilisateur à la liste deletedBy s'il n'y est pas déjà
    const alreadyDeleted = conversation.deletedBy?.some(
      (id: Types.ObjectId) => id.toString() === userId,
    );
    if (alreadyDeleted) {
      return res.status(400).json({ error: "Conversation déjà masquée" });
    }

    // Mettre à jour avec le soft delete (masquage)
    await Conversation.updateOne(
      { _id: conversationId },
      { $addToSet: { deletedBy: userObjectId } },
    );

    // Supprimer de la mémoire pour cet utilisateur
    memoryStorage.removeConversation?.(userId, id);

    console.log(
      `✅ [CONVERSATIONS] Conversation ${id} masquée par l'utilisateur ${userId}`,
    );

    // Note: On ne supprime JAMAIS définitivement les conversations privées
    // pour permettre la réactivation et conserver l'historique des messages

    res.json({
      success: true,
      message:
        "Conversation masquée. Elle réapparaîtra si vous recevez un nouveau message.",
      hidden: true,
    });
  } catch (err) {
    console.error("[CONVERSATIONS] Erreur lors du masquage:", err);
    res.status(500).json({
      error: "Erreur lors du masquage de la conversation",
      details: err,
    });
  }
}

// DELETE /conversations/:id/permanent - Suppression définitive (ADMIN uniquement)
// Cette fonction supprime définitivement une conversation et tous ses messages
export async function adminDeleteConversationPermanent(
  req: Request,
  res: Response,
) {
  try {
    let userId: string | undefined;
    let isAdmin = false;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
      isAdmin = (req.user as any).isAdmin === true;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }
    if (!isAdmin) {
      return res
        .status(403)
        .json({ error: "Accès réservé aux administrateurs" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    const conversationId = new Types.ObjectId(id);

    // Récupérer la conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Archiver la conversation avant suppression (données chiffrées)
    await dataArchiveService.archiveAndRecordDeletion(
      "conversation",
      id,
      conversation.toObject() as unknown as Record<string, unknown>,
      userId,
      { reason: "Suppression définitive par administrateur" },
    );

    // Archiver tous les messages avant suppression (données chiffrées)
    const messagesToArchive = await Message.find({
      conversationId: conversationId,
    }).lean();
    for (const msg of messagesToArchive) {
      await dataArchiveService.archiveEntity(
        "message",
        msg._id as Types.ObjectId,
        msg as Record<string, unknown>,
        userId,
        {
          reason: "Message supprimé avec la conversation (admin)",
          parentEntityType: "conversation",
          parentEntityId: conversationId,
        },
      );
    }

    // Supprimer tous les messages de la conversation
    const deletedMessages = await Message.deleteMany({
      conversationId: conversationId,
    });

    // Supprimer la conversation
    await Conversation.deleteOne({ _id: conversationId });

    // Supprimer de la mémoire pour tous les participants
    for (const participant of conversation.participants) {
      memoryStorage.removeConversation?.(participant.userId.toString(), id);
    }

    console.log(
      `🗑️ [ADMIN] Conversation ${id} supprimée définitivement par admin ${userId} (${deletedMessages.deletedCount} messages supprimés)`,
    );

    res.json({
      success: true,
      message: "Conversation supprimée définitivement",
      deletedMessages: deletedMessages.deletedCount,
    });
  } catch (err) {
    console.error("[ADMIN] Erreur lors de la suppression définitive:", err);
    res.status(500).json({
      error: "Erreur lors de la suppression définitive",
      details: err,
    });
  }
}
