// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PUSH TOKENS (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour la gestion des tokens de notification push
// Toutes les routes nécessitent authentification + vérification mobile
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  verifyMobilePlatform,
  mobileSyncRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
import {
  handleRegisterPushToken,
  handleDeletePushToken,
} from "../controllers/mobilePushTokenControllers";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE COMMUN : Vérification plateforme + Auth + Rate Limit (Permissif)
// ═══════════════════════════════════════════════════════════════════════════
// Rate limit permissif (60 req/15min en prod, 600 en dev) car :
// - Routes authentifiées (moins de risque d'abus)
// - Tokens push peuvent être réenregistrés fréquemment (reconnexions, updates)
// - Moins critique que les routes d'authentification

const mobilePushTokenMiddleware = [
  verifyMobilePlatform,
  appCheckMiddleware,
  authMiddleware,
  mobileSyncRateLimitMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PUSH TOKENS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /mobile/push-tokens:
 *   post:
 *     summary: Enregistre/met à jour un push token FCM ou Expo
 *     description: |
 *       Upsert par (userId, deviceId). Utilisé par notificationsService pour
 *       envoyer les push P0/P1/P2 (auth_revoked, contact_request, share_received…).
 *     tags: [Mobile, Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: X-Platform
 *         required: true
 *         schema: { type: string, enum: [ios, android] }
 *       - in: header
 *         name: X-Device-ID
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, example: 'ExponentPushToken[xxxx]' }
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   model: { type: string }
 *                   osVersion: { type: string }
 *                   appVersion: { type: string }
 *     responses:
 *       200: { description: Token enregistré }
 *       400: { description: MISSING_TOKEN ou INVALID_TOKEN_FORMAT }
 *   delete:
 *     summary: Supprime le push token (logout)
 *     tags: [Mobile, Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: X-Platform
 *         required: true
 *         schema: { type: string, enum: [ios, android] }
 *       - in: header
 *         name: X-Device-ID
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Supprimé }
 *       404: { description: TOKEN_NOT_FOUND }
 */

/**
 * POST /api/mobile/push-tokens
 * Enregistrer ou mettre à jour un token de notification push
 *
 * Headers requis:
 *   - Authorization: Bearer <accessToken>
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Body:
 *   {
 *     "token": "ExponentPushToken[xxxxxx]",  // Token Expo ou FCM
 *     "deviceInfo": {                        // Optionnel
 *       "model": "iPhone 14 Pro",
 *       "osVersion": "17.1",
 *       "appVersion": "1.0.0"
 *     }
 *   }
 *
 * Response 200:
 *   {
 *     success: true,
 *     message: "Token de notification enregistré avec succès.",
 *     pushToken: {
 *       id: string,
 *       userId: string,
 *       deviceId: string,
 *       platform: "ios" | "android",
 *       token: string,
 *       createdAt: Date,
 *       updatedAt: Date
 *     }
 *   }
 *
 * Codes d'erreur:
 *   - 400: MISSING_TOKEN, INVALID_TOKEN_FORMAT
 *   - 401: UNAUTHORIZED
 *   - 500: INTERNAL_ERROR
 */
router.post("/", ...mobilePushTokenMiddleware, handleRegisterPushToken);

/**
 * DELETE /api/mobile/push-tokens
 * Supprimer le token de notification push (lors de la déconnexion)
 *
 * Headers requis:
 *   - Authorization: Bearer <accessToken>
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Response 200:
 *   {
 *     success: true,
 *     message: "Token de notification supprimé avec succès."
 *   }
 *
 * Codes d'erreur:
 *   - 401: UNAUTHORIZED
 *   - 404: TOKEN_NOT_FOUND
 *   - 500: INTERNAL_ERROR
 */
router.delete("/", ...mobilePushTokenMiddleware, handleDeletePushToken);

export default router;
