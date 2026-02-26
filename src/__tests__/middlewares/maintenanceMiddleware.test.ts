/**
 * Tests unitaires pour maintenanceMiddleware
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-key-for-unit-tests";

// Mock logger
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Mock Maintenance model
const mockMaintenanceModel = {
  findOne: jest.fn(),
};
jest.mock("../../models/maintenance", () => mockMaintenanceModel);

// Mock JWT key manager
const mockJwtKeyManager = {
  hasVersion: jest.fn().mockReturnValue(false),
  getKeyByVersion: jest.fn().mockReturnValue(null),
};
jest.mock("../../utils/jwtKeyManager", () => ({
  jwtKeyManager: mockJwtKeyManager,
}));

import { Request, Response, NextFunction } from "express";
import {
  maintenanceMiddleware,
  getMaintenanceStatus,
} from "../../middlewares/maintenanceMiddleware";
import jwt from "jsonwebtoken";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  cookies: {},
  headers: {},
  path: "/test",
  method: "GET",
  ...overrides,
});

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

// ════════════════════════════════════════════════════════
// ✅ Test Suite
// ════════════════════════════════════════════════════════

describe("maintenanceMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Exempt routes", () => {
    it("should allow access to /maintenance routes", async () => {
      const req = mockReq({ path: "/maintenance" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockMaintenanceModel.findOne).not.toHaveBeenCalled();
    });

    it("should allow access to /maintenance/status", async () => {
      const req = mockReq({
        path: "/maintenance/status",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should allow access to /auth/login", async () => {
      const req = mockReq({ path: "/auth/login" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should allow access to /auth/verify-2fa", async () => {
      const req = mockReq({ path: "/auth/verify-2fa" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should allow access to /auth/check", async () => {
      const req = mockReq({ path: "/auth/check" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should allow access to /auth/complete-2fa-login", async () => {
      const req = mockReq({
        path: "/auth/complete-2fa-login",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should allow access to /admin routes", async () => {
      const req = mockReq({ path: "/admin/users" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("Maintenance mode inactive", () => {
    it("should allow access when no maintenance record exists", async () => {
      mockMaintenanceModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should allow access when maintenance is not active", async () => {
      mockMaintenanceModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          isActive: false,
          message: "Test maintenance",
        }),
      });

      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("Maintenance mode active", () => {
    beforeEach(() => {
      mockMaintenanceModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          isActive: true,
          message: "Site en maintenance",
          estimatedEndTime: new Date("2024-12-31T23:59:59Z"),
        }),
      });
    });

    it("should block access when maintenance is active and no token", async () => {
      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        maintenance: true,
        message: "Site en maintenance",
        estimatedEndTime: expect.any(Date),
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should block access for non-admin users", async () => {
      const userToken = jwt.sign(
        { id: "user123", isAdmin: false },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: userToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow access for admin users with valid token (cookie)", async () => {
      const adminToken = jwt.sign(
        { id: "admin123", isAdmin: true },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should allow access for admin users with valid token (header)", async () => {
      const adminToken = jwt.sign(
        { id: "admin123", isAdmin: true },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        path: "/api/fiches",
        headers: { authorization: `Bearer ${adminToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should allow access for admin with versioned key", async () => {
      const adminToken = jwt.sign(
        { id: "admin123", isAdmin: true, kv: "v1" },
        "versioned-secret",
      );

      mockJwtKeyManager.hasVersion.mockReturnValue(true);
      mockJwtKeyManager.getKeyByVersion.mockReturnValue("versioned-secret");

      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should block if versioned key not found but fallback to main secret", async () => {
      const adminToken = jwt.sign(
        { id: "admin123", isAdmin: true, kv: "v1" },
        process.env.JWT_SECRET!, // Signed with main secret
      );

      mockJwtKeyManager.hasVersion.mockReturnValue(true);
      mockJwtKeyManager.getKeyByVersion.mockReturnValue(null); // Key not found

      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled(); // Falls back to main secret
    });

    it("should block access with expired admin token", async () => {
      const expiredToken = jwt.sign(
        {
          id: "admin123",
          isAdmin: true,
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: expiredToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it("should block access with invalid token", async () => {
      const req = mockReq({
        path: "/api/fiches",
        cookies: { token: "invalid.token.here" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it("should use default message if none provided", async () => {
      mockMaintenanceModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          isActive: true,
          message: null,
        }),
      });

      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        maintenance: true,
        message: "Le site est actuellement en maintenance.",
        estimatedEndTime: undefined,
      });
    });
  });

  describe("Error handling", () => {
    it("should allow access if database query fails", async () => {
      mockMaintenanceModel.findOne.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("Database error")),
      });

      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should handle synchronous errors", async () => {
      mockMaintenanceModel.findOne.mockImplementation(() => {
        throw new Error("Synchronous error");
      });

      const req = mockReq({ path: "/api/fiches" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await maintenanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});

describe("getMaintenanceStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return maintenance status when active", async () => {
    mockMaintenanceModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        isActive: true,
        message: "Maintenance en cours",
        estimatedEndTime: new Date("2024-12-31T23:59:59Z"),
      }),
    });

    const req = {} as Request;
    const res = mockRes() as unknown as Response;

    await getMaintenanceStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      isActive: true,
      message: "Maintenance en cours",
      estimatedEndTime: expect.any(Date),
    });
  });

  it("should return inactive status when no maintenance", async () => {
    mockMaintenanceModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const req = {} as Request;
    const res = mockRes() as unknown as Response;

    await getMaintenanceStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      isActive: false,
      message: null,
      estimatedEndTime: null,
    });
  });

  it("should return inactive status when maintenance is not active", async () => {
    mockMaintenanceModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        isActive: false,
        message: "Previous maintenance",
      }),
    });

    const req = {} as Request;
    const res = mockRes() as unknown as Response;

    await getMaintenanceStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      isActive: false,
      message: "Previous maintenance",
      estimatedEndTime: null,
    });
  });

  it("should handle database errors gracefully", async () => {
    mockMaintenanceModel.findOne.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error("Database error")),
    });

    const req = {} as Request;
    const res = mockRes() as unknown as Response;

    await getMaintenanceStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      isActive: false,
      message: null,
      estimatedEndTime: null,
    });
  });
});
