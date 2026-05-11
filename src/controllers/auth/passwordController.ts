import { getErrorMessage } from "../../utils/errorUtils";
import { maskEmail } from "../../utils/logUtils";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { getUserByEmail } from "../../services/userService";
import crypto from "crypto";
import mongoose from "mongoose";
import { refreshTokenService } from "../../services/refreshTokenService";
import { auditService } from "../../services/auditService";
import { redisSessionService } from "../../services/redisSessionService";
import {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  generateVerificationCode,
} from "../../services/emailService";
import { decrypt } from "../../utils/masterEncryptionUtils";
import {
  isPasswordInHistory,
  addToPasswordHistory,
  validatePasswordStrength,
} from "../../utils/passwordUtils";
import { logger } from "../../services/loggerService";

const passwordLogger = logger.child({ service: "auth-password" });

// ═══════════════════════════════════════════════════════════════════════════
// RÉINITIALISATION DE MOT DE PASSE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Demande de réinitialisation de mot de passe
 * Envoie un email avec un code à 8 chiffres (SEC-041)
 */
export async function handleForgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email requis." });
    }

    // Rechercher l'utilisateur par email
    const user = await getUserByEmail(email);

    // Réponse générique pour éviter l'énumération d'utilisateurs
    if (!user) {
      return res.status(200).json({
        message:
          "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
      });
    }

    // SEC-041: Code à 8 chiffres pour renforcer la résistance au brute-force
    const resetCode = generateVerificationCode(8);
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

    // Stocker le hash bcrypt du code (jamais en clair) — token à usage unique
    // Rounds = 12 : aligné sur la baseline projet (≥ 12). Cost ~250 ms sur Node 20.
    user.reset_password_token = await bcrypt.hash(resetCode, 12);
    user.reset_password_expires = resetExpires;
    await user.save();

    // Récupérer les infos pour l'email
    const userName = decrypt(user.name);
    const ipAddress = req.ip || req.connection.remoteAddress || "Inconnue";
    const deviceInfo = req.headers["user-agent"] || "Navigateur inconnu";
    const frontendUrl = process.env.FRONTEND_URL || "https://app.qvarry.fr";
    const resetLink = `${frontendUrl}/?reset=${encodeURIComponent(email)}`;

    // Envoyer l'email de réinitialisation
    await sendPasswordResetEmail(
      email,
      userName,
      resetLink,
      resetCode,
      ipAddress,
      deviceInfo,
      "1 heure",
    );

    passwordLogger.info("[FORGOT-PASSWORD] Code de réinitialisation envoyé", {
      email: maskEmail(email),
    });

    res.status(200).json({
      message:
        "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
    });
  } catch (error: unknown) {
    passwordLogger.error("[FORGOT-PASSWORD] Erreur", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      message: "Erreur lors de l'envoi de l'email de réinitialisation.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Réinitialisation du mot de passe avec le code
 */
export async function handleResetPassword(req: Request, res: Response) {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({
        message: "Email, code et nouveau mot de passe requis.",
      });
    }

    // Validation du mot de passe avec validatePasswordStrength
    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.isValid) {
      return res.status(400).json({
        message: passwordStrength.message,
      });
    }

    // Rechercher l'utilisateur
    const user = await getUserByEmail(email);

    if (!user) {
      return res.status(400).json({
        message: "Code invalide ou expiré.",
        expired: true,
      });
    }

    // SEC-039: Vérifier que l'utilisateur a vérifié son email avant de permettre le reset
    if (!user.is_verified) {
      return res.status(400).json({
        message: "Veuillez d'abord vérifier votre adresse email.",
        needsVerification: true,
      });
    }

    // Vérifier que le token n'est pas expiré
    if (
      !user.reset_password_expires ||
      user.reset_password_expires < new Date()
    ) {
      return res.status(400).json({
        message: "Le code a expiré. Veuillez demander un nouveau code.",
        expired: true,
      });
    }

    // Vérifier le code — storé comme bcrypt hash
    const storedHash = user.reset_password_token || "";
    // Rejeter les anciens tokens au format "plaintextToken:code" (migration)
    if (storedHash.includes(":") || !storedHash.startsWith("$2")) {
      return res.status(400).json({
        message: "Code invalide ou expiré. Veuillez en demander un nouveau.",
        expired: true,
      });
    }
    const isCodeValid = code && (await bcrypt.compare(code, storedHash));
    if (!isCodeValid) {
      return res.status(400).json({
        message: "Code invalide.",
        expired: false,
      });
    }

    // REM-006: Vérifier que le nouveau mot de passe n'est pas dans l'historique des 5 derniers
    const passwordHistory = user.password_history || [];
    // Inclure le mot de passe actuel dans la vérification
    const allPasswordsToCheck = [user.password, ...passwordHistory];

    const isInHistory = await isPasswordInHistory(
      newPassword,
      allPasswordsToCheck,
    );
    if (isInHistory) {
      passwordLogger.warn(
        "[RESET-PASSWORD] Tentative de réutilisation d'un ancien mot de passe",
        {
          email: maskEmail(email),
        },
      );
      return res.status(400).json({
        message:
          "Ce mot de passe a déjà été utilisé récemment. Veuillez en choisir un nouveau.",
        passwordReused: true,
      });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // REM-006: Mettre à jour l'historique des mots de passe
    const newPasswordHistory = addToPasswordHistory(
      user.password,
      passwordHistory,
    );

    // Mettre à jour le mot de passe et effacer les tokens de reset
    user.password = hashedPassword;
    user.password_history = newPasswordHistory;
    user.reset_password_token = "";
    user.reset_password_expires = new Date(0);
    await user.save();

    // REM-007: Révoquer TOUS les tokens de l'utilisateur pour forcer la reconnexion
    const userId = (user._id as mongoose.Types.ObjectId).toString();
    const revokedCount = await refreshTokenService.revokeAllUserTokens(
      userId,
      "password_changed",
    );

    // Supprimer également la session Redis
    await redisSessionService.deleteSession(userId);

    passwordLogger.info("[RESET-PASSWORD] Tokens révoqués", {
      email: maskEmail(email),
      revokedCount,
    });

    // Audit de la révocation
    await auditService.log({
      userId,
      action: "PASSWORD_CHANGED",
      level: "warning",
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        tokensRevoked: revokedCount,
        passwordHistoryUpdated: true,
      },
    });

    // Envoyer un email de confirmation
    const userName = decrypt(user.name);
    const ipAddress = req.ip || req.connection.remoteAddress || "Inconnue";
    const deviceInfo = req.headers["user-agent"] || "Navigateur inconnu";

    await sendPasswordChangedEmail(email, userName, ipAddress, deviceInfo);

    passwordLogger.info("[RESET-PASSWORD] Mot de passe réinitialisé", {
      email: maskEmail(email),
    });

    res.status(200).json({
      message:
        "Mot de passe réinitialisé avec succès ! Vous pouvez maintenant vous connecter.",
      success: true,
    });
  } catch (error: unknown) {
    passwordLogger.error("[RESET-PASSWORD] Erreur", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      message: "Erreur lors de la réinitialisation du mot de passe.",
      error: "Une erreur interne est survenue",
    });
  }
}
