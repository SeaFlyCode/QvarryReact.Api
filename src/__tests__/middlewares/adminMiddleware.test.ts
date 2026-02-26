/**
 * Tests unitaires pour adminMiddleware
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";

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

jest.mock("../../services/auditService", () => ({
  auditService: {
    log: jest.fn(),
  },
}));

import { Request, Response, NextFunction } from "express";
import { adminMiddleware } from "../../middlewares/adminMiddleware";
import { auditService } from "../../services/auditService";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  user: undefined,
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  get: jest.fn((header: string) => {
    if (header === "user-agent") return "test-user-agent";
    return undefined;
  }),
  path: "/admin/test",
  method: "GET",
  ...overrides,
});

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

// ════════════════════════════════════════════════════════
// ✅ Test Suite
// ════════════════════════════════════════════════════════

describe("adminMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication check", () => {
    it("should return 401 if req.user is missing", async () => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise",
        code: "NOT_AUTHENTICATED",
      });
      expect(next).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it("should return 401 if req.user exists but has no id", async () => {
      // Arrange
      const req = mockReq({
        user: { isAdmin: true }, // No id
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise",
        code: "NOT_AUTHENTICATED",
      });
      expect(next).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it("should return 401 if req.user.id is empty string", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "", isAdmin: true },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise",
        code: "NOT_AUTHENTICATED",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Admin authorization check", () => {
    it("should return 403 if req.user.isAdmin is false and log audit", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user123", isAdmin: false },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: "Accès réservé aux administrateurs",
        code: "NOT_ADMIN",
      });
      expect(next).not.toHaveBeenCalled();

      // Verify audit log was called
      expect(auditService.log).toHaveBeenCalledWith({
        userId: "user123",
        action: "ADMIN_ACCESS_DENIED",
        level: "warning",
        ipAddress: "127.0.0.1",
        userAgent: "test-user-agent",
        details: {
          path: "/admin/test",
          method: "GET",
        },
      });
    });

    it("should return 403 if req.user.isAdmin is undefined", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user123" }, // isAdmin not set
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: "Accès réservé aux administrateurs",
        code: "NOT_ADMIN",
      });
      expect(next).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it("should return 403 if req.user.isAdmin is explicitly false", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user123", isAdmin: false },
        ip: "192.168.1.1",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user123",
          action: "ADMIN_ACCESS_DENIED",
          ipAddress: "192.168.1.1",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Successful admin access", () => {
    it("should call next() if req.user.isAdmin is true", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "admin123", isAdmin: true },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      // Audit log should NOT be called for denied access
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it("should call next() and not log if LOG_ADMIN_ACCESS is not set", async () => {
      // Arrange
      delete process.env.LOG_ADMIN_ACCESS;
      const req = mockReq({
        user: { id: "admin123", isAdmin: true, email: "admin@test.com" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('should call next() even if LOG_ADMIN_ACCESS is "true"', async () => {
      // Arrange
      process.env.LOG_ADMIN_ACCESS = "true";
      const req = mockReq({
        user: { id: "admin123", isAdmin: true },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();

      // Clean up
      delete process.env.LOG_ADMIN_ACCESS;
    });
  });

  describe("Error handling", () => {
    it("should return 500 on unexpected errors", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "admin123", isAdmin: true },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;

      // Mock auditService.log to throw an error to simulate unexpected error
      // But we need to trigger an error before the isAdmin check succeeds
      // Let's make the req.get throw an error
      (req as any).get = jest.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      // Actually, looking at the code, the get() is only called when isAdmin is false
      // So let's set isAdmin to false to trigger the path that uses get()
      req.user = { id: "user123", isAdmin: false };

      // Mock auditService.log to throw
      (auditService.log as jest.Mock).mockRejectedValueOnce(
        new Error("Audit service error"),
      );

      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la vérification des permissions",
        code: "ADMIN_CHECK_ERROR",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle Error objects in catch block", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user123", isAdmin: false },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Mock auditService.log to throw an Error
      (auditService.log as jest.Mock).mockRejectedValueOnce(
        new Error("Database connection lost"),
      );

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la vérification des permissions",
        code: "ADMIN_CHECK_ERROR",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle non-Error objects in catch block", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user123", isAdmin: false },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Mock auditService.log to throw a string
      (auditService.log as jest.Mock).mockRejectedValueOnce(
        "String error message",
      );

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la vérification des permissions",
        code: "ADMIN_CHECK_ERROR",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Request context logging", () => {
    it("should include correct request details in audit log", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user456", isAdmin: false },
        path: "/admin/users",
        method: "POST",
        ip: "10.0.0.1",
      }) as unknown as Request;
      req.get = jest.fn((header: string) => {
        if (header === "user-agent") return "Mozilla/5.0 Custom Browser";
        return undefined;
      });

      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(auditService.log).toHaveBeenCalledWith({
        userId: "user456",
        action: "ADMIN_ACCESS_DENIED",
        level: "warning",
        ipAddress: "10.0.0.1",
        userAgent: "Mozilla/5.0 Custom Browser",
        details: {
          path: "/admin/users",
          method: "POST",
        },
      });
    });

    it("should handle missing user-agent gracefully", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user789", isAdmin: false },
      }) as unknown as Request;
      req.get = jest.fn().mockReturnValue(undefined);

      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user789",
          userAgent: undefined,
        }),
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle req.user with only id (minimal user object)", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "minimal-user" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should treat isAdmin: null as non-admin", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user-null-admin", isAdmin: null },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should treat isAdmin: 0 as non-admin", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user-zero-admin", isAdmin: 0 },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow isAdmin: 1 as truthy admin", async () => {
      // Arrange
      const req = mockReq({
        user: { id: "user-one-admin", isAdmin: 1 },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await adminMiddleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
