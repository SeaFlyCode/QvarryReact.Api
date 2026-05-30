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

jest.mock("../../controllers/listsControllers", () => ({
  handleCreateList: jest.fn((req: any, res: any) => res.status(201).json({})),
  handleGetAllLists: jest.fn((req: any, res: any) => res.status(200).json([])),
  handleGetListById: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleDeleteList: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleUpdateList: jest.fn((req: any, res: any) => res.status(200).json({})),
  handleGetListByUserId: jest.fn((req: any, res: any) =>
    res.status(200).json([]),
  ),
  handleAddPointToList: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleRemovePointFromList: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleGetPointsByListId: jest.fn((req: any, res: any) =>
    res.status(200).json([]),
  ),
  handleGetListsByPointId: jest.fn((req: any, res: any) =>
    res.status(200).json([]),
  ),
  handleBulkAddPointsToList: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleBulkRemovePointsFromList: jest.fn((req: any, res: any) =>
    res.status(200).json({}),
  ),
  handleSyncListData: jest.fn((req: any, res: any) => res.status(200).json({})),
}));

import router from "../../routes/listsRoutes";

// [LIST-OFF 2026-05-30] désactivation temporaire du système de listes — réactiver en décommentant (describe.skip → describe)
describe.skip("listsRoutes", () => {
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
    expect(routes).toHaveLength(13);
  });

  it("should register POST / for creating a list", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register POST /:listId/points/:pointId for adding a point to a list", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:listId/points/:pointId",
    });
  });

  it("should register POST /:listId/points/bulk/add for bulk adding points", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:listId/points/bulk/add",
    });
  });

  it("should register POST /:listId/points/bulk/remove for bulk removing points", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:listId/points/bulk/remove",
    });
  });

  it("should register POST /sync for syncing list data", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/sync" });
  });

  it("should register GET / for getting all lists", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/" });
  });

  it("should register GET /:id for getting a list by id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:id" });
  });

  it("should register GET /user/:userId for getting lists by user id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/user/:userId" });
  });

  it("should register GET /:listId/points for getting points by list id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:listId/points" });
  });

  it("should register GET /points/:pointId/lists for getting lists by point id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "GET",
      path: "/points/:pointId/lists",
    });
  });

  it("should register PUT /:id for updating a list", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PUT", path: "/:id" });
  });

  it("should register DELETE /:id for deleting a list", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id" });
  });

  it("should register DELETE /:listId/points/:pointId for removing a point from a list", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "DELETE",
      path: "/:listId/points/:pointId",
    });
  });
});
