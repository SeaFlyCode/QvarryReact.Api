// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD RESET BY TOKEN SERVICE
// ═══════════════════════════════════════════════════════════════════════════
// Service partagé par les handlers mobile (Universal Link / App Link) ET la
// route web miroir (page fallback `/reset-password/:token`).
//
// Schéma : token = crypto.randomBytes(32).toString("hex") généré par
// handleMobileForgotPassword. Stocké en SHA-256 dans user.reset_password_token.
//
// Distinct du flow web "code à 8 chiffres bcrypt-hashé" (cf.
// controllers/auth/passwordController.ts → handleResetPassword) : les deux
// schémas coexistent car le web actuel demande email+code dans le formulaire,
// tandis que le mobile/Universal Link a besoin d'un token URL-safe.
// ═══════════════════════════════════════════════════════════════════════════

import bcrypt from "bcrypt";
import crypto from "crypto";
import mongoose from "mongoose";

import UserModel from "../models/users";
import { refreshTokenService } from "./refreshTokenService";
import { redisSessionService } from "./redisSessionService";
import { auditService } from "./auditService";
import { sendPasswordChangedEmail } from "./emailService";
import { decrypt } from "../utils/masterEncryptionUtils";
import {
  isPasswordInHistory,
  addToPasswordHistory,
  validatePasswordStrength,
} from "../utils/passwordUtils";
import { logger } from "./loggerService";

const resetLogger = logger.child({ service: "password-reset-token" });

export type ResetPasswordByTokenErrorCode =
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "WEAK_PASSWORD"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ResetPasswordByTokenContext {
  ipAddress?: string;
  userAgent?: string;
  /** Origine de l'appel — utilisé pour l'audit. */
  source: "mobile" | "web-fallback";
  /** Données mobiles optionnelles (platform/deviceId) si source === "mobile". */
  platform?: string;
  deviceId?: string;
}

export type ResetPasswordByTokenResult =
  | { success: true; userId: string; tokensRevoked: number }
  | {
      success: false;
      code: ResetPasswordByTokenErrorCode;
      message: string;
      status: number;
    };

const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Réinitialise le mot de passe d'un utilisateur à partir d'un token URL-safe.
 * Valide format → hash SHA-256 → lookup user → expire ? → email vérifié ? →
 * historique → bcrypt(12) + save → revoke tokens + sessions → audit + email.
 *
 * Ne lance JAMAIS d'exception métier — retourne toujours un Result. Les
 * exceptions infrastructure (DB down, etc.) sont catch et retournent
 * INTERNAL_ERROR. Le handler appelant choisit comment formater la réponse HTTP.
 */
export async function resetPasswordByToken(
  token: unknown,
  newPassword: unknown,
  ctx: ResetPasswordByTokenContext,
): Promise<ResetPasswordByTokenResult> {
  try {
    // 1. Validation des inputs
    if (typeof token !== "string" || !token) {
      return {
        success: false,
        code: "INVALID_TOKEN",
        message: "Token requis.",
        status: 400,
      };
    }
    if (typeof newPassword !== "string" || !newPassword) {
      return {
        success: false,
        code: "WEAK_PASSWORD",
        message: "Nouveau mot de passe requis.",
        status: 400,
      };
    }

    // 2. Format du token — garde-fou anti-injection (32 bytes hex = 64 chars)
    if (!TOKEN_REGEX.test(token)) {
      return {
        success: false,
        code: "INVALID_TOKEN",
        message: "Format de token invalide.",
        status: 400,
      };
    }

    // 3. Validation complexité du mot de passe
    const strength = validatePasswordStrength(newPassword);
    if (!strength.isValid) {
      return {
        success: false,
        code: "WEAK_PASSWORD",
        message: strength.message,
        status: 400,
      };
    }

    // 4. Hash du token + lookup user (champs sensibles `select: false` à inclure)
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await UserModel.findOne({
      reset_password_token: tokenHash,
    }).select(
      "+reset_password_token +reset_password_expires +password +password_history +name +email +is_verified",
    );

    if (!user) {
      resetLogger.warn("Reset password : token introuvable", {
        source: ctx.source,
      });
      return {
        success: false,
        code: "INVALID_TOKEN",
        message: "Token invalide ou expiré.",
        status: 400,
      };
    }

    // 5. Expiration
    if (
      !user.reset_password_expires ||
      user.reset_password_expires < new Date()
    ) {
      const userId = (user._id as mongoose.Types.ObjectId).toString();
      resetLogger.warn("Reset password : token expiré", {
        userId,
        source: ctx.source,
      });
      return {
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Le token a expiré. Veuillez demander un nouveau lien.",
        status: 400,
      };
    }

    // 6. SEC-039 : email vérifié
    if (!user.is_verified) {
      return {
        success: false,
        code: "USER_NOT_FOUND",
        message: "Veuillez d'abord vérifier votre adresse email.",
        status: 400,
      };
    }

    // 7. REM-006 : historique des mots de passe
    const passwordHistory = user.password_history || [];
    const allPasswordsToCheck = [user.password, ...passwordHistory];
    const isReused = await isPasswordInHistory(
      newPassword,
      allPasswordsToCheck,
    );
    if (isReused) {
      const userId = (user._id as mongoose.Types.ObjectId).toString();
      resetLogger.warn("Reset password : réutilisation détectée", {
        userId,
        source: ctx.source,
      });
      return {
        success: false,
        code: "WEAK_PASSWORD",
        message:
          "Ce mot de passe a déjà été utilisé récemment. Choisissez-en un autre.",
        status: 400,
      };
    }

    // 8. Hash + update + clear token
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const newPasswordHistory = addToPasswordHistory(
      user.password,
      passwordHistory,
    );

    user.password = hashedPassword;
    user.password_history = newPasswordHistory;
    user.reset_password_token = "";
    user.reset_password_expires = new Date(0);
    await user.save();

    const userId = (user._id as mongoose.Types.ObjectId).toString();

    // 9. REM-007 : révoquer TOUS les refresh tokens + sessions Redis
    const revokedCount = await refreshTokenService.revokeAllUserTokens(
      userId,
      "password_changed",
    );
    await redisSessionService.deleteSession(userId);

    // 10. Audit
    await auditService.log({
      userId,
      action:
        ctx.source === "mobile"
          ? "MOBILE_PASSWORD_RESET_COMPLETED"
          : "PASSWORD_RESET_BY_TOKEN_COMPLETED",
      level: "warning",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      details: {
        source: ctx.source,
        platform: ctx.platform,
        deviceId: ctx.deviceId,
        tokensRevoked: revokedCount,
      },
    });

    // 11. Email de confirmation (non-bloquant)
    // user.email et user.name sont stockés chiffrés (cf. userService.ts).
    try {
      const userName = decrypt(user.name);
      const plainEmail = decrypt(user.email);
      await sendPasswordChangedEmail(
        plainEmail,
        userName,
        ctx.ipAddress || "Inconnue",
        ctx.userAgent || "Inconnu",
      );
    } catch (mailErr) {
      resetLogger.error("Email confirmation reset KO (non-bloquant)", {
        userId,
        error: mailErr instanceof Error ? mailErr.message : String(mailErr),
      });
    }

    resetLogger.info("Reset password by token OK", {
      userId,
      source: ctx.source,
      tokensRevoked: revokedCount,
    });

    return { success: true, userId, tokensRevoked: revokedCount };
  } catch (error) {
    resetLogger.error("Erreur resetPasswordByToken", {
      source: ctx.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      code: "INTERNAL_ERROR",
      message: "Erreur lors de la réinitialisation du mot de passe.",
      status: 500,
    };
  }
}
