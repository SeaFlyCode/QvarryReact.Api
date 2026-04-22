import { Request, Response } from "express";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import UserModel from "../models/users";
import { encrypt, decrypt } from "../utils/masterEncryptionUtils";
import { auditService } from "../services/auditService";
import { logger } from "../services/loggerService";
import * as totpMigrationService from "../services/totpMigrationService";

const twoFactorLogger = logger.child({ service: "two-factor" });

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTIFICATION À DEUX FACTEURS (2FA/TOTP)
// ═══════════════════════════════════════════════════════════════════════════
// Implémentation TOTP conforme RFC 6238
// Compatible avec Google Authenticator, Authy, 1Password, etc.
// ═══════════════════════════════════════════════════════════════════════════

const APP_NAME = process.env.APP_NAME || "Qvarry";
const RECOVERY_CODES_COUNT = 10;

// ─────────────────────────────────────────────────────────────────────────
// RATE LIMITING 2FA PAR USERID (web)
// ─────────────────────────────────────────────────────────────────────────
const twoFactorAttempts = new Map<
  string,
  { count: number; firstAttempt: Date; blockedUntil?: Date }
>();

const TWO_FACTOR_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TWO_FACTOR_MAX_ENTRIES = 10_000;

function cleanupTwoFactorAttempts(): void {
  const now = Date.now();
  const thirtyMinutesMs = 30 * 60 * 1000;

  for (const [key, entry] of twoFactorAttempts) {
    const blockedExpired =
      entry.blockedUntil && entry.blockedUntil.getTime() < now;
    const firstAttemptExpired =
      now - entry.firstAttempt.getTime() > thirtyMinutesMs;

    if (blockedExpired || firstAttemptExpired) {
      twoFactorAttempts.delete(key);
    }
  }

  if (twoFactorAttempts.size > TWO_FACTOR_MAX_ENTRIES) {
    const entries = Array.from(twoFactorAttempts.entries()).sort(
      (a, b) => a[1].firstAttempt.getTime() - b[1].firstAttempt.getTime(),
    );
    const toRemove = entries.length - TWO_FACTOR_MAX_ENTRIES;
    for (let i = 0; i < toRemove; i++) {
      twoFactorAttempts.delete(entries[i][0]);
    }
  }
}

setInterval(cleanupTwoFactorAttempts, TWO_FACTOR_CLEANUP_INTERVAL_MS);

async function checkTwoFactorAttempts(
  userId: string,
): Promise<{ allowed: boolean; waitTime?: number }> {
  const attempt = twoFactorAttempts.get(userId);
  const now = new Date();

  if (!attempt) return { allowed: true };

  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    const waitMinutes = Math.ceil(
      (attempt.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return { allowed: false, waitTime: waitMinutes };
  }

  // Réinitialiser si fenêtre de 15 min dépassée
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  if (attempt.firstAttempt < fifteenMinutesAgo) {
    twoFactorAttempts.delete(userId);
    return { allowed: true };
  }

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

// ─────────────────────────────────────────────────────────────────────────
// GÉNÉRER LES CODES DE RÉCUPÉRATION
// ─────────────────────────────────────────────────────────────────────────
function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODES_COUNT; i++) {
    // Format: XXXX-XXXX-XXXX (12 caractères alphanumériques)
    const code = crypto
      .randomBytes(9)
      .toString("base64url")
      .substring(0, 12)
      .toUpperCase();
    const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
    codes.push(formattedCode);
  }
  return codes;
}

// ─────────────────────────────────────────────────────────────────────────
// HASHER LES CODES DE RÉCUPÉRATION
// ─────────────────────────────────────────────────────────────────────────
async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  const hashedCodes: string[] = [];
  for (const code of codes) {
    const hash = await bcrypt.hash(code.replace(/-/g, ""), 12);
    hashedCodes.push(hash);
  }
  return hashedCodes;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP 2FA - Générer le secret et le QR Code
// ═══════════════════════════════════════════════════════════════════════════
export async function setupTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const user = await UserModel.findById(userId).select(
      "email two_factor_enabled +two_factor_secret",
    );
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Si 2FA déjà activé, empêcher la régénération
    if (user.two_factor_enabled) {
      return res.status(400).json({
        error:
          "L'authentification à deux facteurs est déjà activée. Désactivez-la d'abord pour la reconfigurer.",
      });
    }

    // Générer un nouveau secret TOTP avec SHA512 (via service de migration)
    const decryptedEmail = decrypt(user.email);
    const totpData = totpMigrationService.generateTOTPSecret(decryptedEmail);
    const base32Secret = totpData.secret;
    const otpauthUrl = totpData.qrCodeUrl;

    if (!base32Secret || !otpauthUrl) {
      return res
        .status(500)
        .json({ error: "Erreur lors de la génération du secret 2FA" });
    }

    // Chiffrer et stocker temporairement le secret (non confirmé)
    const encryptedSecret = encrypt(base32Secret);
    user.two_factor_secret = encryptedSecret;
    await user.save();

    // Générer le QR Code
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    twoFactorLogger.info("Setup initié pour l'utilisateur", { userId });

    await auditService.log({
      userId,
      action: "2FA_SETUP_INITIATED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {},
    });

    return res.status(200).json({
      success: true,
      qrCode: qrCodeDataUrl,
      // MED-02 FIX: Secret TOTP supprimé de la réponse — le QR code contient déjà le secret
      message: "Scannez le QR code avec votre application d'authentification",
    });
  } catch (error) {
    twoFactorLogger.error("Erreur setup", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de la configuration de la 2FA" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER ET ACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function verifyAndEnableTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { code } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    if (!code || typeof code !== "string" || code.length !== 6) {
      return res
        .status(400)
        .json({ error: "Code de vérification invalide (6 chiffres requis)" });
    }

    const user = await UserModel.findById(userId).select(
      "+two_factor_secret +two_factor_recovery_codes",
    );
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (user.two_factor_enabled) {
      return res.status(400).json({ error: "La 2FA est déjà activée" });
    }

    if (!user.two_factor_secret) {
      return res.status(400).json({
        error:
          "Aucune configuration 2FA en attente. Initiez d'abord la configuration.",
      });
    }

    // Déchiffrer le secret et vérifier le code avec support migration
    const decryptedEmail = decrypt(user.email);
    const verifyResult = await totpMigrationService.verifyTOTPCode(
      userId,
      decryptedEmail,
      user.two_factor_secret,
      code,
      user.two_factor_algorithm as "SHA1" | "SHA512" | undefined,
    );
    const isValid = verifyResult.isValid;

    if (!isValid) {
      await auditService.log({
        userId,
        action: "2FA_VERIFY_FAILED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: { reason: "invalid_code" },
      });
      return res.status(400).json({
        error:
          "Code invalide. Vérifiez que l'heure de votre téléphone est correcte.",
      });
    }

    // Générer les codes de récupération
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

    // Activer la 2FA
    user.two_factor_enabled = true;
    user.two_factor_algorithm = "sha512"; // ✅ SHA512 pour nouveaux utilisateurs
    user.two_factor_confirmed_at = new Date();
    user.two_factor_recovery_codes = hashedRecoveryCodes;
    await user.save();

    twoFactorLogger.info("Activé pour l'utilisateur", { userId });

    await auditService.log({
      userId,
      action: "2FA_ENABLED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {},
    });

    return res.status(200).json({
      success: true,
      message: "Authentification à deux facteurs activée avec succès",
      recoveryCodes, // Les afficher une seule fois !
    });
  } catch (error) {
    twoFactorLogger.error("Erreur vérification", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de l'activation de la 2FA" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉSACTIVER 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function disableTwoFactor(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { password, code } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    if (!password) {
      return res
        .status(400)
        .json({ error: "Mot de passe requis pour désactiver la 2FA" });
    }

    if (!code) {
      return res.status(400).json({
        error: "Code 2FA ou code de récupération requis pour désactiver la 2FA",
      });
    }

    const user = await UserModel.findById(userId).select(
      "+password +two_factor_secret +two_factor_recovery_codes",
    );
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({ error: "La 2FA n'est pas activée" });
    }

    // Vérifier le mot de passe
    const bcrypt = await import("bcrypt");
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await auditService.log({
        userId,
        action: "2FA_DISABLE_FAILED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: { reason: "invalid_password" },
      });
      return res.status(401).json({ error: "Mot de passe incorrect" });
    }

    // Vérifier le code 2FA ou un code de récupération
    if (!user.two_factor_secret) {
      return res.status(400).json({ error: "Secret 2FA manquant" });
    }
    const decryptedEmail = decrypt(user.email);
    const verifyResult = await totpMigrationService.verifyTOTPCode(
      userId,
      decryptedEmail,
      user.two_factor_secret,
      code,
      user.two_factor_algorithm as "SHA1" | "SHA512" | undefined,
    );
    const isValidTotp = verifyResult.isValid;

    if (!isValidTotp) {
      // Essayer comme code de récupération
      const codeNormalized = code.replace(/-/g, "").toUpperCase();
      let recoveryCodeUsed = false;

      if (user.two_factor_recovery_codes) {
        for (let i = 0; i < user.two_factor_recovery_codes.length; i++) {
          const isMatch = await bcrypt.compare(
            codeNormalized,
            user.two_factor_recovery_codes[i],
          );
          if (isMatch) {
            recoveryCodeUsed = true;
            break;
          }
        }
      }

      if (!recoveryCodeUsed) {
        return res
          .status(400)
          .json({ error: "Code 2FA ou code de récupération invalide" });
      }
    }

    // Désactiver la 2FA
    user.two_factor_enabled = false;
    user.two_factor_secret = undefined;
    user.two_factor_confirmed_at = undefined;
    user.two_factor_recovery_codes = [];
    await user.save();

    twoFactorLogger.info("Désactivé pour l'utilisateur", { userId });

    await auditService.log({
      userId,
      action: "2FA_DISABLED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {},
    });

    return res.status(200).json({
      success: true,
      message: "Authentification à deux facteurs désactivée",
    });
  } catch (error) {
    twoFactorLogger.error("Erreur désactivation", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de la désactivation de la 2FA" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFIER CODE 2FA (pendant le login)
// ═══════════════════════════════════════════════════════════════════════════
export async function verifyTwoFactorLogin(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { tempToken, code, isRecoveryCode } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ error: "tempToken et code requis" });
    }

    // HIGH-01 FIX: Valider le tempToken signé au lieu d'accepter un userId brut
    let userId: string;
    try {
      if (!process.env.JWT_SECRET) {
        return res
          .status(500)
          .json({ error: "Configuration serveur manquante" });
      }
      const decoded = jwt.verify(tempToken, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      }) as {
        userId: string;
        type: string;
      };
      if (decoded.type !== "temp-2fa-web") {
        return res.status(401).json({ error: "Token temporaire invalide" });
      }
      userId = decoded.userId;
    } catch {
      return res
        .status(401)
        .json({ error: "Token temporaire invalide ou expiré" });
    }

    // Vérifier le rate limiting par userId avant toute validation
    const attemptCheck = await checkTwoFactorAttempts(userId);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: `Trop de tentatives. Veuillez réessayer dans ${attemptCheck.waitTime} minute(s).`,
        code: "TOO_MANY_ATTEMPTS",
        waitTime: attemptCheck.waitTime,
      });
    }

    const user = await UserModel.findById(userId).select(
      "+two_factor_secret +two_factor_recovery_codes",
    );
    if (!user) {
      recordTwoFactorFailure(userId);
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      recordTwoFactorFailure(userId);
      return res
        .status(400)
        .json({ error: "2FA non activée pour cet utilisateur" });
    }

    if (isRecoveryCode) {
      // Vérifier comme code de récupération
      const codeNormalized = code.replace(/-/g, "").toUpperCase();
      let recoveryCodeIndex = -1;

      if (user.two_factor_recovery_codes) {
        for (let i = 0; i < user.two_factor_recovery_codes.length; i++) {
          const isMatch = await bcrypt.compare(
            codeNormalized,
            user.two_factor_recovery_codes[i],
          );
          if (isMatch) {
            recoveryCodeIndex = i;
            break;
          }
        }
      }

      if (recoveryCodeIndex === -1) {
        recordTwoFactorFailure(userId);
        await auditService.log({
          userId,
          action: "2FA_LOGIN_FAILED",
          level: "warning",
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: { reason: "invalid_recovery_code" },
        });
        return res.status(400).json({ error: "Code de récupération invalide" });
      }

      // Supprimer le code utilisé
      if (user.two_factor_recovery_codes) {
        user.two_factor_recovery_codes.splice(recoveryCodeIndex, 1);
        await user.save();
      }

      await auditService.log({
        userId,
        action: "2FA_RECOVERY_CODE_USED",
        level: "warning",
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          remainingCodes: user.two_factor_recovery_codes?.length || 0,
        },
      });

      twoFactorLogger.warn("Code de récupération utilisé", {
        userId,
        remainingCodes: user.two_factor_recovery_codes?.length || 0,
      });
    } else {
      // Vérifier comme code TOTP normal avec support migration
      const decryptedEmail = decrypt(user.email);
      const verifyResult = await totpMigrationService.verifyTOTPCode(
        userId,
        decryptedEmail,
        user.two_factor_secret,
        code,
        user.two_factor_algorithm as "SHA1" | "SHA512" | undefined,
      );
      const isValid = verifyResult.isValid;

      // Si migration effectuée, mettre à jour le secret et l'algorithme
      if (verifyResult.migrated && verifyResult.newEncryptedSecret) {
        user.two_factor_secret = verifyResult.newEncryptedSecret;
        user.two_factor_algorithm = "sha512";
        await user.save();
        twoFactorLogger.info("Utilisateur migré vers SHA512 durant login", {
          userId,
        });
      }

      if (!isValid) {
        recordTwoFactorFailure(userId);
        await auditService.log({
          userId,
          action: "2FA_LOGIN_FAILED",
          level: "warning",
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: { reason: "invalid_totp" },
        });
        return res.status(400).json({ error: "Code invalide" });
      }
    }

    // Réinitialiser le compteur après succès
    resetTwoFactorAttempts(userId);

    await auditService.log({
      userId,
      action: "2FA_LOGIN_SUCCESS",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: { method: isRecoveryCode ? "recovery_code" : "totp" },
    });

    return res.status(200).json({
      success: true,
      verified: true,
    });
  } catch (error) {
    twoFactorLogger.error("Erreur vérification login", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de la vérification 2FA" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉGÉNÉRER LES CODES DE RÉCUPÉRATION
// ═══════════════════════════════════════════════════════════════════════════
export async function regenerateRecoveryCodes(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;
    const { password } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    if (!password) {
      return res.status(400).json({ error: "Mot de passe requis" });
    }

    const user = await UserModel.findById(userId).select(
      "+password +two_factor_recovery_codes",
    );
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({ error: "La 2FA n'est pas activée" });
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Mot de passe incorrect" });
    }

    // Générer de nouveaux codes
    const recoveryCodes = generateRecoveryCodes();
    const hashedRecoveryCodes = await hashRecoveryCodes(recoveryCodes);

    user.two_factor_recovery_codes = hashedRecoveryCodes;
    await user.save();

    twoFactorLogger.info("Codes de récupération régénérés", { userId });

    await auditService.log({
      userId,
      action: "2FA_RECOVERY_CODES_REGENERATED",
      level: "info",
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {},
    });

    return res.status(200).json({
      success: true,
      recoveryCodes,
      message:
        "Nouveaux codes de récupération générés. Conservez-les en lieu sûr.",
    });
  } catch (error) {
    twoFactorLogger.error("Erreur régénération codes", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de la régénération des codes" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OBTENIR LE STATUT 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function getTwoFactorStatus(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const user = await UserModel.findById(userId)
      .select(
        "two_factor_enabled two_factor_confirmed_at +two_factor_recovery_codes",
      )
      .lean();
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    return res.status(200).json({
      enabled: user.two_factor_enabled,
      confirmedAt: user.two_factor_confirmed_at,
      recoveryCodesRemaining: user.two_factor_recovery_codes?.length || 0,
    });
  } catch (error) {
    twoFactorLogger.error("Erreur statut", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(500)
      .json({ error: "Erreur lors de la récupération du statut 2FA" });
  }
}
