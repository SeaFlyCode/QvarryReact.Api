// server/src/routes/adminRoutes.ts
import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  getGlobalStats,
  getRegistrationStats,
  getActivityStats,
  listUsers,
  getUserDetails,
  blockUser,
  unblockUser,
  promoteToAdmin,
  demoteFromAdmin,
  forceLogoutUser,
  resetUserPassword,
  getAuditLogs,
  getAuditStats,
  // Nouvelles fonctions de sécurité
  getSecurityDashboard,
  listBlockedIps,
  blockIp,
  unblockIp,
  getIpThreatScore,
  exportAuditLogs,
  sendTestAlert,
  // Validation des comptes
  listPendingUsers,
  approveUser,
  rejectUser,
  getPendingUsersCount,
} from "../controllers/adminControllers";
import {
  handleAdminSosDashboard,
  handleAdminSosActiveSessions,
  handleAdminSosSessionDetails,
  handleAdminSosCancelSession,
  handleAdminSosHistory,
  handleAdminSosStats,
  handleAdminSosHeartbeat,
  handleAdminSosExtendSession,
  handleAdminSosForceEscalation,
  handleAdminSosActivateSession,
  handleAdminSosConfirmSafe,
  handleAdminSosAddParticipant,
  handleAdminSosRemoveParticipant,
  handleAdminSosTriggerSms,
  handleAdminSosSendNotification,
} from "../controllers/adminSosControllers";
import {
  getAllUsersStorage,
  getUserStorageDetails,
  updateUserQuota,
  setUserQuotaBytes,
  getGlobalStorageStats,
  cleanupOrphanFiles,
} from "../controllers/adminStorageController";
import {
  getAppVersionConfig,
  updateAppVersionConfig,
} from "../controllers/adminAppVersionController";

const router = Router();

// Tous les endpoints admin requièrent auth + admin
router.use(authMiddleware, adminMiddleware);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Stats globales (users, fiches, points, lists, sessions)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Stats agrégées } }
 *
 * /admin/stats/registrations:
 *   get:
 *     summary: Stats inscriptions par jour/semaine/mois
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Timeline } }
 *
 * /admin/stats/activity:
 *   get:
 *     summary: Stats activité (logins, requêtes, devices actifs)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Timeline } }
 *
 * /admin/users:
 *   get:
 *     summary: Liste paginée users
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses: { 200: { description: '{ users, total, page }' } }
 *
 * /admin/users/pending:
 *   get:
 *     summary: Liste users en attente de validation (PENDING_VALIDATION)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste } }
 *
 * /admin/users/pending/count:
 *   get:
 *     summary: Nombre users en attente (badge)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ count }' } }
 *
 * /admin/users/storage:
 *   get:
 *     summary: Storage usage de tous les users (paginated)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: 'Liste avec quotaBytes / usedBytes' } }
 *
 * /admin/users/{userId}:
 *   get:
 *     summary: Détails complets user (admin)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { $ref: '#/components/schemas/User' } }
 *
 * /admin/users/{userId}/block:
 *   post:
 *     summary: Bloque un user (status=BLOCKED)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Bloqué + sessions révoquées } }
 *
 * /admin/users/{userId}/unblock:
 *   post:
 *     summary: Débloque un user
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Débloqué } }
 *
 * /admin/users/{userId}/promote:
 *   post:
 *     summary: Promote en admin (isAdmin=true)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Promu } }
 *
 * /admin/users/{userId}/demote:
 *   post:
 *     summary: Demote depuis admin
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Demote } }
 *
 * /admin/users/{userId}/force-logout:
 *   post:
 *     summary: Force déconnexion (révoque toutes les sessions actives)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Sessions révoquées + WS session_revoked diffusé } }
 *
 * /admin/users/{userId}/reset-password:
 *   post:
 *     summary: Reset password (envoie email reset au user)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Email envoyé } }
 *
 * /admin/users/{userId}/approve:
 *   post:
 *     summary: Approuve un user en attente (PENDING → ACTIVE)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Approuvé + email envoyé } }
 *
 * /admin/users/{userId}/reject:
 *   post:
 *     summary: Rejette un user en attente
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Rejeté + email envoyé } }
 *
 * /admin/audit/logs:
 *   get:
 *     summary: Logs d'audit (actions sensibles)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *     responses: { 200: { description: Logs paginés } }
 *
 * /admin/audit/stats:
 *   get:
 *     summary: Stats audit (top actions, top users)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Agrégats } }
 *
 * /admin/audit/export:
 *   get:
 *     summary: Export CSV des logs d'audit
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: 'CSV (text/csv)' } }
 *
 * /admin/security/dashboard:
 *   get:
 *     summary: Dashboard sécurité (threats détectés, IPs suspectes)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Métriques temps réel } }
 *
 * /admin/security/blocked-ips:
 *   get:
 *     summary: Liste IPs bloquées
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste avec reason + bloquéLe } }
 *
 * /admin/security/block-ip:
 *   post:
 *     summary: Bloque une IP manuellement
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [ipAddress], properties: { ipAddress: { type: string }, reason: { type: string }, duration: { type: integer } } }
 *     responses: { 200: { description: Bloquée } }
 *
 * /admin/security/unblock-ip/{ipAddress}:
 *   post:
 *     summary: Débloque une IP (V8.4 — verbe canonique)
 *     description: §V8.4 rename — POST sémantiquement correct (création d'une action d'unblock).
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: ipAddress, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Débloquée } }
 *   delete:
 *     deprecated: true
 *     summary: '[DEPRECATED V8.4] Débloque une IP (utiliser POST à la place)'
 *     description: Alias rétro-compat — sera supprimé en V2.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: ipAddress, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Débloquée } }
 *
 * /admin/security/threat-score/{ipAddress}:
 *   get:
 *     summary: Score de menace d'une IP (0-100)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: ipAddress, required: true, schema: { type: string } }]
 *     responses: { 200: { description: '{ score, signals[] }' } }
 *
 * /admin/security/test-alert:
 *   post:
 *     summary: Envoie une alerte de test (Discord/Slack webhook)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Alerte envoyée } }
 *
 * /admin/sos/dashboard:
 *   get:
 *     summary: Dashboard SOS temps réel (sessions actives + escalades)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Vue agrégée } }
 *
 * /admin/sos/active:
 *   get:
 *     summary: Sessions SOS actives (toutes users)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste } }
 *
 * /admin/sos/sessions/{sessionId}:
 *   get:
 *     summary: Détails session SOS (timeline, heartbeats, participants)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Détails complets } }
 *
 * /admin/sos/sessions/{sessionId}/cancel:
 *   post:
 *     summary: Annule une session (admin override, marque CANCELLED)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Annulée } }
 *
 * /admin/sos/history:
 *   get:
 *     summary: Historique sessions (toutes users, filtrable)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Liste paginée } }
 *
 * /admin/sos/stats:
 *   get:
 *     summary: Stats SOS agrégées (taux escalade, durées moyennes)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Métriques } }
 *
 * /admin/sos/sessions/{sessionId}/heartbeat:
 *   post:
 *     summary: Heartbeat admin (DROIT ABSOLU — bypass owner check)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Timer prolongé } }
 *
 * /admin/sos/sessions/{sessionId}/extend:
 *   post:
 *     summary: Extension manuelle admin
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Étendue } }
 *
 * /admin/sos/sessions/{sessionId}/force-escalation:
 *   post:
 *     summary: Force passage stage suivant (1→2→3)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Escalade déclenchée } }
 *
 * /admin/sos/sessions/activate:
 *   post:
 *     summary: Active une session SOS pour un user (override)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Session créée } }
 *
 * /admin/sos/sessions/{sessionId}/confirm-safe:
 *   post:
 *     summary: Confirme user en sécurité (admin)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Résolue } }
 *
 * /admin/sos/sessions/{sessionId}/add-participant:
 *   post:
 *     summary: Ajoute participant (admin, bypass créateur)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Ajouté } }
 *
 * /admin/sos/sessions/{sessionId}/remove-participant:
 *   post:
 *     summary: Retire participant (admin)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Retiré } }
 *
 * /admin/sos/sessions/{sessionId}/trigger-sms:
 *   post:
 *     summary: Force envoi SMS escalade (Twilio)
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: SMS envoyés } }
 *
 * /admin/sos/sessions/{sessionId}/send-notification:
 *   post:
 *     summary: Force envoi notif push aux contacts
 *     tags: [Admin, SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Notifs envoyées } }
 *
 * /admin/users/{userId}/storage:
 *   get:
 *     summary: Détails stockage user (breakdown par type)
 *     tags: [Admin, Storage]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Détails } }
 *
 * /admin/users/{userId}/quota:
 *   patch:
 *     summary: Update quota (calcul auto bytes depuis multiplicateur)
 *     tags: [Admin, Storage]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Mis à jour } }
 *   post:
 *     summary: Set quota en bytes directement (Vague 9 — interface admin web)
 *     tags: [Admin, Storage]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: userId, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [quotaBytes], properties: { quotaBytes: { type: integer, minimum: 0 } } }
 *     responses: { 200: { description: Set } }
 *
 * /admin/storage/stats:
 *   get:
 *     summary: Stats globales stockage
 *     tags: [Admin, Storage]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ totalUsedBytes, totalQuotaBytes, byType }' } }
 *
 * /admin/storage/cleanup:
 *   post:
 *     summary: Cleanup fichiers orphelins (S3 sans ref DB)
 *     tags: [Admin, Storage]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ deletedCount, freedBytes }' } }
 *
 * /admin/app-version:
 *   get:
 *     summary: Config version min app mobile (kill switch)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: '{ minIos, minAndroid, latestIos, latestAndroid }' } }
 *   put:
 *     summary: Update config version (force update users)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               minIos: { type: string }
 *               minAndroid: { type: string }
 *               latestIos: { type: string }
 *               latestAndroid: { type: string }
 *     responses: { 200: { description: Mis à jour } }
 */

// ═══════════════════════════════════════════════════════════════════════════
// STATISTIQUES
// ═══════════════════════════════════════════════════════════════════════════
router.get("/stats", getGlobalStats);
router.get("/stats/registrations", getRegistrationStats);
router.get("/stats/activity", getActivityStats);

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES UTILISATEURS
// ═══════════════════════════════════════════════════════════════════════════
router.get("/users", listUsers);
router.get("/users/pending", listPendingUsers);
router.get("/users/pending/count", getPendingUsersCount);
router.get("/users/storage", getAllUsersStorage);
router.get("/users/:userId", validateObjectId("userId"), getUserDetails);
router.post("/users/:userId/block", validateObjectId("userId"), blockUser);
router.post("/users/:userId/unblock", validateObjectId("userId"), unblockUser);
router.post(
  "/users/:userId/promote",
  validateObjectId("userId"),
  promoteToAdmin,
);
router.post(
  "/users/:userId/demote",
  validateObjectId("userId"),
  demoteFromAdmin,
);
router.post(
  "/users/:userId/force-logout",
  validateObjectId("userId"),
  forceLogoutUser,
);
router.post(
  "/users/:userId/reset-password",
  validateObjectId("userId"),
  resetUserPassword,
);
router.post("/users/:userId/approve", validateObjectId("userId"), approveUser);
router.post("/users/:userId/reject", validateObjectId("userId"), rejectUser);

// ═══════════════════════════════════════════════════════════════════════════
// LOGS D'AUDIT
// ═══════════════════════════════════════════════════════════════════════════
router.get("/audit/logs", getAuditLogs);
router.get("/audit/stats", getAuditStats);
router.get("/audit/export", exportAuditLogs);

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ AVANCÉE - BLOCAGE D'IP & MONITORING
// ═══════════════════════════════════════════════════════════════════════════
router.get("/security/dashboard", getSecurityDashboard);
router.get("/security/blocked-ips", listBlockedIps);
router.post("/security/block-ip", blockIp);
router.post("/security/unblock-ip/:ipAddress", unblockIp);
// V8.4 — alias DELETE conservé 1 release pour rétro-compat clients (à supprimer V2)
router.delete("/security/unblock-ip/:ipAddress", unblockIp);
router.get("/security/threat-score/:ipAddress", getIpThreatScore);
router.post("/security/test-alert", sendTestAlert);

// ═══════════════════════════════════════════════════════════════════════════
// SOS MODE - ADMINISTRATION
// ═══════════════════════════════════════════════════════════════════════════
router.get("/sos/dashboard", handleAdminSosDashboard);
router.get("/sos/active", handleAdminSosActiveSessions);
router.get(
  "/sos/sessions/:sessionId",
  validateObjectId("sessionId"),
  handleAdminSosSessionDetails,
);
router.post(
  "/sos/sessions/:sessionId/cancel",
  validateObjectId("sessionId"),
  handleAdminSosCancelSession,
);
router.get("/sos/history", handleAdminSosHistory);
router.get("/sos/stats", handleAdminSosStats);

// ─── SOS MODE - ACTIONS ADMIN (DROIT ABSOLU) ────────────────────────────
router.post(
  "/sos/sessions/:sessionId/heartbeat",
  validateObjectId("sessionId"),
  handleAdminSosHeartbeat,
);
router.post(
  "/sos/sessions/:sessionId/extend",
  validateObjectId("sessionId"),
  handleAdminSosExtendSession,
);
router.post(
  "/sos/sessions/:sessionId/force-escalation",
  validateObjectId("sessionId"),
  handleAdminSosForceEscalation,
);
router.post("/sos/sessions/activate", handleAdminSosActivateSession);
router.post(
  "/sos/sessions/:sessionId/confirm-safe",
  validateObjectId("sessionId"),
  handleAdminSosConfirmSafe,
);
router.post(
  "/sos/sessions/:sessionId/add-participant",
  validateObjectId("sessionId"),
  handleAdminSosAddParticipant,
);
router.post(
  "/sos/sessions/:sessionId/remove-participant",
  validateObjectId("sessionId"),
  handleAdminSosRemoveParticipant,
);
router.post(
  "/sos/sessions/:sessionId/trigger-sms",
  validateObjectId("sessionId"),
  handleAdminSosTriggerSms,
);
router.post(
  "/sos/sessions/:sessionId/send-notification",
  validateObjectId("sessionId"),
  handleAdminSosSendNotification,
);

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DU STOCKAGE
// ═══════════════════════════════════════════════════════════════════════════
router.get(
  "/users/:userId/storage",
  validateObjectId("userId"),
  getUserStorageDetails,
);
router.patch(
  "/users/:userId/quota",
  validateObjectId("userId"),
  updateUserQuota,
);
// P1 — endpoint POST appelé par l'interface admin web. Body: { quotaBytes }.
router.post(
  "/users/:userId/quota",
  validateObjectId("userId"),
  setUserQuotaBytes,
);
router.get("/storage/stats", getGlobalStorageStats);
router.post("/storage/cleanup", cleanupOrphanFiles);

// ═══════════════════════════════════════════════════════════════════════════
// GESTION VERSION APP MOBILE
// ═══════════════════════════════════════════════════════════════════════════
router.get("/app-version", getAppVersionConfig);
router.put("/app-version", updateAppVersionConfig);

export default router;
