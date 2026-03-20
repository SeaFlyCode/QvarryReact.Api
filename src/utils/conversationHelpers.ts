import { Types } from "mongoose";
import { IConversation } from "../models/conversations";

/**
 * Interface pour les préférences utilisateur d'une conversation
 */
export interface UserPreferences {
  isMuted: boolean;
  mutedUntil: Date | null;
  notifyOnMention: boolean;
  isArchived: boolean;
  isPinned: boolean;
  pinOrder: number | null;
  isMarkedUnread: boolean;
  isBlocked: boolean;
}

/**
 * Calcule les préférences utilisateur pour une conversation donnée
 * @param conversation - Conversation Mongoose document
 * @param userId - ID de l'utilisateur (string ou ObjectId)
 * @returns UserPreferences object
 */
export function calculateUserPreferences(
  conversation: IConversation | any,
  userId: string | Types.ObjectId,
): UserPreferences {
  const userIdStr = typeof userId === "string" ? userId : userId.toString();
  const now = new Date();

  // Muted
  const mutedInfo = conversation.mutedBy?.find(
    (m: any) => m.userId.toString() === userIdStr,
  );
  const isMuted =
    mutedInfo && (!mutedInfo.mutedUntil || mutedInfo.mutedUntil > now);
  const mutedUntil = mutedInfo?.mutedUntil || null;
  const notifyOnMention = mutedInfo?.notifyOnMention ?? true;

  // Archived
  const isArchived =
    conversation.archivedBy?.some(
      (a: any) => a.userId.toString() === userIdStr,
    ) ?? false;

  // Pinned
  const pinnedInfo = conversation.pinnedBy?.find(
    (p: any) => p.userId.toString() === userIdStr,
  );
  const isPinned = !!pinnedInfo;
  const pinOrder = pinnedInfo?.order ?? null;

  // Marked Unread
  const isMarkedUnread =
    conversation.markedUnreadBy?.some(
      (id: any) => id.toString() === userIdStr,
    ) ?? false;

  // Blocked
  const isBlocked =
    conversation.blockedBy?.some(
      (b: any) => b.userId.toString() === userIdStr,
    ) ?? false;

  return {
    isMuted,
    mutedUntil,
    notifyOnMention,
    isArchived,
    isPinned,
    pinOrder,
    isMarkedUnread,
    isBlocked,
  };
}

/**
 * Vérifie si un utilisateur a atteint la limite de conversations épinglées
 * @param conversation - Conversation Mongoose document
 * @param userId - ID de l'utilisateur
 * @returns boolean - true si limite atteinte
 */
export function hasReachedPinLimit(
  conversation: IConversation | any,
  userId: string | Types.ObjectId,
): boolean {
  const userIdStr = typeof userId === "string" ? userId : userId.toString();
  const pinnedCount =
    conversation.pinnedBy?.filter((p: any) => p.userId.toString() === userIdStr)
      .length ?? 0;

  return pinnedCount >= 5;
}

/**
 * Calcule le prochain numéro d'ordre pour épingler une conversation
 * @param conversations - Liste des conversations de l'utilisateur
 * @param userId - ID de l'utilisateur
 * @returns number - Prochain numéro d'ordre
 */
export function calculateNextPinOrder(
  conversations: (IConversation | any)[],
  userId: string | Types.ObjectId,
): number {
  const userIdStr = typeof userId === "string" ? userId : userId.toString();

  let maxOrder = 0;
  for (const conv of conversations) {
    const pinnedInfo = conv.pinnedBy?.find(
      (p: any) => p.userId.toString() === userIdStr,
    );
    if (pinnedInfo && pinnedInfo.order > maxOrder) {
      maxOrder = pinnedInfo.order;
    }
  }

  return maxOrder + 1;
}

/**
 * Nettoie les entrées mutedBy expirées d'une conversation
 * @param conversation - Conversation Mongoose document
 * @returns string[] - Liste des userId qui ont été unmuted automatiquement
 */
export function cleanExpiredMutes(conversation: IConversation | any): string[] {
  const now = new Date();
  const expiredUserIds: string[] = [];

  if (!conversation.mutedBy || conversation.mutedBy.length === 0) {
    return expiredUserIds;
  }

  conversation.mutedBy = conversation.mutedBy.filter((m: any) => {
    const isExpired = m.mutedUntil && m.mutedUntil < now;
    if (isExpired) {
      expiredUserIds.push(m.userId.toString());
    }
    return !isExpired;
  });

  return expiredUserIds;
}

/**
 * Vérifie si une conversation est bloquée par l'un des participants
 * @param conversation - Conversation Mongoose document
 * @param userId1 - ID du premier utilisateur
 * @param userId2 - ID du deuxième utilisateur (optionnel)
 * @returns boolean - true si bloquée
 */
export function isConversationBlocked(
  conversation: IConversation | any,
  userId1: string | Types.ObjectId,
  userId2?: string | Types.ObjectId,
): boolean {
  const userId1Str = typeof userId1 === "string" ? userId1 : userId1.toString();

  const blockedByUser1 = conversation.blockedBy?.some(
    (b: any) => b.userId.toString() === userId1Str,
  );

  if (blockedByUser1) return true;

  if (userId2) {
    const userId2Str =
      typeof userId2 === "string" ? userId2 : userId2.toString();
    const blockedByUser2 = conversation.blockedBy?.some(
      (b: any) => b.userId.toString() === userId2Str,
    );
    return blockedByUser2;
  }

  return false;
}

/**
 * Sanitize une raison de blocage
 * @param reason - Raison brute
 * @returns string - Raison nettoyée
 */
export function sanitizeBlockReason(reason?: string): string | undefined {
  if (!reason) return undefined;

  // Trim, limite à 500 caractères, supprime les caractères dangereux
  return reason.trim().substring(0, 500).replace(/[<>]/g, ""); // Supprime < et > pour éviter XSS
}
