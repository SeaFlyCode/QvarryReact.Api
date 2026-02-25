// server/src/routes/adminRoutes.ts
import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
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
router.get("/users/:userId", getUserDetails);
router.post("/users/:userId/block", blockUser);
router.post("/users/:userId/unblock", unblockUser);
router.post("/users/:userId/promote", promoteToAdmin);
router.post("/users/:userId/demote", demoteFromAdmin);
router.post("/users/:userId/force-logout", forceLogoutUser);
router.post("/users/:userId/reset-password", resetUserPassword);
router.post("/users/:userId/approve", approveUser);
router.post("/users/:userId/reject", rejectUser);

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
router.get("/sos/sessions/:sessionId", handleAdminSosSessionDetails);
router.post("/sos/sessions/:sessionId/cancel", handleAdminSosCancelSession);
router.get("/sos/history", handleAdminSosHistory);
router.get("/sos/stats", handleAdminSosStats);

export default router;
