import express from "express";
import {
  handleCreateUser,
  handleGetAllUsers,
  handleGetUserById,
  handleDeleteUser,
  handleUpdateUser,
  handleVerifyEmailByCode,
  handleResendVerificationEmail,
} from "../controllers/userControllers";
import { verifyTurnstile } from "../middlewares/turnstileMiddleware";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = express.Router();

// Création de compte avec vérification Cloudflare Turnstile (anti-bot)
// PUBLIC - Nécessaire pour l'inscription
router.post("/", verifyTurnstile, handleCreateUser);

// Routes de vérification d'email - AVANT les routes avec :id pour éviter les conflits
// PUBLIC - Nécessaire pour l'inscription et la vérification d'email
router.post("/verify-email", handleVerifyEmailByCode);
router.post("/resend-verification", handleResendVerificationEmail);

// Liste des utilisateurs - ADMIN UNIQUEMENT (SEC-032)
router.get("/", authMiddleware, adminMiddleware, handleGetAllUsers);

// Routes avec paramètres dynamiques - APRÈS les routes spécifiques
// PROTÉGÉES - Nécessitent authentification (SEC-033, SEC-034, SEC-035)
router.get("/:id", authMiddleware, validateObjectId("id"), handleGetUserById);
router.delete("/:id", authMiddleware, validateObjectId("id"), handleDeleteUser);
router.put("/:id", authMiddleware, validateObjectId("id"), handleUpdateUser);

export default router;
