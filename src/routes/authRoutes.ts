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
  handleAuthMe,
} from "../controllers/auth";
import {
  handleManualSync,
  handleSyncRefresh,
} from "../controllers/syncControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { verifyTurnstile } from "../middlewares/turnstileMiddleware";

const router = express.Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Connexion utilisateur
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: MonMotDePasse123!
 *               turnstileToken:
 *                 type: string
 *                 description: Token Cloudflare Turnstile (optionnel)
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Connexion réussie
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     username:
 *                       type: string
 *       401:
 *         description: Identifiants invalides
 *       429:
 *         description: Trop de tentatives de connexion
 */
router.post("/login", verifyTurnstile, handleLoginUser);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Rafraîchir le token d'accès
 *     tags: [Auth]
 *     description: Utilise le refresh token stocké dans les cookies pour obtenir un nouveau access token
 *     responses:
 *       200:
 *         description: Token rafraîchi avec succès
 *       401:
 *         description: Refresh token invalide ou expiré
 */
router.post("/refresh", handleRefreshToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Déconnexion utilisateur
 *     tags: [Auth]
 *     description: Nettoie les cookies d'authentification même si le token est invalide (évite les boucles après reload serveur)
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 */
router.post("/logout", handleLogoutUser);

/**
 * @swagger
 * /auth/sync:
 *   post:
 *     summary: Synchronisation manuelle des données
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Synchronisation réussie
 *       401:
 *         description: Non authentifié
 */
router.post("/sync", authMiddleware, handleManualSync);

/**
 * @swagger
 * /auth/sync/refresh:
 *   get:
 *     summary: Refresh incrémental - récupère les changements depuis le mobile
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Résultat du refresh
 *       401:
 *         description: Non authentifié
 *       409:
 *         description: Session mémoire non initialisée
 */
router.get("/sync/refresh", authMiddleware, handleSyncRefresh);

/**
 * @swagger
 * /auth/check:
 *   get:
 *     summary: Vérifier l'état d'authentification
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: État de l'authentification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authenticated:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   nullable: true
 */
router.get("/check", checkAuth);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Récupérer le profil de l'utilisateur connecté
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profil utilisateur complet (champs sensibles exclus)
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: Utilisateur non trouvé
 */
router.get("/me", authMiddleware, handleAuthMe);

/**
 * @swagger
 * /auth/ws-token:
 *   get:
 *     summary: Obtenir un token WebSocket temporaire
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token WebSocket généré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expiresIn:
 *                   type: number
 *       401:
 *         description: Non authentifié
 */
router.get("/ws-token", authMiddleware, getWebSocketToken);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Demander une réinitialisation de mot de passe
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email de réinitialisation envoyé (si le compte existe)
 *       429:
 *         description: Trop de tentatives
 */
router.post("/forgot-password", handleForgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Réinitialiser le mot de passe
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé avec succès
 *       400:
 *         description: Token invalide ou expiré
 */
router.post("/reset-password", handleResetPassword);

/**
 * @swagger
 * /auth/complete-2fa-login:
 *   post:
 *     summary: Compléter la connexion après vérification 2FA
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tempToken
 *               - totpCode
 *             properties:
 *               tempToken:
 *                 type: string
 *                 description: Token temporaire reçu lors du login
 *               totpCode:
 *                 type: string
 *                 description: Code TOTP à 6 chiffres
 *     responses:
 *       200:
 *         description: Connexion 2FA complétée
 *       401:
 *         description: Code TOTP invalide
 *       429:
 *         description: Trop de tentatives
 */
router.post("/complete-2fa-login", completeLoginAfter2FA);

export default router;
