// src/middlewares/storageQuotaMiddleware.ts
// Middleware de vérification du quota de stockage avant upload

import { Request, Response, NextFunction } from "express";
import { logger } from "../services/loggerService";
import storageQuotaService from "../services/storageQuotaService";
import { STORAGE_CONFIG } from "../config/storageConfig";

/**
 * Middleware qui vérifie si l'utilisateur a suffisamment d'espace
 * pour uploader un fichier
 */
export const checkStorageQuota = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const quotaLogger = logger.child({
    middleware: "StorageQuota",
    userId: req.user?.id,
  });

  try {
    const userId = req.user?.id;

    if (!userId) {
      quotaLogger.warn("Vérification quota sans authentification", {
        path: req.path,
      });
      res.status(401).json({
        error: "Non authentifié",
      });
      return;
    }

    // Vérifier qu'un fichier est présent
    if (!req.file) {
      quotaLogger.warn("Vérification quota sans fichier", {
        userId,
        path: req.path,
      });
      res.status(400).json({
        error: "Aucun fichier fourni",
      });
      return;
    }

    // Vérifier le quota (on vérifie avec la taille max après compression)
    const requiredBytes = STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES;
    const hasQuota = await storageQuotaService.checkQuotaAvailable(
      userId,
      requiredBytes,
    );

    if (!hasQuota) {
      // Récupérer les informations de stockage pour la réponse
      const storageInfo = await storageQuotaService.getUserStorageInfo(userId);

      quotaLogger.warn("Quota de stockage dépassé", {
        userId,
        storageInfo,
        requiredBytes,
        available: storageInfo.available,
        percentage: storageInfo.percentage,
      });

      res.status(507).json({
        error: "Quota de stockage dépassé",
        required: requiredBytes,
        available: storageInfo.available,
        quota: storageInfo.quota,
        used: storageInfo.used,
        percentage: storageInfo.percentage,
      });
      return;
    }

    quotaLogger.debug("Quota vérifié avec succès", {
      userId,
      requiredBytes,
      fileName: req.file.originalname,
    });

    next();
  } catch (error) {
    quotaLogger.error("Erreur lors de la vérification du quota", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      error: "Erreur lors de la vérification du quota de stockage",
    });
  }
};
