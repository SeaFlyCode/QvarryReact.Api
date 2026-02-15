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
router.post("/login", verifyTurnstileOptional, handleLoginUser);

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
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *       401:
 *         description: Non authentifié
 */
router.post("/logout", authMiddleware, handleLogoutUser);

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

/**
 * @swagger
 * /auth/sessions:
 *   get:
 *     summary: Liste des sessions actives
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   sessionId:
 *                     type: string
 *                   deviceInfo:
 *                     type: string
 *                   lastActive:
 *                     type: string
 *                     format: date-time
 *                   isCurrent:
 *                     type: boolean
 *       401:
 *         description: Non authentifié
 */
router.get("/sessions", authMiddleware, getUserSessions);

/**
 * @swagger
 * /auth/sessions/revoke-all:
 *   post:
 *     summary: Révoquer toutes les autres sessions
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Sessions révoquées
 *       401:
 *         description: Non authentifié
 */
router.post("/sessions/revoke-all", authMiddleware, revokeAllOtherSessions);

export default router;