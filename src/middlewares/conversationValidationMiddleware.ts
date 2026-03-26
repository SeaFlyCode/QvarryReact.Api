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
      validationLogger.warn("Validation échouée : mutedUntil invalide", {
        userId: (req as any).user?.id,
        mutedUntil,
        path: req.path,
      });
      res.status(400).json({ error: "mutedUntil doit être une date valide" });
      return;
    }
  }

  // notifyOnMention est optionnel et doit être boolean
  if (notifyOnMention !== undefined && typeof notifyOnMention !== "boolean") {
    validationLogger.warn("Validation échouée : notifyOnMention invalide", {
      userId: (req as any).user?.id,
      notifyOnMention,
      type: typeof notifyOnMention,
      path: req.path,
    });
    res.status(400).json({ error: "notifyOnMention doit être un booléen" });
    return;
  }

  validationLogger.debug("Validation mute body réussie", {
    userId: (req as any).user?.id,
    hasMutedUntil: !!mutedUntil,
    hasNotifyOnMention: notifyOnMention !== undefined,
  });

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
      validationLogger.warn("Validation échouée : order invalide", {
        userId: (req as any).user?.id,
        order,
        path: req.path,
      });
      res.status(400).json({ error: "order doit être un nombre positif" });
      return;
    }
  }

  validationLogger.debug("Validation pin body réussie", {
    userId: (req as any).user?.id,
    order,
  });

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
      validationLogger.warn("Validation échouée : reason type invalide", {
        userId: (req as any).user?.id,
        reasonType: typeof reason,
        path: req.path,
      });
      res
        .status(400)
        .json({ error: "reason doit être une chaîne de caractères" });
      return;
    }

    if (reason.length > 500) {
      validationLogger.warn("Validation échouée : reason trop long", {
        userId: (req as any).user?.id,
        reasonLength: reason.length,
        path: req.path,
      });
      res
        .status(400)
        .json({ error: "reason ne peut pas dépasser 500 caractères" });
      return;
    }
  }

  validationLogger.debug("Validation block body réussie", {
    userId: (req as any).user?.id,
    hasReason: !!reason,
  });

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
      validationLogger.warn("Validation échouée : limit invalide", {
        userId: (req as any).user?.id,
        limit,
        path: req.path,
      });
      res.status(400).json({ error: "limit doit être entre 1 et 100" });
      return;
    }
  }

  if (skip !== undefined) {
    const skipNum = parseInt(skip as string);
    if (isNaN(skipNum) || skipNum < 0) {
      validationLogger.warn("Validation échouée : skip invalide", {
        userId: (req as any).user?.id,
        skip,
        path: req.path,
      });
      res
        .status(400)
        .json({ error: "skip doit être un nombre positif ou zéro" });
      return;
    }
  }

  validationLogger.debug("Validation pagination réussie", {
    userId: (req as any).user?.id,
    limit,
    skip,
  });

  next();
};
