// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : sessions, heartbeats, contacts d'urgence
// Toutes les routes nécessitent authentification + vérification mobile
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import {
  handleSosActivate,
  handleSosHeartbeat,
  handleSosExtend,
  handleSosDeactivate,
  handleSosStatus,
  handleSosHistory,
  handleSosActiveSessions,
  handleSosConfirmSafe,
  handleSosCreateContact,
  handleSosGetContacts,
  handleSosUpdateContact,
  handleSosDeleteContact,
} from "../controllers/mobileSosControllers";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE COMMUN : Vérification plateforme + Auth + Rate Limit
// ═══════════════════════════════════════════════════════════════════════════

const mobileSosMiddleware = [
  verifyMobilePlatform,
  authMiddleware,
  mobileRateLimitMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SESSION SOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/activate
 * Activer une session SOS avant de descendre sous terre
 *
 * Headers requis:
 *   - Authorization: Bearer <accessToken>
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Body:
 *   {
 *     "expectedDuration": 120,          // Durée en minutes (15-480)
 *     "ficheId": "mongoId",             // Optionnel - site/fiche associé
 *     "note": "Galerie nord",           // Optionnel - note libre
 *     "lat": 48.8566,                   // Optionnel - latitude
 *     "lng": 2.3522,                    // Optionnel - longitude
 *     "accuracy": 10                    // Optionnel - précision GPS en mètres
 *   }
 *
 * Response 201:
 *   { success: true, session: { id, status, activatedAt, expiresAt, ... } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_DURATION, INVALID_DURATION, NO_EMERGENCY_CONTACTS
 *   - 401: UNAUTHORIZED
 *   - 409: SESSION_ALREADY_ACTIVE
 *   - 500: INTERNAL_ERROR
 */
router.post("/activate", ...mobileSosMiddleware, handleSosActivate);

/**
 * POST /api/mobile/sos/heartbeat
 * Envoyer un signe de vie (prolonge le timer de +15 minutes)
 *
 * Body:
 *   {
 *     "sessionId": "mongoId",           // Optionnel - prend la session active
 *     "lat": 48.8566,                   // Optionnel
 *     "lng": 2.3522,                    // Optionnel
 *     "accuracy": 10                    // Optionnel
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, status, expiresAt, heartbeatCount, ... } }
 *
 * Codes d'erreur:
 *   - 401: UNAUTHORIZED
 *   - 404: NO_ACTIVE_SESSION
 *   - 500: INTERNAL_ERROR
 */
router.post("/heartbeat", ...mobileSosMiddleware, handleSosHeartbeat);

/**
 * POST /api/mobile/sos/extend
 * Prolonger manuellement le timer
 *
 * Body:
 *   {
 *     "sessionId": "mongoId",           // Optionnel
 *     "additionalMinutes": 60           // Durée supplémentaire (15-480)
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, status, expiresAt, extensionCount, ... } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_DURATION, INVALID_EXTENSION_DURATION
 *   - 401: UNAUTHORIZED
 *   - 404: NO_ACTIVE_SESSION
 *   - 500: INTERNAL_ERROR
 */
router.post("/extend", ...mobileSosMiddleware, handleSosExtend);

/**
 * POST /api/mobile/sos/deactivate
 * Désactiver la session SOS (l'utilisateur est en sécurité)
 *
 * Body:
 *   {
 *     "sessionId": "mongoId"            // Optionnel
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, status, resolvedAt, resolvedBy } }
 *
 * Codes d'erreur:
 *   - 401: UNAUTHORIZED
 *   - 404: NO_ACTIVE_SESSION
 *   - 500: INTERNAL_ERROR
 */
router.post("/deactivate", ...mobileSosMiddleware, handleSosDeactivate);

/**
 * GET /api/mobile/sos/status
 * Obtenir le statut de la session SOS active
 *
 * Response 200:
 *   { success: true, active: boolean, session: {...} | null }
 */
router.get("/status", ...mobileSosMiddleware, handleSosStatus);

/**
 * GET /api/mobile/sos/history
 * Historique des sessions SOS passées
 *
 * Query params:
 *   - limit: number (max 50, défaut 20)
 *
 * Response 200:
 *   { success: true, sessions: [...], count: number }
 */
router.get("/history", ...mobileSosMiddleware, handleSosHistory);

/**
 * GET /api/mobile/sos/active
 * Sessions actives en escalade visibles par l'utilisateur (dashboard)
 * Retourne les sessions d'autres utilisateurs en stage 1+
 *
 * Response 200:
 *   { success: true, sessions: [...], count: number }
 */
router.get("/active", ...mobileSosMiddleware, handleSosActiveSessions);

/**
 * POST /api/mobile/sos/:sessionId/confirm-safe
 * Confirmer qu'un utilisateur est en sécurité (appelé par un autre utilisateur Qvarry)
 *
 * Response 200:
 *   { success: true, session: { id, status, resolvedAt, resolvedBy } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_SESSION_ID
 *   - 401: UNAUTHORIZED
 *   - 404: SESSION_NOT_FOUND
 *   - 500: INTERNAL_ERROR
 */
router.post(
  "/:sessionId/confirm-safe",
  ...mobileSosMiddleware,
  handleSosConfirmSafe,
);

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES CONTACTS D'URGENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/contacts
 * Créer un nouveau contact d'urgence (max 5 par utilisateur)
 *
 * Body:
 *   {
 *     "name": "Jean Dupont",
 *     "phone": "+33612345678",          // Format E.164 obligatoire
 *     "relationship": "Conjoint",       // Optionnel
 *     "isDefault": true                 // Optionnel
 *   }
 *
 * Response 201:
 *   { success: true, contact: { id, name, phone, relationship, isDefault } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_FIELDS, INVALID_PHONE_FORMAT, MAX_CONTACTS_REACHED
 *   - 401: UNAUTHORIZED
 *   - 409: DUPLICATE_PHONE
 *   - 500: INTERNAL_ERROR
 */
router.post("/contacts", ...mobileSosMiddleware, handleSosCreateContact);

/**
 * GET /api/mobile/sos/contacts
 * Lister les contacts d'urgence de l'utilisateur
 *
 * Response 200:
 *   { success: true, contacts: [...], count: number }
 */
router.get("/contacts", ...mobileSosMiddleware, handleSosGetContacts);

/**
 * PUT /api/mobile/sos/contacts/:id
 * Modifier un contact d'urgence
 *
 * Body: (tous les champs optionnels)
 *   { "name": "...", "phone": "+33...", "relationship": "...", "isDefault": true }
 *
 * Response 200:
 *   { success: true, contact: {...} }
 *
 * Codes d'erreur:
 *   - 400: INVALID_PHONE_FORMAT
 *   - 401: UNAUTHORIZED
 *   - 404: CONTACT_NOT_FOUND
 *   - 500: INTERNAL_ERROR
 */
router.put("/contacts/:id", ...mobileSosMiddleware, handleSosUpdateContact);

/**
 * DELETE /api/mobile/sos/contacts/:id
 * Supprimer un contact d'urgence
 *
 * Response 200:
 *   { success: true, message: "Contact d'urgence supprimé." }
 *
 * Codes d'erreur:
 *   - 401: UNAUTHORIZED
 *   - 404: CONTACT_NOT_FOUND
 *   - 500: INTERNAL_ERROR
 */
router.delete("/contacts/:id", ...mobileSosMiddleware, handleSosDeleteContact);

export default router;
