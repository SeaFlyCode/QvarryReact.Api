import express from "express";
import {
  handleShareData,
  handleGetSharedData,
  handleUpdateShareStatus,
  handleGetReceivedShares,
  handleGetSentShares,
} from "../controllers/dataShareControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

/**
 * @swagger
 * /share:
 *   post:
 *     summary: Partage une fiche/point/list avec un autre utilisateur
 *     description: |
 *       §V0 — Notif P2 envoyée au destinataire avec quick actions accept/decline.
 *       Cron `shareExpirationService` 9h/9h05 envoie rappel à expiration.
 *     tags: [DataShare]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId, resourceType, resourceId]
 *             properties:
 *               recipientId: { type: string }
 *               resourceType: { type: string, enum: [fiche, point, list] }
 *               resourceId: { type: string }
 *               expiresAt: { type: string, format: date-time }
 *               message: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: Partage créé + notif envoyée }
 *       400: { description: Validation échouée }
 *       404: { description: Resource non trouvée }
 *
 * /share/received:
 *   get:
 *     summary: Liste les partages reçus (en attente d'accept/decline)
 *     tags: [DataShare]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste paginée } }
 *
 * /share/sent:
 *   get:
 *     summary: Liste les partages envoyés
 *     tags: [DataShare]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste paginée } }
 *
 * /share/{shareId}:
 *   get:
 *     summary: Récupère le contenu d'un partage accepté
 *     description: Déchiffre les données pour le destinataire (clé RSA partagée).
 *     tags: [DataShare]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: shareId, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Resource déchiffrée }
 *       403: { description: Pas destinataire ou pas accepté }
 *       404: { description: Partage non trouvé ou expiré }
 *
 * /share/{shareId}/status:
 *   patch:
 *     summary: Accepte ou refuse un partage (quick action notif)
 *     tags: [DataShare]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: shareId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [accepted, refused] }
 *     responses:
 *       200: { description: Statut mis à jour }
 *       400: { description: Status invalide }
 */
// Partager des données
router.post("/", handleShareData);

// Lister les partages reçus
router.get("/received", handleGetReceivedShares);

// Lister les partages envoyés
router.get("/sent", handleGetSentShares);

// Récupérer un partage spécifique (déchiffrement)
router.get("/:shareId", validateObjectId("shareId"), handleGetSharedData);

// Accepter ou refuser un partage
router.patch(
  "/:shareId/status",
  validateObjectId("shareId"),
  handleUpdateShareStatus,
);

export default router;
