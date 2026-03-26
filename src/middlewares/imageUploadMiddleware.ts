// src/middlewares/imageUploadMiddleware.ts
// Middleware pour la gestion de l'upload d'images avec Multer

import multer from "multer";
import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../services/loggerService";
import {
  STORAGE_CONFIG,
  STORAGE_ERROR_MESSAGES,
} from "../config/storageConfig";

/**
 * Configuration Multer avec stockage en mémoire
 */
const storage = multer.memoryStorage();

/**
 * Filtre de fichiers - valide les types MIME
 */
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const uploadLogger = logger.child({
    middleware: "ImageUpload",
    userId: (req as any).user?.id,
  });

  // Vérifier le MIME type
  if (!STORAGE_CONFIG.ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
    uploadLogger.warn("Type de fichier non autorisé", {
      mimetype: file.mimetype,
      originalname: file.originalname,
      allowedTypes: STORAGE_CONFIG.ALLOWED_MIME_TYPES,
    });
    return cb(
      new Error(
        `Format non supporté. Formats acceptés: ${STORAGE_CONFIG.ALLOWED_MIME_TYPES.join(", ")}`,
      ),
    );
  }

  uploadLogger.debug("Type de fichier accepté", {
    mimetype: file.mimetype,
    originalname: file.originalname,
  });

  cb(null, true);
};

/**
 * Instance Multer configurée
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: STORAGE_CONFIG.MAX_UPLOAD_SIZE_BYTES,
    files: 1, // Une seule photo par requête
  },
});

/**
 * Middleware de validation de l'upload
 * Vérifie qu'un fichier a bien été uploadé
 */
export const validateImageUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const uploadLogger = logger.child({
    middleware: "ImageUpload",
    userId: req.user?.id,
  });

  try {
    // Vérifier qu'un fichier est présent
    if (!req.file) {
      uploadLogger.warn("Aucun fichier fourni dans la requête", {
        userId: req.user?.id,
        path: req.path,
      });
      res.status(400).json({
        error: "Aucun fichier fourni",
        message: "Veuillez fournir une photo",
      });
      return;
    }

    // Vérifier la taille du fichier
    if (req.file.size > STORAGE_CONFIG.MAX_UPLOAD_SIZE_BYTES) {
      uploadLogger.warn("Fichier trop volumineux", {
        userId: req.user?.id,
        fileSize: req.file.size,
        maxSize: STORAGE_CONFIG.MAX_UPLOAD_SIZE_BYTES,
        originalname: req.file.originalname,
      });
      res.status(413).json({
        error: STORAGE_ERROR_MESSAGES.FILE_TOO_LARGE,
        maxSize: STORAGE_CONFIG.MAX_UPLOAD_SIZE_MB,
        unit: "MB",
      });
      return;
    }

    uploadLogger.info("Fichier valide reçu", {
      userId: req.user?.id,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    next();
  } catch (error) {
    uploadLogger.error("Erreur lors de la validation de l'upload", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      error: "Erreur lors de la validation du fichier",
    });
  }
};

/**
 * Rate limiter pour les uploads
 * Limite: 10 uploads par 15 minutes par utilisateur
 */
export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads max
  message: "Trop d'uploads. Veuillez réessayer dans 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Utiliser l'ID utilisateur pour le rate limiting
    return req.user?.id || req.ip || "unknown";
  },
  handler: (req: Request, res: Response) => {
    logger.warn("Rate limit dépassé pour upload photo", {
      userId: req.user?.id,
      ip: req.ip,
    });
    res.status(429).json({
      error: "Trop d'uploads",
      message:
        "Vous avez atteint la limite d'uploads. Veuillez réessayer dans 15 minutes.",
      retryAfter: 15 * 60, // en secondes
    });
  },
});
