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

    // 2. Récupérer le(s) secret(s) Vonage
    // Phase H §5.x : support d'une clé fallback pour rotation gracieuse.
    // Pendant la rotation, on configure VONAGE_SIGNATURE_SECRET_FALLBACK avec
    // l'ANCIENNE clé. Une fois tous les emitters basculés, on retire la fallback.
    const secret = process.env.VONAGE_SIGNATURE_SECRET;
    const fallbackSecret = process.env.VONAGE_SIGNATURE_SECRET_FALLBACK;

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

    const bufferA = Buffer.from(signature);

    // Helper : compare signature reçue à une signature calculée avec une clé donnée.
    // Retourne true si match (longueur OK + timing-safe equal).
    const verifyWithSecret = (key: string): boolean => {
      const expected = crypto
        .createHmac("sha512", key)
        .update(payload)
        .digest("hex");
      const bufferB = Buffer.from(expected);
      if (bufferA.length !== bufferB.length) {
        return false;
      }
      return crypto.timingSafeEqual(bufferA, bufferB);
    };

    // 4. Tester d'abord la clé primaire
    const matchedPrimary = verifyWithSecret(secret);

    if (!matchedPrimary) {
      // 5. Si fallback configuré, tester avec
      const matchedFallback = fallbackSecret
        ? verifyWithSecret(fallbackSecret)
        : false;

      if (matchedFallback) {
        // ✅ Fallback OK : log info pour alerter ops à finir la rotation
        vonageWebhookLogger.info(
          "vonage_signature_fallback_used — terminer la rotation de clé",
          {
            ip: anonymizeIp(req.ip || ""),
            path: req.path,
          },
        );

        await auditService.log({
          action: "VONAGE_SIGNATURE_FALLBACK_USED",
          level: "warning",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          details: {
            path: req.path,
            method: req.method,
            note: "Webhook validé avec la clé fallback. Finaliser la rotation de VONAGE_SIGNATURE_SECRET.",
          },
        });

        // Signature valide via fallback → continuer
        return next();
      }

      // ❌ Les 2 ont échoué (ou seulement la primaire si pas de fallback)
      vonageWebhookLogger.warn("Invalid Vonage webhook signature", {
        ip: anonymizeIp(req.ip || ""),
        path: req.path,
        fallbackConfigured: !!fallbackSecret,
      });

      await auditService.log({
        action: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          method: req.method,
          reason: fallbackSecret
            ? "signature_mismatch_primary_and_fallback"
            : "signature_mismatch",
        },
      });

      return res.status(403).json({
        error: "Invalid signature",
        code: "VONAGE_WEBHOOK_INVALID_SIGNATURE",
      });
    }

    // 6. Signature primaire valide → continuer
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
