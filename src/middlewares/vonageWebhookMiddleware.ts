// ═══════════════════════════════════════════════════════════════════════════
// MED-003: MIDDLEWARE DE VALIDATION HMAC WEBHOOKS VONAGE
// ═══════════════════════════════════════════════════════════════════════════
// Valide la signature HMAC-SHA512 de tous les webhooks Vonage
// Prévient les webhooks forgés et les attaques man-in-the-middle
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../services/loggerService";
import { auditService } from "../services/auditService";
import { anonymizeIp } from "../utils/logUtils";

const vonageWebhookLogger = logger.child({ service: "vonage-webhook" });

/**
 * Middleware de validation HMAC pour webhooks Vonage
 * Vérifie que le webhook provient bien de Vonage en validant la signature HMAC-SHA512
 */
export const validateVonageWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 1. Extraire signature du header
    const signature = req.headers["x-vonage-signature"] as string;
    if (!signature) {
      vonageWebhookLogger.warn("Webhook Vonage sans signature", {
        ip: anonymizeIp(req.ip || ""),
        path: req.path,
      });

      await auditService.log({
        action: "VONAGE_WEBHOOK_NO_SIGNATURE",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          method: req.method,
        },
      });

      return res.status(401).json({
        error: "Missing signature",
        code: "VONAGE_WEBHOOK_NO_SIGNATURE",
      });
    }

    // 2. Récupérer le secret Vonage
    const secret = process.env.VONAGE_SIGNATURE_SECRET;

    // ✅ FIX: Fail-secure si le secret n'est pas configuré
    if (!secret) {
      vonageWebhookLogger.error(
        "[SECURITY] Vonage signature secret NOT configured",
        {
          ip: anonymizeIp(req.ip || ""),
          path: req.path,
          method: req.method,
        },
      );

      // Audit de sécurité
      await auditService.log({
        action: "VONAGE_WEBHOOK_NO_SECRET",
        level: "critical",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          error: "VONAGE_SIGNATURE_SECRET not configured",
        },
      });

      return res.status(500).json({
        error: "Server configuration error",
        code: "WEBHOOK_VALIDATION_ERROR",
      });
    }

    // 3. Reconstruire le payload exact (ordre important!)
    // Vonage utilise généralement le body brut pour la signature
    const payload = JSON.stringify(req.body);

    // 4. Calculer HMAC-SHA512
    const expectedSignature = crypto
      .createHmac("sha512", secret)
      .update(payload)
      .digest("hex");

    // 5. Comparaison timing-safe
    const bufferA = Buffer.from(signature);
    const bufferB = Buffer.from(expectedSignature);

    // Vérifier longueurs
    if (bufferA.length !== bufferB.length) {
      // Faire quand même une comparaison timing-safe avec un buffer factice
      const dummyBuffer = Buffer.alloc(bufferA.length);
      try {
        crypto.timingSafeEqual(bufferA, dummyBuffer);
      } catch {
        // Ignore
      }

      vonageWebhookLogger.warn("Invalid Vonage webhook signature (length)", {
        ip: anonymizeIp(req.ip || ""),
        path: req.path,
        expectedLength: bufferB.length,
        receivedLength: bufferA.length,
      });

      await auditService.log({
        action: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          method: req.method,
          reason: "signature_length_mismatch",
        },
      });

      return res.status(403).json({
        error: "Invalid signature",
        code: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
      });
    }

    // Comparaison timing-safe des signatures
    if (!crypto.timingSafeEqual(bufferA, bufferB)) {
      vonageWebhookLogger.warn("Invalid Vonage webhook signature", {
        ip: anonymizeIp(req.ip || ""),
        path: req.path,
      });

      await auditService.log({
        action: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          method: req.method,
          reason: "signature_mismatch",
        },
      });

      return res.status(403).json({
        error: "Invalid signature",
        code: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
      });
    }

    // 6. Signature valide → continuer
    vonageWebhookLogger.debug("Vonage webhook signature validée", {
      path: req.path,
    });

    next();
  } catch (error) {
    vonageWebhookLogger.error("[ERROR] Webhook validation error", {
      error: error instanceof Error ? error.message : String(error),
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });

    // ✅ FIX: Fail-secure en cas d'erreur
    await auditService.log({
      action: "VONAGE_WEBHOOK_VALIDATION_ERROR",
      level: "error",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      details: {
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return res.status(500).json({
      error: "Validation error",
      code: "VALIDATION_ERROR",
    });
    // NE PAS appeler next() ici - fail-secure
  }
};

/**
 * Alternative: Validation avec query params (si Vonage utilise cette méthode)
 * Certains webhooks Vonage incluent les params dans le calcul HMAC
 */
export const validateVonageWebhookWithQuery = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const signature = req.headers["x-vonage-signature"] as string;
    if (!signature) {
      return res.status(401).json({
        error: "Missing signature",
        code: "VONAGE_WEBHOOK_NO_SIGNATURE",
      });
    }

    const secret = process.env.VONAGE_SIGNATURE_SECRET;
    if (!secret) {
      vonageWebhookLogger.error("VONAGE_SIGNATURE_SECRET not configured");
      return res.status(500).json({
        error: "Configuration error",
        code: "VONAGE_WEBHOOK_CONFIG_ERROR",
      });
    }

    // Construire le payload avec query params (ordre alphabétique)
    const sortedQuery = Object.keys(req.query)
      .sort()
      .map((key) => `${key}=${req.query[key]}`)
      .join("&");

    const payload = sortedQuery + JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac("sha512", secret)
      .update(payload)
      .digest("hex");

    const bufferA = Buffer.from(signature);
    const bufferB = Buffer.from(expectedSignature);

    if (
      bufferA.length !== bufferB.length ||
      !crypto.timingSafeEqual(bufferA, bufferB)
    ) {
      vonageWebhookLogger.warn(
        "Invalid Vonage webhook signature (with query)",
        {
          ip: anonymizeIp(req.ip || ""),
          path: req.path,
        },
      );

      return res.status(403).json({
        error: "Invalid signature",
        code: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
      });
    }

    next();
  } catch (error) {
    vonageWebhookLogger.error("Vonage webhook validation error (with query)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Validation error",
      code: "VONAGE_WEBHOOK_VALIDATION_ERROR",
    });
  }
};
