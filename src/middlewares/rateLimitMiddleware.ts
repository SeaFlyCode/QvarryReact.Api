// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE SÉCURITÉ - VÉRIFICATION DES IPS BLOQUÉES
// ═══════════════════════════════════════════════════════════════════════════
// Note: Les rate limiters express-rate-limit sont centralisés dans
// src/config/rateLimitConfig.ts et appliqués dans server.ts
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/auditService";
import { anonymizeIp } from "../utils/logUtils";
import { logger } from "../services/loggerService";

const secLogger = logger.child({ service: "security" });

// Import dynamique pour éviter les dépendances circulaires
let securityAlertService: any = null;
const getSecurityAlertService = async () => {
  if (!securityAlertService) {
    const module = await import("../services/securityAlertService");
    securityAlertService = module.securityAlertService;
  }
  return securityAlertService;
};

/**
 * Middleware de vérification des IPs bloquées
 * À utiliser en premier dans la chaîne des middlewares
 */
export const ipBlockCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const identifier = req.ip || req.connection.remoteAddress || "unknown";
    const alertService = await getSecurityAlertService();
    const blockStatus = await alertService.isIpBlocked(identifier);

    if (blockStatus.blocked) {
      secLogger.warn("Blocked IP attempted access", {
        ip: anonymizeIp(identifier),
      });

      // Log la tentative
      await auditService.log({
        action: "BLOCKED_IP_ACCESS_ATTEMPT",
        level: "warning",
        ipAddress: identifier,
        userAgent: req.get("user-agent"),
        details: {
          reason: blockStatus.reason,
          blockedUntil: blockStatus.until,
          attemptedPath: req.path,
        },
      });

      const remainingTime = blockStatus.until
        ? Math.ceil((blockStatus.until.getTime() - Date.now()) / 60000)
        : "permanent";

      return res.status(403).json({
        error: `Accès refusé. Votre adresse IP a été bloquée.`,
        reason: blockStatus.reason,
        blockedUntil: blockStatus.until,
        remainingMinutes: remainingTime,
        code: "IP_BLOCKED",
      });
    }

    next();
  } catch (error) {
    // En cas d'erreur, on laisse passer pour ne pas bloquer le service
    secLogger.error("Error checking IP block status", { error });
    next();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// STORE POUR RESET MANUEL DU RATE LIMIT (utilisé par authControllers)
// ═══════════════════════════════════════════════════════════════════════════

const rateLimitStore = new Map<
  string,
  { count: number; firstAttempt: Date; blockedUntil?: Date }
>();

/**
 * Reset le rate limit pour un identifiant spécifique
 * Utilisé après un login réussi pour réinitialiser le compteur
 */
export const resetRateLimit = (identifier: string): void => {
  rateLimitStore.delete(identifier);
};
