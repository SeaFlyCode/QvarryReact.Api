// Mock all dependencies BEFORE imports
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

jest.mock("../../controllers/dataShareControllers", () => ({
  handleShareData: jest.fn(),
  handleGetSharedData: jest.fn(),
  handleUpdateShareStatus: jest.fn(),
  handleGetReceivedShares: jest.fn(),
  handleGetSentShares: jest.fn(),
}));

import router from "../../routes/dataShareRoutes";

describe("dataShareRoutes", () => {
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
    expect(routes.length).toBe(5);
  });

  it("should register POST /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register GET /received", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/received" });
  });

  it("should register GET /sent", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/sent" });
  });

  it("should register GET /:shareId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:shareId" });
  });

  it("should register PATCH /:shareId/status", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "PATCH",
      path: "/:shareId/status",
    });
  });
});
