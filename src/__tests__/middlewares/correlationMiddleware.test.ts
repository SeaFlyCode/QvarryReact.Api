/**
 * Tests unitaires pour correlationMiddleware
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
import {
  correlationMiddleware,
  getCorrelationId,
} from "../../middlewares/correlationMiddleware";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  get: jest.fn(),
  path: "/test",
  method: "GET",
  correlationId: undefined,
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

describe("correlationMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Correlation ID generation", () => {
    it("should generate a UUID correlation ID when no header present", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Assert - Check that a correlation ID was attached to req
          expect(req.correlationId).toBeDefined();
          expect(typeof req.correlationId).toBe("string");

          // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
          const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          expect(req.correlationId).toMatch(uuidRegex);

          // Check that response header was set
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            req.correlationId,
          );

          // Check that next was called
          expect(next).toHaveBeenCalledTimes(1);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should use existing X-Correlation-ID header if provided", (done) => {
      // Arrange
      const existingCorrelationId = "existing-correlation-id-12345";
      const req = mockReq({
        headers: {
          "x-correlation-id": existingCorrelationId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Assert - Should use existing correlation ID
          expect(req.correlationId).toBe(existingCorrelationId);
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            existingCorrelationId,
          );
          expect(next).toHaveBeenCalledTimes(1);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should use existing correlation ID even if it is not UUID format", (done) => {
      // Arrange
      const customCorrelationId = "custom-id-format";
      const req = mockReq({
        headers: {
          "x-correlation-id": customCorrelationId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          expect(req.correlationId).toBe(customCorrelationId);
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            customCorrelationId,
          );

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });

  describe("Response header setting", () => {
    it("should set X-Correlation-ID response header", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Assert
          expect(res.setHeader).toHaveBeenCalledTimes(1);
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            expect.any(String),
          );

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should set response header before calling next", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;

      let setHeaderCalled = false;
      (res as any).setHeader = jest.fn(() => {
        setHeaderCalled = true;
        return res;
      });

      const next = jest.fn(() => {
        try {
          expect(setHeaderCalled).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });

  describe("Request attachment", () => {
    it("should attach correlationId to req object", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Assert
          expect(req.correlationId).toBeDefined();
          expect(typeof req.correlationId).toBe("string");
          expect(req.correlationId!.length).toBeGreaterThan(0);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should make correlationId available in async context", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Within the AsyncLocalStorage context, we should be able to get the correlation ID
          const correlationId = getCorrelationId();
          expect(correlationId).toBeDefined();
          expect(correlationId).toBe(req.correlationId);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });

  describe("getCorrelationId function", () => {
    it("should return undefined when called outside middleware context", () => {
      // Arrange & Act
      const correlationId = getCorrelationId();

      // Assert
      expect(correlationId).toBeUndefined();
    });

    it("should return correlationId when called within middleware context", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Act
          const correlationId = getCorrelationId();

          // Assert
          expect(correlationId).toBeDefined();
          expect(correlationId).toBe(req.correlationId);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should return same correlationId in nested async operations", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(async () => {
        try {
          const correlationId1 = getCorrelationId();

          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));

          const correlationId2 = getCorrelationId();

          // Assert - Should maintain same correlation ID across async operations
          expect(correlationId1).toBe(correlationId2);
          expect(correlationId1).toBe(req.correlationId);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string correlation ID in header", (done) => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-correlation-id": "",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Empty string is falsy, so should generate new UUID
          expect(req.correlationId).toBeDefined();
          expect(req.correlationId).not.toBe("");
          const uuidRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          expect(req.correlationId).toMatch(uuidRegex);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should handle very long correlation ID", (done) => {
      // Arrange
      const longId = "a".repeat(1000);
      const req = mockReq({
        headers: {
          "x-correlation-id": longId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Should accept and use the long ID as-is
          expect(req.correlationId).toBe(longId);
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            longId,
          );

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should handle special characters in correlation ID", (done) => {
      // Arrange
      const specialId = "id-with-!@#$%^&*()-special-chars";
      const req = mockReq({
        headers: {
          "x-correlation-id": specialId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          expect(req.correlationId).toBe(specialId);
          expect(res.setHeader).toHaveBeenCalledWith(
            "X-Correlation-ID",
            specialId,
          );

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should handle uppercase header name", (done) => {
      // Arrange
      const correlationId = "test-uppercase-header";
      const req = mockReq({
        headers: {
          "X-Correlation-ID": correlationId, // Uppercase
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          // Express normalizes headers to lowercase, but our code should handle it
          expect(req.correlationId).toBeDefined();

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should generate unique IDs for different requests", () => {
      // Arrange
      const req1 = mockReq() as unknown as Request;
      const res1 = mockRes() as unknown as Response;
      const next1 = jest.fn() as NextFunction;

      const req2 = mockReq() as unknown as Request;
      const res2 = mockRes() as unknown as Response;
      const next2 = jest.fn() as NextFunction;

      // Act
      correlationMiddleware(req1, res1, next1);
      correlationMiddleware(req2, res2, next2);

      // Assert - Should generate different IDs
      expect(req1.correlationId).toBeDefined();
      expect(req2.correlationId).toBeDefined();
      expect(req1.correlationId).not.toBe(req2.correlationId);
    });

    it("should preserve existing ID across middleware chain", (done) => {
      // Arrange
      const existingId = "preserved-id-123";
      const req = mockReq({
        headers: {
          "x-correlation-id": existingId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;

      // Simulate middleware chain
      const next = jest.fn(async () => {
        try {
          // Simulate async work in next middleware
          await new Promise((resolve) => setTimeout(resolve, 5));

          // ID should still be the same
          expect(req.correlationId).toBe(existingId);
          expect(getCorrelationId()).toBe(existingId);

          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });

  describe("Next function behavior", () => {
    it("should call next exactly once", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          expect(next).toHaveBeenCalledTimes(1);
          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });

    it("should call next with no arguments", (done) => {
      // Arrange
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = jest.fn(() => {
        try {
          expect(next).toHaveBeenCalledWith();
          done();
        } catch (error) {
          done(error);
        }
      }) as NextFunction;

      // Act
      correlationMiddleware(req, res, next);
    });
  });
});
