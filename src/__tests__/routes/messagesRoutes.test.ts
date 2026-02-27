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

jest.mock("../../controllers/messagesControllers", () => ({
  sendMessage: jest.fn((req: any, res: any) => res.status(201).json({})),
  getMessages: jest.fn((req: any, res: any) => res.status(200).json([])),
  markMessageAsRead: jest.fn((req: any, res: any) => res.status(200).json({})),
  markMessagesAsRead: jest.fn((req: any, res: any) => res.status(200).json({})),
  replyToMessage: jest.fn((req: any, res: any) => res.status(201).json({})),
  editMessage: jest.fn((req: any, res: any) => res.status(200).json({})),
  deleteMessage: jest.fn((req: any, res: any) => res.status(200).json({})),
}));

import router from "../../routes/messagesRoutes";

describe("messagesRoutes", () => {
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
    expect(routes).toHaveLength(7);
  });

  it("should register POST / for sending a message", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/" });
  });

  it("should register POST /read-batch for marking multiple messages as read", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/read-batch" });
  });

  it("should register POST /:messageId/reply for replying to a message", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "POST",
      path: "/:messageId/reply",
    });
  });

  it("should register GET /:conversationId for getting messages in a conversation", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:conversationId" });
  });

  it("should register PATCH /:messageId/read for marking a message as read", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "PATCH",
      path: "/:messageId/read",
    });
  });

  it("should register PATCH /:messageId for editing a message", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PATCH", path: "/:messageId" });
  });

  it("should register DELETE /:messageId for deleting a message", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:messageId" });
  });
});
