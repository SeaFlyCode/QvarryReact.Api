// server/src/middlewares/adminMiddleware.ts
import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/auditService";
import { logger } from "../services/loggerService";
import { sendForbidden } from "../utils/authErrors";

const adminMwLogger = logger.child({ service: "admin-middleware" });

/**
 * Middleware pour vérifier les permissions administrateur
 * Doit être utilisé APRÈS authMiddleware
 */
export const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Vérifier que l'utilisateur est authentifié
    if (!req.user?.id) {
      adminMwLogger.warn("Tentative d'accès admin sans authentification", {
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        message: "Authentification requise",
        code: "NOT_AUTHENTICATED",
      });
    }

    // Vérifier que l'utilisateur est admin
    if (!req.user.isAdmin) {
      adminMwLogger.warn("Accès admin refusé", {
        userId: req.user.id,
        method: req.method,
        path: req.path,
      });

      // Logger la tentative d'accès non autorisé
      await auditService.log({
        userId: req.user.id,
        action: "ADMIN_ACCESS_DENIED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        details: {
          path: req.path,
          method: req.method,
        },
      });

      // P1 — 403 unifié { error: "FORBIDDEN", code, message }
      return sendForbidden(
        res,
        "UNAUTHORIZED",
        "Accès réservé aux administrateurs",
        { reason: "NOT_ADMIN" },
      );
    }

    // Log de l'accès admin (optionnel en debug)
    if (process.env.LOG_ADMIN_ACCESS === "true") {
      adminMwLogger.info("Accès autorisé", {
        userId: req.user.id,
        method: req.method,
        path: req.path,
      });
    }

    next();
  } catch (error: unknown) {
    adminMwLogger.error("Erreur middleware admin", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la vérification des permissions",
      code: "ADMIN_CHECK_ERROR",
    });
  }
};

export default adminMiddleware;
