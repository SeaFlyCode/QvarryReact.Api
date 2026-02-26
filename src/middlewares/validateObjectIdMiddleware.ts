import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";

/**
 * SEC-AUDIT: Middleware de validation des ObjectId MongoDB
 * Empêche les erreurs CastError et les injections via des paramètres d'URL invalides
 */
export const validateObjectId = (...paramNames: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const paramName of paramNames) {
      const value = req.params[paramName];
      if (value && !mongoose.Types.ObjectId.isValid(value)) {
        res.status(400).json({ error: "Identifiant invalide" });
        return;
      }
    }
    next();
  };
};
