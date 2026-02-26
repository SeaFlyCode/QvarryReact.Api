/**
 * Tests unitaires pour authMiddleware
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-key-for-unit-tests";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";
process.env.REQUIRE_ACTIVE_SESSION = "true";
process.env.ALLOW_SESSION_RECOVERY = "true";

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

// Mock memory storage
const mockMemoryStorage = {
  hasSession: jest.fn().mockReturnValue(true),
  touchSession: jest.fn(),
};
jest.mock("../../services/memoryStorageService", () => ({
  memoryStorage: mockMemoryStorage,
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
  exists: jest.fn(),
};
jest.mock("../../models/users", () => mockUserModel);

// Mock loadAndDecryptUserData
const mockLoadAndDecryptUserData = jest.fn().mockResolvedValue(undefined);
jest.mock("../../controllers/auth", () => ({
  loadAndDecryptUserData: mockLoadAndDecryptUserData,
}));

// Mock error utils
jest.mock("../../utils/errorUtils", () => ({
  isErrorWithName: jest.fn((error, name) => error?.name === name),
}));

// Mock log utils
jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip) => ip),
}));

// Mock audit service
const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

import { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware";
import jwt from "jsonwebtoken";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  cookies: {},
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  get: jest.fn((header: string) => {
    if (header === "user-agent") return "test-user-agent";
    return undefined;
  }),
  path: "/api/test",
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

describe("authMiddleware", () => {
  let validToken: string;
  const userId = "507f1f77bcf86cd799439011";

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a valid token for tests
    validToken = jwt.sign(
      { id: userId, isAdmin: false },
      process.env.JWT_SECRET!,
      { algorithm: "HS256" },
    );

    // Reset default mocks
    mockRedisSessionService.isTokenBlacklisted.mockResolvedValue(false);
    mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
    mockMemoryStorage.hasSession.mockReturnValue(true);
    mockJwtKeyManager.hasVersion.mockReturnValue(false);
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
    it("should return 401 if no token is provided", async () => {
      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise. Aucun token fourni.",
        code: "NO_TOKEN",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should accept token from cookie", async () => {
      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });

    it("should accept token from Authorization header", async () => {
      const req = mockReq({
        headers: { authorization: `Bearer ${validToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });

    it("should prioritize cookie over Authorization header", async () => {
      const cookieToken = jwt.sign(
        { id: "cookie-user" },
        process.env.JWT_SECRET!,
      );
      const headerToken = jwt.sign(
        { id: "header-user" },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        cookies: { token: cookieToken },
        headers: { authorization: `Bearer ${headerToken}` },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe("cookie-user");
    });
  });

  describe("Token blacklist check", () => {
    it("should reject blacklisted token", async () => {
      mockRedisSessionService.isTokenBlacklisted.mockResolvedValue(true);

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Token révoqué. Veuillez vous reconnecter.",
        code: "TOKEN_REVOKED",
        tokenBlacklisted: true,
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("JWT verification", () => {
    it("should verify token with main secret", async () => {
      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should verify token with versioned key", async () => {
      const versionedToken = jwt.sign(
        { id: userId, kv: "v1" },
        "versioned-secret",
        { algorithm: "HS256" },
      );

      mockJwtKeyManager.hasVersion.mockReturnValue(true);
      mockJwtKeyManager.getKeyByVersion.mockReturnValue("versioned-secret");

      const req = mockReq({
        cookies: { token: versionedToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

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
        cookies: { token: versionedToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Token invalide.",
        code: "KEY_VERSION_INVALID",
      });
    });

    it("should reject expired token", async () => {
      const expiredToken = jwt.sign(
        { id: userId, exp: Math.floor(Date.now() / 1000) - 3600 },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        cookies: { token: expiredToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification échouée. Veuillez vous reconnecter.",
        code: "AUTH_FAILED",
      });
    });

    it("should reject malformed token", async () => {
      const req = mockReq({
        cookies: { token: "invalid.token.here" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification échouée. Veuillez vous reconnecter.",
        code: "AUTH_FAILED",
      });
    });
  });

  describe("Mobile token detection", () => {
    it("should detect mobile token via platform claim", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
      mockMemoryStorage.hasSession.mockReturnValue(false);

      const req = mockReq({
        cookies: { token: mobileToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockRedisSessionService.validateSessionJti).toHaveBeenCalledWith(
        userId,
        "test-jti",
        "mobile",
      );
      expect(next).toHaveBeenCalled();
      expect((req as any).authType).toBe("mobile");
    });

    it("should detect mobile via x-platform header (iOS)", async () => {
      const mobileToken = jwt.sign(
        { id: userId, jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);

      const req = mockReq({
        cookies: { token: mobileToken },
        headers: { "x-platform": "iOS" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect((req as any).authType).toBe("mobile");
    });

    it("should detect mobile via x-platform header (android)", async () => {
      const mobileToken = jwt.sign(
        { id: userId, jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);

      const req = mockReq({
        cookies: { token: mobileToken },
        headers: { "x-platform": "android" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect((req as any).authType).toBe("mobile");
    });
  });

  describe("Session validation - Mobile", () => {
    it("should reject mobile token with invalid JTI", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(false);

      const req = mockReq({
        cookies: { token: mobileToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Session expirée. Veuillez rafraîchir votre token.",
        code: "SESSION_EXPIRED",
        requiresRefresh: true,
      });
    });

    it("should initialize memoryStorage lazily for mobile", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
      mockMemoryStorage.hasSession.mockReturnValue(false);
      mockLoadAndDecryptUserData.mockResolvedValue(undefined);

      const req = mockReq({
        cookies: { token: mobileToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockLoadAndDecryptUserData).toHaveBeenCalledWith(userId);
      expect(next).toHaveBeenCalled();
    });

    it("should handle lazy initialization error", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);
      mockMemoryStorage.hasSession.mockReturnValue(false);
      mockLoadAndDecryptUserData.mockRejectedValue(new Error("Init failed"));

      const req = mockReq({
        cookies: { token: mobileToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de l'initialisation de la session.",
        code: "SESSION_INIT_ERROR",
      });
    });
  });

  describe("Session validation - Web", () => {
    it("should reject web token without session", async () => {
      process.env.ALLOW_SESSION_RECOVERY = "false";
      mockMemoryStorage.hasSession.mockReturnValue(false);

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Session expirée. Veuillez rafraîchir votre token.",
        code: "SESSION_EXPIRED",
        requiresRefresh: true,
      });

      process.env.ALLOW_SESSION_RECOVERY = "true";
    });

    it("should recover session if ALLOW_SESSION_RECOVERY is true", async () => {
      mockMemoryStorage.hasSession.mockReturnValue(false);
      mockLoadAndDecryptUserData.mockResolvedValue(undefined);

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockLoadAndDecryptUserData).toHaveBeenCalledWith(userId);
      expect(next).toHaveBeenCalled();
    });

    it("should handle session recovery failure", async () => {
      mockMemoryStorage.hasSession.mockReturnValue(false);
      mockLoadAndDecryptUserData.mockRejectedValue(
        new Error("Recovery failed"),
      );

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Session expirée. Veuillez vous reconnecter.",
        code: "SESSION_RECOVERY_FAILED",
        requiresRefresh: true,
      });
    });

    it("should skip session check if REQUIRE_ACTIVE_SESSION is false", async () => {
      process.env.REQUIRE_ACTIVE_SESSION = "false";
      mockMemoryStorage.hasSession.mockReturnValue(false);

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();

      process.env.REQUIRE_ACTIVE_SESSION = "true";
    });
  });

  describe("JTI validation - Web", () => {
    it("should validate JTI for web tokens", async () => {
      const tokenWithJti = jwt.sign(
        { id: userId, jti: "web-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(true);

      const req = mockReq({
        cookies: { token: tokenWithJti },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockRedisSessionService.validateSessionJti).toHaveBeenCalledWith(
        userId,
        "web-jti",
        "web",
      );
      expect(next).toHaveBeenCalled();
    });

    it("should reject web token with invalid JTI", async () => {
      const tokenWithJti = jwt.sign(
        { id: userId, jti: "invalid-jti" },
        process.env.JWT_SECRET!,
      );

      mockRedisSessionService.validateSessionJti.mockResolvedValue(false);

      const req = mockReq({
        cookies: { token: tokenWithJti },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Token invalide ou session expirée. Veuillez vous reconnecter.",
        code: "JTI_INVALID",
        tokenBlacklisted: true,
      });
    });
  });

  describe("Admin privilege validation", () => {
    it("should verify admin status from database", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
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
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.isAdmin).toBe(true);
    });

    it("should return 401 if user not found in database", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
      );

      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      const req = mockReq({
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non trouvé.",
        code: "USER_NOT_FOUND",
      });
    });

    it("should return 403 if user is blocked", async () => {
      const adminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
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
        cookies: { token: adminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: "Votre compte a été suspendu.",
        code: "ACCOUNT_BLOCKED",
      });
    });

    it("should block privilege escalation attempt", async () => {
      const fakeAdminToken = jwt.sign(
        { id: userId, isAdmin: true },
        process.env.JWT_SECRET!,
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
        cookies: { token: fakeAdminToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: "Accès refusé. Incident de sécurité enregistré.",
        code: "PRIVILEGE_ESCALATION_BLOCKED",
      });
      expect(mockRedisSessionService.blacklistToken).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Request enrichment", () => {
    it("should attach user data to request", async () => {
      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(req.user).toEqual({
        id: userId,
        isAdmin: false,
        tokenIssuedAt: expect.any(Number),
        tokenId: undefined,
        clientType: "web",
      });
    });

    it("should attach mobile context for mobile tokens", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        headers: {
          authorization: `Bearer ${mobileToken}`,
          "x-platform": "iOS",
          "x-device-id": "device-123",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect((req as any).mobileContext).toEqual({
        platform: "mobile",
        deviceId: "device-123",
        tokenType: "mobile",
      });
    });

    it("should touch session for web tokens", async () => {
      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockMemoryStorage.touchSession).toHaveBeenCalledWith(userId);
    });

    it("should not touch session for mobile tokens", async () => {
      const mobileToken = jwt.sign(
        { id: userId, platform: "mobile", jti: "test-jti" },
        process.env.JWT_SECRET!,
      );

      const req = mockReq({
        cookies: { token: mobileToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockMemoryStorage.touchSession).not.toHaveBeenCalled();
    });
  });

  describe("Logging", () => {
    it("should log authenticated access when LOG_AUTH_ACCESS is true", async () => {
      process.env.LOG_AUTH_ACCESS = "true";

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();

      delete process.env.LOG_AUTH_ACCESS;
    });
  });

  describe("Error handling", () => {
    it("should handle missing JWT_SECRET", async () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      mockJwtKeyManager.hasVersion.mockReturnValue(false);

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification échouée. Veuillez vous reconnecter.",
        code: "AUTH_FAILED",
      });

      process.env.JWT_SECRET = originalSecret;
    });

    it("should handle unexpected errors gracefully", async () => {
      mockRedisSessionService.isTokenBlacklisted.mockRejectedValue(
        new Error("Redis connection lost"),
      );

      const req = mockReq({
        cookies: { token: validToken },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification échouée. Veuillez vous reconnecter.",
        code: "AUTH_FAILED",
      });
    });
  });
});
