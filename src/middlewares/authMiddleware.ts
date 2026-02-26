import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../services/memoryStorageService";
// CRIT-10: blacklistedTokens Set supprimé, on utilise redisSessionService exclusivement
import { redisSessionService } from "../services/redisSessionService";
import UserModel from "../models/users";
import { jwtKeyManager } from "../utils/jwtKeyManager";
import { isErrorWithName } from "../utils/errorUtils";
import { loadAndDecryptUserData } from "../controllers/auth";
import { anonymizeIp } from "../utils/logUtils";
import { logger } from "../services/loggerService";

const authLogger = logger.child({ service: "auth" });

// Types étendus pour Express dans ../types/express.d.ts

// ═══════════════════════════════════════════════════════════════════════════
// TYPES INTERNES
// ═══════════════════════════════════════════════════════════════════════════

interface DecodedToken {
  id: string;
  isAdmin?: boolean;
  iat?: number;
  exp?: number;
  jti?: string;
  kv?: string; // REM-003: Key Version
  platform?: "mobile" | "web"; // Identifie le type de token
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE D'AUTHENTIFICATION UNIFIÉ (WEB + MOBILE)
// ═══════════════════════════════════════════════════════════════════════════

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. RÉCUPÉRATION DU TOKEN (VULN-010 CORRIGÉE)
    // ─────────────────────────────────────────────────────────────────────
    // - Web: Cookie HTTP-only (prioritaire)
    // - Mobile: Authorization header Bearer token
    // SUPPRIMÉ: req.query.token (exposé dans logs/historique)
    // SUPPRIMÉ: req.body.token (non sécurisé)
    // Pour WebSocket: utiliser handleGetWebSocketToken() pour token temporaire
    // ─────────────────────────────────────────────────────────────────────
    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];

    // 2. VALIDATION DU TOKEN
    if (!token) {
      authLogger.warn("Tentative accès sans token", {
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        message: "Authentification requise. Aucun token fourni.",
        code: "NO_TOKEN",
      });
    }

    // 3. VÉRIFICATION DE LA BLACKLIST (CRIT-10: Redis uniquement)
    const isBlacklisted = await redisSessionService.isTokenBlacklisted(token);

    if (isBlacklisted) {
      authLogger.warn("Token révoqué utilisé", {
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        message: "Token révoqué. Veuillez vous reconnecter.",
        code: "TOKEN_REVOKED",
        tokenBlacklisted: true,
      });
    }

    // 4. VÉRIFICATION ET DÉCODAGE DU TOKEN JWT
    // REM-003: Support du key versioning pour la rotation de clés
    let jwtSecret: string;

    // D'abord décoder sans vérifier pour obtenir la version de la clé
    const unverifiedPayload = jwt.decode(token) as { kv?: string } | null;
    const keyVersion = unverifiedPayload?.kv;

    if (keyVersion && jwtKeyManager.hasVersion(keyVersion)) {
      // Utiliser la clé correspondante à la version du token
      const versionedSecret = jwtKeyManager.getKeyByVersion(keyVersion);
      if (!versionedSecret) {
        authLogger.error("Clé JWT version non trouvée", { keyVersion });
        return res.status(401).json({
          message: "Token invalide.",
          code: "KEY_VERSION_INVALID",
        });
      }
      jwtSecret = versionedSecret;
    } else {
      // Fallback vers la clé principale (tokens anciens sans version)
      const mainSecret = process.env.JWT_SECRET;
      if (!mainSecret) {
        authLogger.error(
          "JWT_SECRET non défini dans les variables d'environnement",
        );
        throw new Error("Configuration de sécurité manquante");
      }
      jwtSecret = mainSecret;
    }

    const decoded = jwt.verify(token, jwtSecret) as DecodedToken;

    // ─────────────────────────────────────────────────────────────────────
    // 5. DÉTECTION DU TYPE DE TOKEN (WEB VS MOBILE)
    // ─────────────────────────────────────────────────────────────────────
    const isMobileToken =
      decoded.platform === "mobile" ||
      req.headers["x-platform"]?.toString().toLowerCase() === "ios" ||
      req.headers["x-platform"]?.toString().toLowerCase() === "android";

    // 6. VÉRIFICATION DE LA SESSION
    // ─────────────────────────────────────────────────────────────────────
    // WEB: Vérifie memoryStorage session (sessions basées sur cookies)
    // MOBILE: Bypass memoryStorage, utilise redisSessionService (sessions créées au login mobile)
    // ─────────────────────────────────────────────────────────────────────
    const requireActiveSession = process.env.REQUIRE_ACTIVE_SESSION !== "false";
    if (requireActiveSession) {
      if (isMobileToken) {
        // MOBILE: Vérifier via redisSessionService (pas memoryStorage)
        // Le login mobile crée une session via redisSessionService.createSession()
        // On vérifie juste que le JTI est valide (plus bas)
        // La session mobile est gérée différemment (refresh token + JTI)
        const hasValidJti = decoded.jti
          ? await redisSessionService.validateSessionJti(
              decoded.id,
              decoded.jti,
              "mobile",
            )
          : false;

        if (!hasValidJti) {
          authLogger.warn("Session/JTI invalide pour mobile", {
            userId: decoded.id,
          });
          return res.status(401).json({
            message: "Session expirée. Veuillez rafraîchir votre token.",
            code: "SESSION_EXPIRED",
            requiresRefresh: true,
          });
        }

        // ─────────────────────────────────────────────────────────────────────
        // MOBILE: LAZY LOADING - Initialiser memoryStorage si nécessaire
        // ─────────────────────────────────────────────────────────────────────
        // Les routes classiques (/api/fiches, etc.) utilisent memoryStorage
        // Pour compatibilité, on initialise la session à la volée si elle n'existe pas
        if (!memoryStorage.hasSession(decoded.id)) {
          authLogger.info("Initialisation lazy de memoryStorage pour mobile", {
            userId: decoded.id,
          });
          try {
            await loadAndDecryptUserData(decoded.id);
            authLogger.info("Session memoryStorage initialisée pour mobile", {
              userId: decoded.id,
            });
          } catch (initError) {
            authLogger.error("Erreur initialisation session mobile", {
              userId: decoded.id,
              error:
                initError instanceof Error
                  ? initError.message
                  : String(initError),
            });
            return res.status(500).json({
              message: "Erreur lors de l'initialisation de la session.",
              code: "SESSION_INIT_ERROR",
            });
          }
        }
      } else {
        // WEB: Vérifier via memoryStorage (comportement original)
        if (!memoryStorage.hasSession(decoded.id)) {
          // ALLOW_SESSION_RECOVERY: Tenter de récupérer automatiquement la session
          const allowRecovery = process.env.ALLOW_SESSION_RECOVERY !== "false";

          if (allowRecovery) {
            authLogger.info("Tentative de récupération de session", {
              userId: decoded.id,
            });
            try {
              await loadAndDecryptUserData(decoded.id);
              authLogger.info("Session récupérée avec succès", {
                userId: decoded.id,
              });
            } catch (recoveryError) {
              authLogger.error("Échec récupération session", {
                userId: decoded.id,
                error:
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
              });
              return res.status(401).json({
                message: "Session expirée. Veuillez vous reconnecter.",
                code: "SESSION_RECOVERY_FAILED",
                requiresRefresh: true,
              });
            }
          } else {
            authLogger.warn("Session expirée ou non initialisée", {
              userId: decoded.id,
            });
            return res.status(401).json({
              message: "Session expirée. Veuillez rafraîchir votre token.",
              code: "SESSION_EXPIRED",
              requiresRefresh: true,
            });
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. AUTH-007: VÉRIFICATION DU JTI EN SESSION (WEB UNIQUEMENT)
    // ─────────────────────────────────────────────────────────────────────
    // Détecte si le token a été modifié ou si un ancien token est utilisé
    // Note: Pour mobile, cette vérification est déjà faite à l'étape 6
    if (decoded.jti && !isMobileToken) {
      const isValidJti = await redisSessionService.validateSessionJti(
        decoded.id,
        decoded.jti,
        "web",
      );
      if (!isValidJti) {
        authLogger.warn("JTI invalide ou token obsolète", {
          userId: decoded.id,
          jti: decoded.jti,
        });
        return res.status(401).json({
          message:
            "Token invalide ou session expirée. Veuillez vous reconnecter.",
          code: "JTI_INVALID",
          tokenBlacklisted: true,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. AUTH-008: VALIDATION ISADMIN DEPUIS LA BASE DE DONNÉES
    // ─────────────────────────────────────────────────────────────────────
    // Empêche l'escalade de privilèges par modification du token
    let verifiedIsAdmin = false;
    if (decoded.isAdmin) {
      const user = await UserModel.findById(decoded.id)
        .select("is_admin is_blocked")
        .lean();
      if (!user) {
        authLogger.warn("Utilisateur non trouvé en DB", { userId: decoded.id });
        return res.status(401).json({
          message: "Utilisateur non trouvé.",
          code: "USER_NOT_FOUND",
        });
      }
      if (user.is_blocked) {
        authLogger.warn("Utilisateur bloqué tente d'accéder", {
          userId: decoded.id,
        });
        return res.status(403).json({
          message: "Votre compte a été suspendu.",
          code: "ACCOUNT_BLOCKED",
        });
      }
      // Utiliser la valeur en base, pas celle du token
      verifiedIsAdmin = user.is_admin === true;

      // ═══════════════════════════════════════════════════════════════════════════
      // AUTHZ-001 CORRIGÉ: REJET IMMÉDIAT SI ESCALADE DE PRIVILÈGES DÉTECTÉE
      // ═══════════════════════════════════════════════════════════════════════════
      // Si le token prétend être admin mais la DB dit non, c'est une tentative d'attaque
      // Rejeter immédiatement au lieu de simplement corriger silencieusement
      if (decoded.isAdmin && !verifiedIsAdmin) {
        authLogger.error("TENTATIVE D'ESCALADE DE PRIVILÈGES BLOQUÉE", {
          userId: decoded.id,
          ip: anonymizeIp(req.ip || ""),
        });

        // Logger l'incident de sécurité pour investigation
        try {
          const { auditService } = await import("../services/auditService");
          await auditService.log({
            userId: decoded.id,
            action: "PRIVILEGE_ESCALATION_ATTEMPT",
            level: "critical",
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
            details: {
              path: req.path,
              method: req.method,
              tokenIsAdmin: decoded.isAdmin,
              dbIsAdmin: verifiedIsAdmin,
              tokenJti: decoded.jti,
            },
          });
        } catch (auditError) {
          authLogger.error("Erreur lors du log de la tentative d'escalade", {
            error:
              auditError instanceof Error
                ? auditError.message
                : String(auditError),
          });
        }

        // Blacklister le token pour empêcher toute réutilisation
        try {
          await redisSessionService.blacklistToken(
            token,
            {
              token,
              userId: decoded.id,
              blacklistedAt: new Date(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
              reason: "PRIVILEGE_ESCALATION_ATTEMPT",
            },
            24 * 60 * 60,
          );
        } catch (blacklistError) {
          authLogger.error("Erreur blacklist token compromis", {
            error:
              blacklistError instanceof Error
                ? blacklistError.message
                : String(blacklistError),
          });
        }

        return res.status(403).json({
          message: "Accès refusé. Incident de sécurité enregistré.",
          code: "PRIVILEGE_ESCALATION_BLOCKED",
        });
      }
    }

    // 9. MISE À JOUR DE LA SESSION (TOUCH)
    if (!isMobileToken && memoryStorage.hasSession(decoded.id)) {
      memoryStorage.touchSession?.(decoded.id);
    }

    // 10. INJECTION DES DONNÉES UTILISATEUR DANS LA REQUÊTE
    req.user = {
      id: decoded.id,
      isAdmin: verifiedIsAdmin, // AUTH-008: Valeur vérifiée depuis la DB
      tokenIssuedAt: decoded.iat,
      tokenId: decoded.jti,
      clientType: decoded.platform === "mobile" ? "mobile" : "web",
    };

    // 11. CONTEXTE MOBILE (si applicable)
    if (isMobileToken) {
      (req as any).authType = "mobile";
      (req as any).mobileContext = {
        platform: decoded.platform || req.headers["x-platform"],
        deviceId: req.headers["x-device-id"],
        tokenType: "mobile",
      };
    } else {
      (req as any).authType = "web";
    }

    // Log des accès authentifiés en mode debug
    if (process.env.LOG_AUTH_ACCESS === "true") {
      const authType = isMobileToken ? "MOBILE" : "WEB";
      authLogger.info("Accès autorisé", {
        authType,
        userId: decoded.id,
        method: req.method,
        path: req.path,
      });
    }

    next();
  } catch (error: unknown) {
    // GESTION DES ERREURS - Messages génériques pour éviter le leakage d'information
    // Note: En interne on log le type exact pour le débogage
    const errorType = isErrorWithName(error, "TokenExpiredError")
      ? "expired"
      : isErrorWithName(error, "JsonWebTokenError")
        ? "invalid"
        : "error";
    authLogger.error("Erreur d'authentification", {
      errorType,
      method: req.method,
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });

    // SÉCURITÉ: Message générique pour ne pas révéler si le token est expiré ou invalide
    return res.status(401).json({
      message: "Authentification échouée. Veuillez vous reconnecter.",
      code: "AUTH_FAILED",
    });
  }
};
