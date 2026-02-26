// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION DES COOKIES - CENTRALISÉE
// ═══════════════════════════════════════════════════════════════════════════
// Utilise les variables d'environnement COOKIE_SECURE et COOKIE_SAMESITE
// pour permettre une configuration flexible des cookies
// ═══════════════════════════════════════════════════════════════════════════

import { CookieOptions } from "express";
import { logger } from "../services/loggerService";

const cookieLogger = logger.child({ service: "cookie-config" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const isProduction = process.env.NODE_ENV === "production";

// COOKIE_SECURE: En production, TOUJOURS true (sécurité forcée). Sinon, configurable via env var.
const COOKIE_SECURE = isProduction
  ? true
  : process.env.COOKIE_SECURE === "true";

// COOKIE_SAMESITE: Si non défini, utilise 'strict' en production, 'lax' sinon
type SameSiteOption = "strict" | "lax" | "none";
const COOKIE_SAMESITE: SameSiteOption =
  (process.env.COOKIE_SAMESITE as SameSiteOption) ||
  (isProduction ? "strict" : "lax");

// ═══════════════════════════════════════════════════════════════════════════
// OPTIONS DE COOKIE PAR TYPE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options de base pour tous les cookies sécurisés
 */
export const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/",
};

/**
 * Options pour le cookie JWT (Access Token)
 * Durée courte, utilisé pour l'authentification
 */
export function getJwtCookieOptions(): CookieOptions {
  const jwtMaxAge =
    parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") *
    60 *
    1000; // Minutes -> ms
  return {
    ...baseCookieOptions,
    maxAge: jwtMaxAge,
  };
}

/**
 * Options pour le cookie Refresh Token
 * Durée longue, utilisé pour rafraîchir le JWT
 */
export function getRefreshTokenCookieOptions(): CookieOptions {
  const refreshMaxAge =
    parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60 * 1000; // Heures -> ms
  return {
    ...baseCookieOptions,
    maxAge: refreshMaxAge,
  };
}

/**
 * Options pour supprimer un cookie (logout)
 */
export const clearCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
  path: "/",
  maxAge: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retourne la configuration actuelle des cookies pour debugging
 */
export function getCookieConfig() {
  return {
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    isProduction,
    jwtMaxAgeMinutes: parseInt(
      process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15",
    ),
    refreshMaxAgeHours: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48"),
  };
}

// Log de la configuration au démarrage
cookieLogger.info("Cookie configuration", {
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAMESITE,
});
