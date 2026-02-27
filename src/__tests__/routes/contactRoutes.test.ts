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

jest.mock("../../controllers/contactControllers", () => ({
  addContact: jest.fn(),
  listContacts: jest.fn(),
  blockContact: jest.fn(),
  deleteContact: jest.fn(),
  getContactDetails: jest.fn(),
  acceptContact: jest.fn(),
  refuseContact: jest.fn(),
}));

import router from "../../routes/contactRoutes";

describe("contactRoutes", () => {
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
    expect(routes.length).toBe(7);
  });

  it("should register POST /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register GET /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/" });
  });

  it("should register GET /:contactId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:contactId" });
  });

  it("should register PATCH /:contactId/block", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "PATCH",
      path: "/:contactId/block",
    });
  });

  it("should register DELETE /:contactId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:contactId" });
  });

  it("should register POST /:contactId/accept", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:contactId/accept",
    });
  });

  it("should register POST /:contactId/refuse", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:contactId/refuse",
    });
  });
});
