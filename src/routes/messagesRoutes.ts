import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  sendMessage,
  getMessages,
  markMessageAsRead,
  markMessagesAsRead,
  replyToMessage,
  editMessage,
  deleteMessage,
} from "../controllers/messagesControllers";

const router = express.Router();
router.use(authMiddleware); // Toutes les routes sont protégées

/**
 * @swagger
 * /messages:
 *   post:
 *     summary: Envoie un message dans une conversation
 *     description: §V3 broadcast WS new_message à tous les participants (filtre sender côté serveur).
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [conversationId, content]
 *             properties:
 *               conversationId: { type: string }
 *               content: { type: string, description: Chiffré côté client recommandé }
 *               replyTo: { type: string, description: ID du message parent (thread) }
 *     responses:
 *       201: { description: Message envoyé }
 *       403: { description: Non participant à la conversation }
 *
 * /messages/{conversationId}:
 *   get:
 *     summary: Liste les messages d'une conversation
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: before
 *         schema: { type: string, format: date-time, description: Cursor pagination }
 *     responses:
 *       200: { description: Liste paginée chronologique }
 *       403: { description: Non participant }
 *
 * /messages/read-batch:
 *   post:
 *     summary: Marque plusieurs messages comme lus
 *     description: §V3 broadcast WS message_read à tous les participants
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messageIds]
 *             properties:
 *               messageIds: { type: array, items: { type: string } }
 *     responses: { 200: { description: Marqués lus } }
 *
 * /messages/{messageId}/read:
 *   patch:
 *     summary: Marque un message comme lu
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: messageId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Marqué lu } }
 *
 * /messages/{messageId}/reply:
 *   post:
 *     summary: Répond à un message (thread)
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: messageId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses: { 201: { description: Réponse envoyée } }
 *
 * /messages/{messageId}:
 *   patch:
 *     summary: Édite un message (auteur uniquement)
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: messageId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       200: { description: Édité }
 *       403: { description: Pas l'auteur }
 *   delete:
 *     summary: Supprime un message (auteur uniquement, soft-delete)
 *     tags: [Messages]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: messageId, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Supprimé }
 *       403: { description: Pas l'auteur }
 */
// Envoyer un message
router.post("/", sendMessage);

// Marquer plusieurs messages comme lus (batch) - DOIT être avant /:conversationId
router.post("/read-batch", markMessagesAsRead);

// Lister les messages d'une conversation
router.get("/:conversationId", validateObjectId("conversationId"), getMessages);

// Marquer un message comme lu
router.patch(
  "/:messageId/read",
  validateObjectId("messageId"),
  markMessageAsRead,
);

// Répondre à un message (thread)
router.post("/:messageId/reply", validateObjectId("messageId"), replyToMessage);

// Modifier un message
router.patch("/:messageId", validateObjectId("messageId"), editMessage);

// Supprimer un message
router.delete("/:messageId", validateObjectId("messageId"), deleteMessage);

export default router;
