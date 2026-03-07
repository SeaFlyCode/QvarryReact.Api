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

const router = Router();

// Tous les endpoints admin requièrent auth + admin
router.use(authMiddleware, adminMiddleware);

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

export default router;
