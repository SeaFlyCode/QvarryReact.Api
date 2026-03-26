// ═══════════════════════════════════════════════════════════════════════════
// MED-001: MIDDLEWARE DE DEVICE BINDING POUR TOKENS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Valide que le device_id du token correspond au device_id du header
// Prévient la réutilisation de tokens volés sur un autre appareil
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import UserModel from "../models/users";
import { logger } from "../services/loggerService";
import { auditService } from "../services/auditService";
import { redisSessionService } from "../services/redisSessionService";

const deviceBindingLogger = logger.child({ service: "device-binding" });

interface DecodedToken {
  id: string;
  deviceId?: string;
  jti?: string;
  platform?: string;
}

/**
 * Middleware de validation du device binding
 * - Vérifie que le deviceId du token correspond au header x-device-id
 * - Vérifie que le device est dans la liste authorized_devices
 * - Met à jour last_seen du device
 * - Rate limiting spécifique par device_id
 */
export const deviceBindingMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 1. Extraire le token (déjà validé par mobileAuthMiddleware)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Token manquant",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2. Décoder le token (sans vérification, car déjà fait par mobileAuthMiddleware)
    const decoded = jwt.decode(token) as DecodedToken | null;
    if (!decoded || !decoded.id) {
      return res.status(401).json({
        error: "Token invalide",
        code: "INVALID_TOKEN",
      });
    }

    // 3. Extraire device_id du header
    const headerDeviceId = req.headers["x-device-id"] as string;
    if (!headerDeviceId) {
      deviceBindingLogger.warn("Header x-device-id manquant", {
        userId: decoded.id,
        path: req.path,
      });
      return res.status(400).json({
        error: "Device ID requis (header x-device-id)",
        code: "DEVICE_ID_MISSING",
      });
    }

    // 4. Vérifier que le token contient un deviceId (tokens mobiles uniquement)
    if (!decoded.deviceId) {
      deviceBindingLogger.warn("Token sans deviceId", {
        userId: decoded.id,
        path: req.path,
      });
      return res.status(401).json({
        error: "Token invalide pour mobile",
        code: "TOKEN_NO_DEVICE_BINDING",
      });
    }

    // 5. TIMING-SAFE COMPARISON entre token deviceId et header deviceId
    const tokenDeviceIdBuffer = Buffer.from(decoded.deviceId);
    const headerDeviceIdBuffer = Buffer.from(headerDeviceId);

    // Si longueurs différentes, faire quand même une comparaison (timing-safe)
    if (tokenDeviceIdBuffer.length !== headerDeviceIdBuffer.length) {
      // Comparer avec un buffer factice de même longueur
      const dummyBuffer = Buffer.alloc(tokenDeviceIdBuffer.length);
      try {
        crypto.timingSafeEqual(tokenDeviceIdBuffer, dummyBuffer);
      } catch {
        // Ignore
      }

      deviceBindingLogger.warn("Device ID mismatch (longueurs différentes)", {
        userId: decoded.id,
        tokenDeviceIdLength: tokenDeviceIdBuffer.length,
        headerDeviceIdLength: headerDeviceIdBuffer.length,
        path: req.path,
      });

      await auditService.log({
        userId: decoded.id,
        action: "DEVICE_MISMATCH_DETECTED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          tokenDeviceId: decoded.deviceId,
          headerDeviceId: headerDeviceId,
          path: req.path,
        },
      });

      return res.status(401).json({
        error: "Device ID mismatch. Veuillez vous reconnecter.",
        code: "DEVICE_MISMATCH",
      });
    }

    // Comparaison timing-safe
    if (!crypto.timingSafeEqual(tokenDeviceIdBuffer, headerDeviceIdBuffer)) {
      deviceBindingLogger.warn("Device ID mismatch", {
        userId: decoded.id,
        tokenDeviceId: decoded.deviceId.substring(0, 8) + "...",
        headerDeviceId: headerDeviceId.substring(0, 8) + "...",
        path: req.path,
      });

      await auditService.log({
        userId: decoded.id,
        action: "DEVICE_MISMATCH_DETECTED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          tokenDeviceId: decoded.deviceId,
          headerDeviceId: headerDeviceId,
          path: req.path,
        },
      });

      return res.status(401).json({
        error: "Device ID mismatch. Veuillez vous reconnecter.",
        code: "DEVICE_MISMATCH",
      });
    }

    // 6. Vérifier que le device est dans authorized_devices
    const user = await UserModel.findById(decoded.id)
      .select("authorized_devices is_blocked")
      .lean();

    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.is_blocked) {
      return res.status(403).json({
        error: "Compte suspendu",
        code: "ACCOUNT_BLOCKED",
      });
    }

    const authorizedDevice = user.authorized_devices?.find(
      (d) => d.device_id === headerDeviceId,
    );

    if (!authorizedDevice) {
      deviceBindingLogger.warn("Device non autorisé", {
        userId: decoded.id,
        deviceId: headerDeviceId.substring(0, 8) + "...",
        path: req.path,
      });

      await auditService.log({
        userId: decoded.id,
        action: "UNAUTHORIZED_DEVICE_ACCESS",
        level: "critical",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          deviceId: headerDeviceId,
          path: req.path,
          method: req.method,
        },
      });

      // Blacklister le token car utilisé avec un device non autorisé
      await redisSessionService.blacklistToken(
        token,
        {
          token,
          userId: decoded.id,
          blacklistedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          reason: "UNAUTHORIZED_DEVICE_ACCESS",
        },
        24 * 60 * 60, // 24h
      );

      return res.status(403).json({
        error:
          "Appareil non autorisé. Veuillez vous reconnecter depuis cet appareil.",
        code: "DEVICE_NOT_AUTHORIZED",
      });
    }

    // 7. Mettre à jour last_seen du device
    await UserModel.findOneAndUpdate(
      {
        _id: decoded.id,
        "authorized_devices.device_id": headerDeviceId,
      },
      {
        $set: {
          "authorized_devices.$.last_seen": new Date(),
        },
      },
    ).catch((err) => {
      deviceBindingLogger.error("Erreur mise à jour last_seen", {
        error: err.message,
      });
    });

    // 8. Attacher deviceId validé à la requête
    (req as any).validatedDeviceId = headerDeviceId;
    (req as any).deviceInfo = {
      id: authorizedDevice.device_id,
      name: authorizedDevice.device_name,
      os: authorizedDevice.device_os,
      trusted: authorizedDevice.trusted,
      firstSeen: authorizedDevice.first_seen,
      lastSeen: authorizedDevice.last_seen,
    };

    // Log succès (debug uniquement)
    deviceBindingLogger.debug("Device binding validé", {
      userId: decoded.id,
      deviceId: headerDeviceId.substring(0, 8) + "...",
      trusted: authorizedDevice.trusted,
    });

    next();
  } catch (error) {
    deviceBindingLogger.error("Erreur device binding middleware", {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
    });
    return res.status(500).json({
      error: "Erreur de validation de l'appareil",
      code: "DEVICE_BINDING_ERROR",
    });
  }
};

/**
 * Rate limiting spécifique par device_id
 * Limite le nombre de requêtes par appareil (plus strict que par IP)
 */
export const createDeviceRateLimiter = (maxRequests: number = 30) => {
  const deviceLimits = new Map<
    string,
    { count: number; resetAt: number; blocked: boolean }
  >();

  // Nettoyage toutes les 5 minutes
  setInterval(
    () => {
      const now = Date.now();
      for (const [deviceId, data] of deviceLimits.entries()) {
        if (now > data.resetAt) {
          deviceLimits.delete(deviceId);
        }
      }
    },
    5 * 60 * 1000,
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    const deviceId = (req as any).validatedDeviceId;

    if (!deviceId) {
      // Si pas de deviceId validé, laisser passer (géré par deviceBindingMiddleware)
      return next();
    }

    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    let limitData = deviceLimits.get(deviceId);

    if (!limitData || now > limitData.resetAt) {
      limitData = {
        count: 0,
        resetAt: now + windowMs,
        blocked: false,
      };
      deviceLimits.set(deviceId, limitData);
    }

    if (limitData.blocked && now < limitData.resetAt) {
      deviceBindingLogger.warn("Device rate limit exceeded", {
        deviceId: deviceId.substring(0, 8) + "...",
        count: limitData.count,
      });
      return res.status(429).json({
        error: "Trop de requêtes depuis cet appareil",
        code: "DEVICE_RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil((limitData.resetAt - now) / 1000),
      });
    }

    limitData.count++;

    if (limitData.count > maxRequests) {
      limitData.blocked = true;
      deviceBindingLogger.warn("Device blocked due to rate limit", {
        deviceId: deviceId.substring(0, 8) + "...",
        count: limitData.count,
      });

      await auditService.log({
        userId: (req as any).user?.id,
        action: "DEVICE_RATE_LIMIT_EXCEEDED",
        level: "warning",
        ipAddress: req.ip,
        details: {
          deviceId,
          requestCount: limitData.count,
          path: req.path,
        },
      });

      return res.status(429).json({
        error: "Trop de requêtes depuis cet appareil",
        code: "DEVICE_RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil((limitData.resetAt - now) / 1000),
      });
    }

    next();
  };
};
