jest.mock("../../middlewares/mobileSecurityMiddleware", () => ({
  mobileSecurityMiddleware: jest.fn((req: any, res: any, next: any) => next()),
  verifyMobilePlatform: jest.fn((req: any, res: any, next: any) => next()),
  mobileRateLimitMiddleware: jest.fn((req: any, res: any, next: any) => next()),
  mobileSecurityHeaders: jest.fn((req: any, res: any, next: any) => next()),
  checkAppVersion: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/mobileAuthControllers", () => ({
  handleMobileLogin: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleMobileRegister: jest.fn((req: any, res: any) =>
    res.status(201).json({}),
  ),
  handleMobileForgotPassword: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleMobileRefreshToken: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

jest.mock("../../controllers/auth/logoutController", () => ({
  handleLogoutUser: jest.fn((req: any, res: any) => res.status(200).json({})),
}));

import router from "../../routes/mobileAuthRoutes";

describe("mobileAuthRoutes", () => {
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
    expect(routes).toHaveLength(5);
  });

  it("should register POST /login for mobile login", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/login" });
  });

  it("should register POST /register for mobile registration", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/register" });
  });

  it("should register POST /forgot-password for mobile password reset", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/forgot-password" });
  });

  it("should register POST /refresh for refreshing mobile tokens", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/refresh" });
  });

  it("should register POST /logout for mobile logout", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/logout" });
  });
});
