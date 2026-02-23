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
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
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
  verifyMobilePlatform,
  authMiddleware,
  mobileRateLimitMiddleware,
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES DE SYNCHRONISATION
// ═══════════════════════════════════════════════════════════════════════════

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
