// Mock all dependencies BEFORE imports
jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/turnstileMiddleware", () => ({
  verifyTurnstile: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/auth", () => ({
  handleLoginUser: jest.fn(),
  handleLogoutUser: jest.fn(),
  handleRefreshToken: jest.fn(),
  checkAuth: jest.fn(),
  getWebSocketToken: jest.fn(),
  handleForgotPassword: jest.fn(),
  handleResetPassword: jest.fn(),
  completeLoginAfter2FA: jest.fn(),
}));

jest.mock("../../controllers/syncControllers", () => ({
  handleManualSync: jest.fn(),
  handleSyncRefresh: jest.fn(),
}));

import router from "../../routes/authRoutes";

describe("authRoutes", () => {
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
    expect(routes.length).toBe(10);
  });

  it("should register POST /login", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/login" });
  });

  it("should register POST /refresh", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/refresh" });
  });

  it("should register POST /logout", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/logout" });
  });

  it("should register POST /sync", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/sync" });
  });

  it("should register GET /sync/refresh", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sync/refresh" });
  });

  it("should register GET /check", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/check" });
  });

  it("should register GET /ws-token", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/ws-token" });
  });

  it("should register POST /forgot-password", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/forgot-password" });
  });

  it("should register POST /reset-password", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/reset-password" });
  });

  it("should register POST /complete-2fa-login", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/complete-2fa-login",
    });
  });
});
