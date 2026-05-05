// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE SÉCURITÉ POUR APPLICATIONS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Remplace Turnstile (non compatible mobile) par :
// - Device ID validation
// - Rate limiting strict par device + IP (Redis en production)
// - Device attestation (iOS/Android)
// - Platform verification
// - Headers de sécurité API
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/auditService";
import { anonymizeIp, maskDeviceId } from "../utils/logUtils";
import { logger } from "../services/loggerService";
import DeviceAttestationService from "../services/deviceAttestationService";
import { redisSessionService } from "../services/redisSessionService";
import { safeJsonParse } from "../utils/secureJsonParser";
import { compareVersions, isValidSemver } from "../utils/versionUtils";
import AppVersionModel from "../models/appVersion";

const mobileSecLogger = logger.child({ service: "mobile-security" });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface MobileRateLimitEntry {
  count: number;
  firstAttempt: Date;
  blockedUntil?: Date;
  deviceIds: Set<string>;
}

/**
 * Représentation sérialisable (JSON) d'une entrée de rate limit pour Redis
 * Les deviceIds sont stockés en Array car Set n'est pas sérialisable
 */
interface MobileRateLimitEntryRedis {
  count: number;
  firstAttempt: string; // ISO string
  blockedUntil: string | null; // ISO string ou null
  deviceIds: string[];
}

interface DeviceAttestationPayload {
  bundleId: string;
  deviceId: string;
  timestamp: number;
  platform: "ios" | "android";
  signature?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const isProduction = process.env.NODE_ENV?.toLowerCase() === "production";
const DEV_MULTIPLIER = 10;

// LOW-003: Version minimale requise de l'application
const MIN_APP_VERSION: Record<string, string> = {
  ios: process.env.MIN_IOS_VERSION || "1.0.0",
  android: process.env.MIN_ANDROID_VERSION || "1.0.0",
};

// Rate limiting pour mobile (hardcodé, avec multiplicateur dev)
const MOBILE_MAX_REQUESTS_BASE = 5; // 5 en prod, 50 en dev
const MOBILE_WINDOW_MINUTES = 15;
const MOBILE_BLOCK_MINUTES = 30;

// MINOR #11: Limite de taille pour prévenir DoS par mémoire
const MAX_KNOWN_DEVICES = 10000;

const MOBILE_MAX_REQUESTS = isProduction
  ? MOBILE_MAX_REQUESTS_BASE
  : MOBILE_MAX_REQUESTS_BASE * DEV_MULTIPLIER;
const MOBILE_WINDOW_MS = MOBILE_WINDOW_MINUTES * 60 * 1000;
const MOBILE_BLOCK_DURATION_MS = MOBILE_BLOCK_MINUTES * 60 * 1000;

// Rate limiting pour sync mobile (plus permissif car authentifié)
const MOBILE_SYNC_MAX_REQUESTS_BASE = 60; // 60 en prod, 600 en dev
const MOBILE_SYNC_WINDOW_MINUTES = 15;
const MOBILE_SYNC_BLOCK_MINUTES = 15;

const MOBILE_SYNC_MAX_REQUESTS = isProduction
  ? MOBILE_SYNC_MAX_REQUESTS_BASE
  : MOBILE_SYNC_MAX_REQUESTS_BASE * DEV_MULTIPLIER;
const MOBILE_SYNC_WINDOW_MS = MOBILE_SYNC_WINDOW_MINUTES * 60 * 1000;
const MOBILE_SYNC_BLOCK_DURATION_MS = MOBILE_SYNC_BLOCK_MINUTES * 60 * 1000;

// HIGH-003: Store en mémoire comme fallback, Redis utilisé via redisSessionService en production
// Les fonctions ci-dessous utilisent Redis quand disponible
const mobileRateLimitStore = new Map<string, MobileRateLimitEntry>();
const mobileSyncRateLimitStore = new Map<string, MobileRateLimitEntry>();
const knownDevices = new Map<
  string,
  { userId?: string; firstSeen: Date; lastSeen: Date; trustScore: number }
>();
const blockedDevices = new Set<string>();

// Préfixes Redis pour le rate limiting mobile (HIGH-003)
const MOBILE_RL_PREFIX = "qvarry:mobile_rl:";
const MOBILE_SYNC_RL_PREFIX = "qvarry:mobile_sync_rl:";

// ─── HELPERS REDIS POUR RATE LIMITING ───────────────────────────────────────

/**
 * Désérialise une entrée Redis en MobileRateLimitEntry (avec Set pour deviceIds)
 */
function deserializeRateLimitEntry(raw: string): MobileRateLimitEntry | null {
  try {
    const parsed: MobileRateLimitEntryRedis = safeJsonParse(raw, {
      context: "rate-limit-cache",
      maxDepth: 3,
    });
    return {
      count: parsed.count,
      firstAttempt: new Date(parsed.firstAttempt),
      blockedUntil: parsed.blockedUntil
        ? new Date(parsed.blockedUntil)
        : undefined,
      deviceIds: new Set(parsed.deviceIds),
    };
  } catch {
    return null;
  }
}

/**
 * Sérialise une MobileRateLimitEntry pour stockage Redis (Set → Array)
 */
function serializeRateLimitEntry(entry: MobileRateLimitEntry): string {
  const serializable: MobileRateLimitEntryRedis = {
    count: entry.count,
    firstAttempt: entry.firstAttempt.toISOString(),
    blockedUntil: entry.blockedUntil ? entry.blockedUntil.toISOString() : null,
    deviceIds: Array.from(entry.deviceIds),
  };
  return JSON.stringify(serializable);
}

/**
 * Récupère une entrée de rate limit depuis Redis avec fallback mémoire
 * @param store - Map mémoire de fallback
 * @param redisPrefix - Préfixe Redis (MOBILE_RL_PREFIX ou MOBILE_SYNC_RL_PREFIX)
 * @param identifier - Identifiant de l'entrée
 */
async function getRateLimitEntry(
  store: Map<string, MobileRateLimitEntry>,
  redisPrefix: string,
  identifier: string,
): Promise<MobileRateLimitEntry | undefined> {
  const redisKey = `${redisPrefix}${identifier}`;
  try {
    const raw = await redisSessionService.getMobileRateLimit(redisKey);
    if (raw) {
      const entry = deserializeRateLimitEntry(raw);
      if (entry) {
        // Synchroniser le cache mémoire
        store.set(identifier, entry);
        return entry;
      }
    }
  } catch {
    // Fallback silencieux sur la Map mémoire
  }
  return store.get(identifier);
}

/**
 * Persiste une entrée de rate limit dans Redis et la Map mémoire (fallback)
 * @param store - Map mémoire de fallback
 * @param redisPrefix - Préfixe Redis
 * @param identifier - Identifiant de l'entrée
 * @param entry - Entrée à persister
 * @param blockDurationMs - Durée de blocage en ms (pour calculer le TTL)
 */
async function setRateLimitEntry(
  store: Map<string, MobileRateLimitEntry>,
  redisPrefix: string,
  identifier: string,
  entry: MobileRateLimitEntry,
  blockDurationMs: number,
): Promise<void> {
  // Toujours mettre à jour le store mémoire (fallback)
  store.set(identifier, entry);

  // Calculer le TTL : durée de blocage ou fenêtre de rate limit
  const ttlSeconds = Math.ceil(blockDurationMs / 1000);
  const redisKey = `${redisPrefix}${identifier}`;

  try {
    await redisSessionService.setMobileRateLimit(
      redisKey,
      serializeRateLimitEntry(entry),
      ttlSeconds,
    );
  } catch {
    // Fallback silencieux : la Map mémoire est déjà à jour
  }
}

// Bundle IDs autorisés pour l'attestation
const ALLOWED_BUNDLE_IDS = [
  "fr.qvarry.app",
  "fr.qvarry.mobile",
  "com.qvarry.app",
  process.env.MOBILE_BUNDLE_ID_IOS,
  process.env.MOBILE_BUNDLE_ID_ANDROID,
].filter(Boolean);

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère un identifiant composite pour le rate limiting (IP + Device)
 */
function getMobileIdentifier(req: Request): string {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const deviceId = (req.headers["x-device-id"] as string) || "no-device";
  return `mobile_${ip}_${deviceId}`;
}

/**
 * Valide le format du Device ID
 */
function isValidDeviceId(deviceId: string | undefined): boolean {
  if (!deviceId) return false;
  // UUID v4 ou format similaire (32-64 caractères alphanumériques avec tirets)
  const uuidRegex = /^[a-zA-Z0-9-]{32,64}$/;
  return uuidRegex.test(deviceId);
}

/**
 * MINOR #11: Éviction de l'appareil le plus ancien si la limite est atteinte
 * Prévient l'épuisement mémoire en cas d'attaque ciblée (millions de device IDs)
 */
function evictOldestDeviceIfNeeded(): void {
  if (knownDevices.size >= MAX_KNOWN_DEVICES) {
    // Map maintient l'ordre d'insertion, le premier est le plus ancien
    const oldestDeviceId = knownDevices.keys().next().value;
    if (oldestDeviceId) {
      knownDevices.delete(oldestDeviceId);
      mobileSecLogger.warn(
        `[SECURITY] knownDevices limit reached (${MAX_KNOWN_DEVICES}), evicting oldest entry`,
        {
          evictedDevice: maskDeviceId(oldestDeviceId),
        },
      );
    }
  }
}

/**
 * Calcule un score de confiance pour l'appareil
 */
function calculateDeviceTrustScore(deviceId: string, req: Request): number {
  let score = 50; // Score de base

  const device = knownDevices.get(deviceId);
  if (device) {
    // Appareil déjà vu = +20
    score += 20;

    // Utilisé depuis plus de 7 jours = +15
    const daysSinceFirstSeen =
      (Date.now() - device.firstSeen.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceFirstSeen > 7) score += 15;

    // Déjà associé à un utilisateur = +10
    if (device.userId) score += 10;
  }

  // Headers mobiles présents = +5 chacun
  if (req.headers["x-platform"]) score += 5;
  if (req.headers["x-app-version"]) score += 5;

  return Math.min(score, 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: VÉRIFICATION PLATEFORME MOBILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifie que la requête provient bien d'une app mobile
 * Headers requis: X-Platform, X-Device-ID
 */
export const verifyMobilePlatform = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const platform = req.headers["x-platform"] as string;
  const deviceId = req.headers["x-device-id"] as string;

  // Vérifier la présence du header plateforme
  if (
    !platform ||
    !["ios", "android", "mobile"].includes(platform.toLowerCase())
  ) {
    mobileSecLogger.warn("Plateforme manquante ou invalide", {
      platform,
      ip: anonymizeIp(req.ip || ""),
    });
    return res.status(400).json({
      error: "Plateforme non spécifiée ou invalide",
      code: "INVALID_PLATFORM",
      hint: "Header X-Platform requis (ios/android)",
    });
  }

  // Vérifier la présence et validité du Device ID
  if (!isValidDeviceId(deviceId)) {
    mobileSecLogger.warn("Device ID manquant ou invalide", {
      ip: anonymizeIp(req.ip || ""),
    });
    return res.status(400).json({
      error: "Identifiant d'appareil manquant ou invalide",
      code: "INVALID_DEVICE_ID",
      hint: "Header X-Device-ID requis (UUID format)",
    });
  }

  // Vérifier si l'appareil est bloqué
  if (blockedDevices.has(deviceId)) {
    mobileSecLogger.warn("Appareil bloqué tentant d'accéder", {
      deviceId: maskDeviceId(deviceId),
    });
    await auditService.log({
      action: "BLOCKED_DEVICE_ACCESS_ATTEMPT",
      level: "warning",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: { deviceId, platform },
    });
    return res.status(403).json({
      error: "Cet appareil a été bloqué",
      code: "DEVICE_BLOCKED",
    });
  }

  // Mettre à jour ou créer l'entrée de l'appareil
  const now = new Date();
  const existingDevice = knownDevices.get(deviceId);
  if (existingDevice) {
    existingDevice.lastSeen = now;
    existingDevice.trustScore = calculateDeviceTrustScore(deviceId, req);
  } else {
    // MINOR #11: Vérifier la limite avant d'ajouter un nouvel appareil
    evictOldestDeviceIfNeeded();
    knownDevices.set(deviceId, {
      firstSeen: now,
      lastSeen: now,
      trustScore: calculateDeviceTrustScore(deviceId, req),
    });
  }

  // Ajouter des infos à la requête pour les middlewares suivants
  (req as any).mobileContext = {
    platform: platform.toLowerCase(),
    deviceId,
    trustScore: knownDevices.get(deviceId)?.trustScore || 50,
  };

  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: RATE LIMITING MOBILE (STRICT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate limiting adapté au mobile
 * Plus strict que le web car pas de protection Turnstile
 * Limite par combinaison IP + Device ID
 * Persisté en Redis (multi-instance) avec fallback mémoire
 */
export const mobileRateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const identifier = getMobileIdentifier(req);
  const deviceId = req.headers["x-device-id"] as string;
  const now = new Date();

  const entry = await getRateLimitEntry(
    mobileRateLimitStore,
    MOBILE_RL_PREFIX,
    identifier,
  );

  if (!entry) {
    const newEntry: MobileRateLimitEntry = {
      count: 1,
      firstAttempt: now,
      deviceIds: new Set([deviceId]),
    };
    await setRateLimitEntry(
      mobileRateLimitStore,
      MOBILE_RL_PREFIX,
      identifier,
      newEntry,
      MOBILE_BLOCK_DURATION_MS,
    );
    return next();
  }

  // Vérifier si bloqué
  if (entry.blockedUntil && entry.blockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (entry.blockedUntil.getTime() - now.getTime()) / 60000,
    );

    await auditService.log({
      action: "MOBILE_RATE_LIMIT_BLOCKED",
      level: "warning",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: { deviceId, remainingMinutes, endpoint: req.path },
    });

    const retryAfter = remainingMinutes * 60;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "RATE_LIMITED",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: `Trop de tentatives. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
    });
  }

  // Réinitialiser la fenêtre si expirée
  const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
  if (timeSinceFirst > MOBILE_WINDOW_MS) {
    const resetEntry: MobileRateLimitEntry = {
      count: 1,
      firstAttempt: now,
      deviceIds: new Set([deviceId]),
    };
    await setRateLimitEntry(
      mobileRateLimitStore,
      MOBILE_RL_PREFIX,
      identifier,
      resetEntry,
      MOBILE_BLOCK_DURATION_MS,
    );
    return next();
  }

  // Incrémenter le compteur
  entry.count++;
  entry.deviceIds.add(deviceId);

  // Vérification de comportement suspect: plusieurs devices pour même IP
  if (entry.deviceIds.size > 3) {
    mobileSecLogger.warn(
      "Comportement suspect: multiple devices depuis même IP",
      {
        deviceCount: entry.deviceIds.size,
        ip: anonymizeIp(req.ip || ""),
      },
    );
    await auditService.log({
      action: "MOBILE_SUSPICIOUS_MULTI_DEVICE",
      level: "warning",
      ipAddress: req.ip || "unknown",
      details: {
        deviceCount: entry.deviceIds.size,
        devices: Array.from(entry.deviceIds),
      },
    });
  }

  // Bloquer si limite dépassée
  if (entry.count > MOBILE_MAX_REQUESTS) {
    entry.blockedUntil = new Date(now.getTime() + MOBILE_BLOCK_DURATION_MS);
    await setRateLimitEntry(
      mobileRateLimitStore,
      MOBILE_RL_PREFIX,
      identifier,
      entry,
      MOBILE_BLOCK_DURATION_MS,
    );

    await auditService.log({
      action: "MOBILE_RATE_LIMIT_TRIGGERED",
      level: "warning",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: {
        attempts: entry.count,
        endpoint: req.path,
        deviceId,
        blockDuration: MOBILE_BLOCK_DURATION_MS / 60000,
      },
    });

    const retryAfter = MOBILE_BLOCK_DURATION_MS / 1000;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "RATE_LIMITED",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: `Trop de tentatives. Bloqué pour ${MOBILE_BLOCK_DURATION_MS / 60000} minutes.`,
    });
  }

  await setRateLimitEntry(
    mobileRateLimitStore,
    MOBILE_RL_PREFIX,
    identifier,
    entry,
    MOBILE_BLOCK_DURATION_MS,
  );
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: RATE LIMITING MOBILE SYNC (PERMISSIF)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rate limiting dédié au sync mobile
 * Plus permissif car les routes de sync sont authentifiées
 * Limite par combinaison IP + Device ID
 * Persisté en Redis (multi-instance) avec fallback mémoire
 */
export const mobileSyncRateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const identifier = getMobileIdentifier(req);
  const deviceId = req.headers["x-device-id"] as string;
  const now = new Date();

  const entry = await getRateLimitEntry(
    mobileSyncRateLimitStore,
    MOBILE_SYNC_RL_PREFIX,
    identifier,
  );

  if (!entry) {
    const newEntry: MobileRateLimitEntry = {
      count: 1,
      firstAttempt: now,
      deviceIds: new Set([deviceId]),
    };
    await setRateLimitEntry(
      mobileSyncRateLimitStore,
      MOBILE_SYNC_RL_PREFIX,
      identifier,
      newEntry,
      MOBILE_SYNC_BLOCK_DURATION_MS,
    );
    return next();
  }

  // Vérifier si bloqué
  if (entry.blockedUntil && entry.blockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (entry.blockedUntil.getTime() - now.getTime()) / 60000,
    );

    await auditService.log({
      action: "MOBILE_SYNC_RATE_LIMIT_BLOCKED",
      level: "warning",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: { deviceId, remainingMinutes, endpoint: req.path },
    });

    const retryAfter = remainingMinutes * 60;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "RATE_LIMITED",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: `Trop de tentatives. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
    });
  }

  // Réinitialiser la fenêtre si expirée
  const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
  if (timeSinceFirst > MOBILE_SYNC_WINDOW_MS) {
    const resetEntry: MobileRateLimitEntry = {
      count: 1,
      firstAttempt: now,
      deviceIds: new Set([deviceId]),
    };
    await setRateLimitEntry(
      mobileSyncRateLimitStore,
      MOBILE_SYNC_RL_PREFIX,
      identifier,
      resetEntry,
      MOBILE_SYNC_BLOCK_DURATION_MS,
    );
    return next();
  }

  // Incrémenter le compteur
  entry.count++;
  entry.deviceIds.add(deviceId);

  // Vérification de comportement suspect: plusieurs devices pour même IP
  if (entry.deviceIds.size > 3) {
    mobileSecLogger.warn(
      "Comportement suspect: multiple devices depuis même IP",
      {
        deviceCount: entry.deviceIds.size,
        ip: anonymizeIp(req.ip || ""),
      },
    );
    await auditService.log({
      action: "MOBILE_SYNC_SUSPICIOUS_MULTI_DEVICE",
      level: "warning",
      ipAddress: req.ip || "unknown",
      details: {
        deviceCount: entry.deviceIds.size,
        devices: Array.from(entry.deviceIds),
      },
    });
  }

  // Bloquer si limite dépassée
  if (entry.count > MOBILE_SYNC_MAX_REQUESTS) {
    entry.blockedUntil = new Date(
      now.getTime() + MOBILE_SYNC_BLOCK_DURATION_MS,
    );
    await setRateLimitEntry(
      mobileSyncRateLimitStore,
      MOBILE_SYNC_RL_PREFIX,
      identifier,
      entry,
      MOBILE_SYNC_BLOCK_DURATION_MS,
    );

    await auditService.log({
      action: "MOBILE_SYNC_RATE_LIMIT_TRIGGERED",
      level: "warning",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: {
        attempts: entry.count,
        endpoint: req.path,
        deviceId,
        blockDuration: MOBILE_SYNC_BLOCK_DURATION_MS / 60000,
      },
    });

    const retryAfter = MOBILE_SYNC_BLOCK_DURATION_MS / 1000;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "RATE_LIMITED",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter,
      message: `Trop de tentatives. Bloqué pour ${MOBILE_SYNC_BLOCK_DURATION_MS / 60000} minutes.`,
    });
  }

  await setRateLimitEntry(
    mobileSyncRateLimitStore,
    MOBILE_SYNC_RL_PREFIX,
    identifier,
    entry,
    MOBILE_SYNC_BLOCK_DURATION_MS,
  );
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: DEVICE ATTESTATION (OPTIONNEL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifie l'attestation de l'appareil (iOS App Attest / Android Play Integrity)
 * En mode optionnel: si présent, augmente le trust score
 * En mode strict: requis pour continuer
 */
export const verifyDeviceAttestation = (strict: boolean = false) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const attestationHeader = req.headers["x-device-attestation"] as string;

    if (!attestationHeader) {
      if (strict) {
        mobileSecLogger.warn("Attestation manquante en mode strict", {
          ip: anonymizeIp(req.ip || ""),
        });
        return res.status(403).json({
          error: "Attestation d'appareil requise",
          code: "ATTESTATION_REQUIRED",
        });
      }
      // Mode non strict: continuer sans attestation
      return next();
    }

    try {
      // Décoder et valider l'attestation
      const attestationData = safeJsonParse<DeviceAttestationPayload>(
        Buffer.from(attestationHeader, "base64").toString("utf-8"),
        { context: "device-attestation", maxDepth: 5 },
      );

      // Vérifier le bundle ID
      if (!ALLOWED_BUNDLE_IDS.includes(attestationData.bundleId)) {
        mobileSecLogger.warn("Bundle ID non autorisé", {
          bundleId: attestationData.bundleId,
        });
        await auditService.log({
          action: "MOBILE_INVALID_BUNDLE_ID",
          level: "warning",
          ipAddress: req.ip || "unknown",
          details: { bundleId: attestationData.bundleId },
        });
        return res.status(403).json({
          error: "Application non autorisée",
          code: "INVALID_BUNDLE_ID",
        });
      }

      // Vérifier le timestamp (pas plus vieux que 5 minutes)
      const maxAge = 5 * 60 * 1000;
      if (Date.now() - attestationData.timestamp > maxAge) {
        mobileSecLogger.warn("Attestation expirée", {
          ip: anonymizeIp(req.ip || ""),
        });
        return res.status(403).json({
          error: "Attestation expirée",
          code: "ATTESTATION_EXPIRED",
        });
      }

      // Vérifier la cohérence du device ID
      const headerDeviceId = req.headers["x-device-id"] as string;
      if (attestationData.deviceId !== headerDeviceId) {
        mobileSecLogger.warn("Device ID mismatch", {
          headerDeviceId: maskDeviceId(headerDeviceId),
          attestationDeviceId: maskDeviceId(attestationData.deviceId),
        });
        return res.status(403).json({
          error: "Incohérence d'identifiant d'appareil",
          code: "DEVICE_ID_MISMATCH",
        });
      }

      // Vérifier l'attestation via le DeviceAttestationService
      const deviceId = req.headers["x-device-id"] as string;
      const signature = attestationData.signature || "";

      // Appeler le service de vérification
      const result = await DeviceAttestationService.verifyAttestation(
        attestationData.platform,
        signature,
        attestationData.deviceId,
      );

      // Gérer le résultat de la vérification
      const device = knownDevices.get(deviceId);

      if (result.verified) {
        // Attestation vérifiée avec succès → trust boost complet (25 points)
        if (device) {
          device.trustScore = Math.min(device.trustScore + 25, 100);
        }
        mobileSecLogger.info("Attestation vérifiée avec succès", {
          deviceId: maskDeviceId(deviceId),
          platform: attestationData.platform,
          trustBoost: 25,
        });
        (req as any).attestationVerified = true;
      } else if (result.bypassed) {
        // Mode bypass → trust boost réduit (12 points)
        if (device) {
          device.trustScore = Math.min(device.trustScore + 12, 100);
        }
        mobileSecLogger.info("Attestation bypassée", {
          deviceId: maskDeviceId(deviceId),
          platform: attestationData.platform,
          reason: result.reason,
          trustBoost: 12,
        });
        (req as any).attestationVerified = false;
      } else {
        // Vérification échouée → aucun trust boost
        mobileSecLogger.warn("Attestation échouée", {
          deviceId: maskDeviceId(deviceId),
          platform: attestationData.platform,
          reason: result.reason,
        });

        await auditService.log({
          action: "MOBILE_ATTESTATION_FAILED",
          level: "warning",
          ipAddress: req.ip || "unknown",
          details: {
            deviceId: maskDeviceId(deviceId),
            platform: attestationData.platform,
            reason: result.reason,
          },
        });

        (req as any).attestationVerified = false;

        // En mode strict, rejeter la requête
        if (strict) {
          return res.status(403).json({
            error: "Vérification d'attestation échouée",
            code: "ATTESTATION_VERIFICATION_FAILED",
            reason: result.reason,
          });
        }
      }

      next();
    } catch (error) {
      mobileSecLogger.error("Erreur validation attestation", {
        error: error instanceof Error ? error.message : String(error),
      });

      if (strict) {
        return res.status(403).json({
          error: "Attestation invalide",
          code: "INVALID_ATTESTATION",
        });
      }

      // Mode non strict: continuer malgré l'erreur
      next();
    }
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE COMBINÉ: SÉCURITÉ MOBILE COMPLÈTE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Middleware combiné qui applique toutes les protections mobiles
 * À utiliser sur les routes sensibles: login, register, forgot-password
 */
export const mobileSecurityMiddleware = [
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
  verifyDeviceAttestation(false), // Mode non strict par défaut
];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES D'ADMINISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bloque un appareil
 */
export function blockDevice(deviceId: string, reason: string): void {
  blockedDevices.add(deviceId);
  mobileSecLogger.info("Appareil bloqué", {
    deviceId: maskDeviceId(deviceId),
    reason,
  });
  auditService.log({
    action: "DEVICE_BLOCKED",
    level: "warning",
    details: { deviceId, reason },
  });
}

/**
 * Débloque un appareil
 */
export function unblockDevice(deviceId: string): void {
  blockedDevices.delete(deviceId);
  mobileSecLogger.info("Appareil débloqué", {
    deviceId: maskDeviceId(deviceId),
  });
}

/**
 * Réinitialise le rate limit pour un identifiant
 */
export function resetMobileRateLimit(identifier: string): void {
  mobileRateLimitStore.delete(identifier);
  mobileSyncRateLimitStore.delete(identifier);
}

/**
 * Associe un device à un utilisateur (après login réussi)
 */
export function associateDeviceWithUser(
  deviceId: string,
  userId: string,
): void {
  const device = knownDevices.get(deviceId);
  if (device) {
    device.userId = userId;
    device.trustScore = Math.min(device.trustScore + 10, 100);
  } else {
    // MINOR #11: Si le device n'existe pas encore, le créer avec vérification de limite
    evictOldestDeviceIfNeeded();
    const now = new Date();
    knownDevices.set(deviceId, {
      userId,
      firstSeen: now,
      lastSeen: now,
      trustScore: 60, // Score de base + bonus pour association utilisateur
    });
  }
}

/**
 * Récupère les statistiques de sécurité mobile
 */
export function getMobileSecurityStats() {
  return {
    knownDevicesCount: knownDevices.size,
    blockedDevicesCount: blockedDevices.size,
    activeRateLimits: mobileRateLimitStore.size,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NETTOYAGE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════════════════

// Nettoyer les entrées expirées toutes les heures
setInterval(
  () => {
    const now = new Date();
    let cleanedRateLimits = 0;
    let cleanedDevices = 0;

    // Nettoyer le rate limit store
    for (const [identifier, entry] of mobileRateLimitStore.entries()) {
      const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
      if (
        timeSinceFirst > MOBILE_WINDOW_MS &&
        (!entry.blockedUntil || entry.blockedUntil < now)
      ) {
        mobileRateLimitStore.delete(identifier);
        cleanedRateLimits++;
      }
    }

    // Nettoyer le sync rate limit store
    for (const [identifier, entry] of mobileSyncRateLimitStore.entries()) {
      const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
      if (
        timeSinceFirst > MOBILE_SYNC_WINDOW_MS &&
        (!entry.blockedUntil || entry.blockedUntil < now)
      ) {
        mobileSyncRateLimitStore.delete(identifier);
        cleanedRateLimits++;
      }
    }

    // Nettoyer les appareils non vus depuis 30 jours
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    for (const [deviceId, device] of knownDevices.entries()) {
      if (device.lastSeen < thirtyDaysAgo) {
        knownDevices.delete(deviceId);
        cleanedDevices++;
      }
    }

    if (cleanedRateLimits > 0 || cleanedDevices > 0) {
      mobileSecLogger.info("Nettoyage effectué", {
        rateLimitsCleaned: cleanedRateLimits,
        devicesCleaned: cleanedDevices,
      });
    }
  },
  60 * 60 * 1000,
);

// ═══════════════════════════════════════════════════════════════════════════
// LOW-002: HEADERS DE SÉCURITÉ POUR API MOBILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ajoute des headers de sécurité spécifiques aux réponses API mobile
 */
export const mobileSecurityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Empêcher le caching des réponses sensibles
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // Protection contre le clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Désactiver le MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Politique de référent
  res.setHeader("Referrer-Policy", "no-referrer");

  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// LOW-003: VÉRIFICATION DE VERSION D'APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

export const checkAppVersion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const platform = (req.headers["x-platform"] as string)?.toLowerCase();
  const appVersion = req.headers["x-app-version"] as string;

  if (!appVersion) {
    if (process.env.NODE_ENV?.toLowerCase() === "production") {
      mobileSecLogger.warn("Requête sans version d'app", {
        ip: anonymizeIp(req.ip || ""),
      });
    }
    return next();
  }

  // Guard format : un appVersion non-semver provoquerait une exception dans
  // compareVersions. On skip le check plutôt que de rejeter — ne pas bloquer
  // un client mal configuré pour un header malformé (dégradation silencieuse).
  if (!isValidSemver(appVersion)) {
    mobileSecLogger.warn("Version d'app invalide ignorée", {
      appVersion,
      platform,
      ip: anonymizeIp(req.ip || ""),
    });
    return next();
  }

  try {
    const dbConfig = await AppVersionModel.findOne().lean();

    let minVersion: string;
    let forceUpdate: boolean;

    if (dbConfig && platform && (platform === "ios" || platform === "android")) {
      const platformConfig = dbConfig[platform];
      minVersion = platformConfig.minVersion;
      forceUpdate = platformConfig.forceUpdate;
    } else {
      minVersion = MIN_APP_VERSION[platform] ?? "";
      forceUpdate = true;
    }

    if (minVersion && compareVersions(appVersion, minVersion) < 0) {
      mobileSecLogger.warn("Version obsolète détectée", {
        currentVersion: appVersion,
        minVersion,
        platform,
        forceUpdate,
      });

      if (forceUpdate) {
        return res.status(426).json({
          error: "Veuillez mettre à jour l'application pour continuer.",
          code: "UPDATE_REQUIRED",
          minVersion,
          currentVersion: appVersion,
          platform,
        });
      }
    }

    return next();
  } catch (error) {
    mobileSecLogger.error("Error checking app version from DB, falling back to env vars", {
      error: error instanceof Error ? error.message : String(error),
    });

    const minVersion = MIN_APP_VERSION[platform];
    if (minVersion && compareVersions(appVersion, minVersion) < 0) {
      return res.status(426).json({
        error: "Veuillez mettre à jour l'application pour continuer.",
        code: "UPDATE_REQUIRED",
        minVersion,
        currentVersion: appVersion,
        platform,
      });
    }

    return next();
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LOW-001: HELPERS POUR SANITISER LES LOGS
// ═══════════════════════════════════════════════════════════════════════════
// Fonctions déplacées dans src/utils/logUtils.ts pour centralisation
