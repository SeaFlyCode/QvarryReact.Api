// ═══════════════════════════════════════════════════════════════════════════
// ROUTES D'AUTHENTIFICATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Routes dédiées aux applications mobiles (iOS/Android)
// Utilise des protections alternatives à Turnstile (non compatible mobile)
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response, NextFunction } from "express";
import {
  handleMobileLogin,
  handleMobileRegister,
  handleMobileForgotPassword,
  handleMobileRefreshToken,
  handleMobileGetMe,
} from "../controllers/mobileAuthControllers";
import { handleLogoutUser } from "../controllers/auth/logoutController";
import { handleUnifiedLogin } from "../controllers/auth/unifiedAuthController";
import {
  mobileSecurityMiddleware,
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { mobileAuthMiddleware } from "../middlewares/mobileAuthMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
import {
  mobileAttestationLimiter,
  mobileAttestationByDeviceLimiter,
} from "../config/rateLimitConfig";

const router = express.Router();

/**
 * P1 — Marqueur "client mobile" pour le handler unifié.
 * Le handler unifié détecte le client via ce flag (priorité) ou via mobileContext.
 */
function markAsMobile(req: Request, _res: Response, next: NextFunction) {
  (req as any).clientType = "mobile";
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PUBLIQUES (protégées par sécurité mobile)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/auth/login
 * Connexion utilisateur depuis l'app mobile
 *
 * Headers requis:
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *   - X-App-Version: Version de l'app (optionnel)
 *   - X-Device-Attestation: Token d'attestation (optionnel)
 *
 * Body:
 *   - email: string
 *   - password: string
 *
 * HIGH-003: Double rate limiting (IP + Device) pour sécuriser l'attestation
 */
/**
 * @swagger
 * /mobile/auth/login:
 *   post:
 *     summary: Login mobile (alias handler unifié /auth/login)
 *     description: |
 *       §V1 — Parité totale avec POST /auth/login (même handler). Différence :
 *       middlewares mobile en amont (App Check Firebase + attestation iOS App
 *       Attest / Android Play Integrity + rate limit par IP + par deviceId).
 *       Réponse identique : { accessToken, refreshToken, user, requires2FA?, tempToken?, tokenId }
 *     tags: [Mobile Auth]
 *     parameters:
 *       - in: header
 *         name: X-Platform
 *         required: true
 *         schema: { type: string, enum: [ios, android] }
 *       - in: header
 *         name: X-Device-ID
 *         required: true
 *         schema: { type: string, description: UUID device }
 *       - in: header
 *         name: X-Firebase-AppCheck
 *         schema: { type: string, description: Token App Check (si APP_CHECK_ENABLED=true) }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200: { $ref: '#/components/schemas/AuthLoginResponse' }
 *       400: { description: Validation échouée }
 *       401: { description: Credentials invalides }
 *       403: { description: 'Codes : BLOCKED / UNVERIFIED / PENDING_VALIDATION / UNAUTHORIZED' }
 *       429: { description: Rate limit (3/h par IP, 5/jour par deviceId) }
 *
 * /mobile/auth/register:
 *   post:
 *     summary: Inscription mobile
 *     tags: [Mobile Auth]
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
 *       201: { description: Compte créé }
 *       400: { description: Validation }
 *       409: { description: Email déjà utilisé }
 *
 * /mobile/auth/forgot-password:
 *   post:
 *     summary: Demande reset password (envoie email)
 *     tags: [Mobile Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [email], properties: { email: { type: string, format: email } } }
 *     responses: { 200: { description: Email envoyé (idempotent) } }
 *
 * /mobile/auth/refresh:
 *   post:
 *     summary: Rotation access + refresh tokens
 *     description: §V9 retourne `tokenId` (nouveau jti) pour sync sessionStorage client.
 *     tags: [Mobile Auth]
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
 *           schema: { type: object, required: [refreshToken], properties: { refreshToken: { type: string } } }
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 accessToken: { type: string }
 *                 refreshToken: { type: string }
 *                 tokenExpiresIn: { type: integer }
 *                 refreshTokenExpiresIn: { type: integer }
 *                 tokenId: { type: string, description: §V9 jti nouveau JWT }
 *       401: { description: Refresh token invalide ou expiré }
 *
 * /mobile/auth/logout:
 *   post:
 *     summary: Logout mobile (révoque le refresh token)
 *     tags: [Mobile Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Déconnecté } }
 *
 * /mobile/auth/me:
 *   get:
 *     summary: Profil utilisateur connecté (mobile)
 *     tags: [Mobile Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { $ref: '#/components/schemas/User' }
 *       401: { description: Non authentifié }
 */
// P1 — Login mobile : alias du handler unifié.
// Garde tous les middlewares de sécurité mobile (App Check, attestation, etc.)
// mais utilise le même handler que /api/v1/auth/login pour garantir la parité
// web/mobile (shape de réponse, codes 403, gestion 2FA…).
router.post(
  "/login",
  appCheckMiddleware,
  mobileAttestationLimiter, // ✅ Par IP (3/heure)
  mobileAttestationByDeviceLimiter, // ✅ Par deviceId (5/jour)
  mobileSecurityMiddleware,
  markAsMobile,
  handleUnifiedLogin,
);

// Rétro-compat : ancien handler mobile dédié, gardé pour permettre une bascule
// progressive (l'app mobile pourra basculer sur /api/v1/auth/login dans une PR
// suivante). À supprimer après migration.
router.post(
  "/login-legacy",
  appCheckMiddleware,
  mobileAttestationLimiter,
  mobileAttestationByDeviceLimiter,
  mobileSecurityMiddleware,
  handleMobileLogin,
);

/**
 * POST /api/mobile/auth/register
 * Création de compte depuis l'app mobile
 *
 * Headers requis: (mêmes que login)
 *
 * Body:
 *   - name: string
 *   - surname: string
 *   - email: string
 *   - password: string
 *
 * HIGH-003: Double rate limiting (IP + Device) pour sécuriser l'attestation
 */
router.post(
  "/register",
  appCheckMiddleware,
  mobileAttestationLimiter, // ✅ Par IP (3/heure)
  mobileAttestationByDeviceLimiter, // ✅ Par deviceId (5/jour)
  mobileSecurityMiddleware,
  handleMobileRegister,
);

/**
 * POST /api/mobile/auth/forgot-password
 * Demande de réinitialisation de mot de passe
 *
 * Headers requis: (mêmes que login)
 *
 * Body:
 *   - email: string
 */
router.post(
  "/forgot-password",
  mobileSecurityMiddleware,
  handleMobileForgotPassword,
);

/**
 * POST /api/mobile/auth/refresh
 * Rafraîchissement du token JWT
 * Rate limiting plus souple car déjà authentifié
 *
 * Headers requis:
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Body:
 *   - refreshToken: string
 */
router.post(
  "/refresh",
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
  handleMobileRefreshToken,
);

/**
 * POST /api/mobile/auth/logout
 * Déconnexion depuis l'app mobile
 * Pas de middleware d'authentification pour éviter les blocages si le token est invalide
 * Le token est extrait du header Authorization et décodé manuellement dans le handler
 *
 * Headers requis:
 *   - Authorization: Bearer <token>
 *
 * Note: Utilise le même handler que la route web (/api/auth/logout)
 */
router.post(
  "/logout",
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
  handleLogoutUser,
);

/**
 * GET /api/mobile/auth/me
 * Récupération du profil de l'utilisateur mobile connecté
 * Route dédiée mobile, exempte de CSRF — utilise mobileAuthMiddleware
 *
 * Headers requis:
 *   - X-Platform: ios | android
 *   - Authorization: Bearer <token>
 */
router.get(
  "/me",
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
  mobileAuthMiddleware,
  handleMobileGetMe,
);

export default router;
