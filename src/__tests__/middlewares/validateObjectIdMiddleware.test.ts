/**
 * Tests unitaires pour validateObjectIdMiddleware
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

import { Request, Response, NextFunction } from "express";
import { validateObjectId } from "../../middlewares/validateObjectIdMiddleware";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  params: {},
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  get: jest.fn(),
  path: "/test",
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

describe("validateObjectIdMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Single parameter validation", () => {
    it("should return 400 for invalid ObjectId", () => {
      // Arrange
      const req = mockReq({
        params: { id: "invalid-id" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should call next() for valid ObjectId", () => {
      // Arrange - Valid 24-character hex string
      const req = mockReq({
        params: { id: "507f1f77bcf86cd799439011" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should call next() for empty string ObjectId", () => {
      // Arrange - Empty string is falsy, so validation is skipped
      const req = mockReq({
        params: { id: "" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert - Empty string is falsy, so the middleware skips validation
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return 400 for ObjectId with invalid characters", () => {
      // Arrange
      const req = mockReq({
        params: { id: "507f1f77bcf86cd79943901g" }, // 'g' is not hex
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 400 for ObjectId with wrong length", () => {
      // Arrange
      const req = mockReq({
        params: { id: "507f1f77bcf86cd7994390" }, // Too short
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Multiple parameters validation", () => {
    it("should validate multiple params and call next() if all valid", () => {
      // Arrange
      const req = mockReq({
        params: {
          userId: "507f1f77bcf86cd799439011",
          postId: "507f1f77bcf86cd799439012",
          commentId: "507f1f77bcf86cd799439013",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId", "commentId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return 400 if first param is invalid", () => {
      // Arrange
      const req = mockReq({
        params: {
          userId: "invalid",
          postId: "507f1f77bcf86cd799439012",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 400 if second param is invalid", () => {
      // Arrange
      const req = mockReq({
        params: {
          userId: "507f1f77bcf86cd799439011",
          postId: "invalid",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 400 if any param in list is invalid", () => {
      // Arrange
      const req = mockReq({
        params: {
          userId: "507f1f77bcf86cd799439011",
          postId: "507f1f77bcf86cd799439012",
          commentId: "invalid-comment-id",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId", "commentId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Missing parameters handling", () => {
    it("should skip validation for params not present in req.params", () => {
      // Arrange - Only userId present, postId missing
      const req = mockReq({
        params: {
          userId: "507f1f77bcf86cd799439011",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId");

      // Act
      middleware(req, res, next);

      // Assert - Should pass because postId is undefined, not invalid
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should call next() when no params are present in req.params", () => {
      // Arrange - Empty params
      const req = mockReq({
        params: {},
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId");

      // Act
      middleware(req, res, next);

      // Assert - Should pass because no params are present
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should validate only present params in mixed scenario", () => {
      // Arrange - userId present and valid, postId missing, commentId present and valid
      const req = mockReq({
        params: {
          userId: "507f1f77bcf86cd799439011",
          commentId: "507f1f77bcf86cd799439013",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId", "commentId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return 400 if present param is invalid even if others are missing", () => {
      // Arrange - userId invalid, postId missing
      const req = mockReq({
        params: {
          userId: "invalid-id",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("userId", "postId");

      // Act
      middleware(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Identifiant invalide",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("should handle null params gracefully", () => {
      // Arrange
      const req = mockReq({
        params: {
          id: null,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert - null is falsy, should skip validation
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should handle undefined params gracefully", () => {
      // Arrange
      const req = mockReq({
        params: {
          id: undefined,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId("id");

      // Act
      middleware(req, res, next);

      // Assert - undefined is falsy, should skip validation
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should work with no parameter names provided", () => {
      // Arrange
      const req = mockReq({
        params: { id: "507f1f77bcf86cd799439011" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;
      const middleware = validateObjectId(); // No params to validate

      // Act
      middleware(req, res, next);

      // Assert - Should just call next() since no validation needed
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should accept different valid ObjectId formats", () => {
      // Arrange - Test with different valid ObjectIds
      const validIds = [
        "507f1f77bcf86cd799439011",
        "000000000000000000000000",
        "FFFFFFFFFFFFFFFFFFFFFFFF",
        "aAbBcCdDeEfF001122334455",
      ];

      validIds.forEach((id) => {
        const req = mockReq({
          params: { id },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;
        const middleware = validateObjectId("id");

        // Act
        middleware(req, res, next);

        // Assert
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();

        jest.clearAllMocks();
      });
    });
  });
});
