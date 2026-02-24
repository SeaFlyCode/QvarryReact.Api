// ═══════════════════════════════════════════════════════════════════════════
// ROUTES D'AUTHENTIFICATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Routes dédiées aux applications mobiles (iOS/Android)
// Utilise des protections alternatives à Turnstile (non compatible mobile)
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import {
  handleMobileLogin,
  handleMobileRegister,
  handleMobileForgotPassword,
  handleMobileRefreshToken,
} from "../controllers/mobileAuthControllers";
import { handleLogoutUser } from "../controllers/auth/logoutController";
import {
  mobileSecurityMiddleware,
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";

const router = express.Router();

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
 */
router.post("/login", mobileSecurityMiddleware, handleMobileLogin);

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
 */
router.post("/register", mobileSecurityMiddleware, handleMobileRegister);

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
router.post("/logout", handleLogoutUser);

export default router;
