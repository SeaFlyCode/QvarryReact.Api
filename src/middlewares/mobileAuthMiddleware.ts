// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE D'AUTHENTIFICATION POUR APPLICATIONS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Version simplifiée du authMiddleware pour le contexte mobile
// - Vérifie uniquement le JWT (pas de session memoryStorage)
// - Utilisé par les routes qui n'ont pas besoin des données en mémoire
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { redisSessionService } from "../services/redisSessionService";
// CRIT-10: blacklistedTokens Set supprimé, on utilise redisSessionService exclusivement
import { jwtKeyManager } from "../utils/jwtKeyManager";
import UserModel from "../models/users";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MobileDecodedToken {
  id: string;
  isAdmin?: boolean;
  iat?: number;
  exp?: number;
  jti?: string;
  kv?: string;
  platform?: "mobile" | "web";
  deviceId?: string; // MED-001: Device binding
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE D'AUTHENTIFICATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Middleware d'authentification pour les routes mobiles
 * Vérifie le JWT sans dépendre de memoryStorage
 * Idéal pour les routes qui n'ont pas besoin des données utilisateur en cache
 */
export const mobileAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 1. RÉCUPÉRATION DU TOKEN (Header Authorization uniquement)
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn(
        `⚠️ [MOBILE-AUTH] Token manquant - ${req.method} ${req.path}`,
      );
      return res.status(401).json({
        error: "Token d'authentification requis",
        code: "NO_TOKEN",
        hint: "Header 'Authorization: Bearer <token>' requis",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "Token d'authentification invalide",
        code: "INVALID_TOKEN_FORMAT",
      });
    }

    // 2. VÉRIFICATION DE LA BLACKLIST (CRIT-10: Redis uniquement)
    const isBlacklisted = await redisSessionService.isTokenBlacklisted(token);

    if (isBlacklisted) {
      console.warn(
        `🚫 [MOBILE-AUTH] Token révoqué utilisé - ${req.method} ${req.path}`,
      );
      return res.status(401).json({
        error: "Token révoqué. Veuillez vous reconnecter.",
        code: "TOKEN_REVOKED",
      });
    }

    // 3. DÉCODAGE ET VÉRIFICATION DU JWT
    // Support du key versioning pour la rotation de clés
    const unverifiedPayload = jwt.decode(token) as MobileDecodedToken | null;

    if (!unverifiedPayload) {
      return res.status(401).json({
        error: "Token invalide",
        code: "TOKEN_DECODE_ERROR",
      });
    }

    const keyVersion = unverifiedPayload.kv;
    let jwtSecret: string;

    if (keyVersion && jwtKeyManager.hasVersion(keyVersion)) {
      const versionedSecret = jwtKeyManager.getKeyByVersion(keyVersion);
      if (!versionedSecret) {
        console.error(
          `❌ [MOBILE-AUTH] Clé JWT version ${keyVersion} non trouvée`,
        );
        return res.status(401).json({
          error: "Token invalide",
          code: "KEY_VERSION_INVALID",
        });
      }
      jwtSecret = versionedSecret;
    } else {
      const mainSecret = process.env.JWT_SECRET;
      if (!mainSecret) {
        console.error("❌ [MOBILE-AUTH] JWT_SECRET non défini");
        throw new Error("Configuration de sécurité manquante");
      }
      jwtSecret = mainSecret;
    }

    // Vérifier le token avec les options d'audience pour mobile
    const decoded = jwt.verify(token, jwtSecret, {
      audience: "qvarry-mobile",
      issuer: "qvarry-api",
    }) as MobileDecodedToken;

    // 4. MED-001: VÉRIFICATION DU BINDING DEVICE-TOKEN
    const headerDeviceId = req.headers["x-device-id"] as string;
    if (
      decoded.deviceId &&
      headerDeviceId &&
      decoded.deviceId !== headerDeviceId
    ) {
      console.warn(
        `🚨 [MOBILE-AUTH] Device mismatch: token=${decoded.deviceId}, header=${headerDeviceId}`,
      );
      return res.status(401).json({
        error: "Token invalide pour cet appareil. Veuillez vous reconnecter.",
        code: "DEVICE_MISMATCH",
      });
    }

    // 5. VÉRIFICATION DU JTI (Session ID)
    if (decoded.jti) {
      const isValidJti = await redisSessionService.validateSessionJti(
        decoded.id,
        decoded.jti,
      );
      if (!isValidJti) {
        console.warn(
          `⚠️ [MOBILE-AUTH] JTI invalide pour userId: ${decoded.id}`,
        );
        return res.status(401).json({
          error: "Session expirée. Veuillez rafraîchir votre token.",
          code: "SESSION_EXPIRED",
          requiresRefresh: true,
        });
      }
    }

    // 6. VÉRIFICATION QUE L'UTILISATEUR EXISTE TOUJOURS
    const userExists = await UserModel.exists({ _id: decoded.id });
    if (!userExists) {
      console.warn(`⚠️ [MOBILE-AUTH] Utilisateur ${decoded.id} n'existe plus`);
      return res.status(401).json({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // HIGH-3 FIX: VALIDATION ISADMIN DEPUIS LA BASE DE DONNÉES
    // ─────────────────────────────────────────────────────────────────────
    // Empêche l'escalade de privilèges par modification du token
    // Même pattern que authMiddleware.ts (ligne 237-262)
    let verifiedIsAdmin = false;
    if (decoded.isAdmin) {
      const user = await UserModel.findById(decoded.id)
        .select("is_admin is_blocked")
        .lean();
      if (!user) {
        console.warn(
          `🚫 [MOBILE-AUTH] Utilisateur non trouvé en DB: ${decoded.id}`,
        );
        return res.status(401).json({
          error: "Utilisateur non trouvé",
          code: "USER_NOT_FOUND",
        });
      }
      if (user.is_blocked) {
        console.warn(
          `🚫 [MOBILE-AUTH] Utilisateur bloqué tente d'accéder: ${decoded.id}`,
        );
        return res.status(403).json({
          error: "Votre compte a été suspendu",
          code: "ACCOUNT_BLOCKED",
        });
      }

      // Utiliser la valeur en base, pas celle du token
      verifiedIsAdmin = user.is_admin === true;

      // Rejet immédiat si escalade de privilèges détectée
      if (decoded.isAdmin && !verifiedIsAdmin) {
        console.error(
          `🚨 [MOBILE-AUTH] TENTATIVE D'ESCALADE DE PRIVILÈGES BLOQUÉE! userId: ${decoded.id} - IP: ${req.ip}`,
        );

        // Logger l'incident de sécurité
        try {
          const { auditService } = await import("../services/auditService");
          await auditService.log({
            userId: decoded.id,
            action: "PRIVILEGE_ESCALATION_ATTEMPT_MOBILE",
            level: "critical",
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
            details: {
              path: req.path,
              method: req.method,
              tokenIsAdmin: decoded.isAdmin,
              dbIsAdmin: verifiedIsAdmin,
              tokenJti: decoded.jti,
              platform: "mobile",
            },
          });
        } catch (auditError) {
          console.error(
            "❌ [MOBILE-AUTH] Erreur lors du log de la tentative d'escalade:",
            auditError,
          );
        }

        // Blacklister le token
        try {
          const authHeader = req.headers.authorization;
          const token = authHeader?.split(" ")[1];
          if (token) {
            await redisSessionService.blacklistToken(
              token,
              {
                token,
                userId: decoded.id,
                blacklistedAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
                reason: "PRIVILEGE_ESCALATION_ATTEMPT_MOBILE",
              },
              24 * 60 * 60,
            );
          }
        } catch (blacklistError) {
          console.error(
            "❌ [MOBILE-AUTH] Erreur blacklist token compromis:",
            blacklistError,
          );
        }

        return res.status(403).json({
          error: "Accès refusé. Incident de sécurité enregistré.",
          code: "PRIVILEGE_ESCALATION_BLOCKED",
        });
      }
    }

    // 7. ATTACHER LES INFOS À LA REQUÊTE
    req.user = {
      id: decoded.id,
      isAdmin: verifiedIsAdmin, // HIGH-3 FIX: Valeur vérifiée depuis la DB
    };

    // Log de debug en développement
    if (process.env.NODE_ENV === "development") {
      console.log(
        `📱 [MOBILE-AUTH] Authentifié: userId=${decoded.id}, admin=${decoded.isAdmin}`,
      );
    }

    next();
  } catch (error: any) {
    // Gestion des erreurs JWT spécifiques
    if (error.name === "TokenExpiredError") {
      console.warn(`⚠️ [MOBILE-AUTH] Token expiré`);
      return res.status(401).json({
        error: "Token expiré. Veuillez rafraîchir votre token.",
        code: "TOKEN_EXPIRED",
        requiresRefresh: true,
      });
    }

    if (error.name === "JsonWebTokenError") {
      console.warn(`⚠️ [MOBILE-AUTH] Token JWT invalide: ${error.message}`);
      return res.status(401).json({
        error: "Token invalide",
        code: "TOKEN_INVALID",
      });
    }

    if (error.name === "NotBeforeError") {
      return res.status(401).json({
        error: "Token pas encore valide",
        code: "TOKEN_NOT_ACTIVE",
      });
    }

    console.error(`❌ [MOBILE-AUTH] Erreur inattendue:`, error);
    return res.status(500).json({
      error: "Erreur d'authentification",
      code: "AUTH_ERROR",
    });
  }
};

/**
 * Version optionnelle du middleware
 * Continue même si pas de token (pour les routes accessibles aux deux)
 */
export const mobileAuthMiddlewareOptional = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  // Pas de token = continuer sans authentification
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  // Sinon, utiliser le middleware normal
  return mobileAuthMiddleware(req, res, next);
};
