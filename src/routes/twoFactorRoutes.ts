import express from "express";
import {
  setupTwoFactor,
  verifyAndEnableTwoFactor,
  disableTwoFactor,
  verifyTwoFactorLogin,
  regenerateRecoveryCodes,
  getTwoFactorStatus,
} from "../controllers/twoFactorControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES 2FA (Authentification à deux facteurs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /2fa/status:
 *   get:
 *     summary: Statut 2FA de l'utilisateur connecté
 *     tags: [2FA]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled: { type: boolean }
 *                 method: { type: string, enum: [totp], description: V1 supporte uniquement TOTP (authenticator app) }
 *
 * /2fa/setup:
 *   post:
 *     summary: Initie la config 2FA (génère secret TOTP + QR code)
 *     description: Le user doit ensuite scanner le QR avec Google Authenticator / 1Password / etc.
 *     tags: [2FA]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qrCode: { type: string, format: byte, description: data:image/png;base64 }
 *                 secret: { type: string, description: Pour saisie manuelle si QR scan impossible }
 *       400: { description: 2FA déjà activé }
 *
 * /2fa/verify-setup:
 *   post:
 *     summary: Valide la config 2FA (vérifie le 1er code TOTP)
 *     tags: [2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, minLength: 6, maxLength: 6 }
 *     responses:
 *       200:
 *         description: 2FA activée + retour des codes de récupération
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 recoveryCodes: { type: array, items: { type: string }, description: 10 codes one-time à imprimer/stocker safe }
 *       400: { description: Code invalide }
 *
 * /2fa/disable:
 *   post:
 *     summary: Désactive 2FA (password + code 2FA requis)
 *     tags: [2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, code]
 *             properties:
 *               password: { type: string }
 *               code: { type: string, description: Code TOTP 6 chars OU recovery code }
 *     responses:
 *       200: { description: 2FA désactivée }
 *       401: { description: Password incorrect }
 *       400: { description: Code 2FA incorrect }
 *
 * /2fa/regenerate-codes:
 *   post:
 *     summary: Régénère les 10 codes de récupération (invalide les anciens)
 *     tags: [2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Nouveaux codes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recoveryCodes: { type: array, items: { type: string } }
 *
 * /2fa/verify:
 *   post:
 *     summary: Vérifie le code 2FA pendant le flow login
 *     description: |
 *       Endpoint legacy. Préférer POST /auth/complete-2fa (Vague 1 unifié) qui
 *       retourne {accessToken, refreshToken, user, tokenId} directement.
 *     tags: [2FA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tempToken, code]
 *             properties:
 *               tempToken: { type: string }
 *               code: { type: string, description: Code TOTP OU recovery code }
 *     responses:
 *       200: { description: 2FA validée + login complet }
 *       400: { description: Code invalide }
 *       401: { description: tempToken invalide ou expiré }
 *       429: { description: Trop de tentatives (Retry-After) }
 */
// Routes protégées (utilisateur connecté)
router.get("/status", authMiddleware, getTwoFactorStatus);
router.post("/setup", authMiddleware, setupTwoFactor);
router.post("/verify-setup", authMiddleware, verifyAndEnableTwoFactor);
router.post("/disable", authMiddleware, disableTwoFactor);
router.post("/regenerate-codes", authMiddleware, regenerateRecoveryCodes);

// Route pour la vérification 2FA pendant le login
// Note: twoFactorLimiter est appliqué globalement dans server.ts
router.post("/verify", verifyTwoFactorLogin);

export default router;
