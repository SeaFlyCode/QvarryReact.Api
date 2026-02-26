import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
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
} from "../controllers/conversationsControllers";

const router = express.Router();

// Protéger toutes les routes avec l'authentification
router.use(authMiddleware);

// Lister toutes les conversations de l'utilisateur
router.get("/", listConversations);

// Marquer tous les messages d'une conversation comme lus
router.patch("/:id/read", validateObjectId("id"), markConversationAsRead);

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
