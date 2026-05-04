jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/validateObjectIdMiddleware", () => ({
  validateObjectId: jest.fn(
    (..._fields: string[]) =>
      (_req: any, _res: any, next: any) =>
        next(),
  ),
}));

jest.mock("../../controllers/mobileSosControllers", () => ({
  handleSosActivate: jest.fn((_req: any, res: any) => res.status(201).json({})),
  handleSosHeartbeat: jest.fn((_req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosConfirmSafe: jest.fn((_req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSosActiveSessions: jest.fn((_req: any, res: any) =>
    res.status(200).json([]),
  ),
}));

import router from "../../routes/sosRoutes";

describe("sosRoutes (web alias)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoutes = () => {
    const routes: { method: string; path: string }[] = [];
    router.stack.forEach((layer: any) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((method) => {
          routes.push({ method: method.toUpperCase(), path: layer.route.path });
        });
      }
    });
    return routes;
  };

  it("expose un Express router valide", () => {
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
    expect(router.stack).toBeDefined();
  });

  it("expose exactement 4 routes (mapping web)", () => {
    expect(getRoutes()).toHaveLength(4);
  });

  it("expose POST /start (alias mobile /activate)", () => {
    expect(getRoutes()).toContainEqual({ method: "POST", path: "/start" });
  });

  it("expose POST /sessions/:sessionId/heartbeat", () => {
    expect(getRoutes()).toContainEqual({
      method: "POST",
      path: "/sessions/:sessionId/heartbeat",
    });
  });

  it("expose POST /sessions/:sessionId/safe (alias /confirm-safe)", () => {
    expect(getRoutes()).toContainEqual({
      method: "POST",
      path: "/sessions/:sessionId/safe",
    });
  });

  it("expose GET /active", () => {
    expect(getRoutes()).toContainEqual({ method: "GET", path: "/active" });
  });

  it("réutilise les MÊMES handlers que mobileSosControllers (pas de duplication)", () => {
    const mobileControllers = jest.requireMock(
      "../../controllers/mobileSosControllers",
    );
    expect(mobileControllers.handleSosActivate).toBeDefined();
    expect(mobileControllers.handleSosHeartbeat).toBeDefined();
    expect(mobileControllers.handleSosConfirmSafe).toBeDefined();
    expect(mobileControllers.handleSosActiveSessions).toBeDefined();
  });
});
