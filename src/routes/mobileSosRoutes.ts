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
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
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
  handleSosAddParticipant,
  handleSosRemoveParticipant,
} from "../controllers/mobileSosControllers";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE COMMUN : Vérification plateforme + Auth + Rate Limit
// ═══════════════════════════════════════════════════════════════════════════

const mobileSosMiddleware = [
  appCheckMiddleware,
  verifyMobilePlatform,
  authMiddleware,
  mobileRateLimitMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER SPÉCIFIQUE POUR OPÉRATIONS SOS CRITIQUES
// ═══════════════════════════════════════════════════════════════════════════
// Les opérations critiques (heartbeat, extend, deactivate, status) nécessitent
// un rate limit plus élevé car le heartbeat est envoyé toutes les 60 secondes.
// 30 requêtes / 15 min permet : 15 heartbeats + extensions + checks de statut

interface SosRateLimitEntry {
  count: number;
  firstAttempt: Date;
  blockedUntil?: Date;
}

const isProduction = process.env.NODE_ENV === "production";
const DEV_MULTIPLIER = 10;

// Rate limiting pour opérations SOS critiques
const SOS_CRITICAL_MAX_REQUESTS_BASE = 30; // 30 en prod, 300 en dev
const SOS_CRITICAL_WINDOW_MINUTES = 15;
const SOS_CRITICAL_BLOCK_MINUTES = 30;

const SOS_CRITICAL_MAX_REQUESTS = isProduction
  ? SOS_CRITICAL_MAX_REQUESTS_BASE
  : SOS_CRITICAL_MAX_REQUESTS_BASE * DEV_MULTIPLIER;
const SOS_CRITICAL_WINDOW_MS = SOS_CRITICAL_WINDOW_MINUTES * 60 * 1000;
const SOS_CRITICAL_BLOCK_DURATION_MS = SOS_CRITICAL_BLOCK_MINUTES * 60 * 1000;

const sosCriticalRateLimitStore = new Map<string, SosRateLimitEntry>();

// Nettoyage périodique des entrées expirées pour éviter un memory leak.
// Une entrée est considérée expirée si :
// - elle est bloquée et le blocage est terminé, OU
// - sa fenêtre de temps est écoulée (et elle n'est pas bloquée)
const sosCriticalRateLimitCleanup = setInterval(() => {
  const now = new Date();
  for (const [key, entry] of sosCriticalRateLimitStore.entries()) {
    const windowExpired =
      now.getTime() - entry.firstAttempt.getTime() > SOS_CRITICAL_WINDOW_MS;
    const blockExpired =
      entry.blockedUntil !== undefined && entry.blockedUntil <= now;
    const notBlocked = entry.blockedUntil === undefined;

    if ((notBlocked && windowExpired) || blockExpired) {
      sosCriticalRateLimitStore.delete(key);
    }
  }
}, 30 * 60 * 1000); // toutes les 30 minutes
sosCriticalRateLimitCleanup.unref();

/**
 * Génère un identifiant composite pour le rate limiting SOS (IP + Device)
 */
function getSosIdentifier(req: express.Request): string {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const deviceId = (req.headers["x-device-id"] as string) || "no-device";
  return `sos_critical_${ip}_${deviceId}`;
}

/**
 * Rate limiter spécifique pour les opérations SOS critiques
 * Permet 30 requêtes / 15 min pour supporter le heartbeat (60s) + autres ops
 */
const sosCriticalRateLimiter = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const identifier = getSosIdentifier(req);
  const now = new Date();

  const entry = sosCriticalRateLimitStore.get(identifier);

  if (!entry) {
    sosCriticalRateLimitStore.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
    return next();
  }

  // Vérifier si bloqué
  if (entry.blockedUntil && entry.blockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (entry.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return res.status(429).json({
      error: `Trop de tentatives SOS. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
      code: "SOS_RATE_LIMIT_EXCEEDED",
      retryAfter: remainingMinutes * 60,
    });
  }

  // Réinitialiser la fenêtre si expirée
  const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
  if (timeSinceFirst > SOS_CRITICAL_WINDOW_MS) {
    sosCriticalRateLimitStore.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
    return next();
  }

  // Incrémenter le compteur
  entry.count++;

  // Bloquer si limite dépassée
  if (entry.count > SOS_CRITICAL_MAX_REQUESTS) {
    entry.blockedUntil = new Date(
      now.getTime() + SOS_CRITICAL_BLOCK_DURATION_MS,
    );
    sosCriticalRateLimitStore.set(identifier, entry);

    return res.status(429).json({
      error: `Trop de tentatives SOS. Bloqué pour ${SOS_CRITICAL_BLOCK_DURATION_MS / 60000} minutes.`,
      code: "SOS_RATE_LIMIT_EXCEEDED",
      retryAfter: SOS_CRITICAL_BLOCK_DURATION_MS / 1000,
    });
  }

  sosCriticalRateLimitStore.set(identifier, entry);
  next();
};

// Middleware pour opérations SOS critiques (avec rate limit élevé)
const mobileSosCriticalMiddleware = [
  appCheckMiddleware,
  verifyMobilePlatform,
  authMiddleware,
  sosCriticalRateLimiter, // Rate limiter plus permissif pour dead-man's-switch
];

// Rate limiter dédié à l'activation SOS.
// authMiddleware a déjà été exécuté à ce stade (il précède ce middleware dans
// mobileSosMiddleware), donc req.user?.id est disponible et inclus dans la clé
// pour éviter qu'un attaquant contourne la limite en changeant simplement d'IP.
const sosActivateRateLimiter = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const deviceId = (req.headers["x-device-id"] as string) || "no-device";
  const userId = (req as any).user?.id || "no-user";
  const identifier = `sos_activate_${userId}_${ip}_${deviceId}`;
  const now = new Date();

  const entry = sosCriticalRateLimitStore.get(identifier);

  if (!entry) {
    sosCriticalRateLimitStore.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
    return next();
  }

  if (entry.blockedUntil && entry.blockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (entry.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return res.status(429).json({
      error: `Trop de tentatives SOS. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
      code: "SOS_RATE_LIMIT_EXCEEDED",
      retryAfter: remainingMinutes * 60,
    });
  }

  const timeSinceFirst = now.getTime() - entry.firstAttempt.getTime();
  if (timeSinceFirst > SOS_CRITICAL_WINDOW_MS) {
    sosCriticalRateLimitStore.set(identifier, {
      count: 1,
      firstAttempt: now,
    });
    return next();
  }

  entry.count++;

  if (entry.count > SOS_CRITICAL_MAX_REQUESTS) {
    entry.blockedUntil = new Date(
      now.getTime() + SOS_CRITICAL_BLOCK_DURATION_MS,
    );
    sosCriticalRateLimitStore.set(identifier, entry);
    return res.status(429).json({
      error: `Trop de tentatives SOS. Bloqué pour ${SOS_CRITICAL_BLOCK_DURATION_MS / 60000} minutes.`,
      code: "SOS_RATE_LIMIT_EXCEEDED",
      retryAfter: SOS_CRITICAL_BLOCK_DURATION_MS / 1000,
    });
  }

  sosCriticalRateLimitStore.set(identifier, entry);
  next();
};

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
router.post("/activate", ...mobileSosMiddleware, sosActivateRateLimiter, handleSosActivate);

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
router.post("/heartbeat", ...mobileSosCriticalMiddleware, handleSosHeartbeat);

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
router.post("/extend", ...mobileSosCriticalMiddleware, handleSosExtend);

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
router.post("/deactivate", ...mobileSosCriticalMiddleware, handleSosDeactivate);

/**
 * GET /api/mobile/sos/status
 * Obtenir le statut de la session SOS active
 *
 * Response 200:
 *   { success: true, active: boolean, session: { ..., participants: [...], isGroupSession: boolean, creatorId: string } | null }
 */
router.get("/status", ...mobileSosCriticalMiddleware, handleSosStatus);

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

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES GESTION DES PARTICIPANTS (SESSION DE GROUPE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/add-participant
 * Ajouter un participant à une session SOS déjà active
 * Seul le créateur de la session peut ajouter quelqu'un
 *
 * Body:
 *   {
 *     "targetUserId": "mongoId",         // ID de l'utilisateur à ajouter
 *     "sessionId": "mongoId"             // Optionnel - prend la session active du créateur
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, participants, ... } }
 *
 * Codes d'erreur:
 *   - 400: INVALID_PARTICIPANT_IDS, ALREADY_PARTICIPANT, SESSION_ALREADY_ACTIVE
 *   - 401: UNAUTHORIZED
 *   - 403: FORBIDDEN (pas le créateur)
 *   - 404: NO_ACTIVE_SESSION
 *   - 500: INTERNAL_ERROR
 */
router.post(
  "/add-participant",
  ...mobileSosMiddleware,
  handleSosAddParticipant,
);

/**
 * POST /api/mobile/sos/remove-participant
 * Retirer un participant d'une session SOS active
 * N'importe quel participant actif peut retirer n'importe qui (soi-même inclus)
 * Si dernier participant → session résolue automatiquement
 *
 * Body:
 *   {
 *     "targetUserId": "mongoId",         // ID de l'utilisateur à retirer
 *     "sessionId": "mongoId"             // Optionnel - prend la session active
 *   }
 *
 * Response 200:
 *   { success: true, session: { id, participants, status, ... } }
 *
 * Codes d'erreur:
 *   - 401: UNAUTHORIZED
 *   - 404: NO_ACTIVE_SESSION, PARTICIPANT_NOT_FOUND
 *   - 500: INTERNAL_ERROR
 */
router.post(
  "/remove-participant",
  ...mobileSosMiddleware,
  handleSosRemoveParticipant,
);

export default router;
