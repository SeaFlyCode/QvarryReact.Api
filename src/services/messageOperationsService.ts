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

const opsLogger = logger.child({ service: "message-operations" });

export async function getDisplayName(userId: string): Promise<string> {
  const { decrypt } = await import("../utils/masterEncryptionUtils");
  const user = await User.findById(userId).select(
    "name surname pseudo showPseudo",
  );
  if (!user) return "Un utilisateur";
  if (user.showPseudo && user.pseudo) {
    try {
      return decrypt(user.pseudo);
    } catch (_e) {}
  }
  try {
    const name = decrypt(user.name);
    const surname = decrypt(user.surname);
    return `${name} ${surname}`;
  } catch (_e) {
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

  opsLogger.info("Message créé", {
    messageId: String(message._id),
    conversationId,
    senderId: userId,
  });

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
