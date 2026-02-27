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

jest.mock("../../controllers/pointsControllers", () => ({
  handleCreatePoint: jest.fn((req: any, res: any) => res.json({})),
  handleGetAllPointsByUserId: jest.fn((req: any, res: any) => res.json({})),
  handleSearchPoints: jest.fn((req: any, res: any) => res.json({})),
  handleGetPointById: jest.fn((req: any, res: any) => res.json({})),
  handleDeletePoint: jest.fn((req: any, res: any) => res.json({})),
  handleUpdatePoint: jest.fn((req: any, res: any) => res.json({})),
}));

import router from "../../routes/pointsRoutes";

describe("pointsRoutes", () => {
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

  it("should register POST / route", () => {
    const routes = getRoutes();
    const createRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/",
    );
    expect(createRoute).toBeDefined();
  });

  it("should register GET /search route", () => {
    const routes = getRoutes();
    const searchRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/search",
    );
    expect(searchRoute).toBeDefined();
  });

  it("should register GET / route", () => {
    const routes = getRoutes();
    const getAllRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/",
    );
    expect(getAllRoute).toBeDefined();
  });

  it("should register GET /:id route", () => {
    const routes = getRoutes();
    const getByIdRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/:id",
    );
    expect(getByIdRoute).toBeDefined();
  });

  it("should register DELETE /:id route", () => {
    const routes = getRoutes();
    const deleteRoute = routes.find(
      (r) => r.method === "DELETE" && r.path === "/:id",
    );
    expect(deleteRoute).toBeDefined();
  });

  it("should register PUT /:id route", () => {
    const routes = getRoutes();
    const updateRoute = routes.find(
      (r) => r.method === "PUT" && r.path === "/:id",
    );
    expect(updateRoute).toBeDefined();
  });
});
