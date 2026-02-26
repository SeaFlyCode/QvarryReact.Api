import mongoose from "mongoose";
import DataShareModel, { IDataShare, DataType } from "../models/dataShare";
import FicheModel from "../models/fiches";
import PointModel from "../models/points";
import ListModel from "../models/lists";
import KeysModel from "../models/keys";
import UserModel from "../models/users";
import { decryptUserKeys } from "../utils/userEncryptionUtils";
import {
  encryptWithPublicKey,
  decryptWithPrivateKey,
  signData,
  verifySignature,
  createDataHash,
} from "../utils/rsaEncryptionUtils";
import { decrypt as decryptMaster } from "../utils/masterEncryptionUtils";
import { memoryStorage } from "./memoryStorageService";
import { createNotification } from "./notificationService";
import { logger } from "./loggerService";

const dataShareLogger = logger.child({ service: "data-share" });

// Durée de validité des signatures de partage (alignée sur la durée de vie des partages)
const SHARE_SIGNATURE_VALIDITY_MS = 20 * 24 * 60 * 60 * 1000; // 20 jours

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

    // Si showPseudo est activé et pseudo existe
    if (user.showPseudo && user.pseudo) {
      try {
        return decryptMaster(user.pseudo);
      } catch {
        // Fallback
      }
    }

    // Sinon, utiliser le nom complet
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

/**
 * Récupère le label du type de données
 */
function getDataTypeLabel(dataType: DataType): string {
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
 * Récupère la clé publique RSA d'un utilisateur
 */
async function getUserPublicKey(
  userId: mongoose.Types.ObjectId,
): Promise<string> {
  const publicKeyDoc = await KeysModel.findOne({
    userId: userId,
    type: "rsa-public",
  }).lean();

  if (!publicKeyDoc) {
    throw new Error(
      `Clé publique RSA non trouvée pour l'utilisateur ${userId}`,
    );
  }

  return publicKeyDoc.key;
}

/**
 * Récupère la clé privée RSA d'un utilisateur (déchiffrée)
 */
async function getUserPrivateKey(
  userId: mongoose.Types.ObjectId,
): Promise<string> {
  const privateKeyDoc = await KeysModel.findOne({
    userId: userId,
    type: "rsa-private",
  }).lean();

  if (!privateKeyDoc) {
    throw new Error(`Clé privée RSA non trouvée pour l'utilisateur ${userId}`);
  }

  // Déchiffrer avec la master key
  return decryptMaster(privateKeyDoc.key);
}

/**
 * Récupère une fiche avec tous ses points liés, déchiffrés
 */
async function getFicheWithPoints(
  ficheId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
) {
  const fiche = await FicheModel.findOne({
    _id: ficheId,
    userId: userId,
    deletedAt: null,
  });
  if (!fiche) {
    throw new Error("Fiche non trouvée ou accès non autorisé");
  }

  // Helper pour déchiffrer seulement si c'est une string chiffrée
  const safeDecrypt = async (value: any): Promise<any> => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "string") {
      // Si c'est un tableau ou un objet, le retourner tel quel
      return value;
    }
    // Vérifier que c'est bien une string chiffrée (contient ":")
    if (!value.includes(":")) {
      // Pas chiffré, retourner tel quel
      return value;
    }
    try {
      return await decryptUserKeys(userId, value);
    } catch (e) {
      dataShareLogger.warn(
        "Erreur déchiffrement, valeur retournée telle quelle",
        {
          error: e instanceof Error ? e.message : String(e),
        },
      );
      return value;
    }
  };

  // Récupérer les points liés
  const points = await PointModel.find({
    _id: { $in: fiche.points_ids },
    userId: userId,
    deletedAt: null,
  });

  // Déchiffrer les locations des points ET leurs autres champs
  const pointsDecrypted = await Promise.all(
    points.map(async (point) => {
      const decryptedLocation = await safeDecrypt(point.location_encrypted);
      const decryptedName = await safeDecrypt(point.name);
      const decryptedDescription = await safeDecrypt(point.description);
      const decryptedAccessType = await safeDecrypt(point.accessType);

      return {
        ...point.toObject(),
        name: decryptedName || "",
        description: decryptedDescription || "",
        accessType: decryptedAccessType || "",
        location_decrypted: decryptedLocation,
      };
    }),
  );

  // Déchiffrer les champs de la fiche
  const ficheObj = fiche.toObject();
  const ficheDecrypted = {
    ...ficheObj,
    name: await safeDecrypt(ficheObj.name),
    ville: await safeDecrypt(ficheObj.ville),
    type: await safeDecrypt(ficheObj.type),
    etat: await safeDecrypt(ficheObj.etat),
    accessibilite: await safeDecrypt(ficheObj.accessibilite),
    difficulte_acces: await safeDecrypt(ficheObj.difficulte_acces),
    risque_oxygene: await safeDecrypt(ficheObj.risque_oxygene),
    acces_souterrain: await safeDecrypt(ficheObj.acces_souterrain),
    praticite_souterrain: await safeDecrypt(ficheObj.praticite_souterrain),
    etat_general: await safeDecrypt(ficheObj.etat_general),
    commentaire: await safeDecrypt(ficheObj.commentaire),
    equipement_conseille: await safeDecrypt(ficheObj.equipement_conseille),
    surface: await safeDecrypt(ficheObj.surface),
    type_galeries: await safeDecrypt(ficheObj.type_galeries),
    interets: await safeDecrypt(ficheObj.interets),
    center_cavite: ficheObj.center_cavite,
  };

  return {
    fiche: ficheDecrypted,
    points: pointsDecrypted,
  };
}

/**
 * Récupère une liste avec tous ses points, déchiffrés
 */
async function getListWithPoints(
  listId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
) {
  const userIdStr = userId.toString();
  const listIdStr = listId.toString();

  // D'abord chercher la liste en mémoire
  let listData: any = null;
  let pointsFromMemory: any[] = [];

  if (memoryStorage.hasSession(userIdStr)) {
    const listInMemory = memoryStorage.getListById(userIdStr, listIdStr);

    if (listInMemory) {
      listData = listInMemory;

      // Récupérer les points de cette liste depuis la mémoire
      if (listInMemory.points && listInMemory.points.length > 0) {
        const pointIds = listInMemory.points.map((id: any) => id.toString());
        pointsFromMemory = memoryStorage.getPointsByIds(userIdStr, pointIds);
      }
    }
  }

  // Helper pour déchiffrer seulement si c'est une string chiffrée
  const safeDecrypt = async (value: any): Promise<any> => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "string") return value;
    if (!value.includes(":")) return value;
    try {
      return await decryptUserKeys(userId, value);
    } catch (_e) {
      return value;
    }
  };

  // Si pas trouvé en mémoire, chercher en DB
  if (!listData) {
    const list = await ListModel.findOne({
      _id: listId,
      userId: userId,
      deletedAt: null,
    });
    if (!list) {
      throw new Error("Liste non trouvée ou accès non autorisé");
    }

    // Récupérer les points liés depuis la DB
    const points = await PointModel.find({
      _id: { $in: list.points },
      userId: userId,
      deletedAt: null,
    });

    // Déchiffrer les locations des points ET leurs autres champs
    const pointsDecrypted = await Promise.all(
      points.map(async (point) => {
        const decryptedLocation = await safeDecrypt(point.location_encrypted);
        const decryptedName = await safeDecrypt(point.name);
        const decryptedDescription = await safeDecrypt(point.description);
        const decryptedAccessType = await safeDecrypt(point.accessType);

        return {
          ...point.toObject(),
          name: decryptedName || "",
          description: decryptedDescription || "",
          accessType: decryptedAccessType || "",
          location_decrypted: decryptedLocation,
        };
      }),
    );

    // Déchiffrer les champs de la liste
    const listObj = list.toObject();
    const listDecrypted = {
      ...listObj,
      name: (await safeDecrypt(listObj.name)) || "",
      description: (await safeDecrypt(listObj.description)) || "",
    };

    return {
      list: listDecrypted,
      points: pointsDecrypted,
    };
  }

  // Si on a récupéré depuis la mémoire, les données sont déjà déchiffrées
  // IMPORTANT: Vérifier si tous les points de la liste ont été trouvés en mémoire
  // Si certains points manquent, les récupérer depuis la base de données
  const pointIdsInList = listData.points?.map((id: any) => id.toString()) || [];
  const pointIdsFoundInMemory = new Set(
    pointsFromMemory.map((p: any) => p._id?.toString()),
  );
  const missingPointIds = pointIdsInList.filter(
    (id: string) => !pointIdsFoundInMemory.has(id),
  );

  if (missingPointIds.length > 0) {
    // Récupérer les points manquants depuis la DB
    const missingPointsFromDB = await PointModel.find({
      _id: { $in: missingPointIds },
      userId: userId,
      deletedAt: null,
    });

    // Déchiffrer les points manquants
    const missingPointsDecrypted = await Promise.all(
      missingPointsFromDB.map(async (point) => {
        const decryptedLocation = await safeDecrypt(point.location_encrypted);
        const decryptedName = await safeDecrypt(point.name);
        const decryptedDescription = await safeDecrypt(point.description);
        const decryptedAccessType = await safeDecrypt(point.accessType);

        return {
          ...point.toObject(),
          name: decryptedName || "",
          description: decryptedDescription || "",
          accessType: decryptedAccessType || "",
          location_decrypted: decryptedLocation,
        };
      }),
    );

    // Ajouter les points manquants à la liste des points
    pointsFromMemory.push(...missingPointsDecrypted);
  }

  // Formater les points pour être compatibles avec le format attendu
  const pointsDecrypted = pointsFromMemory.map((point: any) => {
    // La location en mémoire est un objet {lat, lng}, la convertir en location_decrypted
    // Mais les points de la DB ont déjà location_decrypted
    let locationDecrypted = point.location_decrypted || point.location;
    if (typeof locationDecrypted === "object" && locationDecrypted !== null) {
      locationDecrypted = JSON.stringify(locationDecrypted);
    }

    return {
      ...point,
      _id: point._id,
      name: point.name || "",
      description: point.description || "",
      accessType: point.accessType || "",
      location_decrypted: locationDecrypted,
    };
  });

  return {
    list: {
      ...listData,
      name: listData.name || "",
      description: listData.description || "",
    },
    points: pointsDecrypted,
  };
}

/**
 * Récupère un point déchiffré
 */
async function getPoint(
  pointId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
) {
  // 1. D'abord chercher en mémoire (les points récents peuvent ne pas être encore en DB)
  const userIdStr = userId.toString();
  const pointIdStr = pointId.toString();

  if (memoryStorage.hasSession(userIdStr)) {
    const userData = memoryStorage.getAllUserData(userIdStr);
    const pointInMemory = userData.points?.find(
      (p: any) => p._id?.toString() === pointIdStr,
    );

    if (pointInMemory) {
      return {
        point: pointInMemory,
        location_decrypted: pointInMemory.location, // Déjà déchiffré en mémoire
      };
    }
  }

  // 2. Si pas en mémoire, chercher en base de données
  const point = await PointModel.findOne({
    _id: pointId,
    userId: userId,
    deletedAt: null,
  });

  if (!point) {
    throw new Error("Point non trouvé ou accès non autorisé");
  }

  // Helper pour déchiffrer seulement si c'est une string chiffrée
  const safeDecrypt = async (value: any): Promise<any> => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "string") return value;
    if (!value.includes(":")) return value;
    try {
      return await decryptUserKeys(userId, value);
    } catch (_e) {
      return value;
    }
  };

  // Déchiffrer tous les champs du point
  const decryptedLocation = await safeDecrypt(point.location_encrypted);
  const decryptedName = await safeDecrypt(point.name);
  const decryptedDescription = await safeDecrypt(point.description);
  const decryptedAccessType = await safeDecrypt(point.accessType);

  return {
    point: {
      ...point.toObject(),
      name: decryptedName || "",
      description: decryptedDescription || "",
      accessType: decryptedAccessType || "",
    },
    location_decrypted: decryptedLocation,
  };
}

/**
 * Service principal pour partager des données
 * @param senderId - ID de l'utilisateur qui partage
 * @param receiverIds - IDs des utilisateurs destinataires
 * @param dataType - Type de données ("fiche", "liste", "point")
 * @param dataId - ID de l'entité à partager
 * @param message - Message optionnel accompagnant le partage
 */
export async function shareData(
  senderId: mongoose.Types.ObjectId,
  receiverIds: mongoose.Types.ObjectId[],
  dataType: DataType,
  dataId: mongoose.Types.ObjectId,
  message?: string,
): Promise<IDataShare> {
  // Vérification des contacts pour chaque destinataire (en parallèle)
  const Contact = require("../models/contacts").default;

  await Promise.all(
    receiverIds.map(async (receiverId) => {
      // Chercher la relation de contact dans les deux sens
      const contact = await Contact.findOne({
        $or: [
          { userId: senderId, contactId: receiverId },
          { userId: receiverId, contactId: senderId },
        ],
        status: "accepted",
        isBlocked: false,
      });

      if (!contact) {
        throw new Error(
          "Vous devez être contacts pour partager des données avec cet utilisateur.",
        );
      }
    }),
  );

  // 1. Récupérer les données selon le type
  let dataToShare: any;
  let relatedPointsIds: mongoose.Types.ObjectId[] = [];

  switch (dataType) {
    case "fiche":
      const ficheData = await getFicheWithPoints(dataId, senderId);
      dataToShare = ficheData;
      relatedPointsIds = ficheData.points.map(
        (p) => p._id as mongoose.Types.ObjectId,
      );
      break;

    case "liste":
      const listData = await getListWithPoints(dataId, senderId);
      dataToShare = listData;
      relatedPointsIds = listData.points.map(
        (p) => p._id as mongoose.Types.ObjectId,
      );
      break;

    case "point":
      const pointData = await getPoint(dataId, senderId);
      dataToShare = pointData;
      break;

    default:
      throw new Error(`Type de données invalide: ${dataType}`);
  }

  // 2. Sérialiser les données en JSON
  const dataJSON = JSON.stringify(dataToShare);

  // 3. Créer le hash des données
  const dataHash = createDataHash(dataJSON);

  // 4. Signer avec la clé privée de l'émetteur
  const senderPrivateKey = await getUserPrivateKey(senderId);
  const signature = signData(dataJSON, senderPrivateKey);

  // 5. Chiffrer pour chaque destinataire
  const encryptedDataPerReceiver = await Promise.all(
    receiverIds.map(async (receiverId) => {
      const receiverPublicKey = await getUserPublicKey(receiverId);
      const encryptedData = encryptWithPublicKey(dataJSON, receiverPublicKey);

      return {
        receiverId,
        encryptedData,
        status: "pending" as const,
      };
    }),
  );

  // 6. Chiffrer le message si fourni
  let messagePerReceiver;
  if (message) {
    messagePerReceiver = await Promise.all(
      receiverIds.map(async (receiverId) => {
        const receiverPublicKey = await getUserPublicKey(receiverId);
        const encryptedMessage = encryptWithPublicKey(
          message,
          receiverPublicKey,
        );

        return {
          receiverId,
          encryptedMessage,
        };
      }),
    );
  }

  // 7. Créer le document de partage
  const sharedAt = new Date();
  const expiresAt = new Date(sharedAt.getTime() + 20 * 24 * 60 * 60 * 1000); // +20 jours

  const dataShare = new DataShareModel({
    senderId,
    receiverIds,
    dataType,
    dataId,
    encryptedDataPerReceiver,
    signature,
    dataHash,
    relatedPointsIds:
      relatedPointsIds.length > 0 ? relatedPointsIds : undefined,
    messagePerReceiver,
    sharedAt,
    expiresAt,
    notificationSent: false,
    readBy: [],
    isActive: true,
  });

  await dataShare.save();

  // 8. Envoyer les notifications aux destinataires
  const senderName = await getUserDisplayName(senderId);
  const dataTypeLabel = getDataTypeLabel(dataType);

  await Promise.all(
    receiverIds.map(async (receiverId) => {
      try {
        await createNotification(
          receiverId,
          "share_received",
          "Nouveau partage reçu",
          `${senderName} vous a partagé ${dataTypeLabel}`,
          {
            shareId: dataShare._id as mongoose.Types.ObjectId,
            senderId: senderId,
          },
        );
      } catch (notifError) {
        dataShareLogger.error("Erreur notification pour destinataire", {
          receiverId: receiverId.toString(),
          error:
            notifError instanceof Error
              ? notifError.message
              : String(notifError),
          stack: notifError instanceof Error ? notifError.stack : undefined,
        });
      }
    }),
  );

  // Marquer les notifications comme envoyées
  dataShare.notificationSent = true;
  await dataShare.save();

  dataShareLogger.info("Données partagées avec succès", {
    dataType,
    senderId: senderId.toString(),
    recipientCount: receiverIds.length,
  });

  return dataShare;
}

/**
 * Récupère les données partagées pour un destinataire
 * @param receiverId - ID de l'utilisateur destinataire
 * @param shareId - ID du partage
 * @param ipAddress - Adresse IP (pour l'accusé de réception)
 */
export async function getSharedData(
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  ipAddress?: string,
): Promise<any> {
  // 1. Récupérer le document de partage
  const dataShare = await DataShareModel.findOne({
    _id: shareId,
    receiverIds: receiverId,
    isActive: true,
  }).populate("senderId", "name surname pseudo showPseudo");

  if (!dataShare) {
    throw new Error("Partage non trouvé ou expiré");
  }

  // Vérifier si expiré
  if (dataShare.expiresAt < new Date()) {
    dataShare.isActive = false;
    await dataShare.save();
    throw new Error("Ce partage a expiré");
  }

  // 2. Récupérer les données chiffrées pour ce destinataire
  const receiverData = dataShare.encryptedDataPerReceiver.find(
    (item) => item.receiverId.toString() === receiverId.toString(),
  );

  if (!receiverData) {
    throw new Error("Données non trouvées pour ce destinataire");
  }

  // 3. Déchiffrer avec la clé privée du destinataire
  const receiverPrivateKey = await getUserPrivateKey(receiverId);
  const decryptedDataJSON = decryptWithPrivateKey(
    receiverData.encryptedData,
    receiverPrivateKey,
  );

  // 4. Vérifier la signature avec la clé publique de l'émetteur
  const senderPublicKey = await getUserPublicKey(
    dataShare.senderId as mongoose.Types.ObjectId,
  );
  const isSignatureValid = verifySignature(
    decryptedDataJSON,
    dataShare.signature,
    senderPublicKey,
    SHARE_SIGNATURE_VALIDITY_MS,
  );

  if (!isSignatureValid) {
    throw new Error(
      "⚠️ Signature invalide ! Les données ont peut-être été altérées.",
    );
  }

  // 5. Parser les données
  const data = JSON.parse(decryptedDataJSON);

  // 6. Déchiffrer le message si présent
  let decryptedMessage;
  if (dataShare.messagePerReceiver) {
    const messageData = dataShare.messagePerReceiver.find(
      (item) => item.receiverId.toString() === receiverId.toString(),
    );
    if (messageData) {
      decryptedMessage = decryptWithPrivateKey(
        messageData.encryptedMessage,
        receiverPrivateKey,
      );
    }
  }

  // 7. Marquer comme lu et enregistrer l'accusé de réception
  const alreadyRead = dataShare.readBy.some(
    (receipt) => receipt.receiverId.toString() === receiverId.toString(),
  );

  if (!alreadyRead) {
    dataShare.readBy.push({
      receiverId,
      readAt: new Date(),
      ipAddress,
    });

    // Mettre à jour le statut
    const receiverDataIndex = dataShare.encryptedDataPerReceiver.findIndex(
      (item) => item.receiverId.toString() === receiverId.toString(),
    );
    if (receiverDataIndex !== -1) {
      dataShare.encryptedDataPerReceiver[receiverDataIndex].status = "read";
    }

    await dataShare.save();
  }

  dataShareLogger.info("Données récupérées par destinataire", {
    receiverId: receiverId.toString(),
    signatureValid: isSignatureValid,
  });

  return {
    data,
    message: decryptedMessage,
    sender: dataShare.senderId,
    sharedAt: dataShare.sharedAt,
    expiresAt: dataShare.expiresAt,
    dataType: dataShare.dataType,
    signatureValid: isSignatureValid,
  };
}

/**
 * Récupère les données partagées pour la copie (sans vérifier isActive)
 * Cette fonction est utilisée lors de l'acceptation d'un partage, car le statut
 * peut déjà avoir été mis à jour et le partage désactivé.
 *
 * @param receiverId - ID de l'utilisateur destinataire
 * @param shareId - ID du partage
 */
async function getSharedDataForCopy(
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
): Promise<{ data: any; dataType: string }> {
  // 1. Récupérer le document de partage SANS vérifier isActive
  // Car lors de l'acceptation, le partage peut déjà avoir été désactivé
  const dataShare = await DataShareModel.findOne({
    _id: shareId,
    receiverIds: receiverId,
  });

  if (!dataShare) {
    throw new Error("Partage non trouvé");
  }

  // 2. Récupérer les données chiffrées pour ce destinataire
  const receiverData = dataShare.encryptedDataPerReceiver.find(
    (item) => item.receiverId.toString() === receiverId.toString(),
  );

  if (!receiverData) {
    throw new Error("Données non trouvées pour ce destinataire");
  }

  // 3. Vérifier que le statut est bien 'accepted'
  if (receiverData.status !== "accepted") {
    throw new Error("Ce partage n'a pas été accepté");
  }

  // 4. Déchiffrer avec la clé privée du destinataire
  const receiverPrivateKey = await getUserPrivateKey(receiverId);
  const decryptedDataJSON = decryptWithPrivateKey(
    receiverData.encryptedData,
    receiverPrivateKey,
  );

  // 5. Vérifier la signature avec la clé publique de l'émetteur
  const senderPublicKey = await getUserPublicKey(
    dataShare.senderId as mongoose.Types.ObjectId,
  );
  const isSignatureValid = verifySignature(
    decryptedDataJSON,
    dataShare.signature,
    senderPublicKey,
    SHARE_SIGNATURE_VALIDITY_MS,
  );

  if (!isSignatureValid) {
    throw new Error(
      "⚠️ Signature invalide ! Les données ont peut-être été altérées.",
    );
  }

  // 6. Parser les données
  const data = JSON.parse(decryptedDataJSON);

  dataShareLogger.info("Données récupérées pour copie", {
    shareId: shareId.toString(),
  });

  return {
    data,
    dataType: dataShare.dataType,
  };
}

/**
 * Accepter ou refuser un partage
 * Si accepté, copie les données dans le compte du destinataire
 *
 * BUG-005: Race Condition Documentation
 * Le findOne + check isActive + save ne sont pas atomiques. En théorie, deux appels
 * simultanés pourraient accepter le même partage deux fois. Cependant, ce risque est
 * acceptable car :
 * - Les acceptations de partage sont des opérations utilisateur peu fréquentes
 * - Le pire cas est une double copie des données, pas une perte de données
 * - L'utilisation de findOneAndUpdate complexifierait significativement le code
 *   car le déchiffrement RSA doit se faire entre le find et le save
 * - Les idempotency checks côté client empêchent les doubles soumissions
 */
export async function updateShareStatus(
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  status: "accepted" | "declined",
): Promise<{ copiedData?: { type: string; id: string; name: string } }> {
  const dataShare = await DataShareModel.findOne({
    _id: shareId,
    receiverIds: receiverId,
    isActive: true,
  }).populate("senderId", "_id");

  if (!dataShare) {
    throw new Error("Partage non trouvé");
  }

  const receiverDataIndex = dataShare.encryptedDataPerReceiver.findIndex(
    (item) => item.receiverId.toString() === receiverId.toString(),
  );

  if (receiverDataIndex === -1) {
    throw new Error("Données non trouvées pour ce destinataire");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTANT: Si accepté, déchiffrer les données AVANT de modifier le statut
  // Cela évite l'erreur "Partage non trouvé ou expiré" lors de la copie
  // ═══════════════════════════════════════════════════════════════════════════
  let preloadedData: { data: any; dataType: string } | undefined;

  if (status === "accepted") {
    try {
      // Récupérer et déchiffrer les données MAINTENANT, avant toute modification
      const receiverData =
        dataShare.encryptedDataPerReceiver[receiverDataIndex];
      const receiverPrivateKey = await getUserPrivateKey(receiverId);
      const decryptedDataJSON = decryptWithPrivateKey(
        receiverData.encryptedData,
        receiverPrivateKey,
      );

      // Vérifier la signature
      const senderPublicKey = await getUserPublicKey(
        dataShare.senderId as mongoose.Types.ObjectId,
      );
      const isSignatureValid = verifySignature(
        decryptedDataJSON,
        dataShare.signature,
        senderPublicKey,
        SHARE_SIGNATURE_VALIDITY_MS,
      );

      if (!isSignatureValid) {
        throw new Error(
          "⚠️ Signature invalide ! Les données ont peut-être été altérées.",
        );
      }

      const data = JSON.parse(decryptedDataJSON);
      preloadedData = { data, dataType: dataShare.dataType };

      dataShareLogger.info("Données préchargées pour copie", {
        shareId: shareId.toString(),
      });
    } catch (preloadError) {
      dataShareLogger.error("Erreur lors du préchargement des données", {
        error:
          preloadError instanceof Error
            ? preloadError.message
            : String(preloadError),
        stack: preloadError instanceof Error ? preloadError.stack : undefined,
      });
      throw new Error(
        `Impossible de déchiffrer les données: ${(preloadError as Error).message}`,
      );
    }
  }

  // Mettre à jour le statut
  dataShare.encryptedDataPerReceiver[receiverDataIndex].status = status;
  await dataShare.save();

  dataShareLogger.info("Statut mis à jour", {
    status,
    receiverId: receiverId.toString(),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VÉRIFICATION SI TOUS LES DESTINATAIRES ONT RÉPONDU
  // ═══════════════════════════════════════════════════════════════════════════
  // Si tous les destinataires ont accepté ou refusé, le partage est désactivé
  // Les destinataires qui n'ont pas répondu ont jusqu'à la date d'expiration
  // ═══════════════════════════════════════════════════════════════════════════
  const allResponded = dataShare.encryptedDataPerReceiver.every(
    (item) => item.status === "accepted" || item.status === "declined",
  );

  if (allResponded) {
    dataShare.isActive = false;
    await dataShare.save();
    dataShareLogger.info(
      "Partage désactivé - Tous les destinataires ont répondu",
      {
        shareId: shareId.toString(),
      },
    );
  }

  // Envoyer une notification à l'expéditeur
  const senderId = (dataShare.senderId as any)?._id || dataShare.senderId;
  const receiverName = await getUserDisplayName(receiverId);
  const dataTypeLabel = getDataTypeLabel(dataShare.dataType);

  try {
    if (status === "accepted") {
      await createNotification(
        senderId as mongoose.Types.ObjectId,
        "share_accepted",
        "Partage accepté",
        `${receiverName} a accepté ${dataTypeLabel} que vous avez partagé`,
        {
          shareId: dataShare._id as mongoose.Types.ObjectId,
          senderId: receiverId,
        },
      );
    } else {
      await createNotification(
        senderId as mongoose.Types.ObjectId,
        "share_declined",
        "Partage refusé",
        `${receiverName} a refusé ${dataTypeLabel} que vous avez partagé`,
        {
          shareId: dataShare._id as mongoose.Types.ObjectId,
          senderId: receiverId,
        },
      );
    }
  } catch (notifError) {
    dataShareLogger.error("Erreur notification pour l'expéditeur", {
      error:
        notifError instanceof Error ? notifError.message : String(notifError),
      stack: notifError instanceof Error ? notifError.stack : undefined,
    });
  }

  // Si accepté, copier les données dans le compte du destinataire
  if (status === "accepted" && preloadedData) {
    try {
      const copiedData = await copySharedDataToReceiver(
        receiverId,
        shareId,
        preloadedData,
      );
      return { copiedData };
    } catch (error) {
      dataShareLogger.error("Erreur lors de la copie des données", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error(
        `Partage accepté mais erreur lors de la copie des données: ${(error as Error).message}`,
      );
    }
  }

  return {};
}

/**
 * Copie les données partagées dans le compte du destinataire
 * Crée de nouvelles entités (point, fiche, liste) avec les clés du destinataire
 * Et les ajoute au memoryStorage si une session existe
 *
 * @param receiverId - ID du destinataire
 * @param shareId - ID du partage
 * @param preloadedData - Données déjà récupérées et déchiffrées (optionnel)
 */
async function copySharedDataToReceiver(
  receiverId: mongoose.Types.ObjectId,
  shareId: mongoose.Types.ObjectId,
  preloadedData?: { data: any; dataType: string },
): Promise<{ type: string; id: string; name: string }> {
  const { encryptUserKeys } = await import("../utils/userEncryptionUtils");

  // Helper pour normaliser la location en chaîne JSON
  const normalizeLocation = (location: any): string => {
    if (typeof location === "string") {
      return location;
    }
    // Si c'est un objet, le convertir en JSON
    return JSON.stringify(location);
  };

  // Helper pour parser la location (JSON string ou objet)
  const parseLocation = (
    locationStr: string,
  ): { lat: number; lng: number } | null => {
    try {
      if (typeof locationStr === "string") {
        return JSON.parse(locationStr);
      }
      return locationStr as any;
    } catch {
      return null;
    }
  };

  // Utiliser les données préchargées ou récupérer depuis la base
  // Note: On utilise getSharedDataForCopy qui ne vérifie pas isActive
  let sharedData: { data: any; dataType: string };

  if (preloadedData) {
    sharedData = preloadedData;
  } else {
    sharedData = await getSharedDataForCopy(receiverId, shareId);
  }
  const { data, dataType } = sharedData;

  const receiverIdStr = receiverId.toString();
  const hasSession = memoryStorage.hasSession(receiverIdStr);

  dataShareLogger.info("Copie des données pour utilisateur", {
    dataType,
    receiverId: receiverId.toString(),
    hasSession,
  });

  switch (dataType) {
    case "point": {
      // Créer un nouveau point pour le destinataire
      const pointData = data.point || data;
      const locationDecrypted = normalizeLocation(
        data.location_decrypted || pointData.location,
      );

      // Chiffrer TOUS les champs avec les clés du destinataire
      const locationEncrypted = await encryptUserKeys(
        receiverId,
        locationDecrypted,
      );
      const nameEncrypted = await encryptUserKeys(
        receiverId,
        `${pointData.name} (partagé)`,
      );
      const descriptionEncrypted = await encryptUserKeys(
        receiverId,
        pointData.description || "",
      );
      const accessTypeEncrypted = pointData.accessType
        ? await encryptUserKeys(receiverId, pointData.accessType)
        : "";

      // Créer le GeoJSON pour les requêtes géospatiales
      const parsedLoc = parseLocation(locationDecrypted);
      const geoJsonLocation = parsedLoc
        ? {
            type: "Point" as const,
            coordinates: [parsedLoc.lng, parsedLoc.lat] as [number, number],
          }
        : undefined;

      const newPoint = new PointModel({
        userId: receiverId,
        name: nameEncrypted,
        description: descriptionEncrypted,
        location_encrypted: locationEncrypted,
        accessType: accessTypeEncrypted,
        location: geoJsonLocation,
      });

      await newPoint.save();

      // Ajouter au memoryStorage si session active (avec données déchiffrées)
      if (hasSession) {
        const parsedLocation = parseLocation(locationDecrypted);
        const pointForMemory = {
          _id: newPoint._id,
          userId: receiverId,
          name: `${pointData.name} (partagé)`,
          description: pointData.description || "",
          location: parsedLocation,
          accessType: pointData.accessType || "",
          createdAt: newPoint.createdAt,
          updatedAt: newPoint.updatedAt,
        };
        memoryStorage.storePoint(receiverIdStr, pointForMemory as any);
        dataShareLogger.info("Point ajouté au memoryStorage");
      }

      dataShareLogger.info("Point copié et chiffré", {
        pointId: newPoint._id.toString(),
      });
      return {
        type: "point",
        id: newPoint._id.toString(),
        name: `${pointData.name} (partagé)`,
      };
    }

    case "fiche": {
      // Créer une nouvelle fiche avec ses points
      const ficheData = data.fiche;
      const pointsData = data.points || [];

      // D'abord créer les points (avec chiffrement complet, en parallèle)
      const newPointIds: mongoose.Types.ObjectId[] = [];
      const newPointsForMemory: any[] = [];

      const createdFichePoints = await Promise.all(
        pointsData.map(async (pointData: any) => {
          const locationDecrypted = normalizeLocation(
            pointData.location_decrypted || pointData.location,
          );

          // Chiffrer TOUS les champs avec les clés du destinataire
          const locationEncrypted = await encryptUserKeys(
            receiverId,
            locationDecrypted,
          );
          const nameEncrypted = await encryptUserKeys(
            receiverId,
            pointData.name,
          );
          const descriptionEncrypted = await encryptUserKeys(
            receiverId,
            pointData.description || "",
          );
          const accessTypeEncrypted = pointData.accessType
            ? await encryptUserKeys(receiverId, pointData.accessType)
            : "";

          // Créer le GeoJSON pour les requêtes géospatiales
          const parsedLoc = parseLocation(locationDecrypted);
          const geoJsonLocation = parsedLoc
            ? {
                type: "Point" as const,
                coordinates: [parsedLoc.lng, parsedLoc.lat] as [number, number],
              }
            : undefined;

          const newPoint = new PointModel({
            userId: receiverId,
            name: nameEncrypted,
            description: descriptionEncrypted,
            location_encrypted: locationEncrypted,
            accessType: accessTypeEncrypted,
            location: geoJsonLocation,
          });

          await newPoint.save();

          // Préparer pour memoryStorage (données déchiffrées)
          const parsedLocation = parseLocation(locationDecrypted);
          const pointForMemory = {
            _id: newPoint._id,
            userId: receiverId,
            name: pointData.name,
            description: pointData.description || "",
            location: parsedLocation,
            accessType: pointData.accessType || "",
            createdAt: newPoint.createdAt,
            updatedAt: newPoint.updatedAt,
          };

          return {
            pointId: newPoint._id as mongoose.Types.ObjectId,
            pointForMemory,
          };
        }),
      );

      for (const { pointId, pointForMemory } of createdFichePoints) {
        newPointIds.push(pointId);
        newPointsForMemory.push(pointForMemory);
      }

      // Helper pour convertir en string (gère les tableaux)
      const toEncryptableString = (value: any): string => {
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) return JSON.stringify(value);
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      };

      // Chiffrer les champs de la fiche
      const ficheNameEncrypted = await encryptUserKeys(
        receiverId,
        `${ficheData.name} (partagé)`,
      );
      const ficheVilleEncrypted = await encryptUserKeys(
        receiverId,
        toEncryptableString(ficheData.ville),
      );
      const ficheTypeEncrypted = await encryptUserKeys(
        receiverId,
        toEncryptableString(ficheData.type),
      );
      const ficheEtatEncrypted = await encryptUserKeys(
        receiverId,
        toEncryptableString(ficheData.etat),
      );
      const ficheDifficulteEncrypted = ficheData.difficulte_acces
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.difficulte_acces),
          )
        : undefined;
      const ficheRisqueEncrypted = ficheData.risque_oxygene
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.risque_oxygene),
          )
        : undefined;
      const ficheAccesEncrypted = ficheData.acces_souterrain
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.acces_souterrain),
          )
        : undefined;
      const fichePraticiteEncrypted = ficheData.praticite_souterrain
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.praticite_souterrain),
          )
        : undefined;
      const ficheEtatGeneralEncrypted = ficheData.etat_general
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.etat_general),
          )
        : undefined;
      const ficheEquipementEncrypted = ficheData.equipement_conseille
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.equipement_conseille),
          )
        : undefined;
      const ficheSurfaceEncrypted = ficheData.surface
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.surface),
          )
        : undefined;
      const ficheTypeGaleriesEncrypted = ficheData.type_galeries
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.type_galeries),
          )
        : undefined;
      const ficheInteretsEncrypted = ficheData.interets
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.interets),
          )
        : undefined;
      const ficheAccessibiliteEncrypted = ficheData.accessibilite
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.accessibilite),
          )
        : undefined;
      const ficheCommentaireEncrypted = ficheData.commentaire
        ? await encryptUserKeys(
            receiverId,
            toEncryptableString(ficheData.commentaire),
          )
        : undefined;

      // Créer la fiche avec données chiffrées
      const newFiche = new FicheModel({
        userId: receiverId,
        name: ficheNameEncrypted,
        ville: ficheVilleEncrypted,
        type: ficheTypeEncrypted,
        etat: ficheEtatEncrypted,
        accessibilite: ficheAccessibiliteEncrypted,
        difficulte_acces: ficheDifficulteEncrypted,
        risque_oxygene: ficheRisqueEncrypted,
        acces_souterrain: ficheAccesEncrypted,
        praticite_souterrain: fichePraticiteEncrypted,
        etat_general: ficheEtatGeneralEncrypted,
        commentaire: ficheCommentaireEncrypted,
        points_ids: newPointIds,
        equipement_conseille: ficheEquipementEncrypted,
        surface: ficheSurfaceEncrypted,
        type_galeries: ficheTypeGaleriesEncrypted,
        interets: ficheInteretsEncrypted,
        center_cavite: ficheData.center_cavite,
      });

      await newFiche.save();

      // Mettre à jour les points avec la référence à la fiche
      await PointModel.updateMany(
        { _id: { $in: newPointIds } },
        { ficheId: newFiche._id },
      );

      // Ajouter au memoryStorage si session active (avec données déchiffrées)
      if (hasSession) {
        // Ajouter les points
        for (let i = 0; i < newPointsForMemory.length; i++) {
          newPointsForMemory[i].ficheId = newFiche._id;
          memoryStorage.storePoint(receiverIdStr, newPointsForMemory[i] as any);
        }
        // Ajouter la fiche (données déchiffrées pour le memoryStorage)
        const ficheForMemory = {
          _id: newFiche._id,
          userId: receiverId,
          name: `${ficheData.name} (partagé)`,
          ville: ficheData.ville,
          type: ficheData.type,
          etat: ficheData.etat,
          accessibilite: ficheData.accessibilite,
          difficulte_acces: ficheData.difficulte_acces,
          risque_oxygene: ficheData.risque_oxygene,
          acces_souterrain: ficheData.acces_souterrain,
          praticite_souterrain: ficheData.praticite_souterrain,
          etat_general: ficheData.etat_general,
          commentaire: ficheData.commentaire,
          points_ids: newPointIds,
          equipement_conseille: ficheData.equipement_conseille,
          surface: ficheData.surface,
          type_galeries: ficheData.type_galeries,
          interets: ficheData.interets,
          center_cavite: ficheData.center_cavite,
          date_creation: newFiche.date_creation,
          date_modification: newFiche.date_modification,
        };
        memoryStorage.storeFiche(receiverIdStr, ficheForMemory as any);
        dataShareLogger.info("Fiche et points ajoutés au memoryStorage", {
          pointCount: newPointIds.length,
        });
      }

      dataShareLogger.info("Fiche copiée et chiffrée", {
        ficheId: newFiche._id.toString(),
        pointCount: newPointIds.length,
      });
      return {
        type: "fiche",
        id: newFiche._id.toString(),
        name: `${ficheData.name} (partagé)`,
      };
    }

    case "liste": {
      // Créer une nouvelle liste avec ses points
      const listData = data.list;
      const pointsData = data.points || [];

      // D'abord créer les points (avec chiffrement complet, en parallèle)
      const newPointIds: mongoose.Types.ObjectId[] = [];
      const newPointsForMemory: any[] = [];

      const createdListPoints = await Promise.all(
        pointsData.map(async (pointData: any) => {
          const locationDecrypted = normalizeLocation(
            pointData.location_decrypted || pointData.location,
          );

          // Chiffrer TOUS les champs avec les clés du destinataire
          const locationEncrypted = await encryptUserKeys(
            receiverId,
            locationDecrypted,
          );
          const nameEncrypted = await encryptUserKeys(
            receiverId,
            pointData.name,
          );
          const descriptionEncrypted = await encryptUserKeys(
            receiverId,
            pointData.description || "",
          );
          const accessTypeEncrypted = pointData.accessType
            ? await encryptUserKeys(receiverId, pointData.accessType)
            : "";

          // Créer le GeoJSON pour les requêtes géospatiales
          const parsedLoc = parseLocation(locationDecrypted);
          const geoJsonLocation = parsedLoc
            ? {
                type: "Point" as const,
                coordinates: [parsedLoc.lng, parsedLoc.lat] as [number, number],
              }
            : undefined;

          const newPoint = new PointModel({
            userId: receiverId,
            name: nameEncrypted,
            description: descriptionEncrypted,
            location_encrypted: locationEncrypted,
            accessType: accessTypeEncrypted,
            location: geoJsonLocation,
          });

          await newPoint.save();

          // Préparer pour memoryStorage (données déchiffrées)
          const parsedLocation = parseLocation(locationDecrypted);
          const pointForMemory = {
            _id: newPoint._id,
            userId: receiverId,
            name: pointData.name,
            description: pointData.description || "",
            location: parsedLocation,
            accessType: pointData.accessType || "",
            createdAt: newPoint.createdAt,
            updatedAt: newPoint.updatedAt,
          };

          return {
            pointId: newPoint._id as mongoose.Types.ObjectId,
            pointForMemory,
          };
        }),
      );

      for (const { pointId, pointForMemory } of createdListPoints) {
        newPointIds.push(pointId);
        newPointsForMemory.push(pointForMemory);
      }

      // Chiffrer les champs de la liste
      const listNameEncrypted = await encryptUserKeys(
        receiverId,
        `${listData.name} (partagé)`,
      );
      const listDescriptionEncrypted = await encryptUserKeys(
        receiverId,
        listData.description || "",
      );

      // Créer la liste avec données chiffrées
      const newList = new ListModel({
        userId: receiverId,
        name: listNameEncrypted,
        description: listDescriptionEncrypted,
        points: newPointIds,
        color: listData.color || "#000000",
        icon: listData.icon || "default-icon",
      });

      await newList.save();

      // Ajouter au memoryStorage si session active (avec données déchiffrées)
      if (hasSession) {
        // Ajouter les points
        for (const pointForMemory of newPointsForMemory) {
          memoryStorage.storePoint(receiverIdStr, pointForMemory as any);
        }
        // Ajouter la liste (données déchiffrées pour le memoryStorage)
        const listForMemory = {
          _id: newList._id,
          userId: receiverId,
          name: `${listData.name} (partagé)`,
          description: listData.description || "",
          points: newPointIds,
          color: listData.color || "#000000",
          icon: listData.icon || "default-icon",
          createdAt: newList.createdAt,
          updatedAt: newList.updatedAt,
        };
        memoryStorage.storeList(receiverIdStr, listForMemory as any);
        dataShareLogger.info("Liste et points ajoutés au memoryStorage", {
          pointCount: newPointIds.length,
        });
      }

      dataShareLogger.info("Liste copiée et chiffrée", {
        listId: newList._id.toString(),
        pointCount: newPointIds.length,
      });
      return {
        type: "liste",
        id: newList._id.toString(),
        name: `${listData.name} (partagé)`,
      };
    }

    default:
      throw new Error(`Type de données non supporté: ${dataType}`);
  }
}

/**
 * Liste des partages reçus par un utilisateur
 */
export async function getReceivedShares(
  receiverId: mongoose.Types.ObjectId,
  includeExpired: boolean = false,
): Promise<IDataShare[]> {
  const query: any = {
    receiverIds: receiverId,
    isActive: true,
  };

  if (!includeExpired) {
    query.expiresAt = { $gte: new Date() };
  }

  const shares = await DataShareModel.find(query)
    .populate("senderId", "name surname pseudo showPseudo")
    .sort({ sharedAt: -1 });

  return shares;
}

/**
 * Liste des partages envoyés par un utilisateur
 */
export async function getSentShares(
  senderId: mongoose.Types.ObjectId,
  includeExpired: boolean = false,
): Promise<IDataShare[]> {
  const query: any = {
    senderId: senderId,
    isActive: true,
  };

  if (!includeExpired) {
    query.expiresAt = { $gte: new Date() };
  }

  const shares = await DataShareModel.find(query)
    .populate("receiverIds", "name surname pseudo showPseudo")
    .sort({ sharedAt: -1 });

  return shares;
}

/**
 * Nettoyage automatique des partages expirés
 * À appeler périodiquement (cron job)
 */
export async function cleanupExpiredShares(): Promise<number> {
  const result = await DataShareModel.updateMany(
    {
      expiresAt: { $lt: new Date() },
      isActive: true,
    },
    {
      $set: { isActive: false },
    },
  );

  dataShareLogger.info("Partages expirés désactivés", {
    count: result.modifiedCount,
  });

  return result.modifiedCount;
}
