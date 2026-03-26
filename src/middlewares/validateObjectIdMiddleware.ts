import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";
import { logger } from "../services/loggerService";

const objectIdLogger = logger.child({ service: "validation" });

/**
 * SEC-AUDIT: Middleware de validation des ObjectId MongoDB
 * Empêche les erreurs CastError et les injections via des paramètres d'URL invalides
 */
export const validateObjectId = (...paramNames: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const paramName of paramNames) {
      const value = req.params[paramName];
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        objectIdLogger.warn("ObjectId invalide détecté", {
          userId: (req as any).user?.id,
          paramName,
          value,
          path: req.path,
        });
        res.status(400).json({ error: "Identifiant invalide" });
        return;
      }
    }

    objectIdLogger.debug("Validation ObjectId réussie", {
      userId: (req as any).user?.id,
      params: paramNames,
    });

    next();
  };
};
