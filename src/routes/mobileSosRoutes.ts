// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : sessions, heartbeats, contacts d'urgence
// Toutes les routes nécessitent authentification + vérification mobile
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import Redis, { Cluster } from "ioredis";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import { verifyMobilePlatform } from "../middlewares/mobileSecurityMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
import { logger } from "../services/loggerService";
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
// MIDDLEWARE COMMUN : Vérification plateforme + Auth
// ═══════════════════════════════════════════════════════════════════════════
// Pas de rate limiter générique ici : /activate a sosActivateRateLimiter,
// heartbeat/extend/status/deactivate ont sosCriticalRateLimiter, et le reste
// (contacts CRUD, history, participants) est protégé par auth + globalRateLimiter.

const mobileSosMiddleware = [
  appCheckMiddleware,
  verifyMobilePlatform,
  authMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT REDIS LOCAL (rate limiting SOS)
// ═══════════════════════════════════════════════════════════════════════════

const sosRateLimitLogger = logger.child({ service: "sos-rate-limit" });

let sosRedisClient: Redis | Cluster | null = null;

if (process.env.REDIS_ENABLED === "true") {
  try {
    if (process.env.USE_REDIS_CLUSTER === "true") {
      const clusterNodes =
        process.env.REDIS_CLUSTER_NODES?.split(",").map((node) => {
          const [host, port] = node.split(":");
          return { host, port: parseInt(port) };
        }) || [];
      sosRedisClient = new Cluster(clusterNodes, {
        redisOptions: {
          password: process.env.REDIS_PASSWORD,
          tls: process.env.REDIS_TLS === "true" ? {} : undefined,
        },
      });
    } else {
      sosRedisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || "0"),
        lazyConnect: true,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
      });
    }
  } catch (err) {
    sosRateLimitLogger.error("Échec initialisation Redis (rate limit SOS)", {
      error: err instanceof Error ? err.message : String(err),
    });
    sosRedisClient = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER SPÉCIFIQUE POUR OPÉRATIONS SOS CRITIQUES
// ═══════════════════════════════════════════════════════════════════════════
// Les opérations critiques (heartbeat, extend, deactivate, status) nécessitent
// un rate limit plus élevé car le heartbeat est envoyé toutes les 60 secondes.
// 30 requêtes / 15 min permet : 15 heartbeats + extensions + checks de statut

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
 * Utilise Redis (INCR/EXPIRE + clé de blocage) — fallback permissif si Redis absent
 */
const sosCriticalRateLimiter = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const identifier = getSosIdentifier(req);
  const countKey = `sos_critical:${identifier}`;
  const blockedKey = `sos_critical:blocked:${identifier}`;

  try {
    if (sosRedisClient) {
      // Vérifier blocage
      const blockedTtl = await sosRedisClient.ttl(blockedKey);
      if (blockedTtl > 0) {
        const remainingMinutes = Math.ceil(blockedTtl / 60);
        res.setHeader("Retry-After", String(blockedTtl));
        return res.status(429).json({
          error: "RATE_LIMITED",
          code: "SOS_RATE_LIMIT_EXCEEDED",
          retryAfter: blockedTtl,
          message: `Trop de tentatives SOS. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
        });
      }

      // Incrémenter compteur
      const count = await sosRedisClient.incr(countKey);
      if (count === 1) {
        await sosRedisClient.expire(countKey, SOS_CRITICAL_WINDOW_MS / 1000);
      }

      if (count > SOS_CRITICAL_MAX_REQUESTS) {
        await sosRedisClient.setex(
          blockedKey,
          SOS_CRITICAL_BLOCK_DURATION_MS / 1000,
          "1",
        );
        await sosRedisClient.del(countKey);
        const retryAfter = SOS_CRITICAL_BLOCK_DURATION_MS / 1000;
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: "RATE_LIMITED",
          code: "SOS_RATE_LIMIT_EXCEEDED",
          retryAfter,
          message: `Trop de tentatives SOS. Bloqué pour ${SOS_CRITICAL_BLOCK_DURATION_MS / 60000} minutes.`,
        });
      }

      return next();
    }
  } catch (error) {
    // Si Redis indisponible, laisser passer (safety-critical feature)
    sosRateLimitLogger.error("Erreur Redis rate limiter SOS critique", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Fallback : laisser passer si Redis absent ou en erreur
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
// Utilise Redis (INCR/EXPIRE + clé de blocage) — fallback permissif si Redis absent
const sosActivateRateLimiter = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const deviceId = (req.headers["x-device-id"] as string) || "no-device";
  const userId = (req as any).user?.id || "no-user";
  const identifier = `sos_activate_${userId}_${ip}_${deviceId}`;
  const countKey = `sos_critical:${identifier}`;
  const blockedKey = `sos_critical:blocked:${identifier}`;

  try {
    if (sosRedisClient) {
      // Vérifier blocage
      const blockedTtl = await sosRedisClient.ttl(blockedKey);
      if (blockedTtl > 0) {
        const remainingMinutes = Math.ceil(blockedTtl / 60);
        res.setHeader("Retry-After", String(blockedTtl));
        return res.status(429).json({
          error: "RATE_LIMITED",
          code: "SOS_RATE_LIMIT_EXCEEDED",
          retryAfter: blockedTtl,
          message: `Trop de tentatives SOS. Veuillez réessayer dans ${remainingMinutes} minute(s).`,
        });
      }

      // Incrémenter compteur
      const count = await sosRedisClient.incr(countKey);
      if (count === 1) {
        await sosRedisClient.expire(countKey, SOS_CRITICAL_WINDOW_MS / 1000);
      }

      if (count > SOS_CRITICAL_MAX_REQUESTS) {
        await sosRedisClient.setex(
          blockedKey,
          SOS_CRITICAL_BLOCK_DURATION_MS / 1000,
          "1",
        );
        await sosRedisClient.del(countKey);
        const retryAfter = SOS_CRITICAL_BLOCK_DURATION_MS / 1000;
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: "RATE_LIMITED",
          code: "SOS_RATE_LIMIT_EXCEEDED",
          retryAfter,
          message: `Trop de tentatives SOS. Bloqué pour ${SOS_CRITICAL_BLOCK_DURATION_MS / 60000} minutes.`,
        });
      }

      return next();
    }
  } catch (error) {
    // Si Redis indisponible, laisser passer (safety-critical feature)
    sosRateLimitLogger.error("Erreur Redis rate limiter activation SOS", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Fallback : laisser passer si Redis absent ou en erreur
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SESSION SOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /mobile/sos/activate:
 *   post:
 *     summary: Active une session SOS (dead-man's-switch)
 *     description: |
 *       Crée une session SOS qui expirera après `expectedDuration`. Heartbeat
 *       toutes les 60s pour la prolonger. Sans heartbeat → escalade auto
 *       (Stage 1 push contacts, Stage 2 SMS, Stage 3 secours). Voir
 *       sosEscalationService cron 60s.
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expectedDuration]
 *             properties:
 *               expectedDuration: { type: integer, minimum: 15, maximum: 480 }
 *               note: { type: string }
 *               siteName: { type: string }
 *               zone: { type: string }
 *               depth: { type: integer }
 *               lat: { type: number }
 *               lng: { type: number }
 *               accuracy: { type: number }
 *               participantIds: { type: array, items: { type: string } }
 *               sessionContacts:
 *                 type: object
 *                 properties:
 *                   permanentContactIds: { type: array, items: { type: string } }
 *                   additionalContacts: { type: array, items: { type: object } }
 *     responses:
 *       201: { description: Session créée }
 *       409: { description: SESSION_ALREADY_ACTIVE }
 *       429: { description: Rate limit Redis }
 *
 * /mobile/sos/heartbeat:
 *   post:
 *     summary: Heartbeat (signe de vie, +15min auto)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { sessionId: { type: string }, lat: { type: number }, lng: { type: number }, accuracy: { type: number } } }
 *     responses:
 *       200: { description: Timer prolongé + heartbeatCount }
 *       404: { description: NO_ACTIVE_SESSION }
 *
 * /mobile/sos/extend:
 *   post:
 *     summary: Prolongation manuelle (15-480 min)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Timer étendu } }
 *
 * /mobile/sos/deactivate:
 *   post:
 *     summary: Désactivation manuelle (user en sécurité)
 *     description: scope=self (quitte seul) | all (résout pour tous, défaut).
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Session résolue } }
 *
 * /mobile/sos/status:
 *   get:
 *     summary: Statut session active
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ active, session?, isGroupSession, participants[] }' } }
 *
 * /mobile/sos/history:
 *   get:
 *     summary: Historique sessions + stats agrégées
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: limit, schema: { type: integer, maximum: 50, default: 20 } }]
 *     responses: { 200: { description: Sessions enrichies actualDuration/durationOverrun + stats } }
 *
 * /mobile/sos/active:
 *   get:
 *     summary: Sessions visibles en escalade (dashboard cross-user)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Sessions d'autres users en stage 1+ } }
 *
 * /mobile/sos/{sessionId}/deactivate:
 *   post:
 *     summary: Désactive une session via path param
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Résolue } }
 *
 * /mobile/sos/{sessionId}/confirm-safe:
 *   post:
 *     summary: Confirme qu'un autre user est en sécurité (cross-user)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Résolue par tiers } }
 *
 * /mobile/sos/contacts:
 *   get:
 *     summary: Liste contacts d'urgence
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste (max 5) } }
 *   post:
 *     summary: Crée un contact d'urgence (max 5, phone E.164)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string, pattern: '^\\+[1-9][0-9]{1,14}$' }
 *               relationship: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201: { description: Créé }
 *       400: { description: MAX_CONTACTS_REACHED ou INVALID_PHONE_FORMAT }
 *       409: { description: DUPLICATE_PHONE }
 *
 * /mobile/sos/contacts/{id}:
 *   put:
 *     summary: Modifie un contact d'urgence
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Mis à jour } }
 *   delete:
 *     summary: Supprime un contact d'urgence
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Supprimé } }
 *
 * /mobile/sos/add-participant:
 *   post:
 *     summary: Ajoute un participant à une session de groupe
 *     description: Seul le créateur peut ajouter.
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [targetUserId], properties: { targetUserId: { type: string }, sessionId: { type: string } } }
 *     responses:
 *       200: { description: Ajouté }
 *       403: { description: FORBIDDEN (pas créateur) }
 *
 * /mobile/sos/remove-participant:
 *   post:
 *     summary: Retire un participant (dernier → session résolue)
 *     tags: [Mobile, SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [targetUserId], properties: { targetUserId: { type: string }, sessionId: { type: string } } }
 *     responses: { 200: { description: Retiré } }
 */

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
