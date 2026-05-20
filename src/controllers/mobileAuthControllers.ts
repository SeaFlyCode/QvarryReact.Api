// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS D'AUTHENTIFICATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Réutilise la logique d'authentification existante
// avec des adaptations pour le contexte mobile (réponses JSON, pas de cookies)
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import mongoose from "mongoose";

import { getUserByEmail, createUser } from "../services/userService";
import { refreshTokenService } from "../services/refreshTokenService";
// CRIT-09: sessionService supprimé, redisSessionService est la source de vérité unique
import { redisSessionService } from "../services/redisSessionService";
import { auditService } from "../services/auditService";
import { decrypt, encrypt, hashEmail } from "../utils/masterEncryptionUtils";
import { validatePasswordStrength } from "../utils/passwordUtils";
import { validateEmail, EMAIL_REGEX } from "../utils/emailUtils";
import { generateDeviceFingerprint } from "../utils/deviceFingerprint";
import {
  sendWelcomeEmail,
  generateVerificationCode,
  sendPasswordResetEmail,
} from "../services/emailService";
import { resetPasswordByToken } from "../services/passwordResetTokenService";
import { associateDeviceWithUser } from "../middlewares/mobileSecurityMiddleware";
import { maskEmail } from "../utils/logUtils";
import { logger } from "../services/loggerService";
import { buildForbidden } from "../utils/authErrors";

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
import { createNotification } from "../services/notificationService";

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

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "Format d'email invalide.",
        code: "INVALID_EMAIL_FORMAT",
      });
    }

    // 2. VÉRIFICATION DES TENTATIVES (PROTECTION BRUTE FORCE)
    const attemptCheck = await checkLoginAttempts(email);
    if (!attemptCheck.allowed) {
      const retryAfter = (attemptCheck.waitTime ?? 1) * 60;
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "RATE_LIMITED",
        code: "TOO_MANY_ATTEMPTS",
        retryAfter,
        waitTime: attemptCheck.waitTime,
        message: attemptCheck.message,
      });
    }

    // 3. VÉRIFICATION UTILISATEUR
    const user = await getUserByEmail(email);
    const DUMMY_HASH =
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
    const passwordToCompare = user?.password || DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

    if (!user || !isPasswordValid) {
      const failIp =
        req.ip || req.connection.remoteAddress || undefined;
      await recordFailedLogin(email, failIp);
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

    // 5. VÉRIFICATION ÉTAT DU COMPTE — P1 shape unifié { error, code, message }
    if (user.is_blocked) {
      return res
        .status(403)
        .json(buildForbidden("BLOCKED", "Votre compte a été suspendu."));
    }

    if (!user.is_verified) {
      return res.status(403).json({
        ...buildForbidden(
          "UNVERIFIED",
          "Veuillez vérifier votre adresse email.",
          { email },
        ),
        // legacy: gardé pour rétro-compat clients existants
        email,
      });
    }

    if (!user.is_admin_validated) {
      if (user.admin_validation_rejected) {
        return res
          .status(403)
          .json(
            buildForbidden(
              "PENDING_VALIDATION",
              "Votre demande de compte a été refusée.",
              {
                rejected: true,
                rejectionReason: user.admin_rejection_reason,
              },
            ),
          );
      }
      return res
        .status(403)
        .json(
          buildForbidden(
            "PENDING_VALIDATION",
            "Votre compte est en attente de validation.",
          ),
        );
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

    // MED-001: Extraire device_id du header ou du mobileContext
    const deviceId =
      (req.headers["x-device-id"] as string) || mobileContext?.deviceId;

    // MED-001: Validation stricte du device_id pour tokens mobiles
    if (!deviceId) {
      mobileAuthLogger.warn("Tentative login mobile sans device_id", {
        email: maskEmail(email),
      });
      return res.status(400).json({
        error: "Device ID requis pour l'authentification mobile.",
        code: "DEVICE_ID_MISSING",
      });
    }

    // MED-001: Enregistrer le device dans authorized_devices
    const existingDevice = user.authorized_devices?.find(
      (d) => d.device_id === deviceId,
    );

    if (existingDevice) {
      // Mettre à jour last_seen
      await UserModel.findByIdAndUpdate(
        user._id,
        {
          $set: {
            "authorized_devices.$[elem].last_seen": new Date(),
          },
        },
        {
          arrayFilters: [{ "elem.device_id": deviceId }],
        },
      );
      mobileAuthLogger.debug("Device existant mis à jour", { deviceId });
    } else {
      // Ajouter nouveau device
      const deviceName = req.headers["x-device-name"] as string;
      const deviceOs = req.headers["x-device-os"] as string;

      await UserModel.findByIdAndUpdate(user._id, {
        $push: {
          authorized_devices: {
            device_id: deviceId,
            device_name: deviceName || "Appareil mobile inconnu",
            device_os: deviceOs || "Unknown OS",
            first_seen: new Date(),
            last_seen: new Date(),
            trusted: false, // Non trusted par défaut
          },
        },
      });
      mobileAuthLogger.info("Nouveau device autorisé", {
        deviceId,
        deviceName,
        deviceOs,
      });
    }

    // Générer token avec device_id inclus
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      "mobile",
      undefined,
      deviceId, // MED-001: Device binding
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

    // 10b. NOTIFICATION DE CONNEXION (si activée)
    if (user.login_notifications_enabled !== false) {
      try {
        const platformLabel =
          mobileContext?.platform === "ios"
            ? "iOS"
            : mobileContext?.platform === "android"
              ? "Android"
              : "mobile";
        await createNotification(
          user._id as mongoose.Types.ObjectId,
          "login_new_device",
          "Nouvelle connexion détectée",
          `Connexion depuis un appareil ${platformLabel}. Si ce n'est pas vous, changez votre mot de passe.`,
          {
            senderId: user._id as mongoose.Types.ObjectId,
          },
        );
      } catch (notifErr) {
        mobileAuthLogger.error("Erreur envoi notification login", {
          error:
            notifErr instanceof Error ? notifErr.message : String(notifErr),
        });
      }
    }

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
      storage_quota: 2147483648, // 2 GB par défaut
      storage_used: 0,
    };

    const createdUser = await createUser(newUser);

    // 6. ENVOI EMAIL DE BIENVENUE
    const frontendUrl = process.env.FRONTEND_URL || "https://app.qvarry.fr";
    const verificationLink = `${frontendUrl}/?verify=${encodeURIComponent(email)}`;

    sendWelcomeEmail(
      email,
      name,
      verificationLink,
      emailVerificationCode,
    ).catch((err) =>
      mobileAuthLogger.error("Erreur envoi email bienvenue", {
        error: err.message,
        // HIGH-001: stack trace supprimé pour sécurité,
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

    // Construction du lien Universal Link (iOS) / App Link (Android).
    // L'URL DOIT être HTTPS (Apple/Google refusent les schemes custom comme
    // qvarry:// pour les Universal/App Links). Le domaine doit servir AASA et
    // assetlinks.json sur /.well-known (cf. server.ts).
    //
    // Variable env :
    //   MOBILE_DEEP_LINK_BASE_URL (prod : https://qvarry.fr)
    //   En dev / fallback : on retombe sur http://localhost:3000.
    const deepLinkBaseUrl =
      process.env.MOBILE_DEEP_LINK_BASE_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://qvarry.fr"
        : "http://localhost:3000");
    const resetLink = `${deepLinkBaseUrl}/reset-password/${resetToken}`;
    const resetCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // Code 6 caractères (fallback affiché dans l'email)

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
// HANDLER: GET ME MOBILE
// ═══════════════════════════════════════════════════════════════════════════

// SEC-044: Champs sensibles à exclure des réponses /mobile/auth/me
// §4.1.5 B: utilise SENSITIVE_FIELDS canoniques (cohérence cross-controllers).
import {
  serializeUserForApi,
  SENSITIVE_FIELDS as MOBILE_ME_EXCLUDED_FIELDS,
} from "../utils/userSerializer";

/**
 * GET /api/v1/mobile/auth/me
 * Retourne le profil de l'utilisateur mobile connecté.
 * Route dédiée mobile, exempte de CSRF.
 * Inspiré de handleAuthMe dans loginController.ts.
 */
export async function handleMobileGetMe(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    // SEC-044 + §4.1.5 B: query Mongoose .select(-sensitive) pour bandwidth,
    // puis serializeUserForApi (déchiffre + supprime sensibles + IPs).
    const selectFields = MOBILE_ME_EXCLUDED_FIELDS.map(
      (field) => `-${field}`,
    ).join(" ");

    const user = await UserModel.findById(userId).select(selectFields);
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé.",
        code: "USER_NOT_FOUND",
      });
    }

    mobileAuthLogger.debug("[MOBILE-AUTH] /mobile/auth/me — profil récupéré", {
      userId,
    });

    return res.status(200).json(serializeUserForApi(user));
  } catch (error) {
    mobileAuthLogger.error(
      "[MOBILE-AUTH] Erreur lors de la récupération du profil /me",
      {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return res.status(500).json({
      error: "Erreur lors de la récupération du profil.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: REFRESH TOKEN MOBILE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileRefreshToken(req: Request, res: Response) {
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

    // Récupérer les données utilisateur depuis la DB (isAdmin réel + deviceId)
    const user = await UserModel.findById(userId).select("is_admin").lean();

    // Récupérer le deviceId depuis le header ou le refresh token décodé
    const deviceId = req.headers["x-device-id"] as string | undefined;

    // Générer nouveau token avec isAdmin depuis la DB et deviceId préservé
    const { token: newAccessToken, tokenId: newTokenId } = generateSecureToken(
      userId,
      user?.is_admin || false,
      "mobile",
      undefined,
      deviceId,
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
      // §V4 client : retourne le nouveau tokenId (jti) pour que le client mobile
      // synchronise sa session storage. Permet au handler WS session_revoked
      // de matcher après rotation du refresh token. Cf. Vague 4 §4.1.7.
      tokenId: newTokenId,
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

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS: LOGIN NOTIFICATIONS (toggle email alerte connexion)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleGetLoginNotifications(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const user = await UserModel.findById(userId).select(
      "login_notifications_enabled",
    );
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé.",
        code: "USER_NOT_FOUND",
      });
    }

    return res
      .status(200)
      .json({ enabled: user.login_notifications_enabled !== false });
  } catch (error) {
    mobileAuthLogger.error("Erreur lecture login_notifications", {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Erreur lors de la lecture du paramètre.",
      code: "INTERNAL_ERROR",
    });
  }
}

export async function handleUpdateLoginNotifications(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        error: "Le champ `enabled` doit être un booléen.",
        code: "INVALID_PAYLOAD",
      });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé.",
        code: "USER_NOT_FOUND",
      });
    }

    user.login_notifications_enabled = enabled;
    await user.save();

    mobileAuthLogger.info("login_notifications mis à jour", {
      userId,
      enabled,
    });

    return res.status(200).json({ enabled });
  } catch (error) {
    mobileAuthLogger.error("Erreur update login_notifications", {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: "Erreur lors de la mise à jour.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: RESET PASSWORD MOBILE (Universal Link / App Link)
// ═══════════════════════════════════════════════════════════════════════════
// Pendant du flow handleMobileForgotPassword : valide le token reçu via le deep
// link (https://qvarry.fr/reset-password/<token>) et applique le nouveau mot de
// passe. PAS d'auth requise — l'utilisateur n'est pas connecté quand il arrive
// sur cet endpoint.
//
// Schéma de token : crypto.randomBytes(32).toString("hex") généré dans
// handleMobileForgotPassword, stocké en SHA-256 dans user.reset_password_token.
// On hash le token reçu et on cherche un user dont reset_password_token == hash
// et reset_password_expires > now.
// ═══════════════════════════════════════════════════════════════════════════

export async function handleMobileResetPassword(req: Request, res: Response) {
  const mobileContext = (req as any).mobileContext;
  const { token, newPassword } = req.body || {};

  const result = await resetPasswordByToken(token, newPassword, {
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.headers["user-agent"] || "App Mobile",
    source: "mobile",
    platform: mobileContext?.platform,
    deviceId: mobileContext?.deviceId,
  });

  if (!result.success) {
    return res
      .status(result.status)
      .json({ error: result.message, code: result.code });
  }

  return res.status(200).json({ success: true });
}
