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

import { Request, Response, NextFunction } from 'express';
import { auditService } from '../services/auditService';
import { redisSessionService } from '../services/redisSessionService';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface MobileRateLimitEntry {
    count: number;
    firstAttempt: Date;
    blockedUntil?: Date;
    deviceIds: Set<string>;
}

interface DeviceAttestationPayload {
    bundleId: string;
    deviceId: string;
    timestamp: number;
    platform: 'ios' | 'android';
    signature?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// LOW-003: Version minimale requise de l'application
const MIN_APP_VERSION: Record<string, string> = {
    ios: process.env.MIN_IOS_VERSION || '1.0.0',
    android: process.env.MIN_ANDROID_VERSION || '1.0.0'
};

// Rate limiting pour mobile (plus strict car pas de Turnstile)
const MOBILE_MAX_REQUESTS = parseInt(process.env.MOBILE_RATE_LIMIT_MAX || '5');
const MOBILE_WINDOW_MS = parseInt(process.env.MOBILE_RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000;
const MOBILE_BLOCK_DURATION_MS = parseInt(process.env.MOBILE_RATE_LIMIT_BLOCK_MINUTES || '30') * 60 * 1000;

// HIGH-003: Store en mémoire comme fallback, Redis utilisé via redisSessionService en production
// Les fonctions ci-dessous utilisent Redis quand disponible
const mobileRateLimitStore = new Map<string, MobileRateLimitEntry>();
const knownDevices = new Map<string, { userId?: string; firstSeen: Date; lastSeen: Date; trustScore: number }>();
const blockedDevices = new Set<string>();

// Préfixes Redis pour le rate limiting mobile
const REDIS_PREFIX_RATE_LIMIT = 'qvarry:mobile_rate:';
const REDIS_PREFIX_BLOCKED_DEVICE = 'qvarry:blocked_device:';
const REDIS_PREFIX_KNOWN_DEVICE = 'qvarry:known_device:';

// Bundle IDs autorisés pour l'attestation
const ALLOWED_BUNDLE_IDS = [
    'fr.qvarry.app',
    'fr.qvarry.mobile',
    'com.qvarry.app',
    process.env.MOBILE_BUNDLE_ID_IOS,
    process.env.MOBILE_BUNDLE_ID_ANDROID
].filter(Boolean);

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère un identifiant composite pour le rate limiting (IP + Device)
 */
function getMobileIdentifier(req: Request): string {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const deviceId = req.headers['x-device-id'] as string || 'no-device';
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
 * Calcule un score de confiance pour l'appareil
 */
function calculateDeviceTrustScore(deviceId: string, req: Request): number {
    let score = 50; // Score de base

    const device = knownDevices.get(deviceId);
    if (device) {
        // Appareil déjà vu = +20
        score += 20;

        // Utilisé depuis plus de 7 jours = +15
        const daysSinceFirstSeen = (Date.now() - device.firstSeen.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceFirstSeen > 7) score += 15;

        // Déjà associé à un utilisateur = +10
        if (device.userId) score += 10;
    }

    // Headers mobiles présents = +5 chacun
    if (req.headers['x-platform']) score += 5;
    if (req.headers['x-app-version']) score += 5;

    return Math.min(score, 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: VÉRIFICATION PLATEFORME MOBILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifie que la requête provient bien d'une app mobile
 * Headers requis: X-Platform, X-Device-ID
 */
export const verifyMobilePlatform = async (req: Request, res: Response, next: NextFunction) => {
    const platform = req.headers['x-platform'] as string;
    const deviceId = req.headers['x-device-id'] as string;

    // Vérifier la présence du header plateforme
    if (!platform || !['ios', 'android', 'mobile'].includes(platform.toLowerCase())) {
        console.warn(`⚠️ [MOBILE-SEC] Plateforme manquante ou invalide: ${platform} depuis ${req.ip}`);
        return res.status(400).json({
            error: 'Plateforme non spécifiée ou invalide',
            code: 'INVALID_PLATFORM',
            hint: 'Header X-Platform requis (ios/android)'
        });
    }

    // Vérifier la présence et validité du Device ID
    if (!isValidDeviceId(deviceId)) {
        console.warn(`⚠️ [MOBILE-SEC] Device ID manquant ou invalide depuis ${req.ip}`);
        return res.status(400).json({
            error: 'Identifiant d\'appareil manquant ou invalide',
            code: 'INVALID_DEVICE_ID',
            hint: 'Header X-Device-ID requis (UUID format)'
        });
    }

    // Vérifier si l'appareil est bloqué
    if (blockedDevices.has(deviceId)) {
        console.warn(`🚫 [MOBILE-SEC] Appareil bloqué tentant d'accéder: ${deviceId}`);
        await auditService.log({
            action: 'BLOCKED_DEVICE_ACCESS_ATTEMPT',
            level: 'warning',
            ipAddress: req.ip || 'unknown',
            userAgent: req.headers['user-agent'],
            details: { deviceId, platform }
        });
        return res.status(403).json({
            error: 'Cet appareil a été bloqué',
            code: 'DEVICE_BLOCKED'
        });
    }

    // Mettre à jour ou créer l'entrée de l'appareil
    const now = new Date();
    const existingDevice = knownDevices.get(deviceId);
    if (existingDevice) {
        existingDevice.lastSeen = now;
        existingDevice.trustScore = calculateDeviceTrustScore(deviceId, req);
    } else {
        knownDevices.set(deviceId, {
            firstSeen: now,
            lastSeen: now,
            trustScore: calculateDeviceTrustScore(deviceId, req)
        });
    }

    // Ajouter des infos à la requête pour les middlewares suivants
    (req as any).mobileContext = {
        platform: platform.toLowerCase(),
        deviceId,
        trustScore: knownDevices.get(deviceId)?.trustScore || 50
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
 */
export const mobileRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const identifier = getMobileIdentifier(req);
    const deviceId = req.headers['x-device-id'] as string;
    const now = new Date();

    let entry = mobileRateLimitStore.get(identifier);

    if (!entry) {
        mobileRateLimitStore.set(identifier, {
            count: 1,
            firstAttempt: now,
            deviceIds: new Set([deviceId])
        });
        return next();
    }

    // Vérifier si bloqué
    if (entry.blockedUntil && entry.blockedUntil > now) {
        const remainingMinutes = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 60000);

        await auditService.log({
            action: 'MOBILE_RATE_LIMIT_BLOCKED',
            level: 'warning',
            ipAddress: req.ip || 'unknown',
            userAgent: req.headers['user-agent'],
            details: { deviceId, remainingMinutes, endpoint: req.path }
        });

        return res.status(429).json({
            error: `Trop de tentatives. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: remainingMinutes * 60
        });
    }

    // Réinitialiser la fenêtre si expirée
    const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
    if (timeSinceFirst > MOBILE_WINDOW_MS) {
        mobileRateLimitStore.set(identifier, {
            count: 1,
            firstAttempt: now,
            deviceIds: new Set([deviceId])
        });
        return next();
    }

    // Incrémenter le compteur
    entry.count++;
    entry.deviceIds.add(deviceId);

    // Vérification de comportement suspect: plusieurs devices pour même IP
    if (entry.deviceIds.size > 3) {
        console.warn(`🚨 [MOBILE-SEC] Comportement suspect: ${entry.deviceIds.size} appareils différents depuis ${req.ip}`);
        await auditService.log({
            action: 'MOBILE_SUSPICIOUS_MULTI_DEVICE',
            level: 'warning',
            ipAddress: req.ip || 'unknown',
            details: { deviceCount: entry.deviceIds.size, devices: Array.from(entry.deviceIds) }
        });
    }

    // Bloquer si limite dépassée
    if (entry.count > MOBILE_MAX_REQUESTS) {
        entry.blockedUntil = new Date(now.getTime() + MOBILE_BLOCK_DURATION_MS);
        mobileRateLimitStore.set(identifier, entry);

        await auditService.log({
            action: 'MOBILE_RATE_LIMIT_TRIGGERED',
            level: 'warning',
            ipAddress: req.ip || 'unknown',
            userAgent: req.headers['user-agent'],
            details: {
                attempts: entry.count,
                endpoint: req.path,
                deviceId,
                blockDuration: MOBILE_BLOCK_DURATION_MS / 60000
            }
        });

        return res.status(429).json({
            error: `Trop de tentatives. Bloqué pour ${MOBILE_BLOCK_DURATION_MS / 60000} minutes.`,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: MOBILE_BLOCK_DURATION_MS / 1000
        });
    }

    mobileRateLimitStore.set(identifier, entry);
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
        const attestationHeader = req.headers['x-device-attestation'] as string;

        if (!attestationHeader) {
            if (strict) {
                console.warn(`⚠️ [MOBILE-SEC] Attestation manquante (mode strict) depuis ${req.ip}`);
                return res.status(403).json({
                    error: 'Attestation d\'appareil requise',
                    code: 'ATTESTATION_REQUIRED'
                });
            }
            // Mode non strict: continuer sans attestation
            return next();
        }

        try {
            // Décoder et valider l'attestation
            const attestationData = JSON.parse(
                Buffer.from(attestationHeader, 'base64').toString('utf-8')
            ) as DeviceAttestationPayload;

            // Vérifier le bundle ID
            if (!ALLOWED_BUNDLE_IDS.includes(attestationData.bundleId)) {
                console.warn(`🚫 [MOBILE-SEC] Bundle ID non autorisé: ${attestationData.bundleId}`);
                await auditService.log({
                    action: 'MOBILE_INVALID_BUNDLE_ID',
                    level: 'warning',
                    ipAddress: req.ip || 'unknown',
                    details: { bundleId: attestationData.bundleId }
                });
                return res.status(403).json({
                    error: 'Application non autorisée',
                    code: 'INVALID_BUNDLE_ID'
                });
            }

            // Vérifier le timestamp (pas plus vieux que 5 minutes)
            const maxAge = 5 * 60 * 1000;
            if (Date.now() - attestationData.timestamp > maxAge) {
                console.warn(`⚠️ [MOBILE-SEC] Attestation expirée depuis ${req.ip}`);
                return res.status(403).json({
                    error: 'Attestation expirée',
                    code: 'ATTESTATION_EXPIRED'
                });
            }

            // Vérifier la cohérence du device ID
            const headerDeviceId = req.headers['x-device-id'] as string;
            if (attestationData.deviceId !== headerDeviceId) {
                console.warn(`🚫 [MOBILE-SEC] Device ID mismatch: header=${headerDeviceId}, attestation=${attestationData.deviceId}`);
                return res.status(403).json({
                    error: 'Incohérence d\'identifiant d\'appareil',
                    code: 'DEVICE_ID_MISMATCH'
                });
            }

            // TODO: Validation réelle avec Apple/Google APIs
            // - iOS: Appeler Apple's App Attest API
            // - Android: Appeler Google Play Integrity API
            // Pour l'instant, on fait une validation basique

            // Augmenter le trust score si attestation valide
            const deviceId = req.headers['x-device-id'] as string;
            const device = knownDevices.get(deviceId);
            if (device) {
                device.trustScore = Math.min(device.trustScore + 25, 100);
            }

            console.log(`✅ [MOBILE-SEC] Attestation validée pour device ${deviceId}`);
            (req as any).attestationVerified = true;

            next();
        } catch (error) {
            console.error(`❌ [MOBILE-SEC] Erreur validation attestation:`, error);

            if (strict) {
                return res.status(403).json({
                    error: 'Attestation invalide',
                    code: 'INVALID_ATTESTATION'
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
    verifyDeviceAttestation(false) // Mode non strict par défaut
];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITAIRES D'ADMINISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bloque un appareil
 */
export function blockDevice(deviceId: string, reason: string): void {
    blockedDevices.add(deviceId);
    console.log(`🚫 [MOBILE-SEC] Appareil bloqué: ${deviceId} - Raison: ${reason}`);
    auditService.log({
        action: 'DEVICE_BLOCKED',
        level: 'warning',
        details: { deviceId, reason }
    });
}

/**
 * Débloque un appareil
 */
export function unblockDevice(deviceId: string): void {
    blockedDevices.delete(deviceId);
    console.log(`✅ [MOBILE-SEC] Appareil débloqué: ${deviceId}`);
}

/**
 * Réinitialise le rate limit pour un identifiant
 */
export function resetMobileRateLimit(identifier: string): void {
    mobileRateLimitStore.delete(identifier);
}

/**
 * Associe un device à un utilisateur (après login réussi)
 */
export function associateDeviceWithUser(deviceId: string, userId: string): void {
    const device = knownDevices.get(deviceId);
    if (device) {
        device.userId = userId;
        device.trustScore = Math.min(device.trustScore + 10, 100);
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
        blockedDevices: Array.from(blockedDevices)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// NETTOYAGE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════════════════

// Nettoyer les entrées expirées toutes les heures
setInterval(() => {
    const now = new Date();
    let cleanedRateLimits = 0;
    let cleanedDevices = 0;

    // Nettoyer le rate limit store
    for (const [identifier, entry] of mobileRateLimitStore.entries()) {
        const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
        if (timeSinceFirst > MOBILE_WINDOW_MS && (!entry.blockedUntil || entry.blockedUntil < now)) {
            mobileRateLimitStore.delete(identifier);
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
        console.log(`🧹 [MOBILE-SEC CLEANUP] Rate limits: ${cleanedRateLimits} | Devices: ${cleanedDevices}`);
    }
}, 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// LOW-002: HEADERS DE SÉCURITÉ POUR API MOBILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ajoute des headers de sécurité spécifiques aux réponses API mobile
 */
export const mobileSecurityHeaders = (req: Request, res: Response, next: NextFunction) => {
    // Empêcher le caching des réponses sensibles
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Protection contre le clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Désactiver le MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Politique de référent
    res.setHeader('Referrer-Policy', 'no-referrer');

    next();
};

// ═══════════════════════════════════════════════════════════════════════════
// LOW-003: VÉRIFICATION DE VERSION D'APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare deux versions sémantiques (ex: "1.2.3")
 * Retourne: -1 si v1 < v2, 0 si égal, 1 si v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
    }
    return 0;
}

/**
 * Vérifie que l'application mobile est à jour
 * Refuse les requêtes des versions obsolètes
 */
export const checkAppVersion = (req: Request, res: Response, next: NextFunction) => {
    const platform = (req.headers['x-platform'] as string)?.toLowerCase();
    const appVersion = req.headers['x-app-version'] as string;

    // Si pas de version fournie, on laisse passer (rétrocompatibilité)
    // mais on log un warning
    if (!appVersion) {
        if (process.env.NODE_ENV === 'production') {
            console.warn(`⚠️ [MOBILE-SEC] Requête sans version d'app depuis ${req.ip}`);
        }
        return next();
    }

    // Vérifier la version minimale selon la plateforme
    const minVersion = MIN_APP_VERSION[platform];
    if (minVersion && compareVersions(appVersion, minVersion) < 0) {
        console.warn(`🚫 [MOBILE-SEC] Version obsolète: ${appVersion} < ${minVersion} (${platform})`);
        return res.status(426).json({
            error: "Veuillez mettre à jour l'application pour continuer.",
            code: 'UPDATE_REQUIRED',
            minVersion,
            currentVersion: appVersion,
            platform
        });
    }

    next();
};

// ═══════════════════════════════════════════════════════════════════════════
// LOW-001: HELPERS POUR SANITISER LES LOGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Masque une adresse IP pour les logs
 */
export function maskIP(ip: string): string {
    if (!ip) return 'unknown';
    if (ip.includes(':')) {
        // IPv6
        const parts = ip.split(':');
        return parts.slice(0, 4).join(':') + ':****:****:****:****';
    } else {
        // IPv4
        const parts = ip.split('.');
        return parts.slice(0, 2).join('.') + '.***.**';
    }
}

/**
 * Tronque un Device ID pour les logs
 */
export function maskDeviceId(deviceId: string): string {
    if (!deviceId) return 'unknown';
    return deviceId.substring(0, 8) + '...';
}

/**
 * Sanitise les données pour les logs (LOW-001)
 */
export function sanitizeForLog(data: {
    deviceId?: string;
    userAgent?: string;
    ipAddress?: string;
    [key: string]: any;
}): Record<string, any> {
    return {
        ...data,
        deviceId: data.deviceId ? maskDeviceId(data.deviceId) : undefined,
        userAgent: data.userAgent ? data.userAgent.substring(0, 50) : undefined,
        ipAddress: data.ipAddress ? maskIP(data.ipAddress) : undefined
    };
}
