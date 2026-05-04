import mongoose from "mongoose";
import DataShareModel from "../models/dataShare";
import UserModel from "../models/users";
import { createNotification } from "./notificationService";
import { logger } from "./loggerService";
import { decrypt as decryptMaster } from "../utils/masterEncryptionUtils";

const shareExpLogger = logger.child({ service: "share-expiration" });

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Récupère le nom d'affichage d'un utilisateur (pseudo si activé, sinon nom complet)
 */
async function getUserDisplayName(
  userId: mongoose.Types.ObjectId,
): Promise<string> {
  try {
    const user = await UserModel.findById(userId)
      .select("name surname pseudo showPseudo")
      .lean();
    if (!user) return "Un utilisateur";

    if (user.showPseudo && user.pseudo) {
      try {
        return decryptMaster(user.pseudo);
      } catch {
        // fallback nom/prénom
      }
    }

    try {
      const name = decryptMaster(user.name);
      const surname = decryptMaster(user.surname);
      return `${name} ${surname}`.trim();
    } catch {
      return "Un utilisateur";
    }
  } catch {
    return "Un utilisateur";
  }
}

function getDataTypeLabel(dataType: string): string {
  switch (dataType) {
    case "point":
      return "un point";
    case "fiche":
      return "une fiche";
    case "liste":
      return "une liste";
    default:
      return "des données";
  }
}

/**
 * Notifie les destinataires (et l'expéditeur) des partages dont l'expiration
 * est imminente (entre maintenant et J+2).
 * Skip les partages déjà notifiés (flag expiringSoonNotifiedAt).
 *
 * @returns nombre de partages notifiés
 */
export async function notifyExpiringShares(): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + TWO_DAYS_MS);

  const shares = await DataShareModel.find({
    isActive: true,
    expiresAt: { $gte: now, $lte: horizon },
    expiringSoonNotifiedAt: { $exists: false },
  });

  if (shares.length === 0) {
    shareExpLogger.debug("Aucun partage à notifier (expiring soon)");
    return 0;
  }

  shareExpLogger.info("Partages à notifier (expiring soon)", {
    count: shares.length,
  });

  let notifiedCount = 0;

  for (const share of shares) {
    try {
      const senderId = share.senderId;
      const senderName = await getUserDisplayName(senderId);
      const dataTypeLabel = getDataTypeLabel(share.dataType);

      // Notifier chaque destinataire (uniquement ceux qui n'ont pas encore décliné)
      const activeReceivers = share.encryptedDataPerReceiver
        .filter((r) => r.status !== "declined")
        .map((r) => r.receiverId);

      await Promise.all(
        activeReceivers.map((receiverId) =>
          createNotification(
            receiverId,
            "share_expiring_soon",
            "Partage bientôt expiré",
            `Le partage de ${senderName} (${dataTypeLabel}) expire dans moins de 2 jours`,
            {
              shareId: share._id as mongoose.Types.ObjectId,
              senderId,
            },
          ).catch((err) => {
            shareExpLogger.error("Erreur notification expiring share (receiver)", {
              shareId: (share._id as mongoose.Types.ObjectId).toString(),
              receiverId: receiverId.toString(),
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        ),
      );

      // Notifier également l'expéditeur
      try {
        await createNotification(
          senderId,
          "share_expiring_soon",
          "Votre partage va expirer",
          `Votre partage de ${dataTypeLabel} expire dans moins de 2 jours`,
          {
            shareId: share._id as mongoose.Types.ObjectId,
            senderId,
          },
        );
      } catch (err) {
        shareExpLogger.error("Erreur notification expiring share (sender)", {
          shareId: (share._id as mongoose.Types.ObjectId).toString(),
          senderId: senderId.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Marquer comme notifié
      share.expiringSoonNotifiedAt = now;
      await share.save();

      notifiedCount += 1;
    } catch (err) {
      shareExpLogger.error("Erreur traitement share expiring", {
        shareId: (share._id as mongoose.Types.ObjectId).toString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  shareExpLogger.info("Notifications expiring shares envoyées", {
    notifiedCount,
  });

  return notifiedCount;
}

/**
 * Notifie les destinataires (et l'expéditeur) des partages effectivement
 * expirés et non encore notifiés.
 * Skip les partages déjà notifiés (flag expiredNotifiedAt).
 *
 * @returns nombre de partages notifiés
 */
export async function notifyExpiredShares(): Promise<number> {
  const now = new Date();

  const shares = await DataShareModel.find({
    expiresAt: { $lt: now },
    expiredNotifiedAt: { $exists: false },
  });

  if (shares.length === 0) {
    shareExpLogger.debug("Aucun partage à notifier (expired)");
    return 0;
  }

  shareExpLogger.info("Partages expirés à notifier", { count: shares.length });

  let notifiedCount = 0;

  for (const share of shares) {
    try {
      const senderId = share.senderId;
      const senderName = await getUserDisplayName(senderId);
      const dataTypeLabel = getDataTypeLabel(share.dataType);

      // Notifier chaque destinataire (sauf ceux ayant décliné)
      const activeReceivers = share.encryptedDataPerReceiver
        .filter((r) => r.status !== "declined")
        .map((r) => r.receiverId);

      await Promise.all(
        activeReceivers.map((receiverId) =>
          createNotification(
            receiverId,
            "share_expired",
            "Partage expiré",
            `Le partage de ${senderName} (${dataTypeLabel}) a expiré`,
            {
              shareId: share._id as mongoose.Types.ObjectId,
              senderId,
            },
          ).catch((err) => {
            shareExpLogger.error("Erreur notification expired share (receiver)", {
              shareId: (share._id as mongoose.Types.ObjectId).toString(),
              receiverId: receiverId.toString(),
              error: err instanceof Error ? err.message : String(err),
            });
          }),
        ),
      );

      // Notifier également l'expéditeur
      try {
        await createNotification(
          senderId,
          "share_expired",
          "Votre partage a expiré",
          `Votre partage de ${dataTypeLabel} a expiré`,
          {
            shareId: share._id as mongoose.Types.ObjectId,
            senderId,
          },
        );
      } catch (err) {
        shareExpLogger.error("Erreur notification expired share (sender)", {
          shareId: (share._id as mongoose.Types.ObjectId).toString(),
          senderId: senderId.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }

      share.expiredNotifiedAt = now;
      await share.save();

      notifiedCount += 1;
    } catch (err) {
      shareExpLogger.error("Erreur traitement share expired", {
        shareId: (share._id as mongoose.Types.ObjectId).toString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  shareExpLogger.info("Notifications expired shares envoyées", {
    notifiedCount,
  });

  return notifiedCount;
}
