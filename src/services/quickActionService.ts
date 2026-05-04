// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTION SERVICE
// ═══════════════════════════════════════════════════════════════════════════
// Service dédié aux actions déclenchées depuis les notifications mobiles
// (UNNotificationCategory iOS / Notifee actions Android).
//
// Contraintes :
//  - Idempotent : un double-tap ne plante pas, renvoie `{ alreadyDone: true }`
//  - Réutilise la logique métier existante (sosService, dataShareService,
//    contactControllers) — ne duplique pas les règles métier
//  - Auth standard JWT (cf. middleware sur les routes)
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import Contact from "../models/contacts";
import { sosService } from "./sosService";
import { updateShareStatus } from "./dataShareService";
import { createNotification } from "./notificationService";
import { logger } from "./loggerService";
import UserModel from "../models/users";
import DataShareModel from "../models/dataShare";
import { decrypt } from "../utils/masterEncryptionUtils";

const quickActionLogger = logger.child({ service: "quick-action" });

export interface QuickActionResult {
  success: boolean;
  alreadyDone?: boolean;
  message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getDisplayName(userId: string | mongoose.Types.ObjectId): Promise<string> {
  try {
    const user = await UserModel.findById(userId)
      .select("name surname pseudo showPseudo")
      .lean();
    if (!user) return "Un utilisateur";
    if (user.showPseudo && user.pseudo) {
      try {
        return decrypt(user.pseudo);
      } catch {
        // fallthrough
      }
    }
    try {
      return decrypt(user.name);
    } catch {
      return "Un utilisateur";
    }
  } catch {
    return "Un utilisateur";
  }
}

// ─── SOS : confirm safe ───────────────────────────────────────────────────

/**
 * Confirme qu'une session SOS est safe. Idempotent : si la session est déjà
 * RESOLVED, renvoie `alreadyDone: true` au lieu d'erreur.
 */
export async function quickActionSosConfirmSafe(
  sessionId: string,
  userId: string,
): Promise<QuickActionResult> {
  try {
    await sosService.confirmSafe(sessionId, userId);
    quickActionLogger.info("[quick-action] SOS confirmé safe", {
      sessionId,
      userId,
    });
    return { success: true, message: "Session SOS confirmée safe" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg === "SESSION_NOT_FOUND_OR_NOT_ESCALATING" ||
      msg === "SESSION_NOT_FOUND_OR_ALREADY_RESOLVED"
    ) {
      // Idempotence : déjà résolue ou pas en escalade → considéré comme déjà fait
      quickActionLogger.info("[quick-action] SOS déjà résolu (idempotent)", {
        sessionId,
        userId,
      });
      return { success: true, alreadyDone: true, message: "Session déjà résolue" };
    }
    if (msg === "NOT_AUTHORIZED_TO_CONFIRM") {
      throw new Error("NOT_AUTHORIZED_TO_CONFIRM");
    }
    throw error;
  }
}

// ─── Contact : accept ─────────────────────────────────────────────────────

/**
 * Accepte une demande de contact. Idempotent : si le contact est déjà
 * accepté, renvoie `alreadyDone: true`.
 */
export async function quickActionContactAccept(
  contactId: string,
  userId: string,
): Promise<QuickActionResult> {
  const contactObjectId = new mongoose.Types.ObjectId(contactId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // findOneAndUpdate atomique : passer pending → accepted
  const updated = await Contact.findOneAndUpdate(
    {
      _id: contactObjectId,
      contactId: userObjectId,
      status: "pending",
    },
    { $set: { status: "accepted" } },
    { new: true },
  );

  if (!updated) {
    // Soit le contact n'existe pas, soit déjà traité — chercher pour
    // distinguer les deux cas.
    const existing = await Contact.findOne({
      _id: contactObjectId,
      contactId: userObjectId,
    }).lean();
    if (!existing) {
      throw new Error("CONTACT_NOT_FOUND");
    }
    if (existing.status === "accepted") {
      quickActionLogger.info(
        "[quick-action] Contact déjà accepté (idempotent)",
        { contactId, userId },
      );
      return { success: true, alreadyDone: true };
    }
    // status "blocked" ou autre — ne pas modifier
    throw new Error("CONTACT_INVALID_STATE");
  }

  // Notification au demandeur (best-effort)
  try {
    const displayName = await getDisplayName(userId);
    await createNotification(
      updated.userId as mongoose.Types.ObjectId,
      "contact_accepted",
      "Demande de contact acceptée",
      `${displayName} a accepté votre demande de contact`,
      {
        contactId: updated._id as mongoose.Types.ObjectId,
        senderId: userObjectId,
      },
    );
  } catch (notifErr) {
    quickActionLogger.warn(
      "[quick-action] Échec notification accept contact",
      {
        contactId,
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      },
    );
  }

  quickActionLogger.info("[quick-action] Contact accepté", {
    contactId,
    userId,
  });
  return { success: true };
}

// ─── Contact : refuse ─────────────────────────────────────────────────────

/**
 * Refuse une demande de contact. Idempotent : si la demande n'existe plus,
 * renvoie `alreadyDone: true`.
 */
export async function quickActionContactRefuse(
  contactId: string,
  userId: string,
): Promise<QuickActionResult> {
  const contactObjectId = new mongoose.Types.ObjectId(contactId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const deleted = await Contact.findOneAndDelete({
    _id: contactObjectId,
    contactId: userObjectId,
    status: "pending",
  });

  if (!deleted) {
    // Soit jamais existé, soit déjà traité — idempotent
    quickActionLogger.info(
      "[quick-action] Contact déjà refusé / inexistant (idempotent)",
      { contactId, userId },
    );
    return { success: true, alreadyDone: true };
  }

  // Notifier le demandeur (best-effort)
  try {
    const displayName = await getDisplayName(userId);
    await createNotification(
      deleted.userId as mongoose.Types.ObjectId,
      "contact_refused",
      "Demande de contact refusée",
      `${displayName} a refusé votre demande de contact`,
      {
        contactId: contactObjectId,
        senderId: userObjectId,
      },
    );
  } catch (notifErr) {
    quickActionLogger.warn(
      "[quick-action] Échec notification refus contact",
      {
        contactId,
        error: notifErr instanceof Error ? notifErr.message : String(notifErr),
      },
    );
  }

  quickActionLogger.info("[quick-action] Contact refusé", {
    contactId,
    userId,
  });
  return { success: true };
}

// ─── Share : accept ───────────────────────────────────────────────────────

/**
 * Accepte un partage. Idempotent : si le partage n'est plus actif (déjà
 * traité ou expiré), renvoie `alreadyDone: true` plutôt qu'une erreur.
 */
export async function quickActionShareAccept(
  shareId: string,
  userId: string,
): Promise<QuickActionResult> {
  const receiverId = new mongoose.Types.ObjectId(userId);
  const shareObjectId = new mongoose.Types.ObjectId(shareId);

  // Vérifier d'abord si le share existe et est actif (= encore traitable)
  const existingShare = await DataShareModel.findOne({
    _id: shareObjectId,
    receiverIds: receiverId,
  }).lean();

  if (!existingShare) {
    throw new Error("SHARE_NOT_FOUND");
  }
  if (!existingShare.isActive) {
    quickActionLogger.info(
      "[quick-action] Share déjà traité / inactif (idempotent)",
      { shareId, userId },
    );
    return { success: true, alreadyDone: true };
  }

  const result = await updateShareStatus(receiverId, shareObjectId, "accepted");
  quickActionLogger.info("[quick-action] Share accepté", {
    shareId,
    userId,
    copiedDataType: result.copiedData?.type,
  });
  return { success: true, message: "Partage accepté" };
}

// ─── Share : refuse ───────────────────────────────────────────────────────

/**
 * Refuse un partage. Idempotent.
 */
export async function quickActionShareRefuse(
  shareId: string,
  userId: string,
): Promise<QuickActionResult> {
  const receiverId = new mongoose.Types.ObjectId(userId);
  const shareObjectId = new mongoose.Types.ObjectId(shareId);

  const existingShare = await DataShareModel.findOne({
    _id: shareObjectId,
    receiverIds: receiverId,
  }).lean();

  if (!existingShare) {
    throw new Error("SHARE_NOT_FOUND");
  }
  if (!existingShare.isActive) {
    quickActionLogger.info(
      "[quick-action] Share déjà traité / inactif (idempotent)",
      { shareId, userId },
    );
    return { success: true, alreadyDone: true };
  }

  await updateShareStatus(receiverId, shareObjectId, "declined");
  quickActionLogger.info("[quick-action] Share refusé", { shareId, userId });
  return { success: true, message: "Partage refusé" };
}
