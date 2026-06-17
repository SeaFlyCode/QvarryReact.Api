// ═══════════════════════════════════════════════════════════════════════════
// SERVICE PUSH TOKEN
// ═══════════════════════════════════════════════════════════════════════════
// Gère l'enregistrement et la suppression des tokens FCM pour les notifications
// push multi-appareils. Chaque utilisateur peut avoir plusieurs tokens (iOS,
// Android) identifiés par leur deviceId unique.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import PushTokenModel, { IPushToken } from "../models/pushToken";
import { logger } from "./loggerService";

const pushTokenLogger = logger.child({ service: "push-token" });

// ═══════════════════════════════════════════════════════════════════════════
// ENREGISTREMENT DE TOKEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enregistre ou met à jour un token FCM pour un appareil
 * Utilise upsert pour gérer automatiquement la création/mise à jour
 *
 * @param userId - ID de l'utilisateur
 * @param token - Token FCM
 * @param platform - Plateforme de l'appareil ("ios" ou "android")
 * @param deviceId - Identifiant unique de l'appareil
 * @returns Le document PushToken créé ou mis à jour
 */
export async function registerToken(
  userId: string,
  token: string,
  platform: "ios" | "android",
  deviceId: string,
): Promise<IPushToken> {
  try {
    // Upsert clé sur deviceId seul : un appareil physique = un token, rattaché à
    // l'utilisateur actuellement connecté. Si l'appareil a déjà été enregistré
    // sous un autre compte (changement d'utilisateur, re-login après révocation),
    // on transfère la propriété au lieu de tenter un INSERT qui violerait l'index
    // unique sur `deviceId` (erreur E11000 → 500).
    const pushToken = await PushTokenModel.findOneAndUpdate(
      { deviceId },
      {
        userId: new mongoose.Types.ObjectId(userId),
        token,
        platform,
        updatedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    pushTokenLogger.info("Token FCM enregistré", {
      userId,
      deviceId,
      platform,
    });

    return pushToken;
  } catch (error) {
    pushTokenLogger.error("Erreur lors de l'enregistrement du token FCM", {
      userId,
      deviceId,
      platform,
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPRESSION DE TOKEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supprime un token FCM pour un appareil spécifique
 *
 * @param userId - ID de l'utilisateur
 * @param deviceId - Identifiant unique de l'appareil
 * @returns true si le token a été supprimé, false si introuvable
 */
export async function removeToken(
  userId: string,
  deviceId: string,
): Promise<boolean> {
  try {
    const result = await PushTokenModel.deleteOne({
      userId: new mongoose.Types.ObjectId(userId),
      deviceId,
    });

    if (result.deletedCount && result.deletedCount > 0) {
      pushTokenLogger.info("Token FCM supprimé", { userId, deviceId });
      return true;
    }

    pushTokenLogger.warn("Token FCM introuvable pour suppression", {
      userId,
      deviceId,
    });
    return false;
  } catch (error) {
    pushTokenLogger.error("Erreur lors de la suppression du token FCM", {
      userId,
      deviceId,
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉCUPÉRATION DE TOKENS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère tous les tokens FCM d'un utilisateur
 *
 * @param userId - ID de l'utilisateur
 * @returns Liste des tokens FCM de l'utilisateur
 */
export async function getTokensByUserId(userId: string): Promise<IPushToken[]> {
  try {
    const tokens = await PushTokenModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    }).lean();

    return tokens as unknown as IPushToken[];
  } catch (error) {
    pushTokenLogger.error(
      "Erreur lors de la récupération des tokens FCM par userId",
      {
        userId,
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    throw error;
  }
}

// Reserved for future batch notification use (e.g., group notifications)
/**
 * Récupère tous les tokens FCM de plusieurs utilisateurs en une seule requête
 * Retourne un Map pour un accès rapide par userId
 *
 * @param userIds - Liste des IDs utilisateurs
 * @returns Map de userId -> liste de tokens FCM
 */
export async function getTokensByUserIds(
  userIds: string[],
): Promise<Map<string, IPushToken[]>> {
  try {
    const objectIds = userIds.map((id) => new mongoose.Types.ObjectId(id));

    const tokens = await PushTokenModel.find({
      userId: { $in: objectIds },
    }).lean();

    // Grouper les tokens par userId
    const tokenMap = new Map<string, IPushToken[]>();

    tokens.forEach((token: any) => {
      const userId = token.userId.toString();
      if (!tokenMap.has(userId)) {
        tokenMap.set(userId, []);
      }
      tokenMap.get(userId)!.push(token);
    });

    pushTokenLogger.debug("Tokens FCM récupérés pour plusieurs utilisateurs", {
      userCount: userIds.length,
      tokenCount: tokens.length,
    });

    return tokenMap;
  } catch (error) {
    pushTokenLogger.error(
      "Erreur lors de la récupération des tokens FCM par userIds",
      {
        userIdsCount: userIds.length,
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NETTOYAGE DE TOKENS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supprime les tokens FCM invalides par deviceId
 * Utilisé pour nettoyer les tokens qui ont échoué lors de l'envoi de notifications
 *
 * @param deviceIds - Liste des deviceIds à supprimer
 * @returns Nombre de tokens supprimés
 */
export async function removeInvalidTokens(
  deviceIds: string[],
): Promise<number> {
  try {
    if (deviceIds.length === 0) {
      return 0;
    }

    const result = await PushTokenModel.deleteMany({
      deviceId: { $in: deviceIds },
    });

    const deletedCount = result.deletedCount || 0;

    pushTokenLogger.info("Tokens FCM invalides supprimés", {
      deviceIdsCount: deviceIds.length,
      deletedCount,
    });

    return deletedCount;
  } catch (error) {
    pushTokenLogger.error(
      "Erreur lors de la suppression des tokens FCM invalides",
      {
        deviceIdsCount: deviceIds.length,
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    throw error;
  }
}

/**
 * Nettoie les tokens FCM obsolètes (non mis à jour depuis N jours)
 * Utilisé par un cron job pour maintenir la base propre
 *
 * @param daysOld - Nombre de jours d'inactivité avant suppression (par défaut 90)
 * @returns Nombre de tokens supprimés
 */
export async function cleanupOldTokens(daysOld: number = 90): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await PushTokenModel.deleteMany({
      updatedAt: { $lt: cutoffDate },
    });

    const deletedCount = result.deletedCount || 0;

    pushTokenLogger.info("Tokens FCM obsolètes nettoyés", {
      daysOld,
      cutoffDate: cutoffDate.toISOString(),
      deletedCount,
    });

    return deletedCount;
  } catch (error) {
    pushTokenLogger.error("Erreur lors du nettoyage des tokens FCM obsolètes", {
      daysOld,
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default {
  registerToken,
  removeToken,
  getTokensByUserId,
  getTokensByUserIds,
  removeInvalidTokens,
  cleanupOldTokens,
};
