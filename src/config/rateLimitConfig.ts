// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION CENTRALISÉE DU RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════
// Toutes les configurations de rate limiting sont définies ici
// Les limites sont hardcodées (valeurs PRODUCTION)
// En développement: limites automatiquement multipliées par DEV_MULTIPLIER
// ═══════════════════════════════════════════════════════════════════════════

import rateLimit from "express-rate-limit";
import { anonymizeIp } from "../utils/logUtils";
import { logger } from "../services/loggerService";

const rateLimitLogger = logger.child({ service: "rate-limit" });

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

// En développement, les limites sont multipliées pour éviter les blocages
const DEV_MULTIPLIER = 10;

/**
 * Applique le multiplicateur dev si nécessaire
 */
const limit = (value: number): number => {
  return isProduction ? value : value * DEV_MULTIPLIER;
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION HARDCODÉE (valeurs PRODUCTION)
// En dev, elles sont automatiquement multipliées par DEV_MULTIPLIER (10x)
// ═══════════════════════════════════════════════════════════════════════════

const config = {
  // Rate limiting authentification
  auth: {
    maxRequests: 10, // 10 tentatives en prod, 100 en dev
    windowMinutes: 15, // Fenêtre de 15 minutes
  },
  // Rate limiting mobile
  mobile: {
    maxRequests: 5, // 5 tentatives en prod, 50 en dev
    windowMinutes: 15, // Fenêtre de 15 minutes
  },
  // Limites par type de route (valeurs PRODUCTION)
  limits: {
    global: 1000, // Filet de sécurité global
    health: 120, // Health checks Docker/K8s
    register: 5, // Création de compte (par heure)
    resendEmail: 3, // Renvoi d'emails (par heure)
    passwordReset: 5, // Reset mot de passe
    twoFactor: 5, // 2FA (strict, brute-force TOTP)
    general: 300, // Routes générales
    highTraffic: 500, // Fiches, listes, points
    social: 100, // Contacts, messages, partages
    refreshToken: 10, // Refresh token
    admin: 60, // Routes admin
    security: 30, // Routes sécurité
    authCheck: 60, // Vérification auth
    maintenance: 30, // Routes maintenance
    users: 100, // Routes utilisateurs (SEC-044)
    notifications: 60, // Routes notifications (SEC-AUDIT)
  },
};

/**
 * Retourne la limite avec multiplicateur dev appliqué
 */
const getLimit = (key: keyof typeof config.limits): number => {
  return limit(config.limits[key]);
};

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITERS - EXPRESS-RATE-LIMIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate limiter global - Filet de sécurité (catch-all)
 * S'applique à TOUTES les requêtes comme protection de secours
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("global"),
  message: {
    error: "Trop de requêtes globales, veuillez réessayer plus tard.",
    code: "GLOBAL_RATE_LIMIT_EXCEEDED",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  handler: (req, res) => {
    rateLimitLogger.warn("Global rate limit dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    res.status(429).json({
      error: "Trop de requêtes, veuillez réessayer plus tard.",
      code: "GLOBAL_RATE_LIMIT_EXCEEDED",
      retryAfter: 60,
    });
  },
});

/**
 * Rate limiter pour /health (Docker/Kubernetes health checks)
 */
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("health"),
  message: "Too many health check requests",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour l'authentification (login/register)
 * Utilise les variables .env RATE_LIMIT_*
 */
export const authLimiter = rateLimit({
  windowMs: config.auth.windowMinutes * 60 * 1000,
  max: limit(config.auth.maxRequests),
  message: `Trop de tentatives de connexion, veuillez réessayer dans ${config.auth.windowMinutes} minutes.`,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour la création de compte (anti-spam)
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: getLimit("register"),
  message: "Trop de créations de compte, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour la vérification d'email (protection brute force code à 8 chiffres)
 * SEC-045: Configuration dédiée plus stricte que le limiter auth générique
 * 5 tentatives max en 15 minutes en prod (50 en dev)
 */
export const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: limit(5), // 5 en prod, 50 en dev
  message:
    "Trop de tentatives de vérification, veuillez réessayer dans 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour le renvoi d'emails (anti-spam)
 */
export const resendEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: getLimit("resendEmail"),
  message: "Trop de demandes de renvoi d'email, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour la réinitialisation de mot de passe
 */
export const passwordResetLimiter = rateLimit({
  windowMs: config.auth.windowMinutes * 60 * 1000,
  max: getLimit("passwordReset"),
  message:
    "Trop de tentatives de réinitialisation, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour la 2FA (strict pour éviter brute-force des codes TOTP)
 * SEC-2FA: 5 tentatives pour limiter les attaques par force brute
 * Note: En dev, limite augmentée mais reste stricte pour tester le comportement
 */
export const twoFactorLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: getLimit("twoFactor"),
  message: "Trop de tentatives 2FA, veuillez réessayer dans 5 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter général (routes authentifiées standard)
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("general"),
  message: "Trop de requêtes, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les routes à fort débit (fiches, listes, points en lecture)
 */
export const highTrafficLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("highTraffic"),
  message: "Trop de requêtes, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les actions sociales (contacts, messages, partages)
 */
export const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("social"),
  message: "Trop de requêtes, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour le refresh token
 * Plus permissif que l'auth car l'utilisateur est déjà authentifié
 * Mais doit être limité pour éviter les abus
 */
export const refreshTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("refreshToken"),
  message: "Trop de rafraîchissements de token, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les routes admin
 * Strict pour les actions sensibles mais permet le travail normal
 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("admin"),
  message: "Trop de requêtes admin, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les routes mobiles (appliqué au niveau server.ts)
 * Complète le mobileSecurityMiddleware
 */
export const mobileAuthLimiter = rateLimit({
  windowMs: config.mobile.windowMinutes * 60 * 1000,
  max: config.mobile.maxRequests,
  message: `Trop de tentatives depuis l'application mobile. Réessayez dans ${config.mobile.windowMinutes} minutes.`,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les routes de sécurité (sessions, events)
 */
export const securityLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("security"),
  message: "Trop de requêtes de sécurité, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour la vérification d'authentification (check)
 * Route publique qui peut être appelée fréquemment
 */
export const authCheckLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("authCheck"),
  message: "Trop de vérifications d'authentification.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour les routes de maintenance
 */
export const maintenanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("maintenance"),
  message: "Trop de requêtes de maintenance.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * SEC-044: Rate limiter pour les routes utilisateurs
 * Protection contre l'énumération et l'accès abusif aux profils
 */
export const usersLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("users"),
  message: "Trop de requêtes utilisateurs, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * SEC-AUDIT: Rate limiter pour les routes notifications
 * Protection spécifique pour les notifications (60 req/min en prod)
 */
export const notificationsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("notifications"),
  message: "Trop de requêtes de notifications, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG DE CONFIGURATION AU DÉMARRAGE
// ═══════════════════════════════════════════════════════════════════════════

const envLabel = isProduction ? "PRODUCTION" : "DEVELOPMENT";
const multiplier = isProduction ? 1 : DEV_MULTIPLIER;
rateLimitLogger.info("Rate limiting configuré", {
  env: envLabel,
  multiplier,
  auth: `${limit(config.auth.maxRequests)} req/${config.auth.windowMinutes}min`,
  mobile: `${limit(config.mobile.maxRequests)} req/${config.mobile.windowMinutes}min`,
  twoFactor: `${getLimit("twoFactor")} req/5min`,
  general: `${getLimit("general")} req/min`,
  global: `${getLimit("global")} req/min`,
});
