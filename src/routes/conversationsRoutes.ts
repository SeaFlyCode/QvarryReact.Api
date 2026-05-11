import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  validateMuteBody,
  validatePinBody,
  validateBlockBody,
  validatePaginationQuery,
} from "../middlewares/conversationValidationMiddleware";
import {
  listConversations,
  createPrivateConversation,
  createGroupConversation,
  getConversationDetails,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  deleteGroup,
  updateGroupName,
  updateGroupMemberRole,
  markConversationAsRead,
  deleteConversation,
  adminDeleteConversationPermanent,
  // Nouvelles fonctionnalités
  muteConversation,
  unmuteConversation,
  archiveConversation,
  unarchiveConversation,
  listArchivedConversations,
  pinConversation,
  unpinConversation,
  markConversationAsUnread,
  unmarkConversationAsUnread,
  blockConversation,
  unblockConversation,
} from "../controllers/conversationsControllers";

const router = express.Router();

// Protéger toutes les routes avec l'authentification
router.use(authMiddleware);

/**
 * @swagger
 * /conversations:
 *   get:
 *     summary: Liste les conversations de l'utilisateur
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Liste paginée }
 *
 * /conversations/archived:
 *   get:
 *     summary: Liste les conversations archivées
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Liste paginée }
 *
 * /conversations/private:
 *   post:
 *     summary: Crée une conversation privée (1-to-1)
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId]
 *             properties:
 *               recipientId: { type: string }
 *     responses:
 *       201: { description: Conversation créée }
 *       409: { description: Conversation existe déjà }
 *
 * /conversations/group:
 *   post:
 *     summary: Crée une conversation de groupe
 *     description: §V3 broadcast WS group_member_added à chaque membre ajouté
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, memberIds]
 *             properties:
 *               name: { type: string }
 *               memberIds: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Groupe créé }
 *
 * /conversations/{id}:
 *   get:
 *     summary: Détails d'une conversation
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation }
 *       404: { description: Non trouvée ou non participant }
 *   delete:
 *     summary: Supprime une conversation (pour cet utilisateur)
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Supprimée } }
 *
 * /conversations/{id}/read:
 *   patch:
 *     summary: Marque tous les messages comme lus
 *     description: §V3 broadcast WS message_read à tous les participants
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Lus } }
 *
 * /conversations/{id}/mute:
 *   patch:
 *     summary: Mute la conversation (notifications désactivées)
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               duration: { type: integer, description: "Durée en ms (default: indéfini)" }
 *     responses: { 200: { description: Muted } }
 *
 * /conversations/{id}/archive:
 *   patch:
 *     summary: Archive la conversation
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Archivée } }
 *
 * /conversations/{id}/pin:
 *   patch:
 *     summary: Épingle la conversation en haut de la liste
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Épinglée } }
 *
 * /conversations/{id}/block:
 *   patch:
 *     summary: Bloque l'autre participant (conversation privée uniquement)
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Bloqué }
 *       400: { description: Non applicable (groupe) }
 *
 * /conversations/{id}/members:
 *   post:
 *     summary: Ajoute des membres à un groupe
 *     description: §V3 broadcast WS group_member_added pour chaque ajout
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [memberIds]
 *             properties:
 *               memberIds: { type: array, items: { type: string } }
 *     responses: { 200: { description: Membres ajoutés } }
 *
 * /conversations/{id}/leave:
 *   delete:
 *     summary: Quitte un groupe
 *     description: §V3 broadcast WS group_member_removed
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Quitté } }
 *
 * /conversations/{id}/name:
 *   patch:
 *     summary: Renomme un groupe
 *     description: §V3 broadcast WS group_name_changed
 *     tags: [Conversations]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses: { 200: { description: Renommé } }
 */
// Lister toutes les conversations de l'utilisateur
router.get("/", listConversations);

// Lister les conversations archivées
router.get("/archived", validatePaginationQuery, listArchivedConversations);

// Marquer tous les messages d'une conversation comme lus
router.patch("/:id/read", validateObjectId("id"), markConversationAsRead);

// Nouvelles options de gestion des conversations
router.patch(
  "/:id/mute",
  validateObjectId("id"),
  validateMuteBody,
  muteConversation,
);
router.patch("/:id/unmute", validateObjectId("id"), unmuteConversation);
router.patch("/:id/archive", validateObjectId("id"), archiveConversation);
router.patch("/:id/unarchive", validateObjectId("id"), unarchiveConversation);
router.patch(
  "/:id/pin",
  validateObjectId("id"),
  validatePinBody,
  pinConversation,
);
router.patch("/:id/unpin", validateObjectId("id"), unpinConversation);
router.patch(
  "/:id/mark-unread",
  validateObjectId("id"),
  markConversationAsUnread,
);
router.patch(
  "/:id/mark-read-flag",
  validateObjectId("id"),
  unmarkConversationAsUnread,
);
router.patch(
  "/:id/block",
  validateObjectId("id"),
  validateBlockBody,
  blockConversation,
);
router.patch("/:id/unblock", validateObjectId("id"), unblockConversation);

// Supprimer/Masquer une conversation (soft delete pour les conversations privées)
router.delete("/:id", validateObjectId("id"), deleteConversation);

// SEC-037: Suppression définitive (ADMIN uniquement)
router.delete(
  "/:id/permanent",
  validateObjectId("id"),
  adminMiddleware,
  adminDeleteConversationPermanent,
);

// Les routes suivantes sont commentées car non implémentées ou non fonctionnelles
router.post("/private", createPrivateConversation);
router.post("/group", createGroupConversation);
router.get("/:id", validateObjectId("id"), getConversationDetails);
router.post("/:id/members", validateObjectId("id"), addGroupMembers);
router.delete(
  "/:id/members/:userId",
  validateObjectId("id", "userId"),
  removeGroupMember,
);
router.delete("/:id/leave", validateObjectId("id"), leaveGroup);
router.delete("/:id/group", validateObjectId("id"), deleteGroup);
router.patch("/:id/name", validateObjectId("id"), updateGroupName);
router.patch("/:id/role", validateObjectId("id"), updateGroupMemberRole);

export default router;
