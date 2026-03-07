// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS PUSH TOKENS (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour la gestion des tokens de notifications push
// Toutes les routes nécessitent une authentification mobile
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { registerToken, removeToken } from "../services/pushTokenService";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";

const mobilePushTokenLogger = logger.child({ service: "mobile-push-token" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: ENREGISTRER UN TOKEN PUSH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/push-tokens - Enregistrer un token de notification push
 *
 * Body:
 * {
 *   token: string,           // Token FCM/APNs (requis)
 *   platform: "ios"|"android", // Plateforme (requis)
 *   deviceId: string         // Identifiant unique du device (requis)
 * }
 *
 * Response: { success: true }
 *
 * Codes d'erreur:
 * - UNAUTHORIZED: Utilisateur non authentifié
 * - MISSING_FIELDS: Champs manquants (token, platform, deviceId)
 * - INVALID_PLATFORM: platform doit être "ios" ou "android"
 * - INVALID_TOKEN: token doit être une chaîne non vide
 * - INVALID_DEVICE_ID: deviceId doit être une chaîne non vide
 * - INTERNAL_ERROR: Erreur serveur
 */
export async function handleRegisterPushToken(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { token, platform, deviceId } = req.body;

    // Validation: tous les champs requis
    if (!token || !platform || !deviceId) {
      return res.status(400).json({
        error: "Tous les champs sont requis: token, platform, deviceId.",
        code: "MISSING_FIELDS",
      });
    }

    // Validation: platform doit être "ios" ou "android"
    if (platform !== "ios" && platform !== "android") {
      return res.status(400).json({
        error: "La plateforme doit être 'ios' ou 'android'.",
        code: "INVALID_PLATFORM",
      });
    }

    // Validation: token doit être une chaîne non vide
    if (typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        error: "Le token doit être une chaîne de caractères non vide.",
        code: "INVALID_TOKEN",
      });
    }

    // Validation: deviceId doit être une chaîne non vide
    if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
      return res.status(400).json({
        error: "Le deviceId doit être une chaîne de caractères non vide.",
        code: "INVALID_DEVICE_ID",
      });
    }

    await registerToken(userId, token, platform, deviceId);

    const duration = Date.now() - startTime;
    mobilePushTokenLogger.info("Token enregistré", {
      platform,
      deviceId,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    mobilePushTokenLogger.error("Erreur enregistrement token", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'enregistrement du token.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: SUPPRIMER UN TOKEN PUSH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DELETE /api/mobile/push-tokens - Supprimer un token de notification push
 *
 * Body:
 * {
 *   deviceId: string  // Identifiant unique du device (requis)
 * }
 *
 * Response: { success: true }
 *
 * Codes d'erreur:
 * - UNAUTHORIZED: Utilisateur non authentifié
 * - MISSING_DEVICE_ID: deviceId manquant
 * - INTERNAL_ERROR: Erreur serveur
 */
export async function handleDeletePushToken(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { deviceId } = req.body;

    // Validation: deviceId requis
    if (!deviceId) {
      return res.status(400).json({
        error: "Le deviceId est requis.",
        code: "MISSING_DEVICE_ID",
      });
    }

    await removeToken(userId, deviceId);

    const duration = Date.now() - startTime;
    mobilePushTokenLogger.info("Token supprimé", {
      deviceId,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    mobilePushTokenLogger.error("Erreur suppression token", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la suppression du token.",
      code: "INTERNAL_ERROR",
    });
  }
}
