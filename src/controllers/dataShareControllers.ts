import { getErrorMessage } from "../utils/errorUtils";
import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  shareData,
  getSharedData,
  updateShareStatus,
  getReceivedShares,
  getSentShares,
} from "../services/dataShareService";
import { DataType } from "../models/dataShare";
import { decrypt } from "../utils/masterEncryptionUtils";
import { syncService } from "../services/syncService";
import { sendShareNotificationEmail } from "../services/emailService";
import User from "../models/users";
import { logger } from "../services/loggerService";

const dataShareLogger = logger.child({ service: "data-share" });

/**
 * Déchiffre les informations d'un utilisateur en respectant le paramètre showPseudo
 * SÉCURITÉ: Ne retourne JAMAIS l'email pour protéger la vie privée des utilisateurs
 */
function decryptUserInfo(user: any): {
  _id: string;
  name: string;
  surname: string;
  pseudo?: string;
  showPseudo: boolean;
} {
  if (!user) {
    return {
      _id: "",
      name: "Utilisateur inconnu",
      surname: "",
      showPseudo: false,
    };
  }

  try {
    const userId = user._id?.toString() || "";
    const showPseudo = user.showPseudo || false;

    // Déchiffrer le pseudo si présent
    let decryptedPseudo: string | undefined;
    if (user.pseudo) {
      try {
        decryptedPseudo = decrypt(user.pseudo);
      } catch (e) {
        dataShareLogger.error("Erreur déchiffrement pseudo", {
          userId,
          error: e,
        });
      }
    }

    // Si showPseudo est activé et qu'un pseudo existe, utiliser le pseudo
    if (showPseudo && decryptedPseudo) {
      return {
        _id: userId,
        name: decryptedPseudo, // Utiliser le pseudo comme "nom" pour compatibilité
        surname: "", // Masqué pour sécurité
        pseudo: decryptedPseudo,
        showPseudo: true,
      };
    }

    // Mode normal : déchiffrer et renvoyer le nom/prénom (JAMAIS l'email)
    const decryptedName = user.name ? decrypt(user.name) : "Inconnu";
    const decryptedSurname = user.surname ? decrypt(user.surname) : "";

    return {
      _id: userId,
      name: decryptedName,
      surname: decryptedSurname,
      pseudo: decryptedPseudo,
      showPseudo: false,
    };
  } catch (error) {
    dataShareLogger.error("Erreur déchiffrement infos utilisateur", { error });
    return {
      _id: user._id?.toString() || "",
      name: "Erreur",
      surname: "",
      showPseudo: false,
    };
  }
}

/**
 * Partager des données (fiche, liste ou point) avec d'autres utilisateurs
 * POST /api/share
 */
export const handleShareData = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const senderId = req.user?.id; // Récupéré par authMiddleware via req.user.id

    if (!senderId) {
      res.status(401).json({ error: "Authentification requise" });
      return;
    }

    const { receiverIds, dataType, dataId, message } = req.body;

    dataShareLogger.info("Demande de partage", {
      senderId,
      dataType,
      dataId,
    });

    // Validation des paramètres
    if (
      !receiverIds ||
      !Array.isArray(receiverIds) ||
      receiverIds.length === 0
    ) {
      res.status(400).json({ error: "Au moins un destinataire est requis" });
      return;
    }

    if (!["fiche", "point", "liste"].includes(dataType)) {
      res.status(400).json({ error: "Type de données invalide" });
      return;
    }

    if (!dataId || !mongoose.Types.ObjectId.isValid(dataId)) {
      res.status(400).json({ error: "ID de données invalide" });
      return;
    }

    // Convertir les IDs en ObjectId
    const receiverObjectIds = receiverIds.map((id: string) => {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`ID de destinataire invalide: ${id}`);
      }
      return new mongoose.Types.ObjectId(id);
    });

    const senderObjectId = new mongoose.Types.ObjectId(senderId);
    const dataObjectId = new mongoose.Types.ObjectId(dataId);

    // IMPORTANT: Forcer la synchronisation avant le partage pour s'assurer que
    // toutes les données (notamment les points d'une liste) sont en base de données
    dataShareLogger.info("Synchronisation des données avant partage");
    try {
      await syncService.syncNow(senderId);
      dataShareLogger.info("Synchronisation terminée");
    } catch (syncError) {
      dataShareLogger.warn("Avertissement lors de la synchronisation", {
        error: syncError,
      });
      // On continue quand même, les données peuvent être récupérées depuis la mémoire
    }

    // Créer le partage
    const share = await shareData(
      senderObjectId,
      receiverObjectIds,
      dataType as DataType,
      dataObjectId,
      message,
    );

    res.status(201).json({
      success: true,
      message: `${dataType} partagé avec succès`,
      shareId: share._id,
      expiresAt: share.expiresAt,
      receiverCount: receiverObjectIds.length,
    });

    dataShareLogger.info("Données partagées", {
      dataType,
      senderId,
      receiverCount: receiverObjectIds.length,
    });

    // Envoyer des emails aux destinataires (asynchrone, ne bloque pas la réponse)
    const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
    const shareLink = `${frontendUrl}/partage`;

    // Récupérer le nom de l'expéditeur
    const sender = await User.findById(senderId).select(
      "name surname pseudo showPseudo",
    );
    let senderName = "Un utilisateur";
    if (sender) {
      if (sender.showPseudo && sender.pseudo) {
        try {
          senderName = decrypt(sender.pseudo);
        } catch (e) {}
      } else if (sender.name) {
        try {
          senderName = decrypt(sender.name);
        } catch (e) {}
      }
    }

    // Envoyer un email à chaque destinataire
    for (const receiverId of receiverObjectIds) {
      try {
        const receiver = await User.findById(receiverId).select("email name");
        if (receiver?.email) {
          const recipientEmail = decrypt(receiver.email);
          const recipientName = receiver.name
            ? decrypt(receiver.name)
            : "Utilisateur";

          sendShareNotificationEmail(
            recipientEmail,
            recipientName,
            senderName,
            dataType,
            shareLink,
            message || undefined,
          ).catch((err) =>
            dataShareLogger.error("Erreur envoi email partage", {
              receiverId,
              error: err,
            }),
          );
        }
      } catch (emailError) {
        dataShareLogger.error("Erreur récupération destinataire", {
          receiverId,
          error: emailError,
        });
      }
    }
  } catch (error: unknown) {
    dataShareLogger.error("Erreur partage", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors du partage des données",
      details: getErrorMessage(error),
    });
  }
};

/**
 * Récupérer les données partagées (déchiffrement et vérification de signature)
 * GET /api/share/:shareId
 */
export const handleGetSharedData = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const receiverId = req.user?.id;

    if (!receiverId) {
      res.status(401).json({ error: "Authentification requise" });
      return;
    }

    const { shareId } = req.params;
    const ipAddress = req.ip || req.socket.remoteAddress;

    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      res.status(400).json({ error: "ID de partage invalide" });
      return;
    }

    const receiverObjectId = new mongoose.Types.ObjectId(receiverId);
    const shareObjectId = new mongoose.Types.ObjectId(shareId);

    // Récupérer et déchiffrer les données
    const result = await getSharedData(
      receiverObjectId,
      shareObjectId,
      ipAddress,
    );

    res.status(200).json({
      success: true,
      data: result.data,
      message: result.message,
      sender: decryptUserInfo(result.sender),
      sharedAt: result.sharedAt,
      expiresAt: result.expiresAt,
      dataType: result.dataType,
      signatureValid: result.signatureValid,
    });

    dataShareLogger.info("Données récupérées", {
      receiverId,
      signatureValid: result.signatureValid,
    });
  } catch (error: unknown) {
    dataShareLogger.error("Erreur récupération données partagées", {
      error: getErrorMessage(error),
    });

    if (getErrorMessage(error).includes("expiré")) {
      res.status(410).json({ error: getErrorMessage(error) });
    } else if (getErrorMessage(error).includes("Signature invalide")) {
      res.status(403).json({ error: getErrorMessage(error), tampered: true });
    } else {
      res.status(500).json({
        error: "Erreur lors de la récupération des données partagées",
        details: getErrorMessage(error),
      });
    }
  }
};

/**
 * Accepter ou refuser un partage
 * PATCH /api/share/:shareId/status
 */
export const handleUpdateShareStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const receiverId = req.user?.id;

    if (!receiverId) {
      res.status(401).json({ error: "Authentification requise" });
      return;
    }

    const { shareId } = req.params;
    const { status } = req.body;

    if (!["accepted", "declined"].includes(status)) {
      res.status(400).json({ error: "Statut invalide (accepted ou declined)" });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      res.status(400).json({ error: "ID de partage invalide" });
      return;
    }

    const receiverObjectId = new mongoose.Types.ObjectId(receiverId);
    const shareObjectId = new mongoose.Types.ObjectId(shareId);

    const result = await updateShareStatus(
      receiverObjectId,
      shareObjectId,
      status,
    );

    if (status === "accepted" && result.copiedData) {
      res.status(200).json({
        success: true,
        message: `Partage accepté ! ${result.copiedData.type === "point" ? "Le point" : result.copiedData.type === "fiche" ? "La fiche" : "La liste"} "${result.copiedData.name}" a été ajouté(e) à votre compte.`,
        copiedData: result.copiedData,
      });
    } else {
      res.status(200).json({
        success: true,
        message: `Partage ${status === "accepted" ? "accepté" : "refusé"}`,
      });
    }

    dataShareLogger.info("Statut partage mis à jour", {
      status,
      receiverId,
      shareId,
      copiedData: result.copiedData?.type,
    });
  } catch (error: unknown) {
    dataShareLogger.error("Erreur mise à jour statut", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la mise à jour du statut",
      details: getErrorMessage(error),
    });
  }
};

/**
 * Lister les partages reçus
 * GET /api/share/received
 */
export const handleGetReceivedShares = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const receiverId = req.user?.id;

    if (!receiverId) {
      res.status(401).json({ error: "Authentification requise" });
      return;
    }

    const includeExpired = req.query.includeExpired === "true";

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    const receiverObjectId = new mongoose.Types.ObjectId(receiverId);

    const shares = await getReceivedShares(receiverObjectId, includeExpired);
    const total = shares.length;

    // Appliquer la pagination
    const paginatedShares = shares.slice(offset, offset + limit);

    // Filtrer les données sensibles et ajouter des infos utiles
    // Déchiffrer les informations de l'expéditeur en respectant showPseudo
    const sharesFormatted = paginatedShares.map((share) => ({
      _id: share._id,
      sender: decryptUserInfo(share.senderId),
      dataType: share.dataType,
      dataId: share.dataId,
      sharedAt: share.sharedAt,
      expiresAt: share.expiresAt,
      status:
        share.encryptedDataPerReceiver.find(
          (item: any) => item.receiverId.toString() === receiverId,
        )?.status || "pending",
      hasMessage:
        share.messagePerReceiver && share.messagePerReceiver.length > 0,
      isExpired: share.expiresAt < new Date(),
      relatedPointsCount: share.relatedPointsIds?.length || 0,
    }));

    res.status(200).json({
      success: true,
      data: sharesFormatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

    dataShareLogger.info("Partages reçus récupérés", {
      receiverId,
      count: sharesFormatted.length,
      total,
    });
  } catch (error: unknown) {
    dataShareLogger.error("Erreur récupération partages reçus", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des partages reçus",
      details: getErrorMessage(error),
    });
  }
};

/**
 * Lister les partages envoyés
 * GET /api/share/sent
 */
export const handleGetSentShares = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const senderId = req.user?.id;

    if (!senderId) {
      res.status(401).json({ error: "Authentification requise" });
      return;
    }

    const includeExpired = req.query.includeExpired === "true";

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    const senderObjectId = new mongoose.Types.ObjectId(senderId);

    const shares = await getSentShares(senderObjectId, includeExpired);
    const total = shares.length;

    // Appliquer la pagination
    const paginatedShares = shares.slice(offset, offset + limit);

    // Formater les données pour la réponse
    // Déchiffrer les informations des destinataires en respectant showPseudo
    const sharesFormatted = paginatedShares.map((share) => ({
      _id: share._id,
      receivers: (share.receiverIds as any[]).map((receiver: any) =>
        decryptUserInfo(receiver),
      ),
      dataType: share.dataType,
      dataId: share.dataId,
      sharedAt: share.sharedAt,
      expiresAt: share.expiresAt,
      receiverCount: share.receiverIds.length,
      readCount: share.readBy.length,
      statuses: share.encryptedDataPerReceiver.map((item: any) => ({
        receiverId: item.receiverId,
        status: item.status,
      })),
      isExpired: share.expiresAt < new Date(),
      relatedPointsCount: share.relatedPointsIds?.length || 0,
    }));

    res.status(200).json({
      success: true,
      data: sharesFormatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

    dataShareLogger.info("Partages envoyés récupérés", {
      senderId,
      count: sharesFormatted.length,
      total,
    });
  } catch (error: unknown) {
    dataShareLogger.error("Erreur récupération partages envoyés", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des partages envoyés",
      details: getErrorMessage(error),
    });
  }
};
