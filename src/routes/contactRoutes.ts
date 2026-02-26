import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  addContact,
  listContacts,
  blockContact,
  deleteContact,
  getContactDetails,
  acceptContact,
  refuseContact,
} from "../controllers/contactControllers";

const router = express.Router();

// Toutes les routes sont protégées par authentification
router.use(authMiddleware);

/**
 * POST /contacts
 * Ajouter un contact via son code (@XXXXXX)
 * Body: { contactCode: "@129876" }
 */
router.post("/", addContact);

/**
 * GET /contacts
 * Lister tous les contacts de l'utilisateur
 * Query: status=pending|accepted (optionnel)
 */
router.get("/", listContacts);

/**
 * GET /contacts/:contactId
 * Obtenir les détails d'un contact spécifique
 */
router.get("/:contactId", getContactDetails);

/**
 * PATCH /contacts/:contactId/block
 * Bloquer ou débloquer un contact
 * Body: { isBlocked: true|false }
 */
router.patch("/:contactId/block", blockContact);

/**
 * DELETE /contacts/:contactId
 * Supprimer un contact
 */
router.delete("/:contactId", deleteContact);

/**
 * POST /contacts/:contactId/accept
 * Accepter une demande de contact
 */
router.post("/:contactId/accept", acceptContact);

/**
 * POST /contacts/:contactId/refuse
 * Refuser une demande de contact
 */
router.post("/:contactId/refuse", refuseContact);

export default router;
