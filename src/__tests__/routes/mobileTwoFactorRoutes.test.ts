jest.mock("../../middlewares/mobileAuthMiddleware", () => ({
  mobileAuthMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/mobileSecurityMiddleware", () => ({
  mobileSecurityMiddleware: jest.fn((req: any, res: any, next: any) => next()),
  verifyMobilePlatform: jest.fn((req: any, res: any, next: any) => next()),
  mobileRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
  mobileSecurityHeaders: jest.fn((req: any, res: any, next: any) => next()),
  checkAppVersion: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/mobileTwoFactorControllers", () => ({
  mobileSetupTwoFactor: jest.fn((req: any, res: any) => res.json({})),
  mobileVerifyAndEnableTwoFactor: jest.fn((req: any, res: any) => res.json({})),
  mobileDisableTwoFactor: jest.fn((req: any, res: any) => res.json({})),
  mobileVerifyTwoFactorLogin: jest.fn((req: any, res: any) => res.json({})),
  mobileRegenerateRecoveryCodes: jest.fn((req: any, res: any) => res.json({})),
  mobileGetTwoFactorStatus: jest.fn((req: any, res: any) => res.json({})),
}));

import router from "../../routes/mobileTwoFactorRoutes";

describe("mobileTwoFactorRoutes", () => {
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
    expect(routes).toHaveLength(6);
  });

  it("should register GET /status route", () => {
    const routes = getRoutes();
    const statusRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/status",
    );
    expect(statusRoute).toBeDefined();
  });

  it("should register POST /setup route", () => {
    const routes = getRoutes();
    const setupRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/setup",
    );
    expect(setupRoute).toBeDefined();
  });

  it("should register POST /verify-setup route", () => {
    const routes = getRoutes();
    const verifySetupRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/verify-setup",
    );
    expect(verifySetupRoute).toBeDefined();
  });

  it("should register POST /disable route", () => {
    const routes = getRoutes();
    const disableRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/disable",
    );
    expect(disableRoute).toBeDefined();
  });

  it("should register POST /regenerate-codes route", () => {
    const routes = getRoutes();
    const regenerateRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/regenerate-codes",
    );
    expect(regenerateRoute).toBeDefined();
  });

  it("should register POST /verify-login route", () => {
    const routes = getRoutes();
    const verifyLoginRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/verify-login",
    );
    expect(verifyLoginRoute).toBeDefined();
  });
});
