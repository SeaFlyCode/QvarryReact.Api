// src/controllers/pointsPhotosController.ts
// Contrôleur pour la gestion des photos des points GPS

import { Request, Response } from "express";
import { logger } from "../services/loggerService";
import imageProcessingService from "../services/imageProcessingService";
import storageService from "../services/storageService";
import storageQuotaService, { QuotaExceededError } from "../services/storageQuotaService";
import PointModel from "../models/points";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { STORAGE_ERROR_MESSAGES } from "../config/storageConfig";
import { getErrorMessage } from "../utils/errorUtils";
import { memoryStorage } from "../services/memoryStorageService";

/**
 * Upload ou remplace la photo d'un point
 * POST /api/points/:pointId/photo
 * 🔒 CORRECTION: Race condition résolue avec fichier temporaire + rollback complet
 */
export const uploadPointPhoto = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { pointId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "Aucun fichier fourni" });
      return;
    }

    // Valider l'ID du point
    if (!mongoose.Types.ObjectId.isValid(pointId)) {
      res.status(400).json({ error: "ID de point invalide" });
      return;
    }

    // Récupérer le point avec vérification de propriété
    const point = await PointModel.findOne({
      _id: new mongoose.Types.ObjectId(pointId),
      userId: new mongoose.Types.ObjectId(userId),
      deletedAt: null,
    });

    if (!point) {
      res.status(404).json({ error: "Point non trouvé ou non autorisé" });
      return;
    }

    let oldPhotoSize = 0;
    let oldPhotoUrl: string | null = null;
    let oldPhotoMimeType: string | undefined = undefined;
    let oldPhotoUploadedAt: Date | undefined = undefined;
    let oldPhotoOriginalName: string | undefined = undefined;
    let oldPhotoChecksum: string | undefined = undefined;
    let tempPhotoPath: string | null = null;
    let finalFileWritten = false;
    let quotaIncremented = false;

    try {
      // Traiter l'image AVANT de toucher à l'ancienne
      const processedImage = await imageProcessingService.processImage(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

      // Sauvegarder avec un nom temporaire
      const tempPointId = `${pointId}.tmp`;
      tempPhotoPath = await storageService.savePointPhoto(
        userId,
        tempPointId,
        processedImage.buffer,
      );

      logger.info("Photo temporaire sauvegardée", {
        userId,
        pointId,
        tempPath: tempPhotoPath,
        size: processedImage.size,
      });

      // Si une photo existe, noter ses infos pour rollback potentiel
      if (point.photo) {
        oldPhotoSize = point.photo.size;
        oldPhotoUrl = point.photo.url;
        oldPhotoMimeType = point.photo.mimeType;
        oldPhotoUploadedAt = point.photo.uploadedAt;
        oldPhotoOriginalName = point.photo.originalName;
        oldPhotoChecksum = point.photo.checksum;
      }

      // Mettre à jour MongoDB AVANT de supprimer l'ancienne photo
      point.photo = {
        url: `/api/points/${pointId}/photo`,
        size: processedImage.size,
        mimeType: processedImage.mimeType,
        uploadedAt: new Date(),
        originalName: req.file.originalname,
        checksum: processedImage.checksum,
      };
      await point.save();

      logger.info("Document Point mis à jour", { userId, pointId });

      // Maintenant on peut supprimer l'ancienne photo en toute sécurité
      if (oldPhotoUrl && oldPhotoSize > 0) {
        try {
          await storageService.deletePointPhoto(userId, pointId);
          await storageQuotaService.decrementStorageUsed(userId, oldPhotoSize);
          logger.info("Ancienne photo supprimée", {
            userId,
            pointId,
            oldSize: oldPhotoSize,
          });
        } catch (deleteError) {
          // Log mais ne pas échouer si suppression de l'ancienne photo échoue
          logger.warn("Erreur lors de la suppression de l'ancienne photo", {
            userId,
            pointId,
            error: getErrorMessage(deleteError),
          });
        }
      }

      // Renommer le fichier temporaire vers le nom définitif
      await storageService.renamePointPhoto(userId, tempPointId, pointId);
      tempPhotoPath = null; // Plus besoin de rollback du temp
      finalFileWritten = true; // Le fichier est désormais sous son nom final

      logger.info("Photo temporaire renommée", { userId, pointId });

      // Incrémenter le quota (après succès complet)
      // Atomique avec check $expr (cf. fix.md backend #2). Lève
      // QuotaExceededError si le quota est dépassé par un upload concurrent.
      await storageQuotaService.incrementStorageUsed(
        userId,
        processedImage.size,
      );
      quotaIncremented = true;

      logger.info("Quota mis à jour", {
        userId,
        pointId,
        addedSize: processedImage.size,
      });

      // Récupérer les infos de stockage mises à jour
      const storageInfo = await storageQuotaService.getUserStorageInfo(userId);

      res.status(201).json({
        message: "Photo uploaded successfully",
        photo: {
          url: point.photo.url,
          size: point.photo.size,
          checksum: point.photo.checksum,
          uploadedAt: point.photo.uploadedAt,
        },
        storage: storageInfo,
      });
    } catch (error) {
      // ROLLBACK complet
      logger.error("Erreur lors de l'upload, rollback en cours", {
        userId,
        pointId,
        error: getErrorMessage(error),
      });

      // Restaurer l'ancien état du document Point
      if (oldPhotoUrl && oldPhotoSize > 0) {
        point.photo = {
          url: oldPhotoUrl,
          size: oldPhotoSize,
          mimeType: oldPhotoMimeType || "image/jpeg",
          uploadedAt: oldPhotoUploadedAt || new Date(),
          originalName: oldPhotoOriginalName || "unknown",
          checksum: oldPhotoChecksum || "",
        };
      } else {
        point.photo = undefined;
      }
      await point.save();

      // Supprimer le fichier temporaire si créé
      if (tempPhotoPath) {
        try {
          await storageService.deletePointPhoto(userId, `${pointId}.tmp`);
          logger.info("Fichier temporaire supprimé (rollback)", {
            userId,
            pointId,
          });
        } catch (cleanupError) {
          logger.error("Erreur lors du nettoyage du fichier temporaire", {
            userId,
            pointId,
            error: getErrorMessage(cleanupError),
          });
        }
      }

      // Si le fichier a été renommé en nom final mais que le quota a échoué
      // (cf. fix.md backend #2), supprimer le fichier orphelin sous son nom final.
      if (finalFileWritten && !quotaIncremented) {
        try {
          await storageService.deletePointPhoto(userId, pointId);
          logger.info("Fichier final supprimé (rollback quota)", {
            userId,
            pointId,
          });
        } catch (cleanupError) {
          logger.error("Erreur lors du nettoyage du fichier final orphelin", {
            userId,
            pointId,
            error: getErrorMessage(cleanupError),
          });
        }
      }

      // Décrémenter quota si incrémenté
      if (quotaIncremented) {
        await storageQuotaService.decrementStorageUsed(
          userId,
          point.photo?.size || 0,
        );
      }

      throw error;
    }
  } catch (error) {
    logger.error("Erreur lors de l'upload de photo", {
      error: getErrorMessage(error),
      userId: req.user?.id,
      pointId: req.params.pointId,
    });

    const errorMessage = getErrorMessage(error);
    if (error instanceof QuotaExceededError || /quota/i.test(errorMessage)) {
      res.status(507).json({ error: errorMessage });
    } else if (
      errorMessage.includes("Invalid") ||
      errorMessage.includes("invalide")
    ) {
      res.status(400).json({ error: errorMessage });
    } else {
      res.status(500).json({ error: "Erreur lors de l'upload de la photo" });
    }
  }
};

/**
 * Récupère la photo d'un point
 * GET /api/points/:pointId/photo
 */
export const getPointPhoto = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    const { pointId } = req.params;

    // Validation de l'ID du point
    if (!mongoose.Types.ObjectId.isValid(pointId)) {
      res.status(400).json({ error: "ID de point invalide" });
      return;
    }

    // Récupérer le point et vérifier qu'il appartient à l'utilisateur
    const point = await PointModel.findOne({
      _id: pointId,
      userId: new mongoose.Types.ObjectId(userId),
      deletedAt: null,
    });

    if (!point) {
      res.status(404).json({
        error: STORAGE_ERROR_MESSAGES.POINT_NOT_FOUND,
      });
      return;
    }

    if (!point.photo) {
      res.status(404).json({
        error: STORAGE_ERROR_MESSAGES.PHOTO_NOT_FOUND,
      });
      return;
    }

    // Obtenir le chemin du fichier
    const filePath = storageService.getPhotoPath(userId, pointId);

    // Vérifier que le fichier existe
    const exists = await storageService.fileExists(filePath);
    if (!exists) {
      logger.error("Fichier photo manquant", { userId, pointId, filePath });
      res.status(404).json({
        error: STORAGE_ERROR_MESSAGES.PHOTO_NOT_FOUND,
      });
      return;
    }

    // Envoyer le fichier avec cache headers
    res.setHeader("Content-Type", point.photo.mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 an
    res.setHeader("ETag", point.photo.checksum);

    // Vérifier l'ETag pour éviter un téléchargement inutile
    if (req.headers["if-none-match"] === point.photo.checksum) {
      res.status(304).end();
      return;
    }

    res.sendFile(path.resolve(filePath));
  } catch (error) {
    logger.error("Erreur lors de la récupération de la photo", { error });
    res.status(500).json({
      error: "Erreur lors de la récupération de la photo",
    });
  }
};

/**
 * Supprime la photo d'un point
 * DELETE /api/points/:pointId/photo
 */
export const deletePointPhoto = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    const { pointId } = req.params;

    // Validation de l'ID du point
    if (!mongoose.Types.ObjectId.isValid(pointId)) {
      res.status(400).json({ error: "ID de point invalide" });
      return;
    }

    // Récupérer le point et vérifier qu'il appartient à l'utilisateur
    const point = await PointModel.findOne({
      _id: pointId,
      userId: new mongoose.Types.ObjectId(userId),
      deletedAt: null,
    });

    if (!point) {
      res.status(404).json({
        error: STORAGE_ERROR_MESSAGES.POINT_NOT_FOUND,
      });
      return;
    }

    if (!point.photo) {
      res.status(404).json({
        error: STORAGE_ERROR_MESSAGES.PHOTO_NOT_FOUND,
      });
      return;
    }

    const photoSize = point.photo.size;

    // Supprimer le fichier
    await storageService.deletePointPhoto(userId as string, pointId);

    // Décrémenter le quota
    await storageQuotaService.decrementStorageUsed(userId as string, photoSize);

    // Mettre à jour le document Point
    point.photo = undefined;
    await point.save();

    // Récupérer les informations de stockage
    const storageInfo = await storageQuotaService.getUserStorageInfo(
      userId as string,
    );

    logger.info("Photo supprimée avec succès", {
      userId,
      pointId,
      photoSize,
    });

    res.status(200).json({
      message: "Photo deleted successfully",
      storage: storageInfo,
    });
  } catch (error) {
    logger.error("Erreur lors de la suppression de la photo", { error });
    res.status(500).json({
      error: STORAGE_ERROR_MESSAGES.DELETE_FAILED,
    });
  }
};

/**
 * Récupère les informations de stockage de l'utilisateur
 * GET /api/user/storage
 */
export const getUserStorageInfo = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      logger.error(
        "userId manquant dans la requête (authMiddleware non appliqué ?)",
        {
          path: req.path,
          method: req.method,
        },
      );
      res.status(401).json({
        error: "Non authentifié",
      });
      return;
    }

    logger.debug("Récupération des infos de stockage", {
      userId,
    });

    const storageInfo = await storageQuotaService.getUserStorageInfo(userId);

    res.status(200).json({
      storage: storageInfo,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("Erreur lors de la récupération des infos de stockage", {
      userId: req.user?.id,
      errorMessage,
      errorStack,
      errorType: error?.constructor?.name,
    });

    res.status(500).json({
      error: "Erreur lors de la récupération des informations de stockage",
    });
  }
};

/**
 * Récupère toutes les photos de tous les points d'un utilisateur
 * GET /api/user/photos
 */
export const getUserPhotos = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      logger.error(
        "userId manquant dans la requête (authMiddleware non appliqué ?)",
        {
          path: req.path,
          method: req.method,
        },
      );
      res.status(401).json({
        error: "Non authentifié",
      });
      return;
    }

    logger.debug("Récupération des photos de l'utilisateur", { userId });

    // Récupérer TOUS les points depuis memoryStorage (DÉJÀ DÉCHIFFRÉS)
    const allPoints = memoryStorage.getAllPoints(userId);

    // Filtrer uniquement ceux qui ont une photo
    const points = allPoints.filter((point) => point.photo);

    logger.debug("Points avec photos trouvés", {
      userId,
      count: points.length,
    });

    // Construire la liste des photos avec métadonnées
    const photos = await Promise.all(
      points.map(async (point) => {
        let size = point.photo?.size || 0;

        // Si la taille n'est pas enregistrée, essayer de la récupérer du fichier
        if (!size || size === 0) {
          try {
            const filePath = storageService.getPhotoPath(
              userId,
              point._id.toString(),
            );
            const fileExists = await storageService.fileExists(filePath);

            if (fileExists) {
              const stats = await fs.promises.stat(filePath);
              size = stats.size;
            }
          } catch (error) {
            logger.warn(
              "Erreur lors de la récupération de la taille du fichier",
              {
                userId,
                pointId: point._id.toString(),
                error: getErrorMessage(error),
              },
            );
          }
        }

        return {
          pointId: point._id.toString(),
          pointName: point.name,
          photoPath: point.photo?.url || "",
          photoUrl: `/api/v1/points/${point._id}/photo`,
          size,
          uploadedAt: point.photo?.uploadedAt || point.updatedAt,
          hasPhoto: true,
        };
      }),
    );

    // Calculer les statistiques globales
    const totalSize = photos.reduce((sum, photo) => sum + photo.size, 0);

    logger.info("Photos de l'utilisateur récupérées avec succès", {
      userId,
      total: photos.length,
      totalSize,
    });

    res.status(200).json({
      success: true,
      photos,
      stats: {
        total: photos.length,
        totalSize,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("Erreur lors de la récupération des photos de l'utilisateur", {
      userId: req.user?.id,
      errorMessage,
      errorStack,
      errorType: error?.constructor?.name,
    });

    res.status(500).json({
      error: "Erreur lors de la récupération des photos",
    });
  }
};
