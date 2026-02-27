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

jest.mock("../../controllers/notificationsControllers", () => ({
  getNotifications: jest.fn((req: any, res: any) => res.json({})),
  getUnreadCount: jest.fn((req: any, res: any) => res.json({})),
  markAsRead: jest.fn((req: any, res: any) => res.json({})),
  markAllAsRead: jest.fn((req: any, res: any) => res.json({})),
  deleteNotification: jest.fn((req: any, res: any) => res.json({})),
  deleteAllRead: jest.fn((req: any, res: any) => res.json({})),
  createTestNotification: jest.fn((req: any, res: any) => res.json({})),
}));

import router from "../../routes/notificationsRoutes";

describe("notificationsRoutes", () => {
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
    // 6 regular routes + 1 test route (registered in test/dev environment)
    expect(routes).toHaveLength(7);
  });

  it("should register GET / route", () => {
    const routes = getRoutes();
    const getNotificationsRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/",
    );
    expect(getNotificationsRoute).toBeDefined();
  });

  it("should register GET /unread-count route", () => {
    const routes = getRoutes();
    const unreadCountRoute = routes.find(
      (r) => r.method === "GET" && r.path === "/unread-count",
    );
    expect(unreadCountRoute).toBeDefined();
  });

  it("should register PATCH /read-all route", () => {
    const routes = getRoutes();
    const readAllRoute = routes.find(
      (r) => r.method === "PATCH" && r.path === "/read-all",
    );
    expect(readAllRoute).toBeDefined();
  });

  it("should register PATCH /:notificationId/read route", () => {
    const routes = getRoutes();
    const markAsReadRoute = routes.find(
      (r) => r.method === "PATCH" && r.path === "/:notificationId/read",
    );
    expect(markAsReadRoute).toBeDefined();
  });

  it("should register DELETE /read route", () => {
    const routes = getRoutes();
    const deleteReadRoute = routes.find(
      (r) => r.method === "DELETE" && r.path === "/read",
    );
    expect(deleteReadRoute).toBeDefined();
  });

  it("should register DELETE /:notificationId route", () => {
    const routes = getRoutes();
    const deleteNotificationRoute = routes.find(
      (r) => r.method === "DELETE" && r.path === "/:notificationId",
    );
    expect(deleteNotificationRoute).toBeDefined();
  });

  it("should register POST /test route in test environment", () => {
    const routes = getRoutes();
    const testRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/test",
    );
    expect(testRoute).toBeDefined();
  });
});
