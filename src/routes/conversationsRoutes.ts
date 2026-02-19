import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
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
router.patch("/:id/read", markConversationAsRead);

// Supprimer/Masquer une conversation (soft delete pour les conversations privées)
router.delete("/:id", deleteConversation);

// SEC-037: Suppression définitive (ADMIN uniquement)
router.delete(
  "/:id/permanent",
  adminMiddleware,
  adminDeleteConversationPermanent,
);

// Les routes suivantes sont commentées car non implémentées ou non fonctionnelles
router.post("/private", createPrivateConversation);
router.post("/group", createGroupConversation);
router.get("/:id", getConversationDetails);
router.post("/:id/members", addGroupMembers);
router.delete("/:id/members/:userId", removeGroupMember);
router.delete("/:id/leave", leaveGroup);
router.delete("/:id/group", deleteGroup);
router.patch("/:id/name", updateGroupName);
router.patch("/:id/role", updateGroupMemberRole);

export default router;
