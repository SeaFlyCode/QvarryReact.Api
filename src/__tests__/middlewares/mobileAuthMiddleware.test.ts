/**
 * Tests unitaires pour mobileAuthMiddleware
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

// Mock Redis session service
const mockRedisSessionService = {
  isTokenBlacklisted: jest.fn().mockResolvedValue(false),
  validateSessionJti: jest.fn().mockResolvedValue(true),
  blacklistToken: jest.fn().mockResolvedValue(undefined),
};
jest.mock("../../services/redisSessionService", () => ({
  redisSessionService: mockRedisSessionService,
}));

// Mock JWT key manager
const mockJwtKeyManager = {
  hasVersion: jest.fn().mockReturnValue(false),
  getKeyByVersion: jest.fn().mockReturnValue(null),
};
jest.mock("../../utils/jwtKeyManager", () => ({
  jwtKeyManager: mockJwtKeyManager,
}));

// Mock User model
const mockUserModel = {
  findById: jest.fn(),
  exists: jest.fn().mockResolvedValue(true),
};
jest.mock("../../models/users", () => mockUserModel);

// Mock log utils
jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip) => ip),
}));

// Mock audit service
const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

import { Request, Response, NextFunction } from "express";
import {
  mobileAuthMiddleware,
  mobileAuthMiddlewareOptional,
} from "../../middlewares/mobileAuthMiddleware";
import jwt from "jsonwebtoken";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  get: jest.fn((header: string) => {
    if (header === "user-agent") return "mobile-test-agent";
    return undefined;
  }),
  path: "/api/mobile/test",
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

describe("mobileAuthMiddleware", () => {
  let validToken: string;
  const userId = "507f1f77bcf86cd799439011";

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a valid mobile token
    validToken = jwt.sign(
      { id: userId, isAdmin: false },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        audience: "qvarry-mobile",
        issuer: "qvarry-api",
      },
    );

    // Reset default mocks
    mockRedisSessionService.isTokenBlacklisted.mockResolvedValue(false);
    mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
    mockJwtKeyManager.hasVersion.mockReturnValue(false);
    mockUserModel.exists.mockResolvedValue(true);
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: userId,
          is_admin: false,
          is_blocked: false,
        }),
      }),
    });
  });

  describe("Token retrieval", () => {
    it("should return 401 if no Authorization header", async () => {
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token d'authentification requis",
        code: "NO_TOKEN",
        hint: "Header 'Authorization: Bearer <token>' requis",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 if Authorization header doesn't start with Bearer", async () => {
      const req = mockReq({
        headers: { authorization: "Basic xyz" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token d'authentification requis",
        code: "NO_TOKEN",
        hint: "Header 'Authorization: Bearer <token>' requis",
      });
    });

    it("should return 401 if token is empty after Bearer", async () => {
      const req = mockReq({
        headers: { authorization: "Bearer " },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token d'authentification invalide",
        code: "INVALID_TOKEN_FORMAT",
      });
    });

    it("should accept valid Bearer token", async () => {
      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });
  });

  describe("Token blacklist check", () => {
    it("should reject blacklisted token", async () => {
      mockRedisSessionService.isTokenBlacklisted.mockResolvedValue(true);

      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token révoqué. Veuillez vous reconnecter.",
        code: "TOKEN_REVOKED",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("JWT verification", () => {
    it("should verify token with main secret", async () => {
      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should verify token with versioned key", async () => {
      const versionedToken = jwt.sign(
        { id: userId, kv: "v1" },
        "versioned-secret",
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockJwtKeyManager.hasVersion.mockReturnValue(true);
      mockJwtKeyManager.getKeyByVersion.mockReturnValue("versioned-secret");

      const req = mockReq({
        headers: { authorization: `Bearer ${versionedToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(mockJwtKeyManager.getKeyByVersion).toHaveBeenCalledWith("v1");
      expect(next).toHaveBeenCalled();
    });

    it("should reject if versioned key not found", async () => {
      const versionedToken = jwt.sign(
        { id: userId, kv: "v1" },
        "versioned-secret",
        { algorithm: "HS256" },
      );

      mockJwtKeyManager.hasVersion.mockReturnValue(true);
      mockJwtKeyManager.getKeyByVersion.mockReturnValue(null);

      const req = mockReq({
        headers: { authorization: `Bearer ${versionedToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token invalide",
        code: "KEY_VERSION_INVALID",
      });
    });

    it("should reject token with invalid payload", async () => {
      const req = mockReq({
        headers: { authorization: "Bearer invalid.token.here" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token invalide",
        code: "TOKEN_DECODE_ERROR",
      });
    });

    it("should handle missing JWT_SECRET", async () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur d'authentification",
        code: "AUTH_ERROR",
      });

      process.env.JWT_SECRET = originalSecret;
    });
  });

  describe("Device binding validation", () => {
    it("should allow token with matching device ID", async () => {
      const tokenWithDevice = jwt.sign(
        { id: userId, deviceId: "device-123" },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      const req = mockReq({
        headers: {
          authorization: `Bearer ${tokenWithDevice}`,
          "x-device-id": "device-123",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject token with mismatched device ID", async () => {
      const tokenWithDevice = jwt.sign(
        { id: userId, deviceId: "device-123" },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      const req = mockReq({
        headers: {
          authorization: `Bearer ${tokenWithDevice}`,
          "x-device-id": "device-456",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token invalide pour cet appareil. Veuillez vous reconnecter.",
        code: "DEVICE_MISMATCH",
      });
    });

    it("should allow token without device ID", async () => {
      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("JTI validation", () => {
    it("should validate JTI if present", async () => {
      const tokenWithJti = jwt.sign(
        { id: userId, jti: "mobile-jti-123" },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);

      const req = mockReq({
        headers: { authorization: `Bearer ${tokenWithJti}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(mockRedisSessionService.validateSessionJti).toHaveBeenCalledWith(
        userId,
        "mobile-jti-123",
        "mobile",
      );
      expect(next).toHaveBeenCalled();
    });

    it("should reject if JTI is invalid", async () => {
      const tokenWithJti = jwt.sign(
        { id: userId, jti: "invalid-jti" },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(false);

      const req = mockReq({
        headers: { authorization: `Bearer ${tokenWithJti}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Session expirée. Veuillez rafraîchir votre token.",
        code: "SESSION_EXPIRED",
        requiresRefresh: true,
      });
    });
  });

  describe("User existence check", () => {
    it("should reject if user does not exist", async () => {
      mockUserModel.exists.mockResolvedValue(null);

      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    });
  });

  describe("Admin privilege validation", () => {
    it("should verify admin status from database", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: userId,
            is_admin: true,
            is_blocked: false,
          }),
        }),
      });

      const req = mockReq({
        headers: { authorization: `Bearer ${adminToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.isAdmin).toBe(true);
    });

    it("should return 401 if admin user not found", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      const req = mockReq({
        headers: { authorization: `Bearer ${adminToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non trouvé",
        code: "USER_NOT_FOUND",
      });
    });

    it("should return 403 if user is blocked", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: userId,
            is_admin: true,
            is_blocked: true,
          }),
        }),
      });

      const req = mockReq({
        headers: { authorization: `Bearer ${adminToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Votre compte a été suspendu",
        code: "ACCOUNT_BLOCKED",
      });
    });

    it("should block privilege escalation attempt", async () => {
      const fakeAdminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: userId,
            is_admin: false, // DB says not admin
            is_blocked: false,
          }),
        }),
      });

      // Mock dynamic import of auditService
      jest.isolateModules(() => {
        jest.doMock("../../services/auditService", () => ({
          auditService: mockAuditService,
        }));
      });

      const req = mockReq({
        headers: { authorization: `Bearer ${fakeAdminToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Accès refusé. Incident de sécurité enregistré.",
        code: "PRIVILEGE_ESCALATION_BLOCKED",
      });
      expect(mockRedisSessionService.blacklistToken).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Request enrichment", () => {
    it("should attach user data to request", async () => {
      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(req.user).toEqual({
        id: userId,
        isAdmin: false,
      });
    });
  });

  describe("Error handling", () => {
    it("should handle TokenExpiredError", async () => {
      const expiredToken = jwt.sign(
        { id: userId, exp: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET!,
        { algorithm: "HS256" },
      );

      const req = mockReq({
        headers: { authorization: `Bearer ${expiredToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token expiré. Veuillez rafraîchir votre token.",
        code: "TOKEN_EXPIRED",
        requiresRefresh: true,
      });
    });

    it("should handle JsonWebTokenError", async () => {
      const req = mockReq({
        headers: { authorization: "Bearer malformed-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: expect.stringMatching(/TOKEN_INVALID|TOKEN_DECODE_ERROR/),
        }),
      );
    });

    it("should handle NotBeforeError", async () => {
      const notYetValidToken = jwt.sign(
        { id: userId, nbf: Math.floor(Date.now() / 1000) + 3600 },
        process.env.JWT_SECRET!,
        {
          algorithm: "HS256",
          audience: "qvarry-mobile",
          issuer: "qvarry-api",
        },
      );

      const req = mockReq({
        headers: { authorization: `Bearer ${notYetValidToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token pas encore valide",
        code: "TOKEN_NOT_ACTIVE",
      });
    });

    it("should handle unexpected errors", async () => {
      mockUserModel.exists.mockRejectedValue(new Error("Database error"));

      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur d'authentification",
        code: "AUTH_ERROR",
      });
    });
  });

  describe("Development logging", () => {
    it("should log in development mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await mobileAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });
});

describe("mobileAuthMiddlewareOptional", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default mock implementations after clearMocks
    mockUserModel.exists.mockResolvedValue(true);
    mockRedisSessionService.isTokenBlacklisted.mockResolvedValue(false);
    mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
    mockUserModel.findById.mockResolvedValue({
      _id: "user123",
      isAdmin: false,
    });
  });

  it("should continue without token", async () => {
    const req = mockReq() as unknown as Request;
    const res = mockRes() as unknown as Response;
    const next = mockNext as NextFunction;

    await mobileAuthMiddlewareOptional(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should continue if Authorization header doesn't start with Bearer", async () => {
    const req = mockReq({
      headers: { authorization: "Basic xyz" },
    }) as unknown as Request;
    const res = mockRes() as unknown as Response;
    const next = mockNext as NextFunction;

    await mobileAuthMiddlewareOptional(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should validate token if present", async () => {
    const validToken = jwt.sign({ id: "user123" }, process.env.JWT_SECRET!, {
      algorithm: "HS256",
      audience: "qvarry-mobile",
      issuer: "qvarry-api",
    });

    const req = mockReq({
      headers: { authorization: `Bearer ${validToken}` },
    }) as unknown as Request;
    const res = mockRes() as unknown as Response;
    const next = mockNext as NextFunction;

    await mobileAuthMiddlewareOptional(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
  });
});
