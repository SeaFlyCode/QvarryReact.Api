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
