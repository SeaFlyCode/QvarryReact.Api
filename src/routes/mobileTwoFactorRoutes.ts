// ═══════════════════════════════════════════════════════════════════════════
// ROUTES 2FA POUR APPLICATIONS MOBILES
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints dédiés aux apps mobiles (iOS/Android)
// Utilise l'authentification JWT mobile au lieu des sessions web
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import {
  mobileSetupTwoFactor,
  mobileVerifyAndEnableTwoFactor,
  mobileDisableTwoFactor,
  mobileVerifyTwoFactorLogin,
  mobileRegenerateRecoveryCodes,
  mobileGetTwoFactorStatus,
} from "../controllers/mobileTwoFactorControllers";
import { mobileAuthMiddleware } from "../middlewares/mobileAuthMiddleware";
import {
  verifyMobilePlatform,
  mobileSecurityMiddleware,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PROTÉGÉES (utilisateur connecté via JWT mobile)
// ═══════════════════════════════════════════════════════════════════════════

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
router.post(
  "/verify-login",
  mobileSecurityMiddleware,
  appCheckMiddleware,
  mobileVerifyTwoFactorLogin,
);

export default router;
