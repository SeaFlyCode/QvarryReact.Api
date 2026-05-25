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
import { logger } from "../services/loggerService";
import ContactModel from "../models/contacts";
import {
  calculateUserPreferences,
  calculateNextPinOrder,
  sanitizeBlockReason,
} from "../utils/conversationHelpers";

const convoLogger = logger.child({ service: "conversations" });

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
      // §M (bug 13) — Investigation : query SANS filtres pour comprendre pourquoi
      // l'utilisateur voit "Vous devez être contacts" alors qu'il pense l'être.
      // Causes possibles : status="pending" malgré affichage côté mobile,
      // relation unidirectionnelle (A→B accepted mais pas B→A), isBlocked=true,
      // ou aucune relation en DB. Le résultat de cette query est crucial pour
      // diagnostiquer en prod sans accès direct à la base.
      const debugMatches = await Contact.find({
        $or: [
          { userId: userObjectId, contactId: participantObjectId },
          { userId: participantObjectId, contactId: userObjectId },
        ],
      })
        .select("_id userId contactId status isBlocked createdAt")
        .lean();

      convoLogger.warn("createPrivateConversation: contact non accepté", {
        requesterId: userId,
        targetId: participantId,
        matches: debugMatches.map((m: any) => ({
          // direction: A2B = (requester→target), B2A = (target→requester)
          direction: m.userId?.toString() === userId ? "A2B" : "B2A",
          status: m.status,
          isBlocked: m.isBlocked,
          createdAt: m.createdAt,
        })),
        matchCount: debugMatches.length,
      });

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

        convoLogger.info("Réactivation conversation", {
          conversationId: conversation._id,
          userId,
        });

        // Recharger la conversation mise à jour
        conversation = await Conversation.findById(conversation._id);

        // BUG-007: Null check après refetch - la conversation pourrait avoir été supprimée entre-temps
        if (!conversation) {
          convoLogger.error("Conversation introuvable après réactivation", {
            conversationId: conversation,
          });
          return res
            .status(404)
            .json({ error: "Conversation introuvable après réactivation" });
        }

        // Stocker en mémoire
        const conversationToStore = {
          _id: conversation._id,
          name: conversation.name ?? null,
          isGroup: conversation.isGroup,
          creatorId: conversation.creatorId ?? null,
          participants: conversation.participants,
          lastMessage: conversation.lastMessage ?? null,
          deletedBy: conversation.deletedBy ?? [],
          mutedBy: conversation.mutedBy ?? [],
          archivedBy: conversation.archivedBy ?? [],
          pinnedBy: conversation.pinnedBy ?? [],
          markedUnreadBy: conversation.markedUnreadBy ?? [],
          blockedBy: conversation.blockedBy ?? [],
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        };
        memoryStorage.storeConversation(
          userId,
          conversationToStore as IConversation,
        );

        return res.status(200).json({
          conversationId: conversation._id.toString(),
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
      deletedBy: conversation.deletedBy ?? [],
      mutedBy: conversation.mutedBy ?? [],
      archivedBy: conversation.archivedBy ?? [],
      pinnedBy: conversation.pinnedBy ?? [],
      markedUnreadBy: conversation.markedUnreadBy ?? [],
      blockedBy: conversation.blockedBy ?? [],
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

    // Push notification au participant invité
    try {
      const displayName = await getDisplayName(userId);
      await createNotification(
        new Types.ObjectId(participantId),
        "message",
        "Nouvelle conversation",
        `${displayName} a démarré une conversation avec vous`,
        {
          conversationId: conversation._id as Types.ObjectId,
          senderId: new Types.ObjectId(userId),
        },
      );
    } catch (notifErr) {
      convoLogger.error("Erreur envoi notification nouvelle conversation", {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

    res.status(201).json({ conversationId: conversation._id });
  } catch (err) {
    convoLogger.error("Erreur création conversation privée", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la création de la conversation privée",
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

    if (!Array.isArray(participantIds) || !participantIds.every((id: unknown) => typeof id === "string" && Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: "participantIds contient des valeurs invalides." });
    }

    // SEC: Vérifier que tous les participants sont des contacts acceptés du créateur
    const acceptedContacts = await ContactModel.find({
      userId: userId,
      contactId: { $in: participantIds },
      status: "accepted",
      isBlocked: false,
    }).select("contactId");
    const acceptedContactIds = new Set(
      acceptedContacts.map((c) => c.contactId.toString()),
    );
    const unauthorizedParticipants = participantIds.filter(
      (id: string) => !acceptedContactIds.has(id),
    );
    if (unauthorizedParticipants.length > 0) {
      return res.status(403).json({
        error: "Certains participants ne sont pas dans vos contacts",
      });
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
      deletedBy: conversation.deletedBy ?? [],
      mutedBy: conversation.mutedBy ?? [],
      archivedBy: conversation.archivedBy ?? [],
      pinnedBy: conversation.pinnedBy ?? [],
      markedUnreadBy: conversation.markedUnreadBy ?? [],
      blockedBy: conversation.blockedBy ?? [],
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
    convoLogger.error("Erreur création groupe", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de la création du groupe" });
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

    // Pagination standard
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 20),
      100,
    );
    const skip = (page - 1) * limit;
    const includeArchived = req.query.includeArchived === "true";
    const userObjectId = new Types.ObjectId(userId);

    let conversations = memoryStorage.getAllConversations(userId);
    let total = 0;

    if (!conversations || conversations.length === 0) {
      // Filtrer les conversations où l'utilisateur n'a pas fait de soft delete
      const query: any = {
        "participants.userId": userObjectId,
        deletedBy: { $ne: userObjectId }, // Exclure les conversations supprimées par l'utilisateur
      };

      // Par défaut, exclure les conversations archivées
      if (!includeArchived) {
        query["archivedBy.userId"] = { $ne: userObjectId };
      }

      const [dbConversations, totalCount] = await Promise.all([
        Conversation.find(query)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Conversation.countDocuments(query),
      ]);

      total = totalCount;

      dbConversations.forEach((conv: any) => {
        const conversationToStore = {
          _id: conv._id,
          name: conv.name ?? null,
          isGroup: conv.isGroup,
          creatorId: conv.creatorId ?? null,
          participants: conv.participants,
          lastMessage: conv.lastMessage ?? null,
          deletedBy: conv.deletedBy ?? [],
          mutedBy: conv.mutedBy ?? [],
          archivedBy: conv.archivedBy ?? [],
          pinnedBy: conv.pinnedBy ?? [],
          markedUnreadBy: conv.markedUnreadBy ?? [],
          blockedBy: conv.blockedBy ?? [],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        };
        memoryStorage.storeConversation(
          userId as string,
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
            mutedBy: conv.mutedBy ?? [],
            archivedBy: conv.archivedBy ?? [],
            pinnedBy: conv.pinnedBy ?? [],
            markedUnreadBy: conv.markedUnreadBy ?? [],
            blockedBy: conv.blockedBy ?? [],
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          }) as import("../models/conversations").IConversation,
      );
    } else {
      // Filtrer les conversations en mémoire également
      conversations = conversations.filter((conv: any) => {
        const isDeleted = conv.deletedBy?.some(
          (id: any) => id.toString() === userId,
        );
        if (isDeleted) return false;

        // Filtrer les archivées sauf si includeArchived=true
        if (!includeArchived) {
          const isArchived = conv.archivedBy?.some(
            (a: any) => a.userId.toString() === userId,
          );
          if (isArchived) return false;
        }

        return true;
      });

      // Paginer les conversations en mémoire
      total = conversations.length;
      conversations = conversations.slice(skip, skip + limit);
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
            } catch (_e) {
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
              convoLogger.error("Erreur dechiffrement dernier message", {
                error: e,
              });
              lastMessageContent = null;
            }
          }

          // Calculer les préférences utilisateur
          const userPreferences = calculateUserPreferences(
            conv,
            userId as string,
          );

          return {
            _id: conv._id,
            name: decryptedName,
            isGroup: conv.isGroup,
            participants: conv.participants,
            creatorId: conv.creatorId,
            lastMessage: lastMessageContent, // ✅ Toujours à jour depuis la BDD (agrégation unique)
            unreadCount,
            userPreferences, // ✅ Nouvelles préférences utilisateur
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          };
        },
      ),
    );

    // Tri : épinglées en premier (par order ASC), puis par updatedAt DESC
    result.sort((a, b) => {
      if (a.userPreferences.isPinned && !b.userPreferences.isPinned) return -1;
      if (!a.userPreferences.isPinned && b.userPreferences.isPinned) return 1;
      if (a.userPreferences.isPinned && b.userPreferences.isPinned) {
        return (
          (a.userPreferences.pinOrder ?? 0) - (b.userPreferences.pinOrder ?? 0)
        );
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    res.json({
      data: result,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    convoLogger.error("Erreur récupération conversations", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des conversations",
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
    convoLogger.error("Erreur récupération détails conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des détails",
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
    const invalidIds = (userIds as string[]).filter(id => !Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: "Un ou plusieurs IDs sont invalides." });
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

    // Push notification aux nouveaux membres ajoutés
    try {
      const displayName = await getDisplayName(userId);
      const groupName = conversation.name
        ? decryptCommunication(conversation.name)
        : "un groupe";
      for (const uid of userIds) {
        if (uid !== userId) {
          await createNotification(
            new Types.ObjectId(uid),
            "group_member_added",
            "Ajouté à un groupe",
            `${displayName} vous a ajouté au groupe "${groupName}"`,
            {
              conversationId: conversation._id as Types.ObjectId,
              senderId: new Types.ObjectId(userId),
            },
          );
        }
      }
    } catch (notifErr) {
      convoLogger.error("Erreur envoi notification ajout membres", {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS broadcast — émet group_member_added DISTINCT pour chaque nouveau membre,
    // en plus de l'event group_update (rétrocompat) déjà émis ailleurs.
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      const allParticipantIds = conversation.participants.map((p: any) =>
        p.userId.toString(),
      );
      for (const uid of userIds) {
        if (uid === userId) continue;
        webSocketService.notifyGroupMemberAdded(
          id,
          allParticipantIds,
          uid,
          userId,
        );
      }
      webSocketService.notifyGroupUpdate(id, allParticipantIds, "member_added", {
        addedUserIds: (userIds as string[]).filter((uid) => uid !== userId),
        addedBy: userId,
      });
    } catch (wsErr) {
      convoLogger.error("Erreur broadcast WS ajout membres", {
        error: wsErr instanceof Error ? wsErr.message : String(wsErr),
      });
    }

    res.json({ success: true, conversation: conversation.toObject() });
  } catch (err) {
    convoLogger.error("Erreur ajout membres groupe", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de l'ajout de membres" });
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

    // Push notification au membre retiré
    try {
      const displayName = await getDisplayName(userId);
      const groupName = conversation.name
        ? decryptCommunication(conversation.name)
        : "un groupe";
      await createNotification(
        new Types.ObjectId(memberId),
        "group_member_removed",
        "Retiré d'un groupe",
        `${displayName} vous a retiré du groupe "${groupName}"`,
        {
          conversationId: new Types.ObjectId(id),
          senderId: new Types.ObjectId(userId),
        },
      );
    } catch (notifErr) {
      convoLogger.error("Erreur envoi notification retrait membre", {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

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

    // ═══════════════════════════════════════════════════════════════════════════
    // WS broadcast — émet group_member_removed DISTINCT (en plus de
    // notifyMemberRemoved ciblé sur le membre retiré + group_update rétrocompat)
    // ═══════════════════════════════════════════════════════════════════════════
    try {
      const remainingParticipantIds = conversation.participants.map((p: any) =>
        p.userId.toString(),
      );
      // Inclure le membre retiré pour qu'il reçoive aussi l'event distinct
      // (au cas où des handlers WS notifications seraient toujours actifs).
      const broadcastTargets = Array.from(
        new Set([...remainingParticipantIds, memberId]),
      );
      webSocketService.notifyGroupMemberRemoved(
        id,
        broadcastTargets,
        memberId,
        userId,
      );
      webSocketService.notifyGroupUpdate(
        id,
        remainingParticipantIds,
        "member_removed",
        {
          removedUserId: memberId,
          removedBy: userId,
        },
      );
    } catch (wsErr) {
      convoLogger.error("Erreur broadcast WS retrait membre", {
        error: wsErr instanceof Error ? wsErr.message : String(wsErr),
      });
    }

    convoLogger.info("Membre retiré du groupe", {
      groupId: id,
      memberId,
      byUserId: userId,
    });
    res.json({ success: true });
  } catch (err) {
    convoLogger.error("Erreur suppression membre groupe", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la suppression du membre",
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
    convoLogger.error("Erreur quit groupe", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du quit" });
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
        convoLogger.error("Erreur nettoyage memoire participant", {
          participantId,
          error: err,
        });
      }
    }

    // Notifier tous les participants que le groupe a été supprimé
    webSocketService.notifyGroupDeleted(id, participantIds, userId);

    // Push notification aux participants (sauf l'admin qui supprime)
    try {
      const displayName = await getDisplayName(userId);
      const groupName = conversation.name
        ? decryptCommunication(conversation.name)
        : "un groupe";
      for (const participantId of participantIds) {
        if (participantId !== userId) {
          await createNotification(
            new Types.ObjectId(participantId),
            "group_deleted",
            "Groupe supprimé",
            `${displayName} a supprimé le groupe "${groupName}"`,
            {
              conversationId: new Types.ObjectId(id),
              senderId: new Types.ObjectId(userId),
            },
          );
        }
      }
    } catch (notifErr) {
      convoLogger.error("Erreur envoi notification suppression groupe", {
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      });
    }

    convoLogger.info("Groupe supprime", {
      groupId: id,
      byUserId: userId,
      deletedMessages: deletedMessages.deletedCount,
    });

    res.json({
      success: true,
      message: "Groupe supprimé",
      deletedMessages: deletedMessages.deletedCount,
    });
  } catch (err) {
    convoLogger.error("Erreur suppression groupe", {
      groupId: req.params.id,
      error: err,
    });
    res.status(500).json({ error: "Erreur lors de la suppression du groupe" });
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
    webSocketService.notifyGroupNameChanged(id, name, participantIds, userId);

    // Synchronisation mémoire pour tous les membres
    await updateMemoryForAllParticipants(
      participantIds,
      conversation as IConversation,
      memoryStorage,
    );

    convoLogger.info("Nom du groupe modifie", {
      groupId: id,
      byUserId: userId,
    });
    res.json({ success: true, conversation: conversation.toObject() });
  } catch (err) {
    convoLogger.error("Erreur changement nom groupe", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du changement de nom" });
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
    // Validation du rôle avec whitelist
    const VALID_GROUP_ROLES = ["admin", "member"];
    if (!VALID_GROUP_ROLES.includes(role)) {
      return res.status(400).json({
        error: "Rôle invalide. Les rôles autorisés sont : admin, member",
      });
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
    convoLogger.error("Erreur changement rôle membre", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du changement de rôle" });
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
        convoLogger.debug("Pas de session en ligne pour le participant", {
          participantId,
        });
      }
    } catch (err) {
      // Log l'erreur mais ne bloque pas le processus
      convoLogger.error("Erreur mise a jour memoire participant", {
        participantId,
        error: err,
      });
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

    convoLogger.info("Messages et notifications marques comme lus", {
      userId,
      conversationId: id,
      messagesCount: result.modifiedCount,
      notificationsCount: notifResult.modifiedCount,
    });

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
    convoLogger.error("Erreur marquage conversation comme lue", {
      conversationId: req.params.id,
      error: err,
    });
    res.status(500).json({
      error: "Erreur lors du marquage de la conversation comme lue",
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

    convoLogger.info("Conversation masquee", { conversationId: id, userId });

    // Note: On ne supprime JAMAIS définitivement les conversations privées
    // pour permettre la réactivation et conserver l'historique des messages

    res.json({
      success: true,
      message:
        "Conversation masquée. Elle réapparaîtra si vous recevez un nouveau message.",
      hidden: true,
    });
  } catch (err) {
    convoLogger.error("Erreur masquage conversation", {
      conversationId: req.params.id,
      error: err,
    });
    res.status(500).json({
      error: "Erreur lors du masquage de la conversation",
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

    convoLogger.info("Conversation supprimee definitivement par admin", {
      conversationId: id,
      adminId: userId,
      deletedMessages: deletedMessages.deletedCount,
    });

    res.json({
      success: true,
      message: "Conversation supprimée définitivement",
      deletedMessages: deletedMessages.deletedCount,
    });
  } catch (err) {
    convoLogger.error("Erreur suppression definitive conversation", {
      conversationId: req.params.id,
      error: err,
    });
    res.status(500).json({
      error: "Erreur lors de la suppression définitive",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONNALITÉS DE GESTION DES CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

// PATCH /conversations/:id/mute - Mettre en sourdine une conversation
export async function muteConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const { mutedUntil, notifyOnMention } = req.body;

    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    // Validation de mutedUntil
    let parsedMutedUntil: Date | null = null;
    if (mutedUntil !== undefined && mutedUntil !== null) {
      parsedMutedUntil = new Date(mutedUntil);

      // Vérifier que c'est une date valide
      if (isNaN(parsedMutedUntil.getTime())) {
        return res.status(400).json({ error: "Date mutedUntil invalide" });
      }

      // Vérifier que c'est dans le futur
      if (parsedMutedUntil <= new Date()) {
        return res
          .status(400)
          .json({ error: "La date mutedUntil doit être dans le futur" });
      }

      // Vérifier la limite de 1 an
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      if (parsedMutedUntil > oneYearFromNow) {
        return res
          .status(400)
          .json({ error: "La date mutedUntil ne peut pas dépasser 1 an" });
      }
    }

    const userObjectId = new Types.ObjectId(userId);
    const conversationId = new Types.ObjectId(id);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si déjà muted
    const existingMuteIndex = conversation.mutedBy.findIndex(
      (m: any) => m.userId.toString() === userId,
    );

    if (existingMuteIndex !== -1) {
      // Update existing mute
      conversation.mutedBy[existingMuteIndex].mutedAt = new Date();
      conversation.mutedBy[existingMuteIndex].mutedUntil = parsedMutedUntil;
      conversation.mutedBy[existingMuteIndex].notifyOnMention =
        notifyOnMention ?? true;
    } else {
      // Add new mute
      conversation.mutedBy.push({
        userId: userObjectId,
        mutedAt: new Date(),
        mutedUntil: parsedMutedUntil,
        notifyOnMention: notifyOnMention ?? true,
      } as any);
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation mise en sourdine", {
      conversationId: id,
      userId,
      mutedUntil: parsedMutedUntil,
    });

    const message = parsedMutedUntil
      ? `Conversation mise en sourdine jusqu'au ${parsedMutedUntil.toLocaleString("fr-FR")}`
      : "Conversation mise en sourdine indéfiniment";

    res.json({
      message,
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
      mutedUntil: parsedMutedUntil,
    });
  } catch (err) {
    convoLogger.error("Erreur mute conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de la mise en sourdine" });
  }
}

// PATCH /conversations/:id/unmute - Réactiver le son d'une conversation
export async function unmuteConversation(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Retirer de mutedBy
    const initialLength = conversation.mutedBy.length;
    conversation.mutedBy = conversation.mutedBy.filter(
      (m: any) => m.userId.toString() !== userId,
    );

    if (conversation.mutedBy.length === initialLength) {
      return res
        .status(400)
        .json({ error: "Cette conversation n'est pas en sourdine" });
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation réactivée", { conversationId: id, userId });

    res.json({
      message: "Conversation réactivée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur unmute conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de la réactivation" });
  }
}

// PATCH /conversations/:id/archive - Archiver une conversation
export async function archiveConversation(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si déjà archivée
    const alreadyArchived = conversation.archivedBy.some(
      (a: any) => a.userId.toString() === userId,
    );
    if (alreadyArchived) {
      return res
        .status(400)
        .json({ error: "Cette conversation est déjà archivée" });
    }

    // Ajouter à archivedBy
    conversation.archivedBy.push({
      userId: userObjectId,
      archivedAt: new Date(),
    } as any);

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation archivée", { conversationId: id, userId });

    res.json({
      message: "Conversation archivée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur archive conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de l'archivage" });
  }
}

// PATCH /conversations/:id/unarchive - Désarchiver une conversation
export async function unarchiveConversation(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Retirer de archivedBy
    const initialLength = conversation.archivedBy.length;
    conversation.archivedBy = conversation.archivedBy.filter(
      (a: any) => a.userId.toString() !== userId,
    );

    if (conversation.archivedBy.length === initialLength) {
      return res
        .status(400)
        .json({ error: "Cette conversation n'est pas archivée" });
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation désarchivée", {
      conversationId: id,
      userId,
    });

    res.json({
      message: "Conversation désarchivée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur unarchive conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de la désarchivage" });
  }
}

// GET /conversations/archived - Lister les conversations archivées
export async function listArchivedConversations(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 20),
      100,
    );
    const skip = Math.max(0, parseInt(req.query.skip as string) || 0);

    const userObjectId = new Types.ObjectId(userId);

    // Trouver les conversations archivées par l'utilisateur
    const [conversations, total] = await Promise.all([
      Conversation.find({
        "participants.userId": userObjectId,
        "archivedBy.userId": userObjectId,
      })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments({
        "participants.userId": userObjectId,
        "archivedBy.userId": userObjectId,
      }),
    ]);

    // Formater les conversations avec userPreferences
    const result = await Promise.all(
      conversations.map(async (conv: any) => {
        let decryptedName = null;
        if (conv.name) {
          try {
            decryptedName = await decryptCommunication(conv.name);
          } catch (_e) {
            decryptedName = null;
          }
        }

        const userPreferences = calculateUserPreferences(
          conv,
          userId as string,
        );

        return {
          _id: conv._id,
          name: decryptedName,
          isGroup: conv.isGroup,
          participants: conv.participants,
          creatorId: conv.creatorId,
          userPreferences,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        };
      }),
    );

    res.json({
      conversations: result,
      total,
      limit,
      skip,
    });
  } catch (err) {
    convoLogger.error("Erreur récupération conversations archivées", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des conversations archivées",
    });
  }
}

// PATCH /conversations/:id/pin - Épingler une conversation
export async function pinConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    let { order } = req.body;

    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    // Validation de order si fourni
    if (order !== undefined && order !== null) {
      order = parseInt(order);
      if (isNaN(order) || order < 0) {
        return res
          .status(400)
          .json({ error: "L'ordre doit être un nombre positif" });
      }
    }

    const userObjectId = new Types.ObjectId(userId);
    const conversationId = new Types.ObjectId(id);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si déjà épinglée
    const alreadyPinned = conversation.pinnedBy.some(
      (p: any) => p.userId.toString() === userId,
    );
    if (alreadyPinned) {
      return res
        .status(400)
        .json({ error: "Cette conversation est déjà épinglée" });
    }

    // Vérifier la limite de 5 conversations épinglées
    const allConversations = await Conversation.find({
      "participants.userId": userObjectId,
      "pinnedBy.userId": userObjectId,
    }).lean();

    if (allConversations.length >= 5) {
      return res
        .status(400)
        .json({ error: "Vous ne pouvez épingler que 5 conversations maximum" });
    }

    // Calculer l'ordre si non fourni
    if (order === undefined || order === null) {
      order = calculateNextPinOrder(allConversations, userId);
    }

    // Ajouter à pinnedBy
    conversation.pinnedBy.push({
      userId: userObjectId,
      pinnedAt: new Date(),
      order,
    } as any);

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation épinglée", {
      conversationId: id,
      userId,
      order,
    });

    res.json({
      message: "Conversation épinglée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
      pinOrder: order,
    });
  } catch (err) {
    convoLogger.error("Erreur pin conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de l'épinglage" });
  }
}

// PATCH /conversations/:id/unpin - Désépingler une conversation
export async function unpinConversation(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Retirer de pinnedBy
    const initialLength = conversation.pinnedBy.length;
    conversation.pinnedBy = conversation.pinnedBy.filter(
      (p: any) => p.userId.toString() !== userId,
    );

    if (conversation.pinnedBy.length === initialLength) {
      return res
        .status(400)
        .json({ error: "Cette conversation n'est pas épinglée" });
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation désépinglée", {
      conversationId: id,
      userId,
    });

    res.json({
      message: "Conversation désépinglée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur unpin conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors de la désépinglage" });
  }
}

// PATCH /conversations/:id/mark-unread - Marquer comme non lu
export async function markConversationAsUnread(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si déjà marquée comme non lue
    const alreadyMarked = conversation.markedUnreadBy.some(
      (id: any) => id.toString() === userId,
    );
    if (alreadyMarked) {
      return res
        .status(400)
        .json({ error: "Cette conversation est déjà marquée comme non lue" });
    }

    // Ajouter à markedUnreadBy
    conversation.markedUnreadBy.push(userObjectId);
    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation marquée comme non lue", {
      conversationId: id,
      userId,
    });

    res.json({
      message: "Conversation marquée comme non lue",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur mark conversation as unread", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du marquage" });
  }
}

// PATCH /conversations/:id/mark-read-flag - Retirer le marquage non lu (différent de markConversationAsRead qui marque les messages)
export async function unmarkConversationAsUnread(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Retirer de markedUnreadBy
    const initialLength = conversation.markedUnreadBy.length;
    conversation.markedUnreadBy = conversation.markedUnreadBy.filter(
      (id: any) => id.toString() !== userId,
    );

    if (conversation.markedUnreadBy.length === initialLength) {
      return res
        .status(400)
        .json({ error: "Cette conversation n'est pas marquée comme non lue" });
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation marquée comme lue", {
      conversationId: id,
      userId,
    });

    res.json({
      message: "Conversation marquée comme lue",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur unmark conversation as unread", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du retrait du marquage" });
  }
}

// PATCH /conversations/:id/block - Bloquer une conversation
export async function blockConversation(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!id) {
      return res.status(400).json({ error: "ID de conversation requis" });
    }

    const sanitizedReason = sanitizeBlockReason(reason);

    const userObjectId = new Types.ObjectId(userId);
    const conversationId = new Types.ObjectId(id);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Vérifier si déjà bloquée
    const alreadyBlocked = conversation.blockedBy.some(
      (b: any) => b.userId.toString() === userId,
    );
    if (alreadyBlocked) {
      return res
        .status(400)
        .json({ error: "Cette conversation est déjà bloquée" });
    }

    // Ajouter à blockedBy
    conversation.blockedBy.push({
      userId: userObjectId,
      blockedAt: new Date(),
      reason: sanitizedReason,
    } as any);

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation bloquée", {
      conversationId: id,
      userId,
      reason: sanitizedReason,
    });

    res.json({
      message: "Conversation bloquée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur block conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du blocage" });
  }
}

// PATCH /conversations/:id/unblock - Débloquer une conversation
export async function unblockConversation(req: Request, res: Response) {
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

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    // Vérifier que l'utilisateur est participant actif
    const participant = conversation.participants.find(
      (p: any) => p.userId.toString() === userId && !p.leftAt,
    );
    if (!participant) {
      return res
        .status(403)
        .json({ error: "Vous n'êtes pas participant de cette conversation" });
    }

    // Retirer de blockedBy
    const initialLength = conversation.blockedBy.length;
    conversation.blockedBy = conversation.blockedBy.filter(
      (b: any) => b.userId.toString() !== userId,
    );

    if (conversation.blockedBy.length === initialLength) {
      return res
        .status(400)
        .json({ error: "Cette conversation n'est pas bloquée" });
    }

    conversation.updatedAt = new Date();
    await conversation.save();

    const userPreferences = calculateUserPreferences(conversation, userId);

    convoLogger.info("Conversation débloquée", { conversationId: id, userId });

    res.json({
      message: "Conversation débloquée",
      conversation: {
        _id: conversation._id,
        userPreferences,
      },
    });
  } catch (err) {
    convoLogger.error("Erreur unblock conversation", {
      error: err instanceof Error ? err.message : String(err),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({ error: "Erreur lors du déblocage" });
  }
}
