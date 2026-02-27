jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/adminMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/maintenanceMiddleware", () => ({
  getMaintenanceStatus: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

jest.mock("../../controllers/maintenanceController", () => ({
  activateMaintenance: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  deactivateMaintenance: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  updateMaintenanceMessage: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
}));

import router from "../../routes/maintenanceRoutes";

describe("maintenanceRoutes", () => {
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

  it("should register GET /status for getting maintenance status", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/status" });
  });

  it("should register POST /activate for activating maintenance mode", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/activate" });
  });

  it("should register POST /deactivate for deactivating maintenance mode", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/deactivate" });
  });

  it("should register PUT /message for updating maintenance message", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PUT", path: "/message" });
  });
});
