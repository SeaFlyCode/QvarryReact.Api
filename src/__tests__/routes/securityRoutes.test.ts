jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/validateObjectIdMiddleware", () => ({
  validateObjectId: jest.fn(
    (...fields: string[]) =>
      (req: any, res: any, next: any) =>
        next(),
  ),
}));

jest.mock("../../controllers/securityControllers", () => ({
  getUserSessions: jest.fn((req: any, res: any) => res.json({})),
  revokeSession: jest.fn((req: any, res: any) => res.json({})),
  getSecurityEvents: jest.fn((req: any, res: any) => res.json({})),
}));

jest.mock("../../controllers/sessionControllers", () => ({
  revokeAllOtherSessions: jest.fn((req: any, res: any) => res.json({})),
}));

import router from "../../routes/securityRoutes";

describe("securityRoutes", () => {
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
    expect(routes).toHaveLength(4);
  });

  it("should register GET /sessions route", () => {
    const routes = getRoutes();
    const sessionsRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/sessions",
    );
    expect(sessionsRoute).toBeDefined();
  });

  it("should register GET /events route", () => {
    const routes = getRoutes();
    const eventsRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/events",
    );
    expect(eventsRoute).toBeDefined();
  });

  it("should register DELETE /sessions/:tokenId route", () => {
    const routes = getRoutes();
    const revokeSessionRoute = routes.find(
      (r) => r.method === "DELETE" && r.path === "/sessions/:tokenId",
    );
    expect(revokeSessionRoute).toBeDefined();
  });

  it("should register POST /sessions/revoke-all route", () => {
    const routes = getRoutes();
    const revokeAllRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/sessions/revoke-all",
    );
    expect(revokeAllRoute).toBeDefined();
  });
});
