/**
 * Tests unitaires pour rateLimitMiddleware
 */

process.env.NODE_ENV = "test";

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

// Mock audit service
const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};
jest.mock("../../services/auditService", () => ({
  auditService: mockAuditService,
}));

// Mock anonymizeIp
jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip) => ip),
}));

// Mock security alert service
const mockSecurityAlertService = {
  isIpBlocked: jest.fn().mockResolvedValue({ blocked: false }),
};

import { Request, Response, NextFunction } from "express";
import {
  ipBlockCheckMiddleware,
  resetRateLimit,
} from "../../middlewares/rateLimitMiddleware";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  path: "/api/test",
  method: "GET",
  get: jest.fn((header: string) => {
    if (header === "user-agent") return "test-user-agent";
    return undefined;
  }),
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

describe("ipBlockCheckMiddleware", () => {
  // We need to mock the dynamic import
  let getSecurityAlertService: any;

  beforeAll(() => {
    // Mock the dynamic import by replacing the module cache
    jest.mock("../../services/securityAlertService", () => ({
      securityAlertService: mockSecurityAlertService,
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSecurityAlertService.isIpBlocked.mockResolvedValue({ blocked: false });
  });

  describe("Non-blocked IPs", () => {
    it("should allow access for non-blocked IP", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: false,
      });

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(mockSecurityAlertService.isIpBlocked).toHaveBeenCalledWith(
        "127.0.0.1",
      );
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should use req.connection.remoteAddress if req.ip is undefined", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: false,
      });

      const req = mockReq({
        ip: undefined,
        connection: { remoteAddress: "192.168.1.1" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(mockSecurityAlertService.isIpBlocked).toHaveBeenCalledWith(
        "192.168.1.1",
      );
      expect(next).toHaveBeenCalled();
    });

    it("should use 'unknown' if both ip and remoteAddress are undefined", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: false,
      });

      const req = mockReq({
        ip: undefined,
        connection: { remoteAddress: undefined },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(mockSecurityAlertService.isIpBlocked).toHaveBeenCalledWith(
        "unknown",
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Blocked IPs", () => {
    it("should block access for blocked IP with time limit", async () => {
      const blockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Too many failed login attempts",
        until: blockedUntil,
      });

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Accès refusé. Votre adresse IP a été bloquée.",
        reason: "Too many failed login attempts",
        blockedUntil: blockedUntil,
        remainingMinutes: expect.any(Number),
        code: "IP_BLOCKED",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should block access for permanently blocked IP", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Malicious activity detected",
        until: null,
      });

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Accès refusé. Votre adresse IP a été bloquée.",
        reason: "Malicious activity detected",
        blockedUntil: null,
        remainingMinutes: "permanent",
        code: "IP_BLOCKED",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should log audit entry for blocked IP access attempt", async () => {
      const blockedUntil = new Date(Date.now() + 60 * 60 * 1000);
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Suspicious behavior",
        until: blockedUntil,
      });

      const req = mockReq({
        ip: "10.0.0.1",
        path: "/api/login",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: "BLOCKED_IP_ACCESS_ATTEMPT",
        level: "warning",
        ipAddress: "10.0.0.1",
        userAgent: "test-user-agent",
        details: {
          reason: "Suspicious behavior",
          blockedUntil: blockedUntil,
          attemptedPath: "/api/login",
        },
      });
    });

    it("should calculate remaining minutes correctly", async () => {
      const blockedUntil = new Date(Date.now() + 45 * 60 * 1000); // 45 minutes
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Test block",
        until: blockedUntil,
      });

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.remainingMinutes).toBeGreaterThan(44);
      expect(jsonCall.remainingMinutes).toBeLessThanOrEqual(45);
    });
  });

  describe("Error handling", () => {
    it("should allow access if isIpBlocked throws error", async () => {
      mockSecurityAlertService.isIpBlocked.mockRejectedValue(
        new Error("Database connection failed"),
      );

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should handle synchronous errors", async () => {
      mockSecurityAlertService.isIpBlocked.mockImplementation(() => {
        throw new Error("Synchronous error");
      });

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should handle audit service errors gracefully", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Test",
      });
      mockAuditService.log.mockRejectedValue(new Error("Audit service down"));

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // The middleware fails-open: if audit service throws, it allows access to prevent blocking legitimate users
      await ipBlockCheckMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("should handle block status without reason", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: undefined,
        until: null,
      });

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: undefined,
        }),
      );
    });

    it("should handle missing user-agent", async () => {
      mockSecurityAlertService.isIpBlocked.mockResolvedValue({
        blocked: true,
        reason: "Test",
      });

      const req = mockReq({ ip: "10.0.0.1" }) as unknown as Request;
      req.get = jest.fn().mockReturnValue(undefined);
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await ipBlockCheckMiddleware(req, res, next);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: undefined,
        }),
      );
    });
  });
});

describe("resetRateLimit", () => {
  it("should reset rate limit for identifier", () => {
    // This function just deletes from a Map, so we test it doesn't throw
    expect(() => resetRateLimit("test-identifier")).not.toThrow();
  });

  it("should accept any string identifier", () => {
    expect(() => resetRateLimit("user@example.com")).not.toThrow();
    expect(() => resetRateLimit("192.168.1.1")).not.toThrow();
    expect(() => resetRateLimit("")).not.toThrow();
  });

  it("should be idempotent", () => {
    const identifier = "test-user";
    expect(() => {
      resetRateLimit(identifier);
      resetRateLimit(identifier);
      resetRateLimit(identifier);
    }).not.toThrow();
  });
});
