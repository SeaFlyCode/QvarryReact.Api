// ═══════════════════════════════════════════════════════════════════════════
// ROUTES DE SYNCHRONISATION MOBILE
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour la synchronisation offline-first des données
// Ces routes nécessitent une authentification via JWT mobile
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  verifyMobilePlatform,
  mobileSyncRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { appCheckMiddleware } from "../middlewares/appCheckMiddleware";
import {
  handleMobileSync,
  handleMobileSyncPush,
  handleMobileFullData,
  handleMobileSyncStatus,
} from "../controllers/mobileSyncControllers";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE COMMUN : Vérification plateforme + Auth + Rate Limit
// ═══════════════════════════════════════════════════════════════════════════

const mobileSyncMiddleware = [
  appCheckMiddleware,
  verifyMobilePlatform,
  authMiddleware,
  mobileSyncRateLimitMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES DE SYNCHRONISATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /mobile/sync:
 *   get:
 *     summary: Sync incrémentale offline-first (pull)
 *     description: |
 *       §V0 — Retourne `{points,fiches,lists,sosContacts}` créés/modifiés/supprimés
 *       depuis `since`. Si `since` absent → full sync. Sortie chiffrée côté serveur
 *       puis déchiffrée côté client (clé dérivée bcrypt session).
 *     tags: [Mobile, Sync]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Données delta + lastSyncDate }
 *       400: { description: INVALID_DATE_FORMAT }
 *   post:
 *     summary: Sync incrémentale offline-first (push)
 *     description: |
 *       Push des changements offline. Détecte les conflits via version
 *       (optimistic concurrency). Retourne idMapping localId → serverId.
 *     tags: [Mobile, Sync]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [changes]
 *             properties:
 *               changes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [type, action, timestamp]
 *                   properties:
 *                     type: { type: string, enum: [point, fiche, list, sosContact] }
 *                     action: { type: string, enum: [create, update, delete] }
 *                     id: { type: string }
 *                     localId: { type: string }
 *                     data: { type: object }
 *                     timestamp: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Sync ok
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 synced: { type: array, items: { type: object } }
 *                 conflicts: { type: array, items: { type: object } }
 *                 idMapping: { type: object, additionalProperties: { type: string } }
 *
 * /mobile/sync/status:
 *   get:
 *     summary: Check rapide changes dispo (badge)
 *     tags: [Mobile, Sync]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: since
 *         required: true
 *         schema: { type: string, format: date-time }
 *     responses: { 200: { description: hasChanges + breakdown } }
 *
 * /mobile/data/full:
 *   get:
 *     summary: Download complet (nouveau device, reset, recovery)
 *     tags: [Mobile, Sync]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Toutes les données chiffrées } }
 */

/**
 * GET /api/mobile/sync
 * Synchronisation incrémentale des données
 *
 * Headers requis:
 *   - Authorization: Bearer <accessToken>
 *   - X-Platform: ios | android
 *   - X-Device-ID: UUID de l'appareil
 *
 * Query params:
 *   - since: ISO 8601 date string (optionnel)
 *            Si absent, retourne toutes les données (sync complète)
 *            Ex: ?since=2026-02-10T15:30:00.000Z
 *
 * Response 200:
 *   {
 *     "success": true,
 *     "points": {
 *       "created": [...],    // Nouveaux points depuis 'since'
 *       "updated": [...],    // Points modifiés depuis 'since'
 *       "deleted": [...]     // IDs des points supprimés
 *     },
 *     "fiches": { ... },     // Même structure
 *     "lists": { ... },      // Même structure
 *     "sosContacts": {
 *       "created": [...],    // Nouveaux contacts SOS depuis 'since'
 *       "updated": [...],    // Contacts SOS modifiés depuis 'since'
 *       "deleted": [...]     // IDs des contacts SOS supprimés
 *     },
 *     "activeSosSession": {  // Session SOS active (ou null)
 *       "id": "...",
 *       "status": "ACTIVE",
 *       "currentStage": -1,
 *       "expiresAt": "...",
 *       ...
 *     } | null,
 *     "lastSyncDate": "2026-02-11T10:00:00.000Z",
 *     "totalChanges": 42,
 *     "syncDuration": 156    // ms
 *   }
 *
 * Codes d'erreur:
 *   - 400: INVALID_DATE_FORMAT
 *   - 401: UNAUTHORIZED, SESSION_EXPIRED
 *   - 500: SYNC_ERROR
 */
router.get("/", ...mobileSyncMiddleware, handleMobileSync);

/**
 * POST /api/mobile/sync
 * Push des modifications effectuées en mode offline
 *
 * Headers requis: (mêmes que GET)
 *
 * Body:
 *   {
 *     "changes": [
 *       {
 *         "type": "point" | "fiche" | "list" | "sosContact",
 *         "action": "create" | "update" | "delete",
 *         "id": "serverId",           // Requis pour update/delete
 *         "localId": "uuid-local",    // Pour create (mapping retourné)
 *         "data": { ... },            // Données déchiffrées
 *         "timestamp": "2026-02-11T09:30:00.000Z"
 *       },
 *       ...
 *     ]
 *   }
 *
 * Response 200:
 *   {
 *     "success": true,
 *     "synced": [...],       // Changements appliqués
 *     "conflicts": [...],    // Conflits détectés
 *     "errors": [...],       // Erreurs rencontrées
 *     "idMapping": {         // Mapping localId → serverId
 *       "local-uuid-1": "mongo-id-1",
 *       ...
 *     },
 *     "syncDuration": 234
 *   }
 *
 * Codes d'erreur:
 *   - 400: INVALID_CHANGES_FORMAT, INVALID_CHANGE_TYPE, MISSING_ID, MISSING_DATA
 *   - 401: UNAUTHORIZED
 *   - 500: SYNC_PUSH_ERROR
 */
router.post("/", ...mobileSyncMiddleware, handleMobileSyncPush);

/**
 * GET /api/mobile/sync/status
 * Vérifie rapidement s'il y a des changements disponibles
 * Utile pour afficher un badge "mise à jour disponible"
 *
 * Headers requis: (mêmes que GET /sync)
 *
 * Query params:
 *   - since: ISO 8601 date string (OBLIGATOIRE)
 *
 * Response 200:
 *   {
 *     "success": true,
 *     "hasChanges": true,
 *     "changeCount": 5,
 *     "lastSyncDate": "2026-02-11T10:00:00.000Z",
 *     "breakdown": {
 *       "points": 2,
 *       "fiches": 3,
 *       "lists": 0,
 *       "sosContacts": 1
 *     }
 *   }
 */
router.get("/status", ...mobileSyncMiddleware, handleMobileSyncStatus);

/**
 * GET /api/mobile/data/full
 * Téléchargement complet de toutes les données
 * À utiliser uniquement pour:
 *   - Première connexion sur un nouvel appareil
 *   - Reset complet des données locales
 *   - Récupération après corruption des données locales
 *
 * Headers requis: (mêmes que GET /sync)
 *
 * Response 200: (même format que GET /sync sans paramètre 'since')
 */
router.get("/full", ...mobileSyncMiddleware, handleMobileFullData);

export default router;
