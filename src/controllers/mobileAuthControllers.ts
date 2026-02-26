// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS D'AUTHENTIFICATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Réutilise la logique d'authentification existante
// avec des adaptations pour le contexte mobile (réponses JSON, pas de cookies)
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";

import { getUserByEmail } from "../services/userService";
import { createUser } from "../services/userService";
import { refreshTokenService } from "../services/refreshTokenService";
// CRIT-09: sessionService supprimé, redisSessionService est la source de vérité unique
import { memoryStorage } from "../services/memoryStorageService";
import { redisSessionService } from "../services/redisSessionService";
import { auditService } from "../services/auditService";
import { jwtKeyManager } from "../utils/jwtKeyManager";
import { decrypt, encrypt, hashEmail } from "../utils/masterEncryptionUtils";
import { validatePasswordStrength } from "../utils/passwordUtils";
import { validateEmail } from "../utils/emailUtils";
import { generateDeviceFingerprint } from "../utils/deviceFingerprint";
import {
  sendWelcomeEmail,
  generateVerificationCode,
  sendPasswordResetEmail,
} from "../services/emailService";
import { associateDeviceWithUser } from "../middlewares/mobileSecurityMiddleware";
import { getErrorMessage } from "../utils/errorUtils";
import { maskEmail } from "../utils/logUtils";
import { logger } from "../services/loggerService";

const mobileAuthLogger = logger.child({ service: "mobile-auth" });

// MEDIUM-7: Import des helpers partagés depuis authHelpers au lieu de dupliquer
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
} from "./auth/authHelpers";

import UserModel, { IUserBase } from "../models/users";
import MaintenanceModel from "../models/maintenance";
import KeysModel from "../models/keys";
import PointModel from "../models/points";
import FicheModel from "../models/fiches";
import ListModel from "../models/lists";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS (réutilisés depuis authControllers)
// ═══════════════════════════════════════════════════════════════════════════

// MEDIUM-7: Fonctions déplacées vers authHelpers.ts
// checkLoginAttempts, recordFailedLogin, resetLoginAttempts
// sont maintenant importés depuis auth/authHelpers.ts

// Génération code contact unique (spécifique au mobile)
function generateSecureContactCode(): number {
  const randomBytes = crypto.randomBytes(4);
  const randomNumber = randomBytes.readUInt32BE(0);
  return (randomNumber % 900000) + 100000;
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGIN MOBILE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileLogin(req: Request, res: Response) {
  const startTime = Date.now();
  const mobileContext = (req as any).mobileContext;

  try {
    const { email, password } = req.body;

    // 1. VALIDATION DES ENTRÉES
    if (!email || !password) {
      return res.status(400).json({
        error: "Email et mot de passe requis.",
        code: "MISSING_CREDENTIALS",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Format d'email invalide.",
        code: "INVALID_EMAIL_FORMAT",
      });
    }

    // 2. VÉRIFICATION DES TENTATIVES (PROTECTION BRUTE FORCE)
    const attemptCheck = await checkLoginAttempts(email);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: attemptCheck.message,
        waitTime: attemptCheck.waitTime,
        code: "TOO_MANY_ATTEMPTS",
      });
    }

    // 3. VÉRIFICATION UTILISATEUR
    const user = await getUserByEmail(email);
    const DUMMY_HASH =
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
    const passwordToCompare = user?.password || DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

    if (!user || !isPasswordValid) {
      await recordFailedLogin(email);
      return res.status(401).json({
        error: "Email ou mot de passe incorrect.",
        code: "INVALID_CREDENTIALS",
      });
    }

    // 4. VÉRIFICATION MODE MAINTENANCE
    const maintenance = await MaintenanceModel.findOne().lean();
    if (maintenance?.isActive && !user.is_admin) {
      return res.status(503).json({
        error: "Le site est actuellement en maintenance.",
        code: "MAINTENANCE_MODE",
        message: maintenance.message,
      });
    }

    // 5. VÉRIFICATION ÉTAT DU COMPTE
    if (user.is_blocked) {
      return res.status(403).json({
        error: "Votre compte a été suspendu.",
        code: "ACCOUNT_BLOCKED",
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        error: "Veuillez vérifier votre adresse email.",
        code: "EMAIL_NOT_VERIFIED",
        email: email,
      });
    }

    if (!user.is_admin_validated) {
      if (user.admin_validation_rejected) {
        return res.status(403).json({
          error: "Votre demande de compte a été refusée.",
          code: "ACCOUNT_REJECTED",
          reason: user.admin_rejection_reason,
        });
      }
      return res.status(403).json({
        error: "Votre compte est en attente de validation.",
        code: "PENDING_VALIDATION",
      });
    }

    // 6. VÉRIFICATION 2FA
    if (user.two_factor_enabled) {
      const userId = (user._id as mongoose.Types.ObjectId).toString();
      await resetLoginAttempts(email);

      // CRIT-001: Générer un token temporaire signé au lieu d'envoyer le userId en clair
      const { generateTwoFactorTempToken } =
        await import("./mobileTwoFactorControllers");
      const tempToken = generateTwoFactorTempToken(
        userId,
        mobileContext?.deviceId,
      );

      return res.status(200).json({
        requiresTwoFactor: true,
        tempToken: tempToken, // Token signé au lieu du userId
        message: "Code 2FA requis",
        code: "TWO_FACTOR_REQUIRED",
      });
    }

    // 7. GÉNÉRATION DES TOKENS
    const userId = (user._id as mongoose.Types.ObjectId).toString();
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      "mobile",
    );

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];
    const deviceFingerprint = generateDeviceFingerprint(req);

    // Créer le refresh token avec info mobile
    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // 8. CRÉATION SESSION (CRIT-09: via redisSessionService)
    await redisSessionService.createSession(userId, { ipAddress, userAgent });
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      jwtExpiresInSeconds,
      "mobile",
    );

    // 9. ASSOCIER L'APPAREIL À L'UTILISATEUR
    if (mobileContext?.deviceId) {
      associateDeviceWithUser(mobileContext.deviceId, userId);
    }

    // 10. AUDIT ET LOGGING
    await resetLoginAttempts(email);

    await auditService.log({
      userId,
      action: "MOBILE_LOGIN_SUCCESS",
      level: "info",
      ipAddress,
      userAgent,
      details: {
        tokenId,
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
        trustScore: mobileContext?.trustScore,
      },
    });

    const loginDuration = Date.now() - startTime;
    mobileAuthLogger.info("Connexion réussie", {
      email: maskEmail(email),
      platform: mobileContext?.platform,
      duration: loginDuration,
    });

    // 11. RÉPONSE (tokens dans le body, pas de cookies)
    const jwtMaxAge =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    const refreshMaxAge =
      parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60;

    res.status(200).json({
      success: true,
      userId,
      email: decrypt(user.email),
      isAdmin: user.is_admin || false,
      accessToken: token,
      refreshToken: refreshToken,
      tokenExpiresIn: jwtMaxAge,
      refreshTokenExpiresIn: refreshMaxAge,
    });
  } catch (error) {
    mobileAuthLogger.error("Erreur login", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "Erreur lors de la connexion.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: REGISTER MOBILE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileRegister(req: Request, res: Response) {
  const mobileContext = (req as any).mobileContext;

  try {
    const { name, surname, password, email } = req.body;

    // 1. VALIDATION
    if (!name || !surname || !password || !email) {
      return res.status(400).json({
        error: "Tous les champs sont requis.",
        code: "MISSING_FIELDS",
      });
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return res.status(400).json({
        error: emailValidation.message,
        code: "INVALID_EMAIL",
      });
    }

    const passwordStrength = validatePasswordStrength(password);
    if (!passwordStrength.isValid) {
      return res.status(400).json({
        error: passwordStrength.message,
        code: "WEAK_PASSWORD",
      });
    }

    // 2. VÉRIFICATION EMAIL EXISTANT
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      // Message générique pour éviter l'énumération
      return res.status(200).json({
        message:
          "Si cet email n'est pas déjà utilisé, un email de vérification sera envoyé.",
        requiresEmailVerification: true,
      });
    }

    // 3. GÉNÉRATION CODE CONTACT UNIQUE
    let contact_code: number = 0;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      contact_code = generateSecureContactCode();
      const existing = await UserModel.findOne({ contact_code });
      if (!existing) isUnique = true;
      attempts++;
    }

    // 4. GÉNÉRATION VÉRIFICATION EMAIL
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationCode = generateVerificationCode(6);
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 5. CRÉATION UTILISATEUR
    const ip_creation = req.ip || req.connection.remoteAddress || "unknown";
    const passwordHash = await bcrypt.hash(password, 12);

    const newUser: IUserBase = {
      name: encrypt(name),
      surname: encrypt(surname),
      password: passwordHash,
      email: encrypt(email),
      emailHash: hashEmail(email),
      ip_creation: encrypt(ip_creation),
      ip_last_connection: encrypt(ip_creation),
      creation_date: new Date(),
      last_connection: new Date(),
      is_admin: false,
      is_blocked: false,
      contact_code,
      reset_password_token: "",
      reset_password_expires: new Date(),
      is_verified: false,
      is_auth: false,
      email_verification_token: emailVerificationToken,
      email_verification_code: emailVerificationCode,
      email_verification_expires: emailVerificationExpires,
      is_admin_validated: false,
      admin_validation_rejected: false,
      gdpr_consent: false,
      gdpr_consent_date: undefined,
      gdpr_consent_version: "1.0",
      two_factor_enabled: false,
      login_notifications_enabled: true,
    };

    const createdUser = await createUser(newUser);

    // 6. ENVOI EMAIL DE BIENVENUE
    const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
    const verificationLink = `${frontendUrl}/?verify=${encodeURIComponent(email)}`;

    sendWelcomeEmail(
      email,
      name,
      verificationLink,
      emailVerificationCode,
    ).catch((err) =>
      mobileAuthLogger.error("Erreur envoi email bienvenue", {
        error: err.message,
        stack: err.stack,
      }),
    );

    // 7. AUDIT
    await auditService.log({
      userId: (createdUser._id as mongoose.Types.ObjectId).toString(),
      action: "MOBILE_REGISTER_SUCCESS",
      level: "info",
      ipAddress: ip_creation,
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    mobileAuthLogger.info("Inscription réussie", {
      email: maskEmail(email),
      platform: mobileContext?.platform,
    });

    res.status(201).json({
      success: true,
      message: "Compte créé ! Vérifiez votre email.",
      userId: createdUser._id,
      contact_code: `@${contact_code}`,
      requiresEmailVerification: true,
    });
  } catch (error) {
    mobileAuthLogger.error("Erreur register", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "Erreur lors de la création du compte.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: FORGOT PASSWORD MOBILE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileForgotPassword(req: Request, res: Response) {
  const mobileContext = (req as any).mobileContext;

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email requis.",
        code: "MISSING_EMAIL",
      });
    }

    // Toujours retourner succès pour éviter l'énumération
    const genericResponse = {
      success: true,
      message:
        "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
    };

    const user = await getUserByEmail(email);
    if (!user) {
      // Log mais retourne succès
      mobileAuthLogger.info("Forgot password pour email inexistant", {
        email: maskEmail(email),
      });
      return res.status(200).json(genericResponse);
    }

    // Générer token de réinitialisation
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

    // Sauvegarder le token
    await UserModel.findByIdAndUpdate(user._id, {
      reset_password_token: resetTokenHash,
      reset_password_expires: resetExpires,
    });

    // Envoyer l'email
    const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
    const resetCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // Code 6 caractères

    await sendPasswordResetEmail(
      email,
      decrypt(user.name),
      resetLink,
      resetCode,
      req.ip || "Inconnue",
      req.headers["user-agent"] || "App Mobile",
    );

    // Audit
    await auditService.log({
      userId: (user._id as mongoose.Types.ObjectId).toString(),
      action: "MOBILE_PASSWORD_RESET_REQUESTED",
      level: "info",
      ipAddress: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      details: {
        platform: mobileContext?.platform,
        deviceId: mobileContext?.deviceId,
      },
    });

    mobileAuthLogger.info("Email reset password envoyé", {
      email: maskEmail(email),
    });

    res.status(200).json(genericResponse);
  } catch (error) {
    mobileAuthLogger.error("Erreur forgot-password", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Toujours retourner succès même en cas d'erreur
    res.status(200).json({
      success: true,
      message:
        "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: REFRESH TOKEN MOBILE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileRefreshToken(req: Request, res: Response) {
  const mobileContext = (req as any).mobileContext;

  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        error: "Refresh token manquant.",
        code: "NO_REFRESH_TOKEN",
      });
    }

    // Valider le refresh token
    const storedToken =
      await refreshTokenService.validateRefreshToken(refreshToken);
    if (!storedToken) {
      return res.status(401).json({
        error: "Refresh token invalide ou expiré.",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    const userId = storedToken.userId.toString();
    const ipAddress = req.ip || req.connection.remoteAddress;
    const tokenFamily = storedToken.tokenFamily;

    // Détection vol de token
    if (tokenFamily) {
      const isStolen = await refreshTokenService.detectTokenTheft(
        tokenFamily,
        userId,
        ipAddress,
      );
      if (isStolen) {
        mobileAuthLogger.error("Vol de token détecté", { userId });
        return res.status(401).json({
          error: "Activité suspecte détectée. Reconnectez-vous.",
          code: "TOKEN_THEFT_DETECTED",
        });
      }
    }

    // Générer nouveau token
    const { token: newAccessToken, tokenId: newTokenId } = generateSecureToken(
      userId,
      false,
      "mobile",
    );

    // Rotation du refresh token
    const oldTokenId = storedToken.tokenId;
    const newRefreshToken = await refreshTokenService.rotateToken(
      oldTokenId,
      newTokenId,
      req.ip,
      req.headers["user-agent"],
    );

    // Stocker le nouveau JTI
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      newTokenId,
      jwtExpiresInSeconds,
      "mobile",
    );

    mobileAuthLogger.info("Token rafraîchi", { userId });

    const jwtMaxAge =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    const refreshMaxAge =
      parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "48") * 60 * 60;

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenExpiresIn: jwtMaxAge,
      refreshTokenExpiresIn: refreshMaxAge,
    });
  } catch (error) {
    mobileAuthLogger.error("Erreur refresh", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: "Erreur lors du rafraîchissement.",
      code: "INTERNAL_ERROR",
    });
  }
}
