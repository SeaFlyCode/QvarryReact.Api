// server/src/routes/securityRoutes.ts
import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  getUserSessions,
  revokeSession,
  getSecurityEvents,
} from "../controllers/securityControllers";
import { revokeAllOtherSessions } from "../controllers/sessionControllers";

const router = express.Router();

// Toutes les routes de sécurité nécessitent une authentification
router.use(authMiddleware);

/**
 * @swagger
 * /security/sessions:
 *   get:
 *     summary: Liste les sessions actives de l'utilisateur
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des sessions (avec isCurrent flag)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tokenId: { type: string }
 *                       ipAddress: { type: string }
 *                       userAgent: { type: string }
 *                       createdAt: { type: string, format: date-time }
 *                       lastUsedAt: { type: string, format: date-time }
 *                       expiresAt: { type: string, format: date-time }
 *                       isCurrent: { type: boolean }
 *       401: { description: Non authentifié }
 */
router.get("/sessions", getUserSessions);

/**
 * @swagger
 * /security/sessions/{tokenId}:
 *   delete:
 *     summary: Révoque une session précise (force logout sur ce device)
 *     description: |
 *       §Vague 4 — Le backend broadcast un event WS `session_revoked` sur tous les
 *       sockets du user. Le client dont le tokenId match se déconnecte
 *       immédiatement (Alert RN / forceSessionExpiration web).
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema: { type: string, pattern: '^[a-f0-9]{32}$' }
 *     responses:
 *       200: { description: Session révoquée + event WS émis }
 *       400: { description: tokenId invalide OU tentative de révoquer la session courante }
 *       401: { description: Non authentifié }
 *       404: { description: Session non trouvée }
 */
// DELETE /api/security/sessions/:tokenId - Révoquer une session spécifique
router.delete(
  "/sessions/:tokenId",
  (req, res, next) => {
    const tokenId = req.params.tokenId;
    if (!tokenId || !/^[a-f0-9]{32}$/.test(tokenId)) {
      return res.status(400).json({ error: "ID de session invalide" });
    }
    next();
  },
  revokeSession,
);

/**
 * @swagger
 * /security/sessions/revoke-all:
 *   post:
 *     summary: Révoque toutes les sessions sauf la courante
 *     description: |
 *       §Vague 4 — Broadcast WS session_revoked avec revokedTokenId="all".
 *       Le device émetteur peut éviter sa propre déconnexion en posant un flag
 *       local "ignore-next-session-revoked-all" 5s avant l'appel (cf. Vague 9
 *       client refinements).
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, description: Mot de passe pour confirmation }
 *     responses:
 *       200:
 *         description: Sessions révoquées + event WS émis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 revokedCount: { type: integer }
 *       401: { description: Mot de passe incorrect ou non authentifié }
 */
router.post("/sessions/revoke-all", revokeAllOtherSessions);

/**
 * @swagger
 * /security/events:
 *   get:
 *     summary: Liste les événements de sécurité récents
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Liste des événements }
 *       401: { description: Non authentifié }
 */
router.get("/events", getSecurityEvents);

export default router;
