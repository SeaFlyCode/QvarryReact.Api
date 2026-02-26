import { getErrorMessage } from "../../utils/errorUtils";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../../services/memoryStorageService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { syncService } from "../../services/syncService";
import {
  clearCookieOptions,
  JWT_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "../../config/cookieConfig";
import { blacklistToken } from "./authHelpers";
import UserModel from "../../models/users";
import { logger } from "../../services/loggerService";

const logoutLogger = logger.child({ service: "auth-logout" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGOUT UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLogoutUser(req: Request, res: Response) {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. RÉCUPÉRATION ET VALIDATION DU TOKEN
    // ─────────────────────────────────────────────────────────────────────
    const token =
      req.cookies?.[JWT_COOKIE_NAME] ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      logoutLogger.warn("[AUTH] Tentative de logout sans token");
      return res.status(400).json({
        success: false,
        message: "Token manquant.",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. SUPPRESSION DES COOKIES
    // ─────────────────────────────────────────────────────────────────────
    res.clearCookie(JWT_COOKIE_NAME, clearCookieOptions);

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, clearCookieOptions);

    // ─────────────────────────────────────────────────────────────────────
    // 3. AJOUT DU TOKEN À LA BLACKLIST ET RÉVOCATION DU REFRESH TOKEN
    // ─────────────────────────────────────────────────────────────────────
    let userId: string;
    let tokenId: string | undefined;

    try {
      if (!process.env.JWT_SECRET) {
        logoutLogger.error("[SECURITY] JWT_SECRET non défini");
        throw new Error("Configuration de sécurité manquante");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      }) as {
        id: string;
        jti?: string;
        exp?: number;
        platform?: "web" | "mobile";
      };

      userId = decoded.id;
      tokenId = decoded.jti;
      const clientType = decoded.platform || "web"; // Extraire le clientType depuis le token
      const expiresAt = decoded.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Blacklister le token (Redis + fallback mémoire)
      await blacklistToken(token, {
        token,
        expiresAt,
        blacklistedAt: new Date(),
        reason: "logout",
        userId,
      });

      // Révoquer le refresh token associé
      if (tokenId) {
        await refreshTokenService.revokeToken(tokenId, "logout");
        logoutLogger.info("[AUTH] Refresh token révoqué", { tokenId });
      }

      // Nettoyer la session Redis
      await redisSessionService.deleteSession(userId, tokenId);
      logoutLogger.info("[AUTH] Session Redis nettoyée", {
        userId,
        tokenId: tokenId || undefined,
      });

      // Supprimer le JTI du bon client
      await redisSessionService.deleteSessionJti(userId, clientType);
      logoutLogger.info("[AUTH] JTI supprimé", { userId, clientType });

      // SEC-040: Invalider le token de reset de mot de passe au logout
      // Empêche un attaquant de réutiliser un code de reset après déconnexion
      await UserModel.updateOne(
        { _id: userId },
        {
          $set: {
            reset_password_token: "",
            reset_password_expires: new Date(0),
          },
        },
      ).catch((err: unknown) => {
        logoutLogger.warn("[AUTH] Échec nettoyage reset token au logout", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      logoutLogger.info("[AUTH] Token blacklisté lors du logout", { userId });
    } catch (jwtError) {
      logoutLogger.error(
        "[AUTH] Erreur lors du décodage du token pour logout",
        {
          error:
            jwtError instanceof Error ? jwtError.message : String(jwtError),
          stack: jwtError instanceof Error ? jwtError.stack : undefined,
        },
      );
      return res.status(200).json({
        success: true,
        message: "Déconnexion effectuée (token invalide ou expiré).",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. NETTOYAGE DU CACHE DES CLÉS
    // ─────────────────────────────────────────────────────────────────────
    const { clearUserKeyCache } =
      await import("../../utils/userEncryptionUtils");
    clearUserKeyCache(userId);

    // ─────────────────────────────────────────────────────────────────────
    // 5. SYNCHRONISATION DES DONNÉES SI NÉCESSAIRE
    // ─────────────────────────────────────────────────────────────────────
    if (!memoryStorage.hasSession(userId)) {
      logoutLogger.info("[AUTH] Logout sans session active", { userId });
      return res.status(200).json({
        success: true,
        message: "Déconnexion réussie (pas de session active).",
      });
    }

    // Synchroniser si des modifications sont en attente
    if (memoryStorage.isDirty(userId)) {
      try {
        logoutLogger.info(
          "[AUTH] Synchronisation des données modifiées avant logout",
          { userId },
        );
        const syncResult = await syncService.syncNow(userId);

        if (!syncResult.success) {
          logoutLogger.error(
            "[AUTH] Échec de la synchronisation lors du logout",
            {
              userId,
              error: syncResult.error,
            },
          );
          memoryStorage.endSession(userId);
          return res.status(500).json({
            success: false,
            message:
              "Déconnexion effectuée mais échec de la synchronisation des données.",
            error: syncResult.error,
            logout: true,
            syncFailed: true,
          });
        }

        logoutLogger.info("[AUTH] Synchronisation réussie lors du logout", {
          userId,
        });
      } catch (syncError: any) {
        logoutLogger.error("[AUTH] Erreur lors de la synchronisation", {
          userId,
          error:
            syncError instanceof Error ? syncError.message : String(syncError),
          stack: syncError instanceof Error ? syncError.stack : undefined,
        });
        memoryStorage.endSession(userId);
        return res.status(500).json({
          success: false,
          message:
            "Déconnexion effectuée mais erreur lors de la synchronisation.",
          error: syncError.message,
          logout: true,
          syncFailed: true,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. FERMETURE DE LA SESSION
    // ─────────────────────────────────────────────────────────────────────
    memoryStorage.endSession(userId);
    logoutLogger.info("[AUTH] Déconnexion réussie", { userId });

    return res.status(200).json({
      success: true,
      message: "Déconnexion réussie et données synchronisées.",
      logout: true,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    logoutLogger.error("[AUTH] Erreur lors de la déconnexion", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Note: Le nettoyage de session devrait être fait avant cette erreur
    // Si on arrive ici, on ne peut plus accéder aux données du token

    return res.status(500).json({
      success: false,
      message: "Erreur lors de la déconnexion de l'utilisateur.",
      error: getErrorMessage(error) || "Une erreur inconnue s'est produite.",
      logout: false,
    });
  }
}
