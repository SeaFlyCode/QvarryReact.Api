// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : sessions, heartbeats, contacts d'urgence
// Toutes les routes nécessitent authentification + vérification mobile
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import {
  handleSosActivate,
  handleSosHeartbeat,
  handleSosExtend,
  handleSosDeactivate,
  handleSosDeactivateByParam,
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
 *     "note": "Galerie nord",           // Optionnel - note libre
 *     "siteName": "Carrière de Pont-Réan", // Optionnel - nom du site/carrière
 *     "zone": "Galerie Nord",           // Optionnel - zone dans le site
 *     "depth": 150,                     // Optionnel - profondeur en mètres
 *     "lat": 48.8566,                   // Optionnel - latitude
 *     "lng": 2.3522,                    // Optionnel - longitude
 *     "accuracy": 10,                   // Optionnel - précision GPS en mètres
 *     "participantIds": ["userId1", "userId2"], // Optionnel - IDs des participants pour session de groupe
 *     "sessionContacts": {              // Optionnel - override des contacts pour cette session
 *       "permanentContactIds": ["id1", "id2"], // IDs des contacts permanents à utiliser
 *       "additionalContacts": [         // Contacts temporaires supplémentaires
 *         {
 *           "name": "Jean Dupont",
 *           "phone": "+33612345678",
 *           "relationship": "Collègue"
 *         }
 *       ]
 *     }
 *   }
 *
 * Response 201:
 *   { success: true, session: { id, status, activatedAt, expiresAt, participants, isGroupSession, ... } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_DURATION, INVALID_DURATION, NO_EMERGENCY_CONTACTS, INVALID_CONTACT_IDS, INVALID_PHONE_FORMAT, INVALID_PARTICIPANT_IDS
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
 *     "sessionId": "mongoId",            // Optionnel
 *     "scope": "self" | "all"            // Optionnel (défaut: "all") - "self" pour quitter seul, "all" pour désactiver pour tous
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
 *   { success: true, active: boolean, session: { ..., participants: [...], isGroupSession: boolean, creatorId: string } | null }
 */
router.get("/status", ...mobileSosMiddleware, handleSosStatus);

/**
 * GET /api/mobile/sos/history
 * Historique des sessions SOS passées avec statistiques enrichies
 *
 * Query params:
 *   - limit: number (max 50, défaut 20)
 *
 * Response 200:
 *   {
 *     success: true,
 *     sessions: [...],  // Sessions enrichies avec actualDuration et durationOverrun
 *     stats: {
 *       totalSessions: number,
 *       totalDuration: number,        // Minutes totales sous terre
 *       averageDuration: number,      // Durée moyenne en minutes
 *       longestSession: number,       // Plus longue session en minutes
 *       totalHeartbeats: number,      // Total de heartbeats
 *       escalationRate: number,       // % de sessions qui ont atteint l'escalade
 *       mostVisitedSites: [{ siteName: string, count: number }],
 *       lastSessionDate: Date | null
 *     },
 *     count: number
 *   }
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
 * POST /api/mobile/sos/:sessionId/deactivate
 * Désactiver une session SOS spécifique via son ID dans l'URL
 * Alternative à POST /api/mobile/sos/deactivate avec sessionId dans le body
 *
 * Body:
 *   {
 *     "scope": "self" | "all"            // Optionnel (défaut: "all")
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, status, resolvedAt, resolvedBy } }
 *
 * Codes d'erreur:
 *   - 400: MISSING_SESSION_ID
 *   - 401: UNAUTHORIZED
 *   - 404: NO_ACTIVE_SESSION
 *   - 500: INTERNAL_ERROR
 */
router.post(
  "/:sessionId/deactivate",
  ...mobileSosMiddleware,
  validateObjectId("sessionId"),
  handleSosDeactivateByParam,
);

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
  validateObjectId("sessionId"),
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
router.put(
  "/contacts/:id",
  ...mobileSosMiddleware,
  validateObjectId("id"),
  handleSosUpdateContact,
);

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
router.delete(
  "/contacts/:id",
  ...mobileSosMiddleware,
  validateObjectId("id"),
  handleSosDeleteContact,
);

export default router;
