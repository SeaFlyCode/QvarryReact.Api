import { Request, Response, NextFunction } from "express";
import { logger } from "../services/loggerService";

const validationLogger = logger.child({ service: "validation" });

/**
 * Middleware de validation pour l'endpoint mute/unmute
 */
export const validateMuteBody = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { mutedUntil, notifyOnMention } = req.body;

  // mutedUntil est optionnel
  if (mutedUntil !== undefined && mutedUntil !== null) {
    const date = new Date(mutedUntil);
    if (isNaN(date.getTime())) {
      res.status(400).json({ error: "mutedUntil doit être une date valide" });
      return;
    }
  }

  // notifyOnMention est optionnel et doit être boolean
  if (notifyOnMention !== undefined && typeof notifyOnMention !== "boolean") {
    res.status(400).json({ error: "notifyOnMention doit être un booléen" });
    return;
  }

  next();
};

/**
 * Middleware de validation pour l'endpoint pin
 */
export const validatePinBody = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { order } = req.body;

  // order est optionnel
  if (order !== undefined && order !== null) {
    const orderNum = parseInt(order);
    if (isNaN(orderNum) || orderNum < 0) {
      res.status(400).json({ error: "order doit être un nombre positif" });
      return;
    }
  }

  next();
};

/**
 * Middleware de validation pour l'endpoint block
 */
export const validateBlockBody = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { reason } = req.body;

  // reason est optionnel
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string") {
      res
        .status(400)
        .json({ error: "reason doit être une chaîne de caractères" });
      return;
    }

    if (reason.length > 500) {
      res
        .status(400)
        .json({ error: "reason ne peut pas dépasser 500 caractères" });
      return;
    }
  }

  next();
};

/**
 * Middleware de validation pour les query parameters de pagination
 */
export const validatePaginationQuery = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { limit, skip } = req.query;

  if (limit !== undefined) {
    const limitNum = parseInt(limit as string);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      res.status(400).json({ error: "limit doit être entre 1 et 100" });
      return;
    }
  }

  if (skip !== undefined) {
    const skipNum = parseInt(skip as string);
    if (isNaN(skipNum) || skipNum < 0) {
      res
        .status(400)
        .json({ error: "skip doit être un nombre positif ou zéro" });
      return;
    }
  }

  next();
};
