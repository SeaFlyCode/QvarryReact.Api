// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION CENTRALISÉE DU RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════
// Toutes les configurations de rate limiting sont définies ici
// Les limites sont hardcodées (valeurs PRODUCTION)
// En développement: limites automatiquement multipliées par DEV_MULTIPLIER
// ═══════════════════════════════════════════════════════════════════════════

import rateLimit, { Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { Request } from "express";
import { createHash } from "crypto";
import { anonymizeIp } from "../utils/logUtils";
import { logger } from "../services/loggerService";
import { getRedisClient } from "../services/redisSessionService";

const rateLimitLogger = logger.child({ service: "rate-limit" });

const makeStore = (prefix: string): Store | undefined => {
  const client = getRedisClient();
  if (!client) return undefined;
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) => (client as any).call(...args),
      prefix,
    });
  } catch {
    return undefined;
  }
};

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
    global: 200, // P3 backend #6b — réduit de 1000 → 200/min (catch-all moins permissif)
    health: 120, // Health checks Docker/K8s
    register: 5, // Création de compte (par heure)
    resendEmail: 3, // Renvoi d'emails (par heure)
    passwordReset: 5, // Reset mot de passe
    twoFactor: 5, // 2FA (strict, brute-force TOTP) - MED-002: Déjà au niveau militaire
    general: 300, // Routes générales
    highTraffic: 500, // Fiches, listes, points
    social: 100, // Contacts, messages, partages
    refreshToken: 3, // MED-002: Refresh token (réduit de 10 à 3)
    admin: 60, // Routes admin
    security: 30, // Routes sécurité
    authCheck: 60, // Vérification auth
    maintenance: 30, // Routes maintenance
    users: 100, // Routes utilisateurs (SEC-044)
    notifications: 60, // Routes notifications (SEC-AUDIT)
    // Configuration différenciée par niveau de sécurité (3 niveaux)
    strictAuth: 10, // 🔴 STRICT - Auth sensible (login, register)
    moderateApi: 100, // 🟡 MODERATE - API standard (events, users)
    permissiveMobile: 50, // 🟢 PERMISSIVE - Fonctionnel mobile - MED-002: Réduit de 150 à 50
  },
};

/**
 * Retourne la limite avec multiplicateur dev appliqué
 */
const getLimit = (key: keyof typeof config.limits): number => {
  return limit(config.limits[key]);
};

/**
 * Calcule le nombre de secondes RÉEL restant avant la fin du blocage.
 *
 * express-rate-limit expose `req.rateLimit.resetTime` (quand `standardHeaders`
 * est actif) : c'est l'instant exact où la fenêtre se réinitialise. On s'en
 * sert pour renvoyer un `retryAfter` qui DÉCROÎT à chaque requête (3600 → 3456
 * → …) au lieu de renvoyer la fenêtre complète figée à chaque 429.
 *
 * Fallback sur la fenêtre complète si `resetTime` est indisponible.
 */
const retryAfterSeconds = (req: Request, fallbackWindowMs: number): number => {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } })
    .rateLimit?.resetTime;
  if (resetTime instanceof Date) {
    const seconds = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    if (seconds > 0) return seconds;
  }
  return Math.ceil(fallbackWindowMs / 1000);
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
  store: makeStore("rl:global:"),
  message: {
    error: "Trop de requêtes globales, veuillez réessayer plus tard.",
    code: "GLOBAL_RATE_LIMIT_EXCEEDED",
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  handler: (req, res) => {
    const retryAfter = retryAfterSeconds(req, 60 * 1000);
    rateLimitLogger.warn("Global rate limit dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    // P1 UX : header Retry-After explicite pour les clients qui le lisent
    // (le body conserve aussi `retryAfter` pour les clients qui parsent JSON).
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "GLOBAL_RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: "Trop de requêtes, veuillez réessayer plus tard.",
    });
  },
});

/**
 * Rate limiter pour /health (Docker/Kubernetes health checks)
 */
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: getLimit("health"),
  store: makeStore("rl:health:"),
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
  store: makeStore("rl:auth:"),
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
  store: makeStore("rl:register:"),
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
  store: makeStore("rl:verifyEmail:"),
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
  store: makeStore("rl:resendEmail:"),
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
  store: makeStore("rl:passwordReset:"),
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
  store: makeStore("rl:twoFactor:"),
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
  store: makeStore("rl:general:"),
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
  store: makeStore("rl:highTraffic:"),
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
  store: makeStore("rl:social:"),
  message: "Trop de requêtes, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter pour le refresh token
 * MED-002: Réduit à 3 refresh max toutes les 15 minutes (niveau militaire)
 * Prévient l'abus de refresh tokens et les attaques par force brute
 */
export const refreshTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes (MED-002: changé de 1 min à 15 min)
  max: getLimit("refreshToken"), // 3 en prod, 30 en dev
  store: makeStore("rl:refreshToken:"),
  message:
    "Trop de rafraîchissements de token, veuillez réessayer dans 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = retryAfterSeconds(req, 15 * 60 * 1000);
    rateLimitLogger.warn("🔴 REFRESH: Rate limit dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "REFRESH_TOKEN_RATE_LIMIT_EXCEEDED",
      retryAfter,
      message:
        "Trop de rafraîchissements de token, veuillez réessayer dans 15 minutes.",
    });
  },
});

/**
 * Rate limiter pour les routes admin
 * Strict pour les actions sensibles mais permet le travail normal
 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: getLimit("admin"),
  store: makeStore("rl:admin:"),
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
  store: makeStore("rl:mobileAuth:"),
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
  store: makeStore("rl:security:"),
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
  store: makeStore("rl:authCheck:"),
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
  store: makeStore("rl:maintenance:"),
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
  store: makeStore("rl:users:"),
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
  store: makeStore("rl:notifications:"),
  message: "Trop de requêtes de notifications, veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITERS DIFFÉRENCIÉS PAR NIVEAU DE SÉCURITÉ (3 NIVEAUX)
// ═══════════════════════════════════════════════════════════════════════════
// Configuration différenciée pour gérer les différents besoins de rate limiting
// selon la sensibilité des routes et les cas d'usage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 STRICT - Rate limiter pour l'authentification sensible
 * Routes : /api/auth/login, /api/auth/register
 * Limite : 10 requêtes / 15 minutes (100 en dev)
 *
 * Protection contre :
 * - Brute force attacks sur les credentials
 * - Account enumeration
 * - Création de comptes en masse
 */
export const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit("strictAuth"),
  store: makeStore("rl:strictAuth:"),
  message: {
    error:
      "Trop de tentatives d'authentification, veuillez réessayer dans 15 minutes.",
    code: "STRICT_AUTH_RATE_LIMIT_EXCEEDED",
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = retryAfterSeconds(req, 15 * 60 * 1000);
    rateLimitLogger.warn("🔴 STRICT: Rate limit auth dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "STRICT_AUTH_RATE_LIMIT_EXCEEDED",
      retryAfter,
      message:
        "Trop de tentatives d'authentification, veuillez réessayer dans 15 minutes.",
    });
  },
});

/**
 * 🟡 MODERATE - Rate limiter pour les API standards
 * Routes : /api/events/*, /api/users/*
 * Limite : 100 requêtes / 15 minutes (1000 en dev)
 *
 * Protection contre :
 * - Abus des API standards
 * - Énumération de ressources
 * - Scraping de données
 */
export const moderateApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit("moderateApi"),
  store: makeStore("rl:moderateApi:"),
  message: {
    error: "Trop de requêtes API, veuillez réessayer dans 15 minutes.",
    code: "MODERATE_API_RATE_LIMIT_EXCEEDED",
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = retryAfterSeconds(req, 15 * 60 * 1000);
    rateLimitLogger.warn("🟡 MODERATE: Rate limit API dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "MODERATE_API_RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: "Trop de requêtes API, veuillez réessayer dans 15 minutes.",
    });
  },
});

/**
 * 🟢 PERMISSIVE - Rate limiter pour les fonctionnalités mobiles et opérationnelles
 * Routes : /api/mobile/push-tokens, /api/mobile/sync, /api/health
 * Limite : 50 requêtes / 15 minutes (500 en dev) - MED-002: Réduit de 150 à 50
 *
 * Plus permissif que strictAuth mais réduit pour sécurité militaire/bancaire :
 * - Routes authentifiées (moins de risque d'abus)
 * - Utilisations légitimes fréquentes (sync offline, push tokens, health checks)
 * - Les applications mobiles peuvent se reconnecter fréquemment
 *
 * Protection contre :
 * - Abus massifs (bots, scripts malveillants)
 * - DoS sur les endpoints fonctionnels
 */
export const permissiveMobileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit("permissiveMobile"), // 50 en prod, 500 en dev (MED-002)
  store: makeStore("rl:permissiveMobile:"),
  message: {
    error:
      "Trop de requêtes depuis l'application mobile, veuillez réessayer dans 15 minutes.",
    code: "PERMISSIVE_MOBILE_RATE_LIMIT_EXCEEDED",
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = retryAfterSeconds(req, 15 * 60 * 1000);
    rateLimitLogger.warn("🟢 PERMISSIVE: Rate limit mobile dépassé", {
      ip: anonymizeIp(req.ip || ""),
      path: req.path,
    });
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "PERMISSIVE_MOBILE_RATE_LIMIT_EXCEEDED",
      retryAfter,
      message:
        "Trop de requêtes depuis l'application mobile, veuillez réessayer dans 15 minutes.",
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-003 FIX: Rate Limiter Mobile Attestation (Durci)
// ═══════════════════════════════════════════════════════════════════════════
// Protection contre le bruteforce d'attestations et le contournement du
// device binding. L'attestation d'appareil est coûteuse et critique pour
// la sécurité, donc les limites doivent être strictes.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate limiter par IP pour les attestations mobiles (première couche)
 * HIGH-003: Durci de 5/15min à 3/heure
 */
export const mobileAttestationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ✅ 1 heure (au lieu de 15min)
  max: limit(3), // ✅ 3 tentatives/heure/IP (au lieu de 5/15min)
  store: makeStore("rl:mobileAttestation:"),
  message: "Trop de tentatives d'attestation. Veuillez réessayer plus tard.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // ✅ Compter aussi les succès

  // ✅ Handler personnalisé pour logger les abus
  handler: (req, res, _next, options) => {
    // Import dynamique pour éviter les dépendances circulaires
    import("../services/auditService").then(({ auditService }) => {
      auditService.log({
        action: "RATE_LIMIT_EXCEEDED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          type: "mobile_attestation",
          deviceId: (req.body as any)?.deviceId,
          windowMs: options.windowMs,
          max: options.max,
        },
      });
    });

    rateLimitLogger.warn("[RATE-LIMIT] Mobile attestation limit exceeded", {
      ip: anonymizeIp(req.ip || ""),
      deviceId: (req.body as any)?.deviceId,
      userAgent: req.headers["user-agent"],
    });

    const retryAfter = retryAfterSeconds(req, options.windowMs!);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: "Trop de tentatives d'attestation",
    });
  },
});

/**
 * ✅ NOUVEAU: Rate limiter par deviceId (deuxième couche de défense)
 * Limite plus stricte par appareil pour empêcher la rotation d'IP
 * HIGH-003: 5 tentatives par device par jour
 */
export const mobileAttestationByDeviceLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 heures
  max: limit(5), // 5 tentatives par device par jour
  store: makeStore("rl:mobileAttestationDevice:"),

  // ✅ Clé basée sur deviceId (avec hash pour privacy)
  // AUDIT_2026-05-11 Phase C — Fix P1 #2
  // Canonicalisation deviceId avant hash : trim() + toLowerCase() pour
  // empêcher un bypass trivial via casse ou espaces (" devA" vs "devA").
  // Le deviceId brut reste loggé dans les handlers (traçabilité).
  keyGenerator: (req: Request): string => {
    const rawDeviceId = (req.body as any)?.deviceId;
    const canonical =
      typeof rawDeviceId === "string" && rawDeviceId.trim().length > 0
        ? rawDeviceId.trim().toLowerCase()
        : "unknown";

    // Hash du deviceId canonique pour ne pas stocker en clair dans Redis
    const hash = createHash("sha256")
      .update(canonical + (process.env.IP_HASH_SECRET || "default-salt"))
      .digest("hex");

    return `mobile_attestation_device:${hash}`;
  },

  message: "Quota d'attestation dépassé pour cet appareil",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,

  handler: (req, res, _next, options) => {
    import("../services/auditService").then(({ auditService }) => {
      auditService.log({
        action: "DEVICE_ATTESTATION_QUOTA_EXCEEDED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          deviceId: (req.body as any)?.deviceId,
          windowMs: options.windowMs,
          max: options.max,
        },
      });
    });

    rateLimitLogger.warn("[RATE-LIMIT] Device attestation quota exceeded", {
      ip: anonymizeIp(req.ip || ""),
      deviceId: (req.body as any)?.deviceId,
      userAgent: req.headers["user-agent"],
    });

    const retryAfter = retryAfterSeconds(req, options.windowMs!);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "RATE_LIMITED",
      code: "DEVICE_QUOTA_EXCEEDED",
      retryAfter,
      message: "Quota d'attestation dépassé pour cet appareil",
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LOG DE CONFIGURATION AU DÉMARRAGE
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRE DES LIMITERS (panel admin rate-limit)
// ═══════════════════════════════════════════════════════════════════════════
// Métadonnées de chaque limiter, dérivées de la MÊME config que les limiters
// ci-dessus (mêmes helpers `limit`/`getLimit`, donc multiplicateur dev inclus).
// Permet au panel admin d'enrichir une clé Redis `rl:*` (préfixe → type humain,
// fenêtre, limite max) sans dupliquer les valeurs.
// ⚠️ Garder ce tableau synchronisé si un limiter est ajouté/retiré ci-dessus.

export interface RateLimiterMeta {
  /** Préfixe Redis complet, ex "rl:auth:" */
  prefix: string;
  /** Identifiant court, ex "auth" */
  key: string;
  /** Libellé humain (FR) */
  label: string;
  /** Fenêtre en millisecondes */
  windowMs: number;
  /** Limite max effective (multiplicateur dev appliqué) */
  max: number;
}

export const RATE_LIMITER_REGISTRY: RateLimiterMeta[] = [
  { prefix: "rl:global:", key: "global", label: "Global (catch-all)", windowMs: 60_000, max: getLimit("global") },
  { prefix: "rl:health:", key: "health", label: "Health checks", windowMs: 60_000, max: getLimit("health") },
  { prefix: "rl:auth:", key: "auth", label: "Authentification (login)", windowMs: config.auth.windowMinutes * 60_000, max: limit(config.auth.maxRequests) },
  { prefix: "rl:register:", key: "register", label: "Création de compte", windowMs: 60 * 60_000, max: getLimit("register") },
  { prefix: "rl:verifyEmail:", key: "verifyEmail", label: "Vérification email", windowMs: 15 * 60_000, max: limit(5) },
  { prefix: "rl:resendEmail:", key: "resendEmail", label: "Renvoi d'email", windowMs: 60 * 60_000, max: getLimit("resendEmail") },
  { prefix: "rl:passwordReset:", key: "passwordReset", label: "Réinitialisation mot de passe", windowMs: config.auth.windowMinutes * 60_000, max: getLimit("passwordReset") },
  { prefix: "rl:twoFactor:", key: "twoFactor", label: "2FA (TOTP)", windowMs: 5 * 60_000, max: getLimit("twoFactor") },
  { prefix: "rl:general:", key: "general", label: "Général", windowMs: 60_000, max: getLimit("general") },
  { prefix: "rl:highTraffic:", key: "highTraffic", label: "Fort trafic (fiches/points)", windowMs: 60_000, max: getLimit("highTraffic") },
  { prefix: "rl:social:", key: "social", label: "Social (contacts/messages)", windowMs: 60_000, max: getLimit("social") },
  { prefix: "rl:refreshToken:", key: "refreshToken", label: "Refresh token", windowMs: 15 * 60_000, max: getLimit("refreshToken") },
  { prefix: "rl:admin:", key: "admin", label: "Routes admin", windowMs: 60_000, max: getLimit("admin") },
  { prefix: "rl:mobileAuth:", key: "mobileAuth", label: "Auth mobile", windowMs: config.mobile.windowMinutes * 60_000, max: config.mobile.maxRequests },
  { prefix: "rl:security:", key: "security", label: "Sécurité (sessions/events)", windowMs: 60_000, max: getLimit("security") },
  { prefix: "rl:authCheck:", key: "authCheck", label: "Vérification auth", windowMs: 60_000, max: getLimit("authCheck") },
  { prefix: "rl:maintenance:", key: "maintenance", label: "Maintenance", windowMs: 60_000, max: getLimit("maintenance") },
  { prefix: "rl:users:", key: "users", label: "Utilisateurs", windowMs: 60_000, max: getLimit("users") },
  { prefix: "rl:notifications:", key: "notifications", label: "Notifications", windowMs: 60_000, max: getLimit("notifications") },
  { prefix: "rl:strictAuth:", key: "strictAuth", label: "🔴 Auth stricte", windowMs: 15 * 60_000, max: getLimit("strictAuth") },
  { prefix: "rl:moderateApi:", key: "moderateApi", label: "🟡 API modérée", windowMs: 15 * 60_000, max: getLimit("moderateApi") },
  { prefix: "rl:permissiveMobile:", key: "permissiveMobile", label: "🟢 Mobile permissif", windowMs: 15 * 60_000, max: getLimit("permissiveMobile") },
  { prefix: "rl:mobileAttestation:", key: "mobileAttestation", label: "Attestation mobile (par IP)", windowMs: 60 * 60_000, max: limit(3) },
  { prefix: "rl:mobileAttestationDevice:", key: "mobileAttestationDevice", label: "Attestation mobile (par device)", windowMs: 24 * 60 * 60_000, max: limit(5) },
];

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
  // Configuration différenciée par niveau
  strictAuth: `${getLimit("strictAuth")} req/15min`,
  moderateApi: `${getLimit("moderateApi")} req/15min`,
  permissiveMobile: `${getLimit("permissiveMobile")} req/15min`,
});
