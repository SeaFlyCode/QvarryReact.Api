// Mock all dependencies BEFORE imports
jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/adminMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/validateObjectIdMiddleware", () => ({
  validateObjectId: jest.fn(
    (...fields: string[]) =>
      (req: any, res: any, next: any) =>
        next(),
  ),
}));

jest.mock("../../controllers/adminControllers", () => ({
  getGlobalStats: jest.fn(),
  getRegistrationStats: jest.fn(),
  getActivityStats: jest.fn(),
  listUsers: jest.fn(),
  getUserDetails: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
  promoteToAdmin: jest.fn(),
  demoteFromAdmin: jest.fn(),
  forceLogoutUser: jest.fn(),
  resetUserPassword: jest.fn(),
  getAuditLogs: jest.fn(),
  getAuditStats: jest.fn(),
  getSecurityDashboard: jest.fn(),
  listBlockedIps: jest.fn(),
  blockIp: jest.fn(),
  unblockIp: jest.fn(),
  getIpThreatScore: jest.fn(),
  exportAuditLogs: jest.fn(),
  sendTestAlert: jest.fn(),
  listPendingUsers: jest.fn(),
  approveUser: jest.fn(),
  rejectUser: jest.fn(),
  getPendingUsersCount: jest.fn(),
}));

jest.mock("../../controllers/adminSosControllers", () => ({
  handleAdminSosDashboard: jest.fn(),
  handleAdminSosActiveSessions: jest.fn(),
  handleAdminSosSessionDetails: jest.fn(),
  handleAdminSosCancelSession: jest.fn(),
  handleAdminSosHistory: jest.fn(),
  handleAdminSosStats: jest.fn(),
  handleAdminSosHeartbeat: jest.fn(),
  handleAdminSosExtendSession: jest.fn(),
  handleAdminSosForceEscalation: jest.fn(),
  handleAdminSosActivateSession: jest.fn(),
  handleAdminSosConfirmSafe: jest.fn(),
  handleAdminSosAddParticipant: jest.fn(),
  handleAdminSosRemoveParticipant: jest.fn(),
  handleAdminSosTriggerSms: jest.fn(),
  handleAdminSosSendNotification: jest.fn(),
}));

import router from "../../routes/adminRoutes";

describe("adminRoutes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to extract routes from Express router
  const getRoutes = () => {
    const routes: { method: string; path: string }[] = [];
    router.stack.forEach((layer: any) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods);
        methods.forEach((method) => {
          routes.push({ method: method.toUpperCase(), path: layer.route.path });
        });
      }
    });
    return routes;
  };

  it("should export a valid Express router", () => {
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });

  it("should have the correct number of routes", () => {
    const routes = getRoutes();
    expect(routes.length).toBe(39);
  });

  // STATISTIQUES
  it("should register GET /stats", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/stats" });
  });

  it("should register GET /stats/registrations", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/stats/registrations",
    });
  });

  it("should register GET /stats/activity", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/stats/activity" });
  });

  // GESTION DES UTILISATEURS
  it("should register GET /users", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/users" });
  });

  it("should register GET /users/pending", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/users/pending" });
  });

  it("should register GET /users/pending/count", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/users/pending/count",
    });
  });

  it("should register GET /users/:userId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/users/:userId" });
  });

  it("should register POST /users/:userId/block", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/block",
    });
  });

  it("should register POST /users/:userId/unblock", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/unblock",
    });
  });

  it("should register POST /users/:userId/promote", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/promote",
    });
  });

  it("should register POST /users/:userId/demote", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/demote",
    });
  });

  it("should register POST /users/:userId/force-logout", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/force-logout",
    });
  });

  it("should register POST /users/:userId/reset-password", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/reset-password",
    });
  });

  it("should register POST /users/:userId/approve", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/approve",
    });
  });

  it("should register POST /users/:userId/reject", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/users/:userId/reject",
    });
  });

  // LOGS D'AUDIT
  it("should register GET /audit/logs", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/audit/logs" });
  });

  it("should register GET /audit/stats", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/audit/stats" });
  });

  it("should register GET /audit/export", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/audit/export" });
  });

  // SÉCURITÉ AVANCÉE
  it("should register GET /security/dashboard", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/security/dashboard",
    });
  });

  it("should register GET /security/blocked-ips", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/security/blocked-ips",
    });
  });

  it("should register POST /security/block-ip", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/security/block-ip",
    });
  });

  it("should register DELETE /security/unblock-ip/:ipAddress", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "DELETE",
      path: "/security/unblock-ip/:ipAddress",
    });
  });

  it("should register GET /security/threat-score/:ipAddress", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/security/threat-score/:ipAddress",
    });
  });

  it("should register POST /security/test-alert", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/security/test-alert",
    });
  });

  // SOS MODE - ADMINISTRATION
  it("should register GET /sos/dashboard", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sos/dashboard" });
  });

  it("should register GET /sos/active", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sos/active" });
  });

  it("should register GET /sos/sessions/:sessionId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/sos/sessions/:sessionId",
    });
  });

  it("should register POST /sos/sessions/:sessionId/cancel", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/sos/sessions/:sessionId/cancel",
    });
  });

  it("should register GET /sos/history", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sos/history" });
  });

  it("should register GET /sos/stats", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sos/stats" });
  });
});
