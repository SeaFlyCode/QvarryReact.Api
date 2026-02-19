// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS 2FA POUR APPLICATIONS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Adaptés pour le contexte mobile (tokens JWT, pas de sessions)
// Réutilise la logique 2FA existante avec adaptations spécifiques
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import UserModel from "../models/users";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";
import { auditService } from "../services/auditService";
import { refreshTokenService } from "../services/refreshTokenService";
// CRIT-09: sessionService supprimé, redisSessionService est la source de vérité unique
import { redisSessionService } from "../services/redisSessionService";
import { jwtKeyManager } from "../utils/jwtKeyManager";
import { generateDeviceFingerprint } from "../utils/deviceFingerprint";
import { associateDeviceWithUser } from "../middlewares/mobileSecurityMiddleware";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const APP_NAME = process.env.APP_NAME || "Qvarry";
const RECOVERY_CODES_COUNT = 10;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère des codes de récupération sécurisés
 */
function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
    const code = crypto
      .randomBytes(9)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 12)
      .toUpperCase();
    const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
    codes.push(formattedCode);
  }
  return codes;
}

/**
 * Hash les codes de récupération avec bcrypt
 */
async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  const hashedCodes: string[] = [];
  for (const code of codes) {
    const hash = await bcrypt.hash(code.replace(/-/g, ""), 10);
    hashedCodes.push(hash);
  }
  return hashedCodes;
}

/**
 * Génère un token JWT mobile avec binding au deviceId (MED-001)
 */
function generateMobileTokenWithDevice(
  userId: string,
  isAdmin: boolean = false,
  deviceId?: string,
): { token: string; tokenId: string; keyVersion: string } {
  const { secret, version } = jwtKeyManager.getCurrentKey();

  if (secret.length < 32) {
    throw new Error("JWT_SECRET doit contenir au moins 32 caractères.");
  }

  const jti = crypto.randomBytes(16).toString("hex");
  const expiresIn = process.env.JWT_EXPIRES_IN || "15m";

  const payload: Record<string, any> = {
    id: userId,
    isAdmin,
    iat: Math.floor(Date.now() / 1000),
    jti,
    kv: version,
    platform: "mobile",
  };

  // MED-001: Inclure deviceId si fourni pour binding Device-Token
  if (deviceId) {
    payload.deviceId = deviceId;
  }

  const token = jwt.sign(payload, secret, {
    expiresIn,
    algorithm: "HS256",
    issuer: "qvarry-api",
    audience: "qvarry-mobile",
  } as jwt.SignOptions);

  return { token, tokenId: jti, keyVersion: version };
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP 2FA - Générer le secret et le QR Code
// ═══════════════════════════════════════════════════════════════════════════

export async function mobileSetupTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const mobileContext = (req as any).mobileContext;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    }

    const user = await UserModel.findById(userId).select(
      "email two_factor_enabled two_factor_secret",
    );
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    // Si 2FA déjà activé, empêcher la régénération
    if (user.two_factor_enabled) {
      return res.status(400).json({
        error:
          "L'authentification à deux facteurs est déjà activée. Désactivez-la d'abord pour la reconfigurer.",
        code: "2FA_ALREADY_ENABLED",
      });
    }

    // Générer un nouveau secret TOTP
    const secretObj = new Secret({ size: 32 });
    const totp = new TOTP({
      issuer: APP_NAME,
      label: decrypt(user.email),
      secret: secretObj,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const base32Secret = secretObj.base32;
    const otpauthUrl = totp.toString();

    if (!base32Secret || !otpauthUrl) {
      return res.status(500).json({
        error: "Erreur lors de la génération du secret 2FA",
        code: "SECRET_GENERATION_ERROR",
      });
    }

    // Chiffrer et stocker temporairement le secret (non confirmé)
    const encryptedSecret = encrypt(base32Secret);
    user.two_factor_secret = encryptedSecret;
    await user.save();

    // Générer le QR Code
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    console.log(`🔐 [MOBILE-2FA] Setup initié pour l'utilisateur ${userId}`);

    await auditService.log({
      userId,
      action: "MOBILE_2FA_SETUP_INITIATED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    // HIGH-004: Ne pas exposer le secret en clair dans la réponse
    // L'utilisateur doit scanner le QR code
    return res.status(200).json({
      success: true,
      qrCode: qrCodeDataUrl,
      // secret supprimé pour des raisons de sécurité
      message:
        "Scannez le QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)",
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur setup:", error);
    return res.status(500).json({
      error: "Erreur lors de la configuration de la 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER ET ACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════

export async function mobileVerifyAndEnableTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { code } = req.body;
    const mobileContext = (req as any).mobileContext;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    }

    if (!code || typeof code !== "string" || code.length !== 6) {
      return res.status(400).json({
        error: "Code de vérification invalide (6 chiffres requis)",
        code: "INVALID_CODE_FORMAT",
      });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.two_factor_enabled) {
      return res.status(400).json({
        error: "La 2FA est déjà activée",
        code: "2FA_ALREADY_ENABLED",
      });
    }

    if (!user.two_factor_secret) {
      return res.status(400).json({
        error:
          "Aucune configuration 2FA en attente. Initiez d'abord la configuration.",
        code: "2FA_NOT_INITIATED",
      });
    }

    // Déchiffrer le secret et vérifier le code
    const decryptedSecret = decrypt(user.two_factor_secret);
    // MED-002: window à 0 pour un seul code valide (plus strict)
    const totpVerify = new TOTP({
      secret: Secret.fromBase32(decryptedSecret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const delta = totpVerify.validate({ token: code, window: 0 });
    const isValid = delta !== null;

    if (!isValid) {
      await auditService.log({
        userId,
        action: "MOBILE_2FA_VERIFY_FAILED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          reason: "invalid_code",
          platform: mobileContext?.platform,
        },
      });
      return res.status(400).json({
        error:
          "Code invalide. Vérifiez que l'heure de votre téléphone est correcte.",
        code: "INVALID_CODE",
      });
    }

    // Générer les codes de récupération
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

    // Activer la 2FA
    user.two_factor_enabled = true;
    user.two_factor_confirmed_at = new Date();
    user.two_factor_recovery_codes = hashedRecoveryCodes;
    await user.save();

    console.log(`✅ [MOBILE-2FA] Activé pour l'utilisateur ${userId}`);

    await auditService.log({
      userId,
      action: "MOBILE_2FA_ENABLED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Authentification à deux facteurs activée avec succès",
      recoveryCodes,
      warning:
        "Conservez ces codes de récupération en lieu sûr. Ils ne seront plus affichés.",
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur vérification:", error);
    return res.status(500).json({
      error: "Erreur lors de l'activation de la 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉSACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════

export async function mobileDisableTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { password, code } = req.body;
    const mobileContext = (req as any).mobileContext;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    }

    if (!password) {
      return res.status(400).json({
        error: "Mot de passe requis pour désactiver la 2FA",
        code: "PASSWORD_REQUIRED",
      });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({
        error: "La 2FA n'est pas activée",
        code: "2FA_NOT_ENABLED",
      });
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await auditService.log({
        userId,
        action: "MOBILE_2FA_DISABLE_FAILED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          reason: "invalid_password",
          platform: mobileContext?.platform,
        },
      });
      return res.status(401).json({
        error: "Mot de passe incorrect",
        code: "INVALID_PASSWORD",
      });
    }

    // Vérifier le code 2FA ou un code de récupération
    if (code) {
      const decryptedSecret = decrypt(user.two_factor_secret!);
      const totpVerify = new TOTP({
        secret: Secret.fromBase32(decryptedSecret),
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      const delta = totpVerify.validate({ token: code, window: 1 });
      const isValidTotp = delta !== null;

      if (!isValidTotp) {
        // Essayer comme code de récupération
        const codeNormalized = code.replace(/-/g, "").toUpperCase();
        let recoveryCodeUsed = false;

        for (let i = 0; i < user.two_factor_recovery_codes!.length; i++) {
          const isMatch = await bcrypt.compare(
            codeNormalized,
            user.two_factor_recovery_codes![i],
          );
          if (isMatch) {
            recoveryCodeUsed = true;
            break;
          }
        }

        if (!recoveryCodeUsed) {
          return res.status(400).json({
            error: "Code 2FA ou code de récupération invalide",
            code: "INVALID_2FA_CODE",
          });
        }
      }
    }

    // Désactiver la 2FA
    user.two_factor_enabled = false;
    user.two_factor_secret = undefined;
    user.two_factor_confirmed_at = undefined;
    user.two_factor_recovery_codes = [];
    await user.save();

    console.log(`🔓 [MOBILE-2FA] Désactivé pour l'utilisateur ${userId}`);

    await auditService.log({
      userId,
      action: "MOBILE_2FA_DISABLED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Authentification à deux facteurs désactivée",
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur désactivation:", error);
    return res.status(500).json({
      error: "Erreur lors de la désactivation de la 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER CODE 2FA (pendant le login) - RENVOIE LES TOKENS
// ═══════════════════════════════════════════════════════════════════════════

// Rate limiting spécifique par userId pour les tentatives 2FA
const twoFactorAttempts = new Map<
  string,
  { count: number; firstAttempt: Date; blockedUntil?: Date }
>();

// BUG-002: Nettoyage périodique de la Map twoFactorAttempts pour éviter la croissance non bornée
const TWO_FACTOR_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TWO_FACTOR_MAX_ENTRIES = 10_000;

function cleanupTwoFactorAttempts(): void {
  const now = Date.now();
  const thirtyMinutesMs = 30 * 60 * 1000;

  for (const [key, entry] of twoFactorAttempts) {
    // Supprimer les entrées dont le blocage a expiré ET qui sont anciennes
    const blockedExpired =
      entry.blockedUntil && entry.blockedUntil.getTime() < now;
    const firstAttemptExpired =
      now - entry.firstAttempt.getTime() > thirtyMinutesMs;

    if (blockedExpired || firstAttemptExpired) {
      twoFactorAttempts.delete(key);
    }
  }

  // Si toujours trop d'entrées, supprimer les plus anciennes
  if (twoFactorAttempts.size > TWO_FACTOR_MAX_ENTRIES) {
    const entries = Array.from(twoFactorAttempts.entries()).sort(
      (a, b) => a[1].firstAttempt.getTime() - b[1].firstAttempt.getTime(),
    );

    const toRemove = entries.length - TWO_FACTOR_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      twoFactorAttempts.delete(entries[i][0]);
    }
  }

  if (twoFactorAttempts.size > 0) {
    console.log(
      `🧹 [2FA CLEANUP] twoFactorAttempts: ${twoFactorAttempts.size} entrées restantes`,
    );
  }
}

setInterval(cleanupTwoFactorAttempts, TWO_FACTOR_CLEANUP_INTERVAL_MS);
console.log(
  `✅ [2FA CLEANUP] Nettoyage automatique démarré (intervalle: ${TWO_FACTOR_CLEANUP_INTERVAL_MS / 1000}s)`,
);

/**
 * Vérifie les tentatives 2FA pour un userId donné
 * Bloque après 5 échecs pendant 30 minutes
 */
async function checkTwoFactorAttempts(
  userId: string,
): Promise<{ allowed: boolean; waitTime?: number }> {
  const attempt = twoFactorAttempts.get(userId);
  const now = new Date();

  if (!attempt) return { allowed: true };

  // Vérifier si bloqué
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    const waitMinutes = Math.ceil(
      (attempt.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return { allowed: false, waitTime: waitMinutes };
  }

  // Réinitialiser si plus de 15 minutes depuis le premier échec
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  if (attempt.firstAttempt < fifteenMinutesAgo) {
    twoFactorAttempts.delete(userId);
    return { allowed: true };
  }

  // Bloquer si trop de tentatives
  if (attempt.count >= 5) {
    attempt.blockedUntil = new Date(now.getTime() + 30 * 60 * 1000);
    return { allowed: false, waitTime: 30 };
  }

  return { allowed: true };
}

function recordTwoFactorFailure(userId: string): void {
  const attempt = twoFactorAttempts.get(userId);
  const now = new Date();

  if (attempt) {
    attempt.count++;
  } else {
    twoFactorAttempts.set(userId, { count: 1, firstAttempt: now });
  }
}

function resetTwoFactorAttempts(userId: string): void {
  twoFactorAttempts.delete(userId);
}

/**
 * Génère un token temporaire signé pour la vérification 2FA
 * Ce token remplace l'envoi du userId en clair
 */
export function generateTwoFactorTempToken(
  userId: string,
  deviceId?: string,
): string {
  const { secret } = jwtKeyManager.getCurrentKey();

  return jwt.sign(
    {
      userId,
      deviceId,
      purpose: "2fa_verification",
      iat: Math.floor(Date.now() / 1000),
    },
    secret,
    {
      expiresIn: "5m", // Expire après 5 minutes
      algorithm: "HS256",
      issuer: "qvarry-api",
    },
  );
}

/**
 * Vérifie le token temporaire 2FA
 */
function verifyTwoFactorTempToken(
  tempToken: string,
): { userId: string; deviceId?: string } | null {
  try {
    const { secret } = jwtKeyManager.getCurrentKey();
    const payload = jwt.verify(tempToken, secret, {
      issuer: "qvarry-api",
    }) as any;

    if (payload.purpose !== "2fa_verification") {
      return null;
    }

    return { userId: payload.userId, deviceId: payload.deviceId };
  } catch {
    return null;
  }
}

// Message d'erreur générique pour éviter l'énumération (HIGH-002)
const GENERIC_2FA_ERROR = {
  error: "Code invalide ou vérification impossible",
  code: "VERIFICATION_FAILED",
};

export async function mobileVerifyTwoFactorLogin(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    // CRIT-001: Utiliser tempToken au lieu de userId en clair
    const { tempToken, code, isRecoveryCode } = req.body;
    const mobileContext = (req as any).mobileContext;

    // Support rétrocompatibilité: accepter userId OU tempToken
    let userId: string;
    let tokenDeviceId: string | undefined;

    if (tempToken) {
      // Nouvelle méthode sécurisée: token temporaire signé
      const tokenPayload = verifyTwoFactorTempToken(tempToken);
      if (!tokenPayload) {
        // Délai pour éviter timing attack
        await new Promise((resolve) => setTimeout(resolve, 500));
        return res.status(401).json({
          error: "Token expiré ou invalide. Veuillez recommencer la connexion.",
          code: "INVALID_TEMP_TOKEN",
        });
      }
      userId = tokenPayload.userId;
      tokenDeviceId = tokenPayload.deviceId;

      // MED-001: Vérifier le binding Device-Token
      if (
        tokenDeviceId &&
        mobileContext?.deviceId &&
        tokenDeviceId !== mobileContext.deviceId
      ) {
        console.warn(
          `🚨 [MOBILE-2FA] Device mismatch: token=${tokenDeviceId}, header=${mobileContext.deviceId}`,
        );
        await auditService.log({
          userId,
          action: "MOBILE_2FA_DEVICE_MISMATCH",
          level: "warning",
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: { tokenDeviceId, headerDeviceId: mobileContext.deviceId },
        });
        return res.status(401).json({
          error: "Appareil non reconnu. Veuillez recommencer la connexion.",
          code: "DEVICE_MISMATCH",
        });
      }
    } else if (req.body.userId) {
      // Ancienne méthode (dépréciée mais supportée temporairement)
      console.warn(`⚠️ [MOBILE-2FA] Utilisation dépréciée de userId direct`);
      userId = req.body.userId;
    } else {
      return res.status(400).json({
        error: "Token ou code manquant",
        code: "MISSING_PARAMS",
      });
    }

    if (!code) {
      return res.status(400).json({
        error: "Code requis",
        code: "MISSING_CODE",
      });
    }

    // Vérifier le rate limiting par userId
    const attemptCheck = await checkTwoFactorAttempts(userId);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: `Trop de tentatives. Veuillez réessayer dans ${attemptCheck.waitTime} minute(s).`,
        code: "TOO_MANY_ATTEMPTS",
        waitTime: attemptCheck.waitTime,
      });
    }

    const user = await UserModel.findById(userId);

    // HIGH-002: Message générique + délai pour éviter énumération
    if (!user) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      recordTwoFactorFailure(userId);
      return res.status(400).json(GENERIC_2FA_ERROR);
    }

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      recordTwoFactorFailure(userId);
      return res.status(400).json(GENERIC_2FA_ERROR);
    }

    let codeValid = false;

    if (isRecoveryCode) {
      // MED-004: Limite spécifique pour les codes de récupération (max 3 échecs)
      const recoveryKey = `recovery_${userId}`;
      const recoveryAttempt = twoFactorAttempts.get(recoveryKey);
      if (recoveryAttempt && recoveryAttempt.count >= 3) {
        return res.status(429).json({
          error:
            "Trop de tentatives avec les codes de récupération. Veuillez utiliser un code TOTP.",
          code: "RECOVERY_LOCKED",
        });
      }

      // Vérifier comme code de récupération
      const codeNormalized = code.replace(/-/g, "").toUpperCase();
      let recoveryCodeIndex = -1;

      for (let i = 0; i < user.two_factor_recovery_codes!.length; i++) {
        const isMatch = await bcrypt.compare(
          codeNormalized,
          user.two_factor_recovery_codes![i],
        );
        if (isMatch) {
          recoveryCodeIndex = i;
          break;
        }
      }

      if (recoveryCodeIndex === -1) {
        // Enregistrer l'échec pour les codes de récupération
        if (recoveryAttempt) {
          recoveryAttempt.count++;
        } else {
          twoFactorAttempts.set(recoveryKey, {
            count: 1,
            firstAttempt: new Date(),
          });
        }

        await auditService.log({
          userId,
          action: "MOBILE_2FA_LOGIN_FAILED",
          level: "warning",
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: {
            reason: "invalid_recovery_code",
            platform: mobileContext?.platform,
          },
        });
        recordTwoFactorFailure(userId);
        return res.status(400).json(GENERIC_2FA_ERROR);
      }

      // Supprimer le code utilisé
      user.two_factor_recovery_codes!.splice(recoveryCodeIndex, 1);
      await user.save();
      codeValid = true;

      // Réinitialiser le compteur de récupération
      twoFactorAttempts.delete(recoveryKey);

      await auditService.log({
        userId,
        action: "MOBILE_2FA_RECOVERY_CODE_USED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          remainingCodes: user.two_factor_recovery_codes!.length,
          platform: mobileContext?.platform,
        },
      });

      console.log(
        `⚠️ [MOBILE-2FA] Code de récupération utilisé pour ${userId}, ${user.two_factor_recovery_codes!.length} restants`,
      );
    } else {
      // Vérifier comme code TOTP normal
      const decryptedSecret = decrypt(user.two_factor_secret);
      // MED-002: Réduire window à 0 (un seul code valide)
      const totpVerify = new TOTP({
        secret: Secret.fromBase32(decryptedSecret),
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      const delta = totpVerify.validate({ token: code, window: 0 });
      codeValid = delta !== null;

      if (!codeValid) {
        await auditService.log({
          userId,
          action: "MOBILE_2FA_LOGIN_FAILED",
          level: "warning",
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: {
            reason: "invalid_totp",
            platform: mobileContext?.platform,
          },
        });
        recordTwoFactorFailure(userId);
        return res.status(400).json(GENERIC_2FA_ERROR);
      }
    }

    // Réinitialiser les compteurs après succès
    resetTwoFactorAttempts(userId);

    // Code valide -> Générer les tokens et compléter la connexion
    // MED-001: Inclure deviceId dans le token
    const deviceId = mobileContext?.deviceId;
    const { token, tokenId } = generateMobileTokenWithDevice(
      userId,
      user.is_admin || false,
      deviceId,
    );

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];
    const deviceFingerprint = generateDeviceFingerprint(req);

    // Créer le refresh token
    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // Créer la session (CRIT-09: via redisSessionService)
    await redisSessionService.createSession(userId, { ipAddress, userAgent });
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      jwtExpiresInSeconds,
    );

    // Associer l'appareil à l'utilisateur
    if (mobileContext?.deviceId) {
      associateDeviceWithUser(mobileContext.deviceId, userId);
    }

    await auditService.log({
      userId,
      action: "MOBILE_2FA_LOGIN_SUCCESS",
      level: "info",
      ipAddress,
      userAgent,
      details: {
        method: isRecoveryCode ? "recovery_code" : "totp",
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    console.log(
      `✅ [MOBILE-2FA] Login complété pour ${userId} (${mobileContext?.platform})`,
    );

    const jwtMaxAge =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    const refreshMaxAge =
      parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60;

    return res.status(200).json({
      success: true,
      verified: true,
      userId,
      email: decrypt(user.email),
      isAdmin: user.is_admin || false,
      accessToken: token,
      refreshToken: refreshToken,
      tokenExpiresIn: jwtMaxAge,
      refreshTokenExpiresIn: refreshMaxAge,
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur vérification login:", error);
    return res.status(500).json({
      error: "Erreur lors de la vérification 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉGÉNÉRER LES CODES DE RÉCUPÉRATION
// ═══════════════════════════════════════════════════════════════════════════

export async function mobileRegenerateRecoveryCodes(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { password } = req.body;
    const mobileContext = (req as any).mobileContext;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    }

    if (!password) {
      return res.status(400).json({
        error: "Mot de passe requis",
        code: "PASSWORD_REQUIRED",
      });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({
        error: "La 2FA n'est pas activée",
        code: "2FA_NOT_ENABLED",
      });
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: "Mot de passe incorrect",
        code: "INVALID_PASSWORD",
      });
    }

    // Générer de nouveaux codes
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

    user.two_factor_recovery_codes = hashedRecoveryCodes;
    await user.save();

    console.log(
      `🔄 [MOBILE-2FA] Codes de récupération régénérés pour ${userId}`,
    );

    await auditService.log({
      userId,
      action: "MOBILE_2FA_RECOVERY_CODES_REGENERATED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    return res.status(200).json({
      success: true,
      recoveryCodes,
      message:
        "Nouveaux codes de récupération générés. Conservez-les en lieu sûr.",
      warning: "Les anciens codes ont été invalidés.",
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur régénération codes:", error);
    return res.status(500).json({
      error: "Erreur lors de la régénération des codes",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OBTENIR LE STATUT 2FA
// ═══════════════════════════════════════════════════════════════════════════

export async function mobileGetTwoFactorStatus(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    }

    const user = await UserModel.findById(userId)
      .select(
        "two_factor_enabled two_factor_confirmed_at two_factor_recovery_codes",
      )
      .lean();
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    return res.status(200).json({
      success: true,
      enabled: user.two_factor_enabled || false,
      confirmedAt: user.two_factor_confirmed_at || null,
      recoveryCodesRemaining: user.two_factor_recovery_codes?.length || 0,
    });
  } catch (error) {
    console.error("❌ [MOBILE-2FA] Erreur statut:", error);
    return res.status(500).json({
      error: "Erreur lors de la récupération du statut 2FA",
      code: "INTERNAL_ERROR",
    });
  }
}
