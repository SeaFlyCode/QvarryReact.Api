import express from "express";
import {
    handleCreateUser,
    handleGetAllUsers,
    handleGetUserById,
    handleDeleteUser,
    handleUpdateUser,
    handleVerifyEmailByCode,
    handleResendVerificationEmail
} from "../controllers/userControllers";
import { verifyTurnstile } from "../middlewares/turnstileMiddleware";

const router = express.Router();

// Création de compte avec vérification Cloudflare Turnstile (anti-bot)
router.post("/", verifyTurnstile, handleCreateUser);

router.get("/", handleGetAllUsers);

// Routes de vérification d'email - AVANT les routes avec :id pour éviter les conflits
router.post("/verify-email", handleVerifyEmailByCode);
router.post("/resend-verification", handleResendVerificationEmail);

// Routes avec paramètres dynamiques - APRÈS les routes spécifiques
router.get("/:id", handleGetUserById);
router.delete("/:id", handleDeleteUser);
router.put("/:id", handleUpdateUser);

export default router;
