// src/services/messageOperationsService.ts
// Logique métier pure des opérations sur les messages
// Utilisée à la fois par les controllers HTTP et le handler WebSocket

import Message, { IMessageReply } from "../models/messages";
import Conversation from "../models/conversations";
import { Types } from "mongoose";
import {
  encrypt as encryptCommunication,
  decrypt as decryptCommunication,
} from "../utils/communicationEncryptionUtils";
import { createNotification } from "./notificationService";
import { memoryStorage } from "./memoryStorageService";
import User from "../models/users";
import { logger } from "./loggerService";
import { decrypt as decryptMaster } from "../utils/masterEncryptionUtils";

const opsLogger = logger.child({ service: "message-operations" });

const MENTION_REGEX = /@([\w-]+)/g;

// ─── Détection de pattern abusif (admin_abuse_pattern) ─────────────────────
const ABUSE_WINDOW_SECONDS = 60;
const ABUSE_MSG_THRESHOLD = 30;
const abuseMemory = new Map<string, { count: number; expiresAt: number }>();

function inMemoryAbuseIncr(userId: string): number {
  const now = Date.now();
  const entry = abuseMemory.get(userId);
  if (!entry || entry.expiresAt <= now) {
    abuseMemory.set(userId, {
      count: 1,
      expiresAt: now + ABUSE_WINDOW_SECONDS * 1000,
    });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

async function checkAbusePattern(userId: string): Promise<void> {
  let count = 0;
  try {
    const RedisConnectionPool = (await import("../config/redisPool")).default;
    const client = RedisConnectionPool.getPublisher();
    const key = `abuse:msg:${userId}`;
    count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, ABUSE_WINDOW_SECONDS);
    }
  } catch {
    count = inMemoryAbuseIncr(userId);
  }

  if (count <= ABUSE_MSG_THRESHOLD) return;

  try {
    const { notifyAllAdmins } = await import("./adminNotificationService");
    await notifyAllAdmins(
      "admin_abuse_pattern",
      "⚠️ Pattern abusif détecté",
      `User ${userId} envoie > ${ABUSE_MSG_THRESHOLD} msg/min (${count} en ${ABUSE_WINDOW_SECONDS}s).`,
      {
        userId,
        count,
        windowSeconds: ABUSE_WINDOW_SECONDS,
        dedupKey: `abuse-msg:${userId}`,
      },
    );
  } catch (err) {
    opsLogger.warn("Échec notification admin_abuse_pattern", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Extrait les pseudos mentionnés (@pseudo) d'un contenu texte.
 * Limite simple : pseudos sans espaces, alphanumériques + tirets/underscores.
 * Déduplique les pseudos.
 */
function extractMentionPseudos(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_REGEX)) {
    const pseudo = match[1];
    if (pseudo) seen.add(pseudo);
  }
  return Array.from(seen);
}

/**
 * Résout les pseudos mentionnés en ObjectIds parmi les participants
 * d'une conversation. Compare le pseudo déchiffré (showPseudo activé)
 * et fallback sur prénom déchiffré.
 */
async function resolveMentionedUserIds(
  content: string,
  participantIds: Types.ObjectId[],
): Promise<Types.ObjectId[]> {
  const pseudos = extractMentionPseudos(content);
  if (pseudos.length === 0 || participantIds.length === 0) return [];

  const users = await User.find({ _id: { $in: participantIds } })
    .select("_id name pseudo showPseudo")
    .lean();

  const lowered = new Set(pseudos.map((p) => p.toLowerCase()));
  const matched: Types.ObjectId[] = [];

  for (const user of users) {
    let candidate: string | null = null;
    if (user.showPseudo && user.pseudo) {
      try {
        candidate = decryptMaster(user.pseudo);
      } catch (err) {
        opsLogger.debug("Échec déchiffrement pseudo lors de la résolution mention", {
          userId: user._id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!candidate) {
      try {
        candidate = decryptMaster(user.name);
      } catch (err) {
        opsLogger.debug("Échec déchiffrement nom lors de la résolution mention", {
          userId: user._id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (candidate && lowered.has(candidate.toLowerCase())) {
      matched.push(user._id as Types.ObjectId);
    }
  }

  return matched;
}

export async function getDisplayName(userId: string): Promise<string> {
  const { decrypt } = await import("../utils/masterEncryptionUtils");
  const user = await User.findById(userId).select(
    "name surname pseudo showPseudo",
  );
  if (!user) return "Un utilisateur";
  if (user.showPseudo && user.pseudo) {
    try {
      return decrypt(user.pseudo);
    } catch (e) {
      // P3 backend #6e — log warn pour permettre de détecter une corruption
      // de clé / données chiffrées au lieu d'avoir un fallback silencieux.
      opsLogger.warn("Échec déchiffrement pseudo, fallback nom/prénom", {
        userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  try {
    const name = decrypt(user.name);
    const surname = decrypt(user.surname);
    return `${name} ${surname}`;
  } catch (e) {
    opsLogger.warn("Échec déchiffrement nom/prénom, fallback générique", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return "Un utilisateur";
  }
}

export interface CreateMessageResult {
  messageId: string;
  message: {
    _id: string;
    conversationId: string;
    senderId: string;
    content: string;
    type: string;
    readBy: any[];
    replies: any[];
    metadata: any;
    createdAt: Date;
    updatedAt: Date;
  };
  reactivatedUserIds: string[];
  participantIds: string[];
}

export async function createMessageOp(
  userId: string,
  conversationId: string,
  content: string,
  type: string = "text",
  metadata?: any,
): Promise<CreateMessageResult> {
  const conversation = await Conversation.findById(conversationId);
  if (
    !conversation ||
    !conversation.participants.some(
      (p: any) => p.userId.toString() === userId,
    )
  ) {
    throw Object.assign(new Error("Conversation non trouvée"), {
      statusCode: 404,
    });
  }

  const encryptedContent = encryptCommunication(content);
  const ALLOWED_METADATA_KEYS = ["mentions", "replyTo", "type", "format"];
  let encryptedMetadata: any = undefined;
  if (metadata) {
    const sanitizedMetadata: Record<string, any> = {};
    for (const key of ALLOWED_METADATA_KEYS) {
      if (key in metadata) sanitizedMetadata[key] = metadata[key];
    }
    if (sanitizedMetadata.mentions) {
      encryptedMetadata = {
        ...sanitizedMetadata,
        mentions: sanitizedMetadata.mentions.map((id: string) =>
          encryptCommunication(id),
        ),
      };
    } else {
      encryptedMetadata = sanitizedMetadata;
    }
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

  conversation.lastMessage = message._id;
  conversation.updatedAt = new Date();
  await conversation.save();

  const participantIds = conversation.participants.map((p: any) =>
    p.userId.toString(),
  );
  memoryStorage.updateConversationLastMessage(
    conversationId,
    message._id,
    participantIds,
  );

  const reactivatedUserIds: string[] = [];
  if (conversation.deletedBy && conversation.deletedBy.length > 0) {
    const usersToReactivate = conversation.deletedBy.filter(
      (id: Types.ObjectId) => id.toString() !== userId,
    );
    if (usersToReactivate.length > 0) {
      await Conversation.updateOne(
        { _id: conversation._id },
        { $pull: { deletedBy: { $in: usersToReactivate } } },
      );
      for (const reactivatedUserId of usersToReactivate) {
        reactivatedUserIds.push(reactivatedUserId.toString());
      }
    }
  }

  const otherParticipants = conversation.participants.filter(
    (p: any) => p.userId.toString() !== userId,
  );
  const displayName = await getDisplayName(userId);
  let conversationName = "un groupe";
  if (conversation.isGroup && conversation.name) {
    try {
      conversationName = decryptCommunication(conversation.name);
    } catch (_e) {}
  }

  // Détection des mentions @pseudo dans le contenu en clair, uniquement
  // pour les groupes (cf. mute par-mention géré dans createNotification).
  let mentionedUserIds: Types.ObjectId[] = [];
  if (conversation.isGroup) {
    try {
      const otherParticipantIds = otherParticipants.map(
        (p: any) => p.userId as Types.ObjectId,
      );
      mentionedUserIds = await resolveMentionedUserIds(
        content,
        otherParticipantIds,
      );
    } catch (err) {
      opsLogger.warn("Échec résolution mentions, on continue sans mentions", {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
        ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
      },
    );
  }

  opsLogger.info("Message créé", {
    messageId: String(message._id),
    conversationId,
    senderId: userId,
  });

  // Pattern abusif (best-effort, ne bloque pas la création)
  void checkAbusePattern(userId);

  return {
    messageId: String(message._id),
    message: {
      _id: String(message._id),
      conversationId,
      senderId: String(message.senderId),
      content, // contenu en clair
      type: message.type,
      readBy: message.readBy,
      replies: [],
      metadata: metadata || null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    },
    reactivatedUserIds,
    participantIds,
  };
}

export interface GetMessagesResult {
  messages: any[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    oldestMessageId: any;
  };
}

export async function getMessagesOp(
  userId: string,
  conversationId: string,
  queryParams: { limit?: number; offset?: number; beforeId?: string },
): Promise<GetMessagesResult> {
  const conversation = await Conversation.findById(conversationId);
  if (
    !conversation ||
    !conversation.participants.some(
      (p: any) => p.userId.toString() === userId,
    )
  ) {
    throw Object.assign(new Error("Conversation non trouvée"), {
      statusCode: 404,
    });
  }

  const limit = Math.min(queryParams.limit || 20, 50);
  const offset = queryParams.offset || 0;
  const beforeId = queryParams.beforeId;

  const query: any = {
    conversationId: new Types.ObjectId(conversationId),
  };
  if (beforeId) {
    const beforeMessage = await Message.findById(beforeId);
    if (beforeMessage) query.createdAt = { $lt: beforeMessage.createdAt };
  }

  const totalCount = await Message.countDocuments({
    conversationId: new Types.ObjectId(conversationId),
  }).maxTimeMS(5000);
  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .skip(beforeId ? 0 : offset)
    .limit(limit)
    .lean()
    .maxTimeMS(5000);
  const orderedMessages = messages.reverse();

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

  const currentPosition = offset + messages.length;
  const hasMore = beforeId
    ? messages.length === limit
    : currentPosition < totalCount;

  return {
    messages: result,
    pagination: {
      offset,
      limit,
      total: totalCount,
      hasMore,
      oldestMessageId: result.length > 0 ? result[0]._id : null,
    },
  };
}

export async function markMessageAsReadOp(
  userId: string,
  messageId: string,
  _conversationId?: string,
): Promise<{ alreadyRead: boolean; participantIds: string[] }> {
  const message = await Message.findById(messageId);
  if (!message)
    throw Object.assign(new Error("Message non trouvé"), { statusCode: 404 });

  const conversation = await Conversation.findOne({
    _id: message.conversationId,
    "participants.userId": userId,
  });
  if (!conversation)
    throw Object.assign(new Error("Accès non autorisé"), { statusCode: 403 });

  const alreadyRead = message.readBy
    .map((id: any) => id.toString())
    .includes(userId);
  const participantIds = conversation.participants.map((p: any) =>
    p.userId.toString(),
  );

  if (!alreadyRead) {
    message.readBy.push(new Types.ObjectId(userId));
    message.updatedAt = new Date();
    await message.save();
  }

  return { alreadyRead, participantIds };
}

export async function replyToMessageOp(
  userId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const message = await Message.findById(messageId);
  if (!message)
    throw Object.assign(new Error("Message non trouvé"), { statusCode: 404 });

  const conversation = await Conversation.findOne({
    _id: message.conversationId,
    "participants.userId": userId,
  });
  if (!conversation)
    throw Object.assign(new Error("Accès non autorisé"), { statusCode: 403 });

  const encryptedContent = encryptCommunication(content);
  const reply: IMessageReply = {
    userId: new Types.ObjectId(userId),
    content: encryptedContent,
    createdAt: new Date(),
  };
  message.replies.push(reply);
  message.updatedAt = new Date();
  await message.save();
}

export async function editMessageOp(
  userId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const message = await Message.findById(messageId);
  if (!message)
    throw Object.assign(new Error("Message non trouvé"), { statusCode: 404 });
  if (message.senderId.toString() !== userId)
    throw Object.assign(new Error("Non autorisé"), { statusCode: 403 });

  message.content = encryptCommunication(content);
  message.metadata = { ...message.metadata, edited: true };
  message.updatedAt = new Date();
  await message.save();
}

export async function deleteMessageOp(
  userId: string,
  messageId: string,
): Promise<void> {
  const message = await Message.findById(messageId);
  if (!message)
    throw Object.assign(new Error("Message non trouvé"), { statusCode: 404 });
  if (message.senderId.toString() !== userId)
    throw Object.assign(new Error("Non autorisé"), { statusCode: 403 });

  message.metadata = { ...message.metadata, deleted: true };
  message.updatedAt = new Date();
  await message.save();
}
