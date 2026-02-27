jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/mobileSecurityMiddleware", () => ({
  verifyMobilePlatform: jest.fn((req: any, res: any, next: any) => next()),
  mobileRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/mobileSyncControllers", () => ({
  handleMobileSync: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleMobileSyncPush: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleMobileFullData: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleMobileSyncStatus: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

import router from "../../routes/mobileSyncRoutes";

describe("mobileSyncRoutes", () => {
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

  it("should register GET / for getting mobile sync data", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/" });
  });

  it("should register GET /status for getting mobile sync status", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/status" });
  });

  it("should register GET /full for getting full mobile data", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/full" });
  });

  it("should register POST / for pushing mobile sync data", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });
});
