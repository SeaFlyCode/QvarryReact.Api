// Mock all dependencies BEFORE imports
jest.mock("../../middlewares/authMiddleware", () => ({
  authMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/adminMiddleware", () => ({
  adminMiddleware: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../middlewares/validateObjectIdMiddleware", () => ({
  validateObjectId: jest.fn(
    (...fields: string[]) =>
      (req: any, res: any, next: any) =>
        next(),
  ),
}));

jest.mock("../../middlewares/conversationValidationMiddleware", () => ({
  validateMuteBody: jest.fn((req: any, res: any, next: any) => next()),
  validatePinBody: jest.fn((req: any, res: any, next: any) => next()),
  validateBlockBody: jest.fn((req: any, res: any, next: any) => next()),
  validatePaginationQuery: jest.fn((req: any, res: any, next: any) => next()),
}));

jest.mock("../../controllers/conversationsControllers", () => ({
  listConversations: jest.fn(),
  createPrivateConversation: jest.fn(),
  createGroupConversation: jest.fn(),
  getConversationDetails: jest.fn(),
  addGroupMembers: jest.fn(),
  removeGroupMember: jest.fn(),
  leaveGroup: jest.fn(),
  deleteGroup: jest.fn(),
  updateGroupName: jest.fn(),
  updateGroupMemberRole: jest.fn(),
  markConversationAsRead: jest.fn(),
  deleteConversation: jest.fn(),
  adminDeleteConversationPermanent: jest.fn(),
  // V7: handlers ajoutés Vagues récentes (mute/archive/pin/unread/block)
  muteConversation: jest.fn(),
  unmuteConversation: jest.fn(),
  archiveConversation: jest.fn(),
  unarchiveConversation: jest.fn(),
  listArchivedConversations: jest.fn(),
  pinConversation: jest.fn(),
  unpinConversation: jest.fn(),
  markConversationAsUnread: jest.fn(),
  unmarkConversationAsUnread: jest.fn(),
  blockConversation: jest.fn(),
  unblockConversation: jest.fn(),
}));

import router from "../../routes/conversationsRoutes";

// [MSG-OFF 2026-05-30] désactivation temporaire messagerie — réactiver en décommentant (.skip -> describe)
describe.skip("conversationsRoutes", () => {
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
    expect(routes.length).toBe(13);
  });

  it("should register GET /", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/" });
  });

  it("should register PATCH /:id/read", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PATCH", path: "/:id/read" });
  });

  it("should register DELETE /:id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id" });
  });

  it("should register DELETE /:id/permanent", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id/permanent" });
  });

  it("should register POST /private", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/private" });
  });

  it("should register POST /group", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/group" });
  });

  it("should register GET /:id", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "GET", path: "/:id" });
  });

  it("should register POST /:id/members", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "POST", path: "/:id/members" });
  });

  it("should register DELETE /:id/members/:userId", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({
      method: "DELETE",
      path: "/:id/members/:userId",
    });
  });

  it("should register DELETE /:id/leave", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id/leave" });
  });

  it("should register DELETE /:id/group", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "DELETE", path: "/:id/group" });
  });

  it("should register PATCH /:id/name", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PATCH", path: "/:id/name" });
  });

  it("should register PATCH /:id/role", () => {
    const routes = getRoutes();
    expect(routes).toContainEqual({ method: "PATCH", path: "/:id/role" });
  });
});
