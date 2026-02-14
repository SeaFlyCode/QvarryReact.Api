// server/src/middlewares/rateLimitMiddleware.ts
import { Request, Response, NextFunction } from "express";
import { auditService } from "../services/auditService";

interface RateLimitEntry {
    count: number;
    firstAttempt: Date;
    blockedUntil?: Date;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const twoFactorRateLimitStore = new Map<string, RateLimitEntry>();

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10');
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000;
const BLOCK_DURATION_MS = parseInt(process.env.RATE_LIMIT_BLOCK_MINUTES || '30') * 60 * 1000;

// Limites plus souples pour les étapes 2FA (après le login initial)
const TWO_FACTOR_MAX_REQUESTS = 20;
const TWO_FACTOR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const TWO_FACTOR_BLOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Import dynamique pour éviter les dépendances circulaires
let securityAlertService: any = null;
const getSecurityAlertService = async () => {
    if (!securityAlertService) {
        const module = await import('../services/securityAlertService');
        securityAlertService = module.securityAlertService;
    }
    return securityAlertService;
};

/**
 * Middleware de vérification des IPs bloquées
 * À utiliser en premier dans la chaîne des middlewares
 */
export const ipBlockCheckMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const identifier = req.ip || req.connection.remoteAddress || 'unknown';
        const alertService = await getSecurityAlertService();
        const blockStatus = await alertService.isIpBlocked(identifier);

        if (blockStatus.blocked) {
            console.warn(`🚫 [SECURITY] Blocked IP attempted access: ${identifier}`);

            // Log la tentative
            await auditService.log({
                action: 'BLOCKED_IP_ACCESS_ATTEMPT',
                level: 'warning',
                ipAddress: identifier,
                userAgent: req.get('user-agent'),
                details: {
                    reason: blockStatus.reason,
                    blockedUntil: blockStatus.until,
                    attemptedPath: req.path
                }
            });

            const remainingTime = blockStatus.until
                ? Math.ceil((blockStatus.until.getTime() - Date.now()) / 60000)
                : 'permanent';

            return res.status(403).json({
                error: `Accès refusé. Votre adresse IP a été bloquée.`,
                reason: blockStatus.reason,
                blockedUntil: blockStatus.until,
                remainingMinutes: remainingTime,
                code: 'IP_BLOCKED'
            });
        }

        next();
    } catch (error) {
        // En cas d'erreur, on laisse passer pour ne pas bloquer le service
        console.error('❌ [SECURITY] Error checking IP block status:', error);
        next();
    }
};

export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.ip || req.connection.remoteAddress || 'unknown';
    const now = new Date();
    let entry = rateLimitStore.get(identifier);

    if (!entry) {
        rateLimitStore.set(identifier, { count: 1, firstAttempt: now });
        return next();
    }

    if (entry.blockedUntil && entry.blockedUntil > now) {
        const remainingMinutes = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 60000);
        return res.status(429).json({
            error: `Trop de tentatives. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: remainingMinutes
        });
    }

    const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
    if (timeSinceFirst > WINDOW_MS) {
        rateLimitStore.set(identifier, { count: 1, firstAttempt: now });
        return next();
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
        entry.blockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS);
        rateLimitStore.set(identifier, entry);

        // Log avec déclenchement d'alerte de sécurité
        await auditService.log({
            action: 'RATE_LIMIT_TRIGGERED',
            level: 'warning',
            ipAddress: identifier,
            userAgent: req.get('user-agent'),
            details: { attempts: entry.count, endpoint: req.path }
        });

        return res.status(429).json({
            error: `Trop de tentatives. Bloqué pour ${BLOCK_DURATION_MS / 60000} minutes.`,
            code: 'RATE_LIMIT_EXCEEDED'
        });
    }

    rateLimitStore.set(identifier, entry);
    next();
};

/**
 * Rate limiter dédié aux routes 2FA (vérification et completion)
 * Plus souple que le rate limiter principal car ces routes sont appelées
 * après une première authentification réussie
 */
export const twoFactorRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const identifier = `2fa_${req.ip || req.connection.remoteAddress || 'unknown'}`;
    const now = new Date();
    let entry = twoFactorRateLimitStore.get(identifier);

    if (!entry) {
        twoFactorRateLimitStore.set(identifier, { count: 1, firstAttempt: now });
        return next();
    }

    if (entry.blockedUntil && entry.blockedUntil > now) {
        const remainingMinutes = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 60000);
        return res.status(429).json({
            error: `Trop de tentatives 2FA. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: remainingMinutes
        });
    }

    const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
    if (timeSinceFirst > TWO_FACTOR_WINDOW_MS) {
        twoFactorRateLimitStore.set(identifier, { count: 1, firstAttempt: now });
        return next();
    }

    entry.count++;

    if (entry.count > TWO_FACTOR_MAX_REQUESTS) {
        entry.blockedUntil = new Date(now.getTime() + TWO_FACTOR_BLOCK_DURATION_MS);
        twoFactorRateLimitStore.set(identifier, entry);

        await auditService.log({
            action: 'TWO_FACTOR_RATE_LIMIT_TRIGGERED',
            level: 'warning',
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
            details: { attempts: entry.count, endpoint: req.path }
        });

        return res.status(429).json({
            error: `Trop de tentatives 2FA. Bloqué pour ${TWO_FACTOR_BLOCK_DURATION_MS / 60000} minutes.`,
            code: 'RATE_LIMIT_EXCEEDED'
        });
    }

    twoFactorRateLimitStore.set(identifier, entry);
    next();
};

export const resetRateLimit = (identifier: string): void => {
    rateLimitStore.delete(identifier);
};

export const resetTwoFactorRateLimit = (identifier: string): void => {
    twoFactorRateLimitStore.delete(`2fa_${identifier}`);
};

