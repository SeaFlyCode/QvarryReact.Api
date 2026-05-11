// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTION ROUTES
// ═══════════════════════════════════════════════════════════════════════════
// Routes appelées depuis les boutons d'action des notifications mobiles.
// L'app peut être killed : tant que le JWT en SecureStore est valide, ces
// endpoints fonctionnent. Si le token est expiré, le mobile fallback en
// ouvrant l'app (gestion côté mobile, hors scope backend).
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  handleQuickActionSosConfirmSafe,
  handleQuickActionContactAccept,
  handleQuickActionContactRefuse,
  handleQuickActionShareAccept,
  handleQuickActionShareRefuse,
} from "../controllers/quickActionControllers";

const router = express.Router();

// Toutes les routes nécessitent une authentification standard JWT
router.use(authMiddleware);

/**
 * @swagger
 * /quick-action/sos/confirm-safe:
 *   post:
 *     summary: Action notif "Je suis en sécurité" (bouton push iOS/Android)
 *     description: |
 *       Endpoint invoqué directement depuis la notif (action button) même si
 *       l'app est killed. Tant que le JWT SecureStore est valide, on résout
 *       la session sans ouvrir l'app. Si JWT expiré → fallback ouverture app
 *       (handled mobile-side).
 *     tags: [QuickAction]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [sessionId], properties: { sessionId: { type: string } } }
 *     responses: { 200: { description: Session résolue } }
 *
 * /quick-action/contact/accept:
 *   post:
 *     summary: Action notif "Accepter" demande contact
 *     tags: [QuickAction]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [contactId], properties: { contactId: { type: string } } }
 *     responses: { 200: { description: Acceptée } }
 *
 * /quick-action/contact/refuse:
 *   post:
 *     summary: Action notif "Refuser" demande contact
 *     tags: [QuickAction]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [contactId], properties: { contactId: { type: string } } }
 *     responses: { 200: { description: Refusée } }
 *
 * /quick-action/share/accept:
 *   post:
 *     summary: Action notif "Accepter" partage de données
 *     tags: [QuickAction]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [shareId], properties: { shareId: { type: string } } }
 *     responses: { 200: { description: Accepté } }
 *
 * /quick-action/share/refuse:
 *   post:
 *     summary: Action notif "Refuser" partage de données
 *     tags: [QuickAction]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [shareId], properties: { shareId: { type: string } } }
 *     responses: { 200: { description: Refusé } }
 */

// ─── SOS ─────────────────────────────────────────────────────────────────
router.post("/sos/confirm-safe", handleQuickActionSosConfirmSafe);

// ─── Contact ─────────────────────────────────────────────────────────────
router.post("/contact/accept", handleQuickActionContactAccept);
router.post("/contact/refuse", handleQuickActionContactRefuse);

// ─── Share ───────────────────────────────────────────────────────────────
router.post("/share/accept", handleQuickActionShareAccept);
router.post("/share/refuse", handleQuickActionShareRefuse);

export default router;
