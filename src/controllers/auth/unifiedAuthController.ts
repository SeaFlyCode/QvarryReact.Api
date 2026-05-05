// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEUR D'AUTHENTIFICATION UNIFIÉ (P1 — login/2FA web+mobile)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoint principal :
//   POST /api/v1/auth/login
//   POST /api/v1/auth/complete-2fa
//
// Réponse JSON pour TOUS les clients (web et mobile). Aucun cookie posé
// côté serveur — le client (Next.js routes ou app mobile) gère son propre
// stockage (cookies HttpOnly côté Next.js, SecureStore côté mobile).
//
// Les anciens endpoints `/auth/login`, `/auth/complete-2fa-login`,
// `/mobile/auth/login`, `/mobile/2fa/verify-login` sont câblés en alias
// rétro-compat dans les fichiers de routes (cf. authRoutes.ts,
// mobileAuthRoutes.ts, mobileTwoFactorRoutes.ts).
//
// Codes 403 unifiés (cf. utils/authErrors.ts) :
//   - BLOCKED              : compte bloqué
//   - UNVERIFIED           : email non vérifié
//   - PENDING_VALIDATION   : compte en attente de validation manuelle (ou refusé)
//   - UNAUTHORIZED         : autre motif
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";

import { getUserByEmail } from "../../services/userService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { auditService } from "../../services/auditService";
import { resetRateLimit } from "../../middlewares/rateLimitMiddleware";
import { generateDeviceFingerprint } from "../../utils/deviceFingerprint";
import { decrypt } from "../../utils/masterEncryptionUtils";
import { sendSecurityAlertEmail } from "../../services/emailService";
import { maskEmail } from "../../utils/logUtils";
import { serializeUserForApi } from "../../utils/userSerializer";
import { sendForbidden } from "../../utils/authErrors";
import { logger } from "../../services/loggerService";
import { setRequestContext } from "../../middlewares/correlationMiddleware";

import UserModel from "../../models/users";
import MaintenanceModel from "../../models/maintenance";
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
  loadAndDecryptUserData,
} from "./authHelpers";

const unifiedAuthLogger = logger.child({ service: "auth-unified" });

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ═══════════════════════════════════════════════════════════════════════════

const DUMMY_HASH =
  "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getJwtExpiresInSeconds(): number {
  return (
    parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60
  );
}

function getRefreshExpiresInSeconds(): number {
  return parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60;
}

/**
 * Détermine le client à utiliser pour la génération de tokens et les sessions.
 * - mobile : si la requête a un mobileContext (header X-Platform validé), un
 *   header X-Device-ID, ou si la route est explicitement mobile.
 * - web : sinon.
 */
function detectClient(req: Request): "web" | "mobile" {
  // Set explicitement par la route mobile
  if ((req as any).clientType === "mobile") return "mobile";
  // mobileContext est posé par mobileSecurityMiddleware
  if ((req as any).mobileContext) return "mobile";
  // Heuristique : header x-device-id présent → mobile
  if (req.headers["x-device-id"]) return "mobile";
  return "web";
}

/**
 * Construit la réponse "user" à renvoyer dans le payload.
 * Sérialise via serializeUserForApi pour exclure les champs sensibles
 * et déchiffrer les champs chiffrés.
 */
function buildUserPayload(user: any) {
  return serializeUserForApi(user);
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGIN UNIFIÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Réponse 200 standard:
 *   { accessToken, refreshToken, user, tokenExpiresIn, refreshTokenExpiresIn }
 * Réponse 200 avec 2FA requis:
 *   { requires2FA: true, tempToken, message }
 */
export async function handleUnifiedLogin(req: Request, res: Response) {
  const startTime = Date.now();
  const client = detectClient(req);
  const mobileContext = (req as any).mobileContext;

  try {
    const { email, password } = req.body || {};

    // 1. VALIDATION DES ENTRÉES
    if (!email || !password) {
      return res.status(400).json({
        error: "Email et mot de passe requis.",
        code: "MISSING_CREDENTIALS",
      });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "Format d'email invalide.",
        code: "INVALID_EMAIL_FORMAT",
      });
    }

    // 2. RATE LIMITING (BRUTE FORCE)
    const attemptCheck = await checkLoginAttempts(email);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: attemptCheck.message,
        waitTime: attemptCheck.waitTime,
        code: "TOO_MANY_ATTEMPTS",
      });
    }

    // 3. RÉCUPÉRATION USER + COMPARAISON BCRYPT (timing-safe)
    const user = await getUserByEmail(email);
    const passwordToCompare = user?.password || DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

    if (!user || !isPasswordValid) {
      const failIp =
        req.ip || (req as any).connection?.remoteAddress || undefined;
      await recordFailedLogin(email, failIp);
      return res.status(401).json({
        error: "Email ou mot de passe incorrect.",
        code: "INVALID_CREDENTIALS",
      });
    }

    // 4. MAINTENANCE
    const maintenance = await MaintenanceModel.findOne().lean();
    const isMaintenanceActive = maintenance?.isActive || false;
    if (isMaintenanceActive && !user.is_admin) {
      return res.status(503).json({
        error:
          "Le site est actuellement en maintenance. Seuls les administrateurs peuvent se connecter.",
        maintenance: true,
        message: maintenance?.message || "Site en maintenance",
        code: "MAINTENANCE_MODE",
      });
    }

    // 5. ÉTATS DU COMPTE → 403 STRUCTURÉS
    if (user.is_blocked) {
      unifiedAuthLogger.warn("Tentative connexion compte bloqué", {
        email: maskEmail(email),
      });
      return sendForbidden(
        res,
        "BLOCKED",
        "Votre compte a été suspendu. Contactez l'administrateur pour plus d'informations.",
      );
    }

    if (!user.is_verified) {
      return sendForbidden(
        res,
        "UNVERIFIED",
        "Veuillez vérifier votre adresse email avant de vous connecter.",
        { email },
      );
    }

    if (!user.is_admin_validated) {
      if (user.admin_validation_rejected) {
        unifiedAuthLogger.warn("Tentative connexion compte refusé", {
          email: maskEmail(email),
        });
        return sendForbidden(
          res,
          "PENDING_VALIDATION",
          "Votre demande de compte a été refusée. Contactez l'administrateur pour plus d'informations.",
          {
            rejected: true,
            rejectionReason: user.admin_rejection_reason || undefined,
          },
        );
      }
      unifiedAuthLogger.warn("Tentative connexion compte en attente de validation", {
        email: maskEmail(email),
      });
      return sendForbidden(
        res,
        "PENDING_VALIDATION",
        "Votre compte est en attente de validation par un administrateur. Vous recevrez un email lorsque votre compte sera activé.",
      );
    }

    // 6. 2FA
    if (user.two_factor_enabled) {
      const userId = (user._id as mongoose.Types.ObjectId).toString();
      await resetLoginAttempts(email);

      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
      }
      // Token temporaire unifié — accepté par /api/v1/auth/complete-2fa
      const deviceId =
        client === "mobile"
          ? (req.headers["x-device-id"] as string) || mobileContext?.deviceId
          : undefined;

      const tempToken = jwt.sign(
        {
          userId,
          purpose: "2fa_verification",
          client,
          deviceId,
          jti: crypto.randomUUID(),
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m", algorithm: "HS256", issuer: "qvarry-api" },
      );

      return res.status(200).json({
        requires2FA: true,
        tempToken,
        message: "Veuillez entrer votre code d'authentification à deux facteurs",
      });
    }

    // 7. DEVICE BINDING (mobile uniquement)
    const userId = (user._id as mongoose.Types.ObjectId).toString();
    setRequestContext({ userId, clientType: client });

    let deviceId: string | undefined;
    if (client === "mobile") {
      deviceId =
        (req.headers["x-device-id"] as string) || mobileContext?.deviceId;
      if (!deviceId) {
        return res.status(400).json({
          error: "Device ID requis pour l'authentification mobile.",
          code: "DEVICE_ID_MISSING",
        });
      }
      await registerOrTouchMobileDevice(user, deviceId, req);
    }

    // 8. GÉNÉRATION DES TOKENS
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      client,
      undefined,
      deviceId,
    );

    const ipAddress = req.ip || (req as any).connection?.remoteAddress;
    const userAgent = req.headers["user-agent"];
    const deviceFingerprint = generateDeviceFingerprint(req);

    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // 9. SESSION + JTI
    if (client === "web") {
      // Charger la session memoryStorage côté web (utilisée par /api/fiches, etc.)
      await loadAndDecryptUserData(userId);
    }
    await redisSessionService.createSession(userId, {
      ipAddress,
      userAgent,
      tokenId,
    });
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      getJwtExpiresInSeconds(),
      client,
    );

    // 10. CLEANUP + AUDIT
    await resetLoginAttempts(email);
    resetRateLimit(req.ip || (req as any).connection?.remoteAddress || "unknown");

    await auditService.log({
      userId,
      action: client === "mobile" ? "MOBILE_LOGIN_SUCCESS" : "LOGIN_SUCCESS",
      level: "info",
      ipAddress,
      userAgent,
      details: {
        tokenId,
        client,
        platform: mobileContext?.platform,
        deviceId,
      },
    });

    unifiedAuthLogger.info("Connexion réussie", {
      email: maskEmail(email),
      userId,
      client,
      duration: Date.now() - startTime,
    });

    // 11. EMAIL D'ALERTE OPTIONNEL (web uniquement, comme avant)
    if (
      client === "web" &&
      process.env.SEND_LOGIN_ALERTS === "true" &&
      user.login_notifications_enabled !== false
    ) {
      try {
        const userName = decrypt(user.name);
        const loginTime = new Date().toLocaleString("fr-FR", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "Europe/Paris",
        });
        sendSecurityAlertEmail(
          email,
          userName,
          ipAddress || "Inconnue",
          userAgent || "Navigateur inconnu",
          loginTime,
        ).catch((err) =>
          unifiedAuthLogger.error("Erreur envoi alerte connexion", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } catch {
        // déchiffrement impossible — ignorer
      }
    }

    // 12. RÉPONSE UNIFIÉE
    return res.status(200).json({
      accessToken: token,
      refreshToken,
      user: buildUserPayload(user),
      tokenExpiresIn: getJwtExpiresInSeconds(),
      refreshTokenExpiresIn: getRefreshExpiresInSeconds(),
    });
  } catch (error: unknown) {
    unifiedAuthLogger.error("Erreur lors de la connexion", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Erreur lors de la connexion. Veuillez réessayer.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: COMPLETE 2FA UNIFIÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/auth/complete-2fa
 * Body: { tempToken, code, isRecoveryCode? }
 * Réponse 200:
 *   { accessToken, refreshToken, user, tokenExpiresIn, refreshTokenExpiresIn }
 *
 * Accepte également les anciens shapes pour rétro-compat :
 *   - tempToken signé avec type "temp-2fa-web" (ancien web)
 *   - tempToken signé avec purpose "2fa_verification" (ancien mobile + nouveau)
 */
export async function handleUnifiedComplete2FA(req: Request, res: Response) {
  const detectedClient = detectClient(req);
  const mobileContext = (req as any).mobileContext;

  try {
    const { tempToken, code, totpCode, isRecoveryCode } = req.body || {};

    // Le code peut venir soit dans `code` (mobile + nouveau) soit `totpCode` (ancien web)
    const submittedCode = code || totpCode;

    if (!tempToken) {
      return res.status(400).json({
        error: "tempToken requis",
        code: "MISSING_TEMP_TOKEN",
      });
    }
    if (!submittedCode) {
      return res.status(400).json({
        error: "Code requis",
        code: "MISSING_CODE",
      });
    }

    // 1. VALIDATION DU TEMP TOKEN (multi-format)
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    let userId: string;
    let tempClient: "web" | "mobile" = detectedClient;
    let tempDeviceId: string | undefined;

    try {
      const decoded = jwt.verify(tempToken, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      }) as {
        userId?: string;
        type?: string;
        purpose?: string;
        client?: "web" | "mobile";
        deviceId?: string;
      };

      // Format unifié (nouveau)
      if (decoded.purpose === "2fa_verification" && decoded.userId) {
        userId = decoded.userId;
        tempClient = decoded.client || detectedClient;
        tempDeviceId = decoded.deviceId;
      }
      // Format legacy web
      else if (decoded.type === "temp-2fa-web" && decoded.userId) {
        userId = decoded.userId;
        tempClient = "web";
      } else {
        return res.status(401).json({
          error: "Token temporaire invalide",
          code: "INVALID_TEMP_TOKEN",
        });
      }
    } catch {
      return res.status(401).json({
        error: "Token temporaire invalide ou expiré",
        code: "INVALID_TEMP_TOKEN",
      });
    }

    setRequestContext({ userId, clientType: tempClient });

    // 2. RATE LIMIT 2FA
    const attemptCheck =
      await redisSessionService.checkTwoFactorAttempts(userId);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: `Trop de tentatives. Veuillez réessayer dans ${attemptCheck.waitTime} minute(s).`,
        code: "TOO_MANY_ATTEMPTS",
        waitTime: attemptCheck.waitTime,
      });
    }

    // 3. CHARGEMENT USER
    const user = await UserModel.findById(userId).select(
      "+two_factor_secret +two_factor_recovery_codes",
    );
    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await redisSessionService.recordTwoFactorFailure(userId);
      return res.status(400).json({
        error: "Code invalide ou vérification impossible",
        code: "VERIFICATION_FAILED",
      });
    }

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await redisSessionService.recordTwoFactorFailure(userId);
      return res.status(400).json({
        error: "Code invalide ou vérification impossible",
        code: "VERIFICATION_FAILED",
      });
    }

    // 4. DEVICE BINDING (mobile uniquement)
    const headerDeviceId = req.headers["x-device-id"] as string | undefined;
    let deviceId: string | undefined;
    if (tempClient === "mobile") {
      deviceId = headerDeviceId || mobileContext?.deviceId;
      if (tempDeviceId && deviceId && tempDeviceId !== deviceId) {
        unifiedAuthLogger.warn("Device mismatch 2FA", {
          tempDeviceId,
          headerDeviceId: deviceId,
        });
        return res.status(401).json({
          error: "Appareil non reconnu. Veuillez recommencer la connexion.",
          code: "DEVICE_MISMATCH",
        });
      }
    }

    // 5. VÉRIFICATION DU CODE TOTP OU RECOVERY
    const totpMigrationService = await import(
      "../../services/totpMigrationService"
    );

    let codeValid = false;
    if (isRecoveryCode) {
      const codeNormalized = String(submittedCode).replace(/-/g, "").toUpperCase();
      let recoveryIdx = -1;
      if (user.two_factor_recovery_codes) {
        for (let i = 0; i < user.two_factor_recovery_codes.length; i++) {
          if (await bcrypt.compare(codeNormalized, user.two_factor_recovery_codes[i])) {
            recoveryIdx = i;
            break;
          }
        }
      }
      if (recoveryIdx === -1) {
        await redisSessionService.recordTwoFactorFailure(userId);
        return res.status(400).json({
          error: "Code invalide ou vérification impossible",
          code: "VERIFICATION_FAILED",
        });
      }
      // Consommer le code
      user.two_factor_recovery_codes!.splice(recoveryIdx, 1);
      await user.save();
      codeValid = true;
    } else {
      const decryptedEmail = decrypt(user.email);
      const verifyResult = await totpMigrationService.verifyTOTPCode(
        userId,
        decryptedEmail,
        user.two_factor_secret!,
        String(submittedCode),
        user.two_factor_algorithm as "SHA1" | "SHA512" | undefined,
      );
      codeValid = verifyResult.isValid;

      if (verifyResult.migrated && verifyResult.newEncryptedSecret) {
        user.two_factor_secret = verifyResult.newEncryptedSecret;
        user.two_factor_algorithm = "sha512";
        await user.save();
      }
    }

    if (!codeValid) {
      await redisSessionService.recordTwoFactorFailure(userId);
      await auditService.log({
        userId,
        action:
          tempClient === "mobile" ? "MOBILE_2FA_LOGIN_FAILED" : "LOGIN_2FA_FAILED",
        level: "warning",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: { reason: "invalid_code", client: tempClient },
      });
      return res.status(400).json({
        error: "Code invalide ou vérification impossible",
        code: "VERIFICATION_FAILED",
      });
    }

    await redisSessionService.resetTwoFactorAttempts(userId);

    // 6. GÉNÉRATION DES TOKENS
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      tempClient,
      undefined,
      deviceId,
    );

    const ipAddress = req.ip || (req as any).connection?.remoteAddress;
    const userAgent = req.headers["user-agent"];
    const deviceFingerprint = generateDeviceFingerprint(req);

    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // 7. SESSION + JTI
    if (tempClient === "web") {
      try {
        await loadAndDecryptUserData(userId);
      } catch (err) {
        unifiedAuthLogger.error("Erreur loadAndDecryptUserData après 2FA", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({
          error: "Erreur lors de la connexion",
          code: "SESSION_INIT_ERROR",
        });
      }
    }
    await redisSessionService.createSession(userId, {
      ipAddress,
      userAgent,
      tokenId,
    });
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      getJwtExpiresInSeconds(),
      tempClient,
    );

    await auditService.log({
      userId,
      action:
        tempClient === "mobile"
          ? "MOBILE_2FA_LOGIN_SUCCESS"
          : "LOGIN_SUCCESS_2FA",
      level: "info",
      ipAddress,
      userAgent,
      details: {
        tokenId,
        method: isRecoveryCode ? "recovery_code" : "totp",
        client: tempClient,
      },
    });

    unifiedAuthLogger.info("Login 2FA réussi", { userId, client: tempClient });

    return res.status(200).json({
      accessToken: token,
      refreshToken,
      user: buildUserPayload(user),
      tokenExpiresIn: getJwtExpiresInSeconds(),
      refreshTokenExpiresIn: getRefreshExpiresInSeconds(),
    });
  } catch (error: unknown) {
    unifiedAuthLogger.error("Erreur lors du complete-2fa", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Erreur lors de la vérification 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS PRIVÉS
// ═══════════════════════════════════════════════════════════════════════════

async function registerOrTouchMobileDevice(
  user: any,
  deviceId: string,
  req: Request,
): Promise<void> {
  const existingDevice = user.authorized_devices?.find(
    (d: any) => d.device_id === deviceId,
  );

  if (existingDevice) {
    await UserModel.findByIdAndUpdate(
      user._id,
      {
        $set: { "authorized_devices.$[elem].last_seen": new Date() },
      },
      { arrayFilters: [{ "elem.device_id": deviceId }] },
    );
    return;
  }

  const deviceName = req.headers["x-device-name"] as string | undefined;
  const deviceOs = req.headers["x-device-os"] as string | undefined;

  await UserModel.findByIdAndUpdate(user._id, {
    $push: {
      authorized_devices: {
        device_id: deviceId,
        device_name: deviceName || "Appareil mobile inconnu",
        device_os: deviceOs || "Unknown OS",
        first_seen: new Date(),
        last_seen: new Date(),
        trusted: false,
      },
    },
  });
}
