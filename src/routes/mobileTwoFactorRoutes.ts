// ═══════════════════════════════════════════════════════════════════════════
// ROUTES 2FA POUR APPLICATIONS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints dédiés aux apps mobiles (iOS/Android)
// Utilise l'authentification JWT mobile au lieu des sessions web
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response, NextFunction } from "express";
import {
  mobileSetupTwoFactor,
  mobileVerifyAndEnableTwoFactor,
  mobileDisableTwoFactor,
  mobileVerifyTwoFactorLogin,
  mobileRegenerateRecoveryCodes,
  mobileGetTwoFactorStatus,
} from "../controllers/mobileTwoFactorControllers";
import { handleUnifiedComplete2FA } from "../controllers/auth/unifiedAuthController";
import { mobileAuthMiddleware } from "../middlewares/mobileAuthMiddleware";
import {
  verifyMobilePlatform,
  mobileSecurityMiddleware,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";

const router = express.Router();

/**
 * P1 — Marqueur "client mobile" pour le handler unifié.
 */
function markAsMobile(req: Request, _res: Response, next: NextFunction) {
  (req as any).clientType = "mobile";
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PROTÉGÉES (utilisateur connecté via JWT mobile)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /mobile/2fa/status:
 *   get:
 *     summary: Statut 2FA mobile
 *     tags: [Mobile, 2FA]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled: { type: boolean }
 *                 confirmedAt: { type: string, format: date-time, nullable: true }
 *                 recoveryCodesRemaining: { type: integer }
 *
 * /mobile/2fa/setup:
 *   post:
 *     summary: Initie config 2FA mobile (QR + secret)
 *     tags: [Mobile, 2FA]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ qrCode (data:image/png;base64), secret }' } }
 *
 * /mobile/2fa/verify-setup:
 *   post:
 *     summary: Valide config 2FA + retourne recovery codes
 *     tags: [Mobile, 2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [code], properties: { code: { type: string, minLength: 6, maxLength: 6 } } }
 *     responses: { 200: { description: '{ recoveryCodes: string[10] }' } }
 *
 * /mobile/2fa/disable:
 *   post:
 *     summary: Désactive 2FA mobile
 *     tags: [Mobile, 2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [password], properties: { password: { type: string }, code: { type: string } } }
 *     responses: { 200: { description: Désactivée } }
 *
 * /mobile/2fa/regenerate-codes:
 *   post:
 *     summary: Régénère les recovery codes
 *     tags: [Mobile, 2FA]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [password], properties: { password: { type: string } } }
 *     responses: { 200: { description: '{ recoveryCodes: string[10] }' } }
 *
 * /mobile/2fa/verify-login:
 *   post:
 *     summary: Complète le flow login 2FA (alias handler unifié)
 *     description: §V1 — Parité avec POST /auth/complete-2fa.
 *     tags: [Mobile, 2FA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tempToken, code]
 *             properties:
 *               tempToken: { type: string }
 *               code: { type: string }
 *               isRecoveryCode: { type: boolean }
 *     responses:
 *       200: { $ref: '#/components/schemas/AuthLoginResponse' }
 *       400: { description: Code invalide }
 *       429: { description: Rate limit (Retry-After) }
 */

/**
 * GET /api/mobile/2fa/status
 * Obtenir le statut de la 2FA pour l'utilisateur connecté
 *
 * Headers requis:
 *   - Authorization: Bearer <accessToken>
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Response:
 *   {
 *     "success": true,
 *     "enabled": boolean,
 *     "confirmedAt": string | null,
 *     "recoveryCodesRemaining": number
 *   }
 */
router.get(
  "/status",
  verifyMobilePlatform,
  appCheckMiddleware,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  mobileGetTwoFactorStatus,
);

/**
 * POST /api/mobile/2fa/setup
 * Initier la configuration de la 2FA
 *
 * Headers requis: (mêmes que status)
 *
 * Response:
 *   {
 *     "success": true,
 *     "qrCode": "data:image/png;base64,...",
 *     "secret": "JBSWY3DPEHPK3PXP",
 *     "message": "..."
 *   }
 */
router.post(
  "/setup",
  verifyMobilePlatform,
  appCheckMiddleware,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  mobileSetupTwoFactor,
);

/**
 * POST /api/mobile/2fa/verify-setup
 * Vérifier le code TOTP et activer la 2FA
 *
 * Headers requis: (mêmes que status)
 *
 * Body:
 *   - code: string (6 chiffres)
 *
 * Response:
 *   {
 *     "success": true,
 *     "recoveryCodes": ["XXXX-XXXX-XXXX", ...],
 *     "message": "..."
 *   }
 */
router.post(
  "/verify-setup",
  verifyMobilePlatform,
  appCheckMiddleware,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  mobileVerifyAndEnableTwoFactor,
);

/**
 * POST /api/mobile/2fa/disable
 * Désactiver la 2FA
 *
 * Headers requis: (mêmes que status)
 *
 * Body:
 *   - password: string (mot de passe du compte)
 *   - code: string (code TOTP ou code de récupération, optionnel)
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "..."
 *   }
 */
router.post(
  "/disable",
  verifyMobilePlatform,
  appCheckMiddleware,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  mobileDisableTwoFactor,
);

/**
 * POST /api/mobile/2fa/regenerate-codes
 * Régénérer les codes de récupération
 *
 * Headers requis: (mêmes que status)
 *
 * Body:
 *   - password: string (mot de passe du compte)
 *
 * Response:
 *   {
 *     "success": true,
 *     "recoveryCodes": ["XXXX-XXXX-XXXX", ...],
 *     "message": "..."
 *   }
 */
router.post(
  "/regenerate-codes",
  verifyMobilePlatform,
  appCheckMiddleware,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  mobileRegenerateRecoveryCodes,
);

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PUBLIQUES (pendant le login)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/2fa/verify-login
 * Vérifier le code 2FA pendant le processus de login
 * Appelé après que /api/mobile/auth/login retourne requiresTwoFactor: true
 *
 * Headers requis:
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Body:
 *   - userId: string (retourné par /api/mobile/auth/login)
 *   - code: string (code TOTP ou code de récupération)
 *   - isRecoveryCode: boolean (true si c'est un code de récupération)
 *
 * Response (succès):
 *   {
 *     "success": true,
 *     "verified": true,
 *     "userId": "...",
 *     "email": "...",
 *     "isAdmin": boolean,
 *     "accessToken": "...",
 *     "refreshToken": "...",
 *     "tokenExpiresIn": number,
 *     "refreshTokenExpiresIn": number
 *   }
 */
// P1 — verify-login devient un alias du handler unifié.
// Conserve les middlewares mobile (sécurité, App Check) mais utilise le même
// handler que /api/v1/auth/complete-2fa pour la parité web/mobile.
router.post(
  "/verify-login",
  mobileSecurityMiddleware,
  appCheckMiddleware,
  markAsMobile,
  handleUnifiedComplete2FA,
);

// Rétro-compat : ancien handler 2FA mobile dédié. À supprimer après migration.
router.post(
  "/verify-login-legacy",
  mobileSecurityMiddleware,
  appCheckMiddleware,
  mobileVerifyTwoFactorLogin,
);

export default router;
