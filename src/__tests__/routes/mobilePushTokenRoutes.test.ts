jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/mobileSecurityMiddleware", () => ({
  verifyMobilePlatform: jest.fn((req: any, res: any, next: any) => next()),
  mobileRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
  // V7: middleware ajouté Vagues récentes
  mobileSyncRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/appCheckMiddleware", () => ({
  appCheckMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/mobilePushTokenControllers", () => ({
  handleRegisterPushToken: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleDeletePushToken: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

import router from "../../routes/mobilePushTokenRoutes";

describe("mobilePushTokenRoutes", () => {
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
    expect(routes).toHaveLength(2);
  });

  it("should register POST / for registering push token", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register DELETE / for deleting push token", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/" });
  });
});
