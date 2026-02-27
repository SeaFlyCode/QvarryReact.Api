jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/mobileSecurityMiddleware", () => ({
  verifyMobilePlatform: jest.fn((req: any, res: any, next: any) => next()),
  mobileRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/validateObjectIdMiddleware", () => ({
  validateObjectId: jest.fn(
    (...fields: string[]) =>
      (req: any, res: any, next: any) =>
        next(),
  ),
}));

jest.mock("../../controllers/mobileSosControllers", () => ({
  handleSosActivate: jest.fn((req: any, res: any) => res.status(201).json({})),
  handleSosHeartbeat: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleSosExtend: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleSosDeactivate: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosDeactivateByParam: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosConfirmSafe: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosStatus: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleSosHistory: jest.fn((req: any, res: any) => res.status(200).json([])),
  handleSosActiveSessions: jest.fn((req: any, res: any) =>
    res.status(200).json([]),
  ),
  handleSosCreateContact: jest.fn((req: any, res: any) =>
    res.status(201).json({}),
  ),
  handleSosGetContacts: jest.fn((req: any, res: any) =>
    res.status(200).json([]),
  ),
  handleSosUpdateContact: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosDeleteContact: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

import router from "../../routes/mobileSosRoutes";

describe("mobileSosRoutes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    expect(router.stack).toBeDefined();
  });

  it("should have the correct number of routes", () => {
    const routes = getRoutes();
    expect(routes).toHaveLength(13);
  });

  it("should register POST /activate for activating SOS", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/activate" });
  });

  it("should register POST /heartbeat for SOS heartbeat", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/heartbeat" });
  });

  it("should register POST /extend for extending SOS session", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/extend" });
  });

  it("should register POST /deactivate for deactivating SOS", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/deactivate" });
  });

  it("should register POST /:sessionId/deactivate for deactivating SOS by session id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:sessionId/deactivate",
    });
  });

  it("should register POST /:sessionId/confirm-safe for confirming user is safe", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:sessionId/confirm-safe",
    });
  });

  it("should register POST /contacts for adding emergency contact", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/contacts" });
  });

  it("should register GET /status for getting SOS status", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/status" });
  });

  it("should register GET /history for getting SOS history", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/history" });
  });

  it("should register GET /active for getting active SOS sessions", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/active" });
  });

  it("should register GET /contacts for getting emergency contacts", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/contacts" });
  });

  it("should register PUT /contacts/:id for updating emergency contact", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PUT", path: "/contacts/:id" });
  });

  it("should register DELETE /contacts/:id for deleting emergency contact", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/contacts/:id" });
  });
});
