import { getErrorMessage } from "../../utils/errorUtils";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../../services/memoryStorageService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { syncService } from "../../services/syncService";
import { clearCookieOptions } from "../../config/cookieConfig";
import { blacklistToken } from "./authHelpers";

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LOGOUT UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

export async function handleLogoutUser(req: Request, res: Response) {
  try {
    // ─────────────────────────────────────────────────────────────────────
    // 1. RÉCUPÉRATION ET VALIDATION DU TOKEN
    // ─────────────────────────────────────────────────────────────────────
    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      console.warn(`⚠️ [AUTH] Tentative de logout sans token`);
      return res.status(400).json({
        success: false,
        message: "Token manquant.",
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. SUPPRESSION DES COOKIES
    // ─────────────────────────────────────────────────────────────────────
    res.clearCookie("token", clearCookieOptions);

    res.clearCookie("refreshToken", clearCookieOptions);

    // ─────────────────────────────────────────────────────────────────────
    // 3. AJOUT DU TOKEN À LA BLACKLIST ET RÉVOCATION DU REFRESH TOKEN
    // ─────────────────────────────────────────────────────────────────────
    let userId: string;
    let tokenId: string | undefined;

    try {
      if (!process.env.JWT_SECRET) {
        console.error("❌ [SECURITY] JWT_SECRET non défini");
        throw new Error("Configuration de sécurité manquante");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
        id: string;
        jti?: string;
        exp?: number;
      };

      userId = decoded.id;
      tokenId = decoded.jti;
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
        console.log(`🚫 [AUTH] Refresh token révoqué (tokenId: ${tokenId})`);
      }

      console.log(
        `🚫 [AUTH] Token blacklisté lors du logout (userId: ${userId})`,
      );
    } catch (jwtError) {
      console.error(
        `❌ [AUTH] Erreur lors du décodage du token pour logout:`,
        jwtError,
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
      console.log(
        `ℹ️ [AUTH] Logout sans session active pour userId: ${userId}`,
      );
      return res.status(200).json({
        success: true,
        message: "Déconnexion réussie (pas de session active).",
      });
    }

    // Synchroniser si des modifications sont en attente
    if (memoryStorage.isDirty(userId)) {
      try {
        console.log(
          `🔄 [AUTH] Synchronisation des données modifiées avant logout...`,
        );
        const syncResult = await syncService.syncNow(userId);

        if (!syncResult.success) {
          console.error(
            `❌ [AUTH] Échec de la synchronisation lors du logout:`,
            syncResult.error,
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

        console.log(`✅ [AUTH] Synchronisation réussie lors du logout`);
      } catch (syncError: any) {
        console.error(
          `❌ [AUTH] Erreur lors de la synchronisation:`,
          syncError,
        );
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
    console.log(`✅ [AUTH] Déconnexion réussie pour userId: ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Déconnexion réussie et données synchronisées.",
      logout: true,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    console.error(`❌ [AUTH] Erreur lors de la déconnexion:`, error);

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
