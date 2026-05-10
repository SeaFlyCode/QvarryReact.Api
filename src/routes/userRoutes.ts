import express from "express";
import {
  handleCreateUser,
  handleGetAllUsers,
  handleGetUserById,
  handleGetMe,
  handleDeleteUser,
  handleUpdateUser,
  handleVerifyEmailByCode,
  handleResendVerificationEmail,
  handleGetNotificationPreferences,
  handleUpdateNotificationPreferences,
  handleUpdateMyLocation,
} from "../controllers/userControllers";
import { verifyTurnstile } from "../middlewares/turnstileMiddleware";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = express.Router();

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Création de compte (inscription)
 *     description: Public. Nécessite token Cloudflare Turnstile (cf-turnstile-response).
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name, surname]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 12, description: "12+ chars, maj/min/chiffre/spécial" }
 *               name: { type: string }
 *               surname: { type: string }
 *               cf-turnstile-response: { type: string, description: Token Cloudflare Turnstile }
 *     responses:
 *       201: { description: Compte créé (en attente vérif email + validation admin) }
 *       400: { description: Validation échouée (email blocklist, password faible, etc.) }
 *       409: { description: Email déjà utilisé }
 *       429: { description: Trop de tentatives (Retry-After header) }
 */
// Création de compte avec vérification Cloudflare Turnstile (anti-bot)
// PUBLIC - Nécessaire pour l'inscription
router.post("/", verifyTurnstile, handleCreateUser);

// Routes de vérification d'email - AVANT les routes avec :id pour éviter les conflits
// PUBLIC - Nécessaire pour l'inscription et la vérification d'email
router.post("/verify-email", handleVerifyEmailByCode);
router.post("/resend-verification", handleResendVerificationEmail);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Profil de l'utilisateur connecté
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User (sans champs sensibles, IPs filtrées)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401: { description: Non authentifié }
 *
 * /users/{id}:
 *   get:
 *     summary: Profil d'un utilisateur par ID
 *     description: Self ou admin uniquement (SEC-033)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { $ref: '#/components/schemas/User' }
 *       401: { description: Non authentifié }
 *       403: { description: Pas autorisé à voir ce profil }
 *       404: { description: User non trouvé }
 *   put:
 *     summary: Met à jour son profil
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               surname: { type: string }
 *               pseudo: { type: string }
 *               showPseudo: { type: boolean }
 *               password: { type: string, description: "Nouveau password (requires currentPassword)" }
 *               currentPassword: { type: string }
 *     responses:
 *       200: { description: Profil mis à jour }
 *       400: { description: Mot de passe actuel incorrect ou validation }
 *       401: { description: Non authentifié }
 *       404: { description: User non trouvé }
 */
// Profil de l'utilisateur connecté - AVANT /:id pour que "me" ne soit pas capturé par le param
// PROTÉGÉE - Nécessite authentification
router.get("/me", authMiddleware, handleGetMe);

// Préférences de notifications de l'utilisateur connecté
// PROTÉGÉES - AVANT /:id pour éviter conflit
router.get(
  "/me/notification-preferences",
  authMiddleware,
  handleGetNotificationPreferences,
);
router.patch(
  "/me/notification-preferences",
  authMiddleware,
  handleUpdateNotificationPreferences,
);

// Heartbeat de localisation — alimente le filtre géo broadcast SOS Stage 1
// PROTÉGÉ - AVANT /:id pour éviter conflit
router.patch("/me/location", authMiddleware, handleUpdateMyLocation);

// Liste des utilisateurs - ADMIN UNIQUEMENT (SEC-032)
router.get("/", authMiddleware, adminMiddleware, handleGetAllUsers);

// Routes avec paramètres dynamiques - APRÈS les routes spécifiques
// PROTÉGÉES - Nécessitent authentification (SEC-033, SEC-034, SEC-035)
router.get("/:id", authMiddleware, validateObjectId("id"), handleGetUserById);
router.delete("/:id", authMiddleware, validateObjectId("id"), handleDeleteUser);
router.put("/:id", authMiddleware, validateObjectId("id"), handleUpdateUser);

export default router;
