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

jest.mock("../../services/validationService", () => ({
  validateFiche: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/fichesControllers", () => ({
  handleCreateFiche: jest.fn(),
  handleGetAllFiches: jest.fn(),
  handleGetFicheById: jest.fn(),
  handleDeleteFiche: jest.fn(),
  handleUpdateFiche: jest.fn(),
  handleGetFicheByPointId: jest.fn(),
  handleGetUserFiches: jest.fn(),
  handleAddPointToFiche: jest.fn(),
  handleRemovePointFromFiche: jest.fn(),
  handleGetPointsByFicheId: jest.fn(),
  handleSearchFiches: jest.fn(),
}));

import router from "../../routes/fichesRoutes";

describe("fichesRoutes", () => {
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
    expect(routes.length).toBe(11);
  });

  it("should register GET /search", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/search" });
  });

  it("should register POST /add", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/add" });
  });

  it("should register POST /remove", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/remove" });
  });

  it("should register GET /fiche/:ficheId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/fiche/:ficheId" });
  });

  it("should register GET /by-point/:pointId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/by-point/:pointId",
    });
  });

  it("should register GET /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/" });
  });

  it("should register GET /user/:userId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/user/:userId" });
  });

  it("should register POST /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register GET /:id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:id" });
  });

  it("should register PUT /:id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PUT", path: "/:id" });
  });

  it("should register DELETE /:id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id" });
  });
});
