import express from "express";
import {
    setupTwoFactor,
    verifyAndEnableTwoFactor,
    disableTwoFactor,
    verifyTwoFactorLogin,
    regenerateRecoveryCodes,
    getTwoFactorStatus
} from "../controllers/twoFactorControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES 2FA (Authentification à deux facteurs)
// ═══════════════════════════════════════════════════════════════════════════

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
