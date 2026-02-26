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
