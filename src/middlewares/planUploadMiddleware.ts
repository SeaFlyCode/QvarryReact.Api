// src/middlewares/planUploadMiddleware.ts
// Upload multipart des plans (champ `file`, 10 Mo max, PNG/JPEG/WebP uniquement).

import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { PLANS_CONFIG, STORAGE_ERROR_MESSAGES } from "../config/storageConfig";

const allowed = PLANS_CONFIG.ALLOWED_MIME_TYPES as readonly string[];

const planMulter = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    // application/octet-stream toléré (certains clients mobiles) :
    // le vrai type est de toute façon vérifié par magic bytes dans le contrôleur.
    if (allowed.includes(file.mimetype) || file.mimetype === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    }
  },
  limits: {
    fileSize: PLANS_CONFIG.MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 5,
    fieldSize: PLANS_CONFIG.MAX_PLACEMENT_JSON_LENGTH * 2,
  },
}).single("file");

/** Wrapper multer qui traduit les erreurs d'upload en réponses JSON propres. */
export const planUpload = (req: Request, res: Response, next: NextFunction): void => {
  planMulter(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: STORAGE_ERROR_MESSAGES.FILE_TOO_LARGE,
          maxSize: PLANS_CONFIG.MAX_FILE_SIZE_BYTES / (1024 * 1024),
          unit: "MB",
        });
        return;
      }
      res.status(400).json({
        error: `${STORAGE_ERROR_MESSAGES.INVALID_FORMAT} (PNG, JPEG ou WebP)`,
      });
      return;
    }
    res.status(400).json({ error: "Requête d'upload invalide" });
  });
};
