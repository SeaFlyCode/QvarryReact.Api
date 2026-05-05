import { getErrorMessage, isErrorWithName } from "../../utils/errorUtils";
import { maskEmail, anonymizeIp } from "../../utils/logUtils";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getUserByEmail } from "../../services/userService";
import { memoryStorage } from "../../services/memoryStorageService";
import mongoose from "mongoose";
import { refreshTokenService } from "../../services/refreshTokenService";
import { auditService } from "../../services/auditService";
import { resetRateLimit } from "../../middlewares/rateLimitMiddleware";
import { redisSessionService } from "../../services/redisSessionService";
import { sendSecurityAlertEmail } from "../../services/emailService";
import { generateDeviceFingerprint } from "../../utils/deviceFingerprint";
import MaintenanceModel from "../../models/maintenance";
import { decrypt } from "../../utils/masterEncryptionUtils";
import UserModel from "../../models/users";
import {
  getJwtCookieOptions,
  getRefreshTokenCookieOptions,
  getCookieConfig,
  clearCookieOptions,
  JWT_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "../../config/cookieConfig";
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
  loadAndDecryptUserData,
} from "./authHelpers";
import { logger } from "../../services/loggerService";
import { setRequestContext } from "../../middlewares/correlationMiddleware";
import { buildForbidden } from "../../utils/authErrors";

// SEC-044: Champs sensibles à exclure des réponses /auth/me
const AUTH_ME_EXCLUDED_FIELDS = [
  "password",
  "password_history",
  "reset_password_token",
  "reset_password_expires",
  "email_verification_token",
  "email_verification_code",
  "email_verification_expires",
  "two_factor_secret",
  "two_factor_recovery_codes",
  "ip_creation",
  "ip_last_connection",
];

const loginLogger = logger.child({ service: "auth-login" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGIN UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLoginUser(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const { email, password } = req.body;

    // ─────────────────────────────────────────────────────────────────────
    // 1. VALIDATION DES ENTRÉES
    // ─────────────────────────────────────────────────────────────────────
    if (!email || !password) {
      loginLogger.warn("[AUTH] Tentative de connexion avec champs manquants");
      return res.status(400).json({
        error: "Email et mot de passe requis.",
      });
    }

    // Validation du format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      loginLogger.warn("[AUTH] Format d'email invalide", {
        email: maskEmail(email),
      });
      return res.status(400).json({
        error: "Format d'email invalide.",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. VÉRIFICATION DES TENTATIVES DE CONNEXION (PROTECTION BRUTE FORCE)
    // ─────────────────────────────────────────────────────────────────────
    const attemptCheck = await checkLoginAttempts(email);
    if (!attemptCheck.allowed) {
      return res.status(429).json({
        error: attemptCheck.message,
        waitTime: attemptCheck.waitTime,
        tooManyAttempts: true,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. VÉRIFICATION DE L'UTILISATEUR
    // ─────────────────────────────────────────────────────────────────────
    const user = await getUserByEmail(email);

    // ─────────────────────────────────────────────────────────────────────
    // 4. VÉRIFICATION DU MOT DE PASSE (AUTH-003: Protection timing attack)
    // ─────────────────────────────────────────────────────────────────────
    // AUTH-003 CORRIGÉ: Exécuter bcrypt.compare même pour utilisateurs inexistants
    // Cela prévient les timing attacks pour l'énumération d'utilisateurs
    // Le hash factice a été pré-généré avec le même coût que les vrais hashs (12 rounds)
    const DUMMY_HASH =
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
    const passwordToCompare = user?.password || DUMMY_HASH;

    const isPasswordValid = await bcrypt.compare(password, passwordToCompare);

    if (!user || !isPasswordValid) {
      const failIp =
        req.ip || req.connection.remoteAddress || undefined;
      await recordFailedLogin(email, failIp);
      // Message générique pour éviter l'énumération des utilisateurs
      return res.status(401).json({
        error: "Email ou mot de passe incorrect.",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4.1 VÉRIFICATION DU MODE MAINTENANCE
    // ─────────────────────────────────────────────────────────────────────
    const maintenance = await MaintenanceModel.findOne().lean();
    const isMaintenanceActive = maintenance?.isActive || false;

    if (isMaintenanceActive && !user.is_admin) {
      loginLogger.warn(
        "[AUTH] Connexion refusée pendant maintenance pour non-admin",
        { email: maskEmail(email) },
      );
      return res.status(503).json({
        error:
          "Le site est actuellement en maintenance. Seuls les administrateurs peuvent se connecter.",
        maintenance: true,
        message: maintenance?.message || "Site en maintenance",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4.3 VÉRIFICATION DU BLOCAGE DU COMPTE
    // ─────────────────────────────────────────────────────────────────────
    if (user.is_blocked) {
      loginLogger.warn("[AUTH] Tentative de connexion d'un compte bloqué", {
        email: maskEmail(email),
      });
      // P1 — shape unifié { error: "FORBIDDEN", code, message } + flag legacy
      return res.status(403).json({
        ...buildForbidden(
          "BLOCKED",
          "Votre compte a été suspendu. Contactez l'administrateur pour plus d'informations.",
        ),
        accountBlocked: true,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4.5 VÉRIFICATION DE L'EMAIL
    // ─────────────────────────────────────────────────────────────────────
    if (!user.is_verified) {
      // P1 — shape unifié + flags legacy
      return res.status(403).json({
        ...buildForbidden(
          "UNVERIFIED",
          "Veuillez vérifier votre adresse email avant de vous connecter.",
          { email },
        ),
        emailNotVerified: true,
        email, // legacy: utilisé par le frontend pour permettre le renvoi du code
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4.6 VÉRIFICATION DE LA VALIDATION PAR UN ADMIN
    // ─────────────────────────────────────────────────────────────────────
    if (!user.is_admin_validated) {
      // Vérifier si le compte a été refusé
      if (user.admin_validation_rejected) {
        loginLogger.warn("[AUTH] Tentative de connexion d'un compte refusé", {
          email: maskEmail(email),
        });
        // P1 — shape unifié + flags legacy
        return res.status(403).json({
          ...buildForbidden(
            "PENDING_VALIDATION",
            "Votre demande de compte a été refusée. Contactez l'administrateur pour plus d'informations.",
            {
              rejected: true,
              rejectionReason: user.admin_rejection_reason || undefined,
            },
          ),
          accountRejected: true,
          rejectionReason: user.admin_rejection_reason || undefined,
        });
      }

      loginLogger.warn(
        "[AUTH] Tentative de connexion d'un compte en attente de validation",
        { email: maskEmail(email) },
      );
      // P1 — shape unifié + flags legacy
      return res.status(403).json({
        ...buildForbidden(
          "PENDING_VALIDATION",
          "Votre compte est en attente de validation par un administrateur. Vous recevrez un email lorsque votre compte sera activé.",
        ),
        pendingAdminValidation: true,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4.7 VÉRIFICATION 2FA (si activée)
    // ─────────────────────────────────────────────────────────────────────
    if (user.two_factor_enabled) {
      const userId = (user._id as mongoose.Types.ObjectId).toString();
      loginLogger.info("[AUTH] 2FA requis", { email: maskEmail(email) });

      // Réinitialiser les tentatives car le mot de passe est correct
      await resetLoginAttempts(email);

      // HIGH-01 FIX: Générer un tempToken signé au lieu d'envoyer le userId en clair
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
      }
      const tempToken = jwt.sign(
        { userId, type: "temp-2fa-web", jti: crypto.randomUUID() },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      return res.status(200).json({
        requiresTwoFactor: true,
        tempToken: tempToken,
        message:
          "Veuillez entrer votre code d'authentification à deux facteurs",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. GÉNÉRATION DES TOKENS (JWT + REFRESH TOKEN)
    // ─────────────────────────────────────────────────────────────────────
    const userId = (user._id as mongoose.Types.ObjectId).toString();
    // Enrichir le contexte de la requête pour les logs automatiques
    setRequestContext({ userId, clientType: "web" });
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      "web",
    );

    // Métadonnées de sécurité
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];
    // SÉCURITÉ: Calcul du fingerprint côté serveur (évite manipulation client)
    const deviceFingerprint = generateDeviceFingerprint(req);

    // Créer le refresh token en base de données
    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // ─────────────────────────────────────────────────────────────────────
    // 6. CONFIGURATION DES COOKIES SÉCURISÉS
    // ─────────────────────────────────────────────────────────────────────
    // Cookie pour le JWT (courte durée)
    res.cookie(JWT_COOKIE_NAME, token, getJwtCookieOptions());

    // Cookie pour le refresh token (longue durée)
    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      refreshToken,
      getRefreshTokenCookieOptions(),
    );

    // ─────────────────────────────────────────────────────────────────────
    // 7. CHARGEMENT ET DÉCHIFFREMENT DES DONNÉES UTILISATEUR
    // ─────────────────────────────────────────────────────────────────────
    await loadAndDecryptUserData(userId);

    // ─────────────────────────────────────────────────────────────────────
    // 8. CRÉATION DE LA SESSION AVEC MÉTADONNÉES
    // ─────────────────────────────────────────────────────────────────────
    // CRIT-09: Session créée via redisSessionService (source de vérité unique)
    await redisSessionService.createSession(userId, {
      ipAddress,
      userAgent,
      tokenId,
    });

    // AUTH-007: Stocker le JTI pour validation ultérieure
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      jwtExpiresInSeconds,
      "web",
    );

    // ─────────────────────────────────────────────────────────────────────
    // 9. RÉINITIALISATION DES TENTATIVES, AUDIT ET LOGGING
    // ─────────────────────────────────────────────────────────────────────
    await resetLoginAttempts(email);
    resetRateLimit(req.ip || req.connection.remoteAddress || "unknown");

    await auditService.log({
      userId,
      action: "LOGIN_SUCCESS",
      level: "info",
      ipAddress,
      userAgent,
      details: { tokenId },
    });

    const loginDuration = Date.now() - startTime;
    loginLogger.info("[AUTH] Connexion réussie", {
      email: maskEmail(email),
      userId,
      duration: loginDuration,
    });

    // ─────────────────────────────────────────────────────────────────────
    // 9.5 ENVOI D'EMAIL D'ALERTE DE SÉCURITÉ (optionnel, configurable)
    // ─────────────────────────────────────────────────────────────────────
    loginLogger.debug("[AUTH] Vérification des alertes de connexion", {
      SEND_LOGIN_ALERTS: process.env.SEND_LOGIN_ALERTS,
      userPreference: user.login_notifications_enabled ?? true,
    });

    // Vérifier à la fois la variable d'environnement globale ET la préférence utilisateur
    const userWantsLoginNotifications =
      user.login_notifications_enabled !== false; // true par défaut

    if (
      process.env.SEND_LOGIN_ALERTS === "true" &&
      userWantsLoginNotifications
    ) {
      loginLogger.info("[AUTH] Envoi d'email d'alerte de connexion", {
        email: maskEmail(email),
      });
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
        loginTime, // location/time info
      )
        .then(() => {
          loginLogger.info("[AUTH] Email d'alerte envoyé", {
            email: maskEmail(email),
          });
        })
        .catch((err) => {
          loginLogger.error("[AUTH] Erreur envoi email alerte connexion", {
            email: maskEmail(email),
            error: err instanceof Error ? err.message : String(err),
            // HIGH-001: stack trace supprimé pour sécurité,
          });
        });
    } else {
      if (!userWantsLoginNotifications) {
        loginLogger.info("[AUTH] Email d'alerte désactivé par l'utilisateur");
      } else {
        loginLogger.info(
          "[AUTH] Email d'alerte de connexion désactivé (SEND_LOGIN_ALERTS != 'true')",
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 10. PRÉPARATION DE LA RÉPONSE (MODE DEBUG OPTIONNEL)
    // ─────────────────────────────────────────────────────────────────────
    const cookieConfig = getCookieConfig();
    const response: any = {
      login: true,
      userId: userId,
      isAdmin: user.is_admin || false,
      redirectToAdmin: isMaintenanceActive && user.is_admin, // Rediriger vers /admin si maintenance active
      sessionCreated: new Date().toISOString(),
      tokenExpiresIn: cookieConfig.jwtMaxAgeMinutes * 60, // secondes
    };

    // En développement, ajouter des infos de debug
    if (!cookieConfig.isProduction && process.env.DEBUG_MODE === "true") {
      const memoryData = memoryStorage.getAllUserData(userId);
      response.debug = {
        pointsCount: memoryData.points?.length || 0,
        fichesCount: memoryData.fiches?.length || 0,
        listsCount: memoryData.lists?.length || 0,
        hasEncryptionKey: !!memoryData.encryptionKey,
        sessionInitialized: memoryStorage.hasSession(userId),
        tokenId,
      };
    }

    res.status(200).json(response);
  } catch (error: unknown) {
    loginLogger.error("[AUTH] Erreur lors de la connexion", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors de la connexion. Veuillez réessayer.",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: REFRESH TOKEN (RENOUVELLEMENT DU JWT)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleRefreshToken(req: Request, res: Response) {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. RÉCUPÉRATION DU REFRESH TOKEN
    // ─────────────────────────────────────────────────────────────────────
    loginLogger.debug("[AUTH DEBUG] Cookies reçus", {
      cookies: Object.keys(req.cookies || {}),
      hasRefreshToken: !!req.cookies?.[REFRESH_TOKEN_COOKIE_NAME],
    });

    const refreshToken =
      req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

    if (!refreshToken) {
      loginLogger.warn("[AUTH] Tentative de refresh sans token", {
        availableCookies: Object.keys(req.cookies || {}),
      });
      return res.status(401).json({
        error: "Refresh token manquant. Veuillez vous reconnecter.",
        code: "NO_REFRESH_TOKEN",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. VALIDATION DU REFRESH TOKEN
    // ─────────────────────────────────────────────────────────────────────
    const storedToken =
      await refreshTokenService.validateRefreshToken(refreshToken);

    if (!storedToken) {
      loginLogger.warn("[AUTH] Refresh token invalide ou expiré");

      await auditService.log({
        action: "REFRESH_TOKEN_INVALID",
        level: "warning",
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      return res.status(401).json({
        error: "Refresh token invalide ou expiré. Veuillez vous reconnecter.",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. DÉTECTION DE VOL DE TOKEN (Refresh Token Rotation Attack)
    // ─────────────────────────────────────────────────────────────────────
    const userId = storedToken.userId.toString();
    // Enrichir le contexte de la requête pour les logs automatiques
    setRequestContext({ userId, clientType: "web" });
    const tokenFamily = storedToken.tokenFamily;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (tokenFamily) {
      const isStolen = await refreshTokenService.detectTokenTheft(
        tokenFamily,
        userId,
        ipAddress,
      );

      if (isStolen) {
        loginLogger.error(
          "[SECURITY] Vol de token détecté! Tous les tokens révoqués",
          { userId },
        );
        return res.status(401).json({
          error:
            "Activité suspecte détectée. Tous vos tokens ont été révoqués. Veuillez vous reconnecter.",
          code: "TOKEN_THEFT_DETECTED",
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. VALIDATION DES MÉTADONNÉES (DÉTECTION DE CHANGEMENT SUSPECT)
    // ─────────────────────────────────────────────────────────────────────
    const userAgent = req.headers["user-agent"];

    if (process.env.VALIDATE_SESSION_METADATA === "true") {
      // Changement d'IP
      if (storedToken.ipAddress && storedToken.ipAddress !== ipAddress) {
        loginLogger.warn("[SECURITY] Changement d'IP détecté", {
          userId,
          oldIp: anonymizeIp(storedToken.ipAddress || ""),
          newIp: anonymizeIp(ipAddress || ""),
        });

        await auditService.log({
          userId,
          action: "IP_CHANGE_DETECTED",
          level: "warning",
          ipAddress,
          details: { oldIp: storedToken.ipAddress, newIp: ipAddress },
        });

        // Option: forcer MFA ou bloquer
        // return res.status(401).json({ error: "Changement d'IP détecté", code: 'IP_CHANGED' });
      }

      // Changement de User-Agent
      if (storedToken.userAgent && storedToken.userAgent !== userAgent) {
        loginLogger.warn("[SECURITY] Changement de User-Agent détecté", {
          userId,
        });

        await auditService.log({
          userId,
          action: "USER_AGENT_CHANGE_DETECTED",
          level: "warning",
          ipAddress,
          details: { oldUA: storedToken.userAgent, newUA: userAgent },
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. GÉNÉRER UN NOUVEAU JWT
    // ─────────────────────────────────────────────────────────────────────
    const { getUserById } = await import("../../services/userService");
    const user = await getUserById(userId);
    const { token: newJwt, tokenId: newTokenId } = generateSecureToken(
      userId,
      user?.is_admin || false,
      "web",
    );

    // ─────────────────────────────────────────────────────────────────────
    // 6. ROTATION DU REFRESH TOKEN (même session, nouveau hash)
    // ─────────────────────────────────────────────────────────────────────
    // Au lieu de révoquer + créer, on met à jour le hash dans le même document
    // Cela garde 1 session = 1 appareil et invalide l'ancien token
    const newRefreshToken = await refreshTokenService.rotateToken(
      storedToken.tokenId,
      newTokenId,
      ipAddress,
      userAgent,
    );

    // ─────────────────────────────────────────────────────────────────────
    // 7. RESTAURER LA SESSION SI NÉCESSAIRE
    // ─────────────────────────────────────────────────────────────────────
    if (!memoryStorage.hasSession(userId)) {
      loginLogger.info("[AUTH] Restauration de la session", { userId });
      await loadAndDecryptUserData(userId);
      // CRIT-09: Session créée via redisSessionService
      await redisSessionService.createSession(userId, {
        ipAddress,
        userAgent,
        tokenId: newTokenId,
      });
    } else {
      // Mettre à jour le timestamp de dernière activité
      memoryStorage.touchSession?.(userId);
    }

    // AUTH-007: Stocker le nouveau JTI pour validation ultérieure
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      newTokenId,
      jwtExpiresInSeconds,
      "web",
    );

    // ─────────────────────────────────────────────────────────────────────
    // 8. CONFIGURER LES NOUVEAUX COOKIES
    // ─────────────────────────────────────────────────────────────────────
    res.cookie(JWT_COOKIE_NAME, newJwt, getJwtCookieOptions());

    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      newRefreshToken,
      getRefreshTokenCookieOptions(),
    );

    // ─────────────────────────────────────────────────────────────────────
    // 9. AUDIT ET RÉPONSE
    // ─────────────────────────────────────────────────────────────────────
    await auditService.log({
      userId,
      action: "TOKEN_REFRESHED",
      level: "info",
      ipAddress,
      userAgent,
      details: { oldTokenId: storedToken.tokenId, newTokenId },
    });

    loginLogger.info("[AUTH] Token renouvelé", { userId });

    res.status(200).json({
      success: true,
      tokenExpiresIn: getCookieConfig().jwtMaxAgeMinutes * 60,
      message: "Token renouvelé avec succès",
    });
  } catch (error: unknown) {
    loginLogger.error("[AUTH] Erreur lors du refresh du token", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      error: "Erreur lors du renouvellement du token.",
      code: "REFRESH_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: VÉRIFICATION DE L'AUTHENTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export const checkAuth = async (req: Request, res: Response) => {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. RÉCUPÉRATION DU TOKEN
    // HIGH-2 FIX: Suppression des sources non sécurisées (query/body)
    // Seuls les cookies et Authorization header sont acceptés
    // ─────────────────────────────────────────────────────────────────────
    const token =
      req.cookies?.[JWT_COOKIE_NAME] ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        authenticated: false,
        reason: "no_token",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. VÉRIFICATION DE LA BLACKLIST (CRIT-10: via Redis uniquement)
    // ─────────────────────────────────────────────────────────────────────
    if (await redisSessionService.isTokenBlacklisted(token)) {
      loginLogger.warn("[AUTH] Tentative d'utilisation d'un token blacklisté");
      // Supprimer le cookie invalide
      res.clearCookie(JWT_COOKIE_NAME, clearCookieOptions);
      return res.status(401).json({
        authenticated: false,
        reason: "token_revoked",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. VÉRIFICATION ET DÉCODAGE DU TOKEN
    // ─────────────────────────────────────────────────────────────────────
    if (!process.env.JWT_SECRET) {
      loginLogger.error("[SECURITY] JWT_SECRET non défini");
      throw new Error("Configuration de sécurité manquante");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as {
      id: string;
      isAdmin?: boolean;
      iat?: number;
      exp?: number;
      jti?: string;
    };

    // Enrichir le contexte de la requête pour les logs automatiques
    setRequestContext({ userId: decoded.id, clientType: "web" });

    // Vérifier l'expiration explicite
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      loginLogger.warn("[AUTH] Token expiré", { userId: decoded.id });
      // Supprimer le cookie expiré
      res.clearCookie(JWT_COOKIE_NAME, clearCookieOptions);
      return res.status(401).json({
        authenticated: false,
        reason: "token_expired",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3b. VÉRIFICATION DU JTI (COHÉRENCE AVEC authMiddleware)
    // ─────────────────────────────────────────────────────────────────────
    // Si le JTI n'est plus valide dans Redis (ex: après un reload serveur),
    // le token est considéré comme invalide pour éviter les boucles
    // d'authentification où checkAuth dit "ok" mais les routes protégées
    // retournent 401.
    if (decoded.jti) {
      const isValidJti = await redisSessionService.validateSessionJti(
        decoded.id,
        decoded.jti,
        "web",
      );
      if (!isValidJti) {
        loginLogger.warn(
          "[AUTH] JTI invalide dans checkAuth - session probablement expirée",
          { userId: decoded.id },
        );
        res.clearCookie(JWT_COOKIE_NAME, clearCookieOptions);
        res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, clearCookieOptions);
        return res.status(401).json({
          authenticated: false,
          reason: "session_expired",
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. VÉRIFICATION DE LA SESSION (OPTIONNEL EN MODE STRICT)
    // ─────────────────────────────────────────────────────────────────────
    // Note: On peut désactiver cette vérification si trop stricte
    const requireActiveSession = process.env.REQUIRE_ACTIVE_SESSION === "true";
    if (requireActiveSession && !memoryStorage.hasSession(decoded.id)) {
      loginLogger.warn("[AUTH] Pas de session active", { userId: decoded.id });
      return res.status(401).json({
        authenticated: false,
        reason: "no_active_session",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. RÉPONSE DE SUCCÈS
    // ─────────────────────────────────────────────────────────────────────
    return res.status(200).json({
      authenticated: true,
      userId: decoded.id,
      isAdmin: decoded.isAdmin || false,
      tokenIssuedAt: decoded.iat
        ? new Date(decoded.iat * 1000).toISOString()
        : undefined,
    });
  } catch (error: unknown) {
    // Supprimer le cookie invalide dans tous les cas d'erreur
    res.clearCookie(JWT_COOKIE_NAME, clearCookieOptions);

    // Distinguer les différents types d'erreurs JWT
    if (isErrorWithName(error, "TokenExpiredError")) {
      loginLogger.warn("[AUTH] Token expiré");
      return res.status(401).json({
        authenticated: false,
        reason: "token_expired",
      });
    } else if (isErrorWithName(error, "JsonWebTokenError")) {
      loginLogger.warn("[AUTH] Token invalide", {
        error: getErrorMessage(error),
      });
      return res.status(401).json({
        authenticated: false,
        reason: "token_invalid",
      });
    } else {
      loginLogger.error("[AUTH] Erreur lors de la vérification du token", {
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      });
      return res.status(401).json({
        authenticated: false,
        reason: "verification_error",
      });
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: COMPLÉTER LE LOGIN APRÈS VÉRIFICATION 2FA
// ═══════════════════════════════════════════════════════════════════════════
export async function completeLoginAfter2FA(req: Request, res: Response) {
  try {
    const { tempToken } = req.body;

    if (!tempToken) {
      return res.status(400).json({ error: "tempToken requis" });
    }

    // HIGH-01 FIX: Valider le tempToken signé au lieu d'accepter un userId brut
    let userId: string;
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
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
      // Enrichir le contexte de la requête pour les logs automatiques
      setRequestContext({ userId, clientType: "web" });
    } catch {
      return res
        .status(401)
        .json({ error: "Token temporaire invalide ou expiré" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Générer les tokens
    const { token, tokenId } = generateSecureToken(
      userId,
      user.is_admin || false,
      "web",
    );

    // Métadonnées de sécurité
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];
    // SÉCURITÉ: Calcul du fingerprint côté serveur (évite manipulation client)
    const deviceFingerprint = generateDeviceFingerprint(req);

    // Créer le refresh token en base de données
    const refreshToken = await refreshTokenService.createRefreshToken({
      userId,
      tokenId,
      ipAddress,
      userAgent,
      deviceFingerprint,
    });

    // Configuration des cookies
    // Cookie pour le JWT
    res.cookie(JWT_COOKIE_NAME, token, getJwtCookieOptions());

    // Cookie pour le refresh token
    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      refreshToken,
      getRefreshTokenCookieOptions(),
    );

    // Charger les données utilisateur
    await loadAndDecryptUserData(userId);

    // Créer la session - CRIT-09: via redisSessionService
    await redisSessionService.createSession(userId, {
      ipAddress,
      userAgent,
      tokenId,
    });

    // Stocker le JTI
    const jwtExpiresInSeconds =
      parseInt(process.env.JWT_EXPIRES_IN?.replace(/[^0-9]/g, "") || "15") * 60;
    await redisSessionService.storeSessionJti(
      userId,
      tokenId,
      jwtExpiresInSeconds,
      "web",
    );

    await auditService.log({
      userId,
      action: "LOGIN_SUCCESS_2FA",
      level: "info",
      ipAddress,
      userAgent,
      details: { tokenId, method: "2fa" },
    });

    loginLogger.info("[AUTH] Connexion 2FA réussie", { userId });

    return res.status(200).json({
      login: true,
      userId,
      sessionCreated: new Date().toISOString(),
      tokenExpiresIn: getCookieConfig().jwtMaxAgeMinutes * 60,
    });
  } catch (error: unknown) {
    loginLogger.error("[AUTH] Erreur lors de la finalisation du login 2FA", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({ error: "Erreur lors de la connexion" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: PROFIL DE L'UTILISATEUR CONNECTÉ (GET /auth/me)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAuthMe(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    // SEC-044: Exclure les champs sensibles de la query Mongoose
    const selectFields = AUTH_ME_EXCLUDED_FIELDS.map(
      (field) => `-${field}`,
    ).join(" ");

    const user = await UserModel.findById(userId).select(selectFields);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // Déchiffrer les champs chiffrés
    const { ip_creation: _ic, ip_last_connection: _ilc, ...userObj } = user.toObject();
    const decrypted = {
      ...userObj,
      name: decrypt(user.name),
      surname: decrypt(user.surname),
      pseudo: user.pseudo ? decrypt(user.pseudo) : undefined,
      email: decrypt(user.email),
    };

    // Sanitize finale : supprimer les champs exclus restants
    const sanitized: Record<string, any> = { ...decrypted };
    AUTH_ME_EXCLUDED_FIELDS.forEach((field) => {
      delete sanitized[field];
    });

    loginLogger.debug("[AUTH] /auth/me — profil récupéré", { userId });

    return res.status(200).json(sanitized);
  } catch (error: unknown) {
    loginLogger.error("[AUTH] Erreur lors de la récupération du profil /me", {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      message: "Erreur lors de la récupération du profil.",
    });
  }
}
