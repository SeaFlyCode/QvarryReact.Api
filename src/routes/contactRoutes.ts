import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
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
 * @swagger
 * /contacts:
 *   get:
 *     summary: Liste les contacts de l'utilisateur
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, accepted] }
 *     responses:
 *       200: { description: Liste paginée }
 *   post:
 *     summary: Ajoute un contact via son code @XXXXXX
 *     description: Émet push P2 au destinataire (channel notifications).
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contactCode]
 *             properties:
 *               contactCode: { type: string, pattern: '^@[0-9]{6}$', example: '@129876' }
 *     responses:
 *       201: { description: Demande envoyée }
 *       404: { description: Contact code non trouvé }
 *       409: { description: Déjà contact }
 *
 * /contacts/{contactId}:
 *   get:
 *     summary: Détails d'un contact
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: contactId, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Contact }
 *       404: { description: Non trouvé }
 *   delete:
 *     summary: Supprime un contact
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: contactId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Supprimé } }
 *
 * /contacts/{contactId}/accept:
 *   post:
 *     summary: Accepte une demande de contact (quick action notif Vague 0)
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: contactId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Accepté } }
 *
 * /contacts/{contactId}/refuse:
 *   post:
 *     summary: Refuse une demande de contact (quick action notif)
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: contactId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Refusé } }
 *
 * /contacts/{contactId}/block:
 *   patch:
 *     summary: Bloque/débloque un contact
 *     tags: [Contacts]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: contactId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isBlocked]
 *             properties:
 *               isBlocked: { type: boolean }
 *     responses: { 200: { description: Statut mis à jour } }
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
router.get("/:contactId", validateObjectId("contactId"), getContactDetails);

/**
 * PATCH /contacts/:contactId/block
 * Bloquer ou débloquer un contact
 * Body: { isBlocked: true|false }
 */
router.patch("/:contactId/block", validateObjectId("contactId"), blockContact);

/**
 * DELETE /contacts/:contactId
 * Supprimer un contact
 */
router.delete("/:contactId", validateObjectId("contactId"), deleteContact);

/**
 * POST /contacts/:contactId/accept
 * Accepter une demande de contact
 */
router.post("/:contactId/accept", validateObjectId("contactId"), acceptContact);

/**
 * POST /contacts/:contactId/refuse
 * Refuser une demande de contact
 */
router.post("/:contactId/refuse", validateObjectId("contactId"), refuseContact);

export default router;
