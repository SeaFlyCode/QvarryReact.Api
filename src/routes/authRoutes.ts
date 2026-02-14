import express from "express";
import {
    handleLoginUser,
    handleLogoutUser,
    handleRefreshToken,
    checkAuth,
    getWebSocketToken,
    handleForgotPassword,
    handleResetPassword,
    completeLoginAfter2FA,
} from "../controllers/authControllers";
import { handleManualSync } from "../controllers/syncController";
import { getUserSessions, revokeAllOtherSessions } from "../controllers/sessionControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { verifyTurnstileOptional } from "../middlewares/turnstileMiddleware";

const router = express.Router();

// Routes avec rate limiting (protection brute force) + Turnstile invisible
// Note: authLimiter est appliqué globalement dans server.ts pour /api/auth/login
router.post("/login", verifyTurnstileOptional, handleLoginUser);
router.post("/refresh", handleRefreshToken); // Pas de rate limit strict pour le refresh
router.post("/logout", authMiddleware, handleLogoutUser);
router.post("/sync", authMiddleware, handleManualSync);
router.get("/check", checkAuth); // Pas de authMiddleware ici, on vérifie juste le token
router.get("/ws-token", authMiddleware, getWebSocketToken); // Nouveau: obtenir un token WebSocket temporaire

// Réinitialisation de mot de passe
// Note: passwordResetLimiter est appliqué globalement dans server.ts
router.post("/forgot-password", handleForgotPassword);
router.post("/reset-password", handleResetPassword);

// Compléter le login après vérification 2FA
// Note: twoFactorLimiter est appliqué globalement dans server.ts
router.post("/complete-2fa-login", completeLoginAfter2FA);

// Gestion des sessions utilisateur
router.get("/sessions", authMiddleware, getUserSessions); // Liste des sessions actives
router.post("/sessions/revoke-all", authMiddleware, revokeAllOtherSessions); // Révoquer toutes les autres sessions

export default router;