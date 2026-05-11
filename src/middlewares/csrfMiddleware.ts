// ═══════════════════════════════════════════════════════════════════════════
// MED-004: MIDDLEWARE DE PROTECTION CSRF
// ═══════════════════════════════════════════════════════════════════════════
// Implémentation Double Submit Cookie pattern (plus robuste que cookie-only)
// - Génère un token CSRF stocké en cookie HttpOnly
// - Requiert le même token dans le header X-CSRF-Token
// - Validation timing-safe pour éviter timing attacks
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../services/loggerService";
import { auditService } from "../services/auditService";

const csrfLogger = logger.child({ service: "csrf" });

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_LENGTH = 32; // 32 bytes = 64 caractères hex

/**
 * Génère un token CSRF cryptographiquement sécurisé
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/**
 * Endpoint pour obtenir le CSRF token
 * À appeler par le frontend au chargement de l'app
 * GET /api/csrf-token
 */
export const getCsrfToken = (req: Request, res: Response) => {
  try {
    // Vérifier si un token existe déjà dans le cookie
    let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];

    // Générer un nouveau token si absent ou invalide
    if (!csrfToken || csrfToken.length !== CSRF_TOKEN_LENGTH * 2) {
      csrfToken = generateCsrfToken();
    }

    // Définir le cookie CSRF (HttpOnly pour sécurité)
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 1000, // 1 heure
      path: "/",
    });

    csrfLogger.debug("CSRF token généré", {
      tokenLength: csrfToken.length,
      userId: (req as any).user?.id,
    });

    // Retourner le token au client (pour l'inclure dans les headers)
    res.status(200).json({
      csrfToken,
      expiresIn: 3600, // 1 heure en secondes
    });
  } catch (error) {
    csrfLogger.error("Erreur génération CSRF token", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "Erreur lors de la génération du token CSRF",
      code: "CSRF_TOKEN_GENERATION_ERROR",
    });
  }
};

/**
 * Middleware de protection CSRF
 * Valide que le token dans le cookie correspond au token dans le header
 * Utilise une comparaison timing-safe pour prévenir timing attacks
 */
export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Ignorer les requêtes GET, HEAD, OPTIONS (idempotentes et sûres)
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // 1. Extraire le token du cookie
    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    if (!cookieToken) {
      csrfLogger.warn("CSRF token manquant dans cookie", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: (req as any).user?.id,
      });

      return res.status(403).json({
        error:
          "Token CSRF manquant. Veuillez rafraîchir la page ou obtenir un nouveau token.",
        code: "CSRF_TOKEN_MISSING",
        hint: "Appelez GET /api/csrf-token pour obtenir un token",
      });
    }

    // 2. Extraire le token du header
    const headerToken = req.headers[CSRF_HEADER_NAME] as string;
    if (!headerToken) {
      csrfLogger.warn("CSRF token manquant dans header", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: (req as any).user?.id,
      });

      return res.status(403).json({
        error: "Token CSRF manquant dans le header",
        code: "CSRF_HEADER_MISSING",
        hint: `Incluez le header '${CSRF_HEADER_NAME}: <token>'`,
      });
    }

    // 3. TIMING-SAFE COMPARISON des tokens
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);

    // Vérifier longueurs
    if (cookieBuffer.length !== headerBuffer.length) {
      // Faire quand même une comparaison timing-safe avec un buffer factice
      const dummyBuffer = Buffer.alloc(cookieBuffer.length);
      try {
        crypto.timingSafeEqual(cookieBuffer, dummyBuffer);
      } catch {
        // Ignore
      }

      csrfLogger.warn("CSRF token invalide (longueurs différentes)", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: (req as any).user?.id,
        cookieLength: cookieBuffer.length,
        headerLength: headerBuffer.length,
      });

      auditService
        .log({
          userId: (req as any).user?.id,
          action: "CSRF_TOKEN_INVALID",
          level: "warning",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          details: {
            reason: "length_mismatch",
            path: req.path,
            method: req.method,
          },
        })
        .catch((err) =>
          csrfLogger.error("Erreur audit CSRF", { error: err.message }),
        );

      return res.status(403).json({
        error: "Token CSRF invalide",
        code: "CSRF_TOKEN_INVALID",
      });
    }

    // Comparaison timing-safe
    if (!crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
      csrfLogger.warn("CSRF token mismatch", {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: (req as any).user?.id,
      });

      auditService
        .log({
          userId: (req as any).user?.id,
          action: "CSRF_TOKEN_MISMATCH",
          level: "warning",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
          details: {
            path: req.path,
            method: req.method,
          },
        })
        .catch((err) =>
          csrfLogger.error("Erreur audit CSRF", { error: err.message }),
        );

      return res.status(403).json({
        error: "Token CSRF invalide",
        code: "CSRF_TOKEN_MISMATCH",
      });
    }

    // 4. Token valide → continuer
    csrfLogger.debug("CSRF token validé", {
      method: req.method,
      path: req.path,
      userId: (req as any).user?.id,
    });

    next();
  } catch (error) {
    csrfLogger.error("Erreur validation CSRF", {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
    });

    return res.status(500).json({
      error: "Erreur lors de la validation du token CSRF",
      code: "CSRF_VALIDATION_ERROR",
    });
  }
};

/**
 * Error handler CSRF (à placer AVANT le error handler général)
 * Catch les erreurs CSRF et retourne une réponse appropriée
 */
export const csrfErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Vérifier si c'est une erreur CSRF
  if (err.code === "EBADCSRFTOKEN" || err.message?.includes("CSRF")) {
    csrfLogger.warn("CSRF token validation failed", {
      ip: req.ip,
      path: req.path,
      userId: (req as any).user?.id,
      error: err.message,
    });

    auditService
      .log({
        userId: (req as any).user?.id,
        action: "CSRF_VALIDATION_FAILED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          path: req.path,
          error: err.message,
        },
      })
      .catch((auditErr) =>
        csrfLogger.error("Erreur audit CSRF", { error: auditErr.message }),
      );

    return res.status(403).json({
      error: "Token CSRF invalide ou expiré",
      code: "CSRF_VALIDATION_FAILED",
    });
  }

  // Passer au prochain error handler
  next(err);
};

/**
 * Middleware optionnel : Renouveler le token CSRF après une requête sensible.
 *
 * ## Rationale (AUDIT_2026-05-11 §4.1 — Fix P1 #4)
 *
 * L'audit a identifié un risque de rejeu CSRF sur 1h (durée de vie du cookie
 * CSRF). La **rotation systématique sur toute requête mutante a été
 * délibérément écartée** car :
 *
 *   1. Elle casse les clients qui n'observent pas `(res as any).newCsrfToken`
 *      et tentent une requête suivante avec l'ancien token (rejeu côté
 *      client → 403, mauvaise UX).
 *   2. Les flows mobile + SDK tiers ne savent pas re-fetch le token rotated.
 *   3. Sur requêtes concurrentes (SPA avec plusieurs onglets), une rotation
 *      en cours invalide les tokens des autres tabs.
 *
 * ## Quand l'appliquer manuellement
 *
 * Ce middleware DOIT être inséré à la fin du pipeline (avant le handler de
 * réponse) sur les routes "haute sensibilité" suivantes — la rotation y est
 * justifiée car le client est attendu en flow synchrone (form classique) :
 *
 *   - `POST /auth/change-password` (changement mot de passe)
 *   - `POST /auth/change-email` (changement email)
 *   - `POST /2fa/setup`, `POST /2fa/disable`, `POST /2fa/regenerate-codes`
 *   - `POST /admin/*` (toute mutation admin sensible)
 *
 * ## TODO call sites
 *
 * Au moment de l'écriture (2026-05-11), `rotateCsrfToken` n'est appelé nulle
 * part. Les routes ci-dessus restent candidates ; à activer route par route
 * après vérification que le client front lit bien `newCsrfToken`.
 *
 * Voir : `REFONTE_2026-05-04.md` et `AUDIT_2026-05-11.md` §4.1.
 */
export const rotateCsrfToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Générer un nouveau token
  const newToken = generateCsrfToken();

  // Mettre à jour le cookie
  res.cookie(CSRF_COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 1000, // 1 heure
    path: "/",
  });

  // Ajouter le nouveau token dans la réponse (pour que le client l'utilise)
  (res as any).newCsrfToken = newToken;

  csrfLogger.debug("CSRF token rotated", {
    userId: (req as any).user?.id,
    path: req.path,
  });

  next();
};
