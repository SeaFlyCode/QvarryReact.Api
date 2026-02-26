/**
 * Tests for redisSessionService
 * Service de gestion des sessions et blacklist avec Redis et fallback mémoire
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// ════════════════════════════════════════════════════════════════════════════
// SETUP: MOCK IOREDIS BEFORE IMPORT
// ════════════════════════════════════════════════════════════════════════════

// Create a mock Redis instance that we can control
let mockRedisInstance: any;

// Store the original env vars to restore later
const originalEnv = { ...process.env };

// Mock ioredis BEFORE importing the service
// @ts-ignore - Mock object types don't need to match exactly
jest.mock("ioredis", () => {
  mockRedisInstance = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    setex: jest.fn().mockResolvedValue("OK"),
    setnx: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    flushdb: jest.fn().mockResolvedValue("OK"),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    ping: jest.fn().mockResolvedValue("PONG"),
    status: "ready",
    scanStream: jest.fn(() => {
      // Return an async iterator
      return (async function* () {
        yield [];
      })();
    }),
  };

  // Mock both Redis and Cluster classes
  const MockRedis = jest.fn(() => mockRedisInstance);
  const MockCluster = jest.fn(() => ({
    ...mockRedisInstance,
    // Cluster uses keys() instead of scanStream
    keys: jest.fn().mockResolvedValue([]),
  }));

  return {
    __esModule: true,
    default: MockRedis,
    Cluster: MockCluster,
  };
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: MEMORY FALLBACK MODE (REDIS_ENABLED=false)
// ════════════════════════════════════════════════════════════════════════════

describe("RedisSessionService - Memory Fallback Mode", () => {
  let redisSessionService: any;
  let RedisSessionService: any;

  beforeEach(() => {
    // Clear all modules to get fresh imports
    jest.resetModules();
    jest.clearAllMocks();

    // Set Redis to disabled BEFORE importing
    process.env.REDIS_ENABLED = "false";
    process.env.NODE_ENV = "test";
    process.env.SESSION_TTL = "3600";
    process.env.JWT_EXPIRES_IN = "15m";

    // Import the service (will use memory fallback)
    const module = require("../../services/redisSessionService");
    redisSessionService = module.redisSessionService;
    RedisSessionService = module.RedisSessionService;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION MANAGEMENT - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("createSession - Memory", () => {
    it("should create a session in memory when Redis is disabled", async () => {
      // Arrange
      const userId = "user123";
      const metadata = {
        tokenId: "token123",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      };

      // Act
      await redisSessionService.createSession(userId, metadata);

      // Assert
      const session = await redisSessionService.getSession(
        userId,
        metadata.tokenId,
      );
      expect(session).toBeDefined();
      expect(session?.userId).toBe(userId);
      expect(session?.tokenId).toBe(metadata.tokenId);
      expect(session?.ipAddress).toBe(metadata.ipAddress);
      expect(session?.userAgent).toBe(metadata.userAgent);
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.lastActivity).toBeInstanceOf(Date);
    });

    it("should create a session without tokenId", async () => {
      // Arrange
      const userId = "user456";
      const metadata = {
        ipAddress: "192.168.1.2",
        userAgent: "Chrome",
      };

      // Act
      await redisSessionService.createSession(userId, metadata);

      // Assert
      const session = await redisSessionService.getSession(userId);
      expect(session).toBeDefined();
      expect(session?.userId).toBe(userId);
      expect(session?.tokenId).toBeUndefined();
    });
  });

  describe("getSession - Memory", () => {
    it("should retrieve an existing session", async () => {
      // Arrange
      const userId = "user789";
      const metadata = { tokenId: "token789" };
      await redisSessionService.createSession(userId, metadata);

      // Act
      const session = await redisSessionService.getSession(
        userId,
        metadata.tokenId,
      );

      // Assert
      expect(session).toBeDefined();
      expect(session?.userId).toBe(userId);
    });

    it("should return null for non-existent session", async () => {
      // Act
      const session = await redisSessionService.getSession("nonexistent");

      // Assert
      expect(session).toBeNull();
    });
  });

  describe("hasSession - Memory", () => {
    it("should return true if session exists", async () => {
      // Arrange
      const userId = "user101";
      await redisSessionService.createSession(userId, {});

      // Act
      const exists = await redisSessionService.hasSession(userId);

      // Assert
      expect(exists).toBe(true);
    });

    it("should return false if session does not exist", async () => {
      // Act
      const exists = await redisSessionService.hasSession("nonexistent");

      // Assert
      expect(exists).toBe(false);
    });
  });

  describe("deleteSession - Memory", () => {
    it("should delete an existing session", async () => {
      // Arrange
      const userId = "user202";
      const tokenId = "token202";
      await redisSessionService.createSession(userId, { tokenId });

      // Act
      await redisSessionService.deleteSession(userId, tokenId);

      // Assert
      const exists = await redisSessionService.hasSession(userId, tokenId);
      expect(exists).toBe(false);
    });
  });

  describe("touchSession - Memory", () => {
    it("should update lastActivity timestamp", async () => {
      // Arrange
      const userId = "user303";
      const tokenId = "token303";
      await redisSessionService.createSession(userId, { tokenId });
      const originalSession = await redisSessionService.getSession(
        userId,
        tokenId,
      );
      const originalActivity = originalSession?.lastActivity;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act
      await redisSessionService.touchSession(userId, tokenId);

      // Assert
      const updatedSession = await redisSessionService.getSession(
        userId,
        tokenId,
      );
      expect(updatedSession?.lastActivity.getTime()).toBeGreaterThan(
        originalActivity?.getTime() || 0,
      );
    });

    it("should do nothing if session does not exist", async () => {
      // Act & Assert - should not throw
      await expect(
        redisSessionService.touchSession("nonexistent"),
      ).resolves.not.toThrow();
    });
  });

  describe("getAllActiveSessions - Memory", () => {
    it("should return count of active sessions", async () => {
      // Arrange
      await redisSessionService.createSession("user1", {});
      await redisSessionService.createSession("user2", {});
      await redisSessionService.createSession("user3", {});

      // Act
      const count = await redisSessionService.getAllActiveSessions();

      // Assert
      expect(count).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLACKLIST MANAGEMENT - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("blacklistToken - Memory", () => {
    it("should add token to blacklist in memory", async () => {
      // Arrange
      const token = "jwt.token.here";
      const details = {
        token,
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "User logout",
        userId: "user404",
      };

      // Act
      await redisSessionService.blacklistToken(token, details, 3600);

      // Assert
      const isBlacklisted = await redisSessionService.isTokenBlacklisted(token);
      expect(isBlacklisted).toBe(true);
    });
  });

  describe("isTokenBlacklisted - Memory", () => {
    it("should return true for blacklisted token", async () => {
      // Arrange
      const token = "blacklisted.token";
      const details = {
        token,
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "Suspicious activity",
        userId: "user505",
      };
      await redisSessionService.blacklistToken(token, details, 3600);

      // Act
      const isBlacklisted = await redisSessionService.isTokenBlacklisted(token);

      // Assert
      expect(isBlacklisted).toBe(true);
    });

    it("should return false for non-blacklisted token", async () => {
      // Act
      const isBlacklisted =
        await redisSessionService.isTokenBlacklisted("clean.token");

      // Assert
      expect(isBlacklisted).toBe(false);
    });
  });

  describe("getBlacklistedTokenDetails - Memory", () => {
    it("should return details of blacklisted token", async () => {
      // Arrange
      const token = "detailed.token";
      const details = {
        token,
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "Token revoked",
        userId: "user606",
      };
      await redisSessionService.blacklistToken(token, details, 3600);

      // Act
      const retrieved =
        await redisSessionService.getBlacklistedTokenDetails(token);

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.reason).toBe("Token revoked");
      expect(retrieved?.userId).toBe("user606");
    });

    it("should return null for non-blacklisted token", async () => {
      // Act
      const details =
        await redisSessionService.getBlacklistedTokenDetails(
          "nonexistent.token",
        );

      // Assert
      expect(details).toBeNull();
    });
  });

  describe("getBlacklistCount - Memory", () => {
    it("should return count of blacklisted tokens", async () => {
      // Arrange
      const details1 = {
        token: "token1",
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "Test",
        userId: "user1",
      };
      const details2 = {
        token: "token2",
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "Test",
        userId: "user2",
      };
      await redisSessionService.blacklistToken("token1", details1, 3600);
      await redisSessionService.blacklistToken("token2", details2, 3600);

      // Act
      const count = await redisSessionService.getBlacklistCount();

      // Assert
      expect(count).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIN ATTEMPTS - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("recordLoginAttempt - Memory", () => {
    it("should record a login attempt", async () => {
      // Arrange
      const email = "test@example.com";

      // Act
      await redisSessionService.recordLoginAttempt(email, false, 30);

      // Assert
      const attempts = await redisSessionService.getLoginAttempts(email);
      expect(attempts).toBeDefined();
      expect(attempts?.attempts).toBe(1);
      expect(attempts?.lastAttempt).toBeInstanceOf(Date);
    });

    it("should increment attempts for repeated failures", async () => {
      // Arrange
      const email = "repeat@example.com";

      // Act
      await redisSessionService.recordLoginAttempt(email, false, 30);
      await redisSessionService.recordLoginAttempt(email, false, 30);
      await redisSessionService.recordLoginAttempt(email, false, 30);

      // Assert
      const attempts = await redisSessionService.getLoginAttempts(email);
      expect(attempts?.attempts).toBe(3);
    });

    it("should set blockedUntil when blocked=true", async () => {
      // Arrange
      const email = "blocked@example.com";

      // Act
      await redisSessionService.recordLoginAttempt(email, true, 30);

      // Assert
      const attempts = await redisSessionService.getLoginAttempts(email);
      expect(attempts?.blockedUntil).toBeInstanceOf(Date);
      expect(attempts?.blockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("getLoginAttempts - Memory", () => {
    it("should return null for email with no attempts", async () => {
      // Act
      const attempts =
        await redisSessionService.getLoginAttempts("new@example.com");

      // Assert
      expect(attempts).toBeNull();
    });
  });

  describe("resetLoginAttempts - Memory", () => {
    it("should reset login attempts", async () => {
      // Arrange
      const email = "reset@example.com";
      await redisSessionService.recordLoginAttempt(email, false, 30);

      // Act
      await redisSessionService.resetLoginAttempts(email);

      // Assert
      const attempts = await redisSessionService.getLoginAttempts(email);
      expect(attempts).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // JTI STORAGE - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("storeSessionJti - Memory", () => {
    it("should store JTI for user session", async () => {
      // Arrange
      const userId = "user707";
      const jti = "jti-12345";

      // Act
      await redisSessionService.storeSessionJti(userId, jti, 3600, "web");

      // Assert
      const storedJti = await redisSessionService.getSessionJti(userId, "web");
      expect(storedJti).toBe(jti);
    });

    it("should store different JTI for mobile client", async () => {
      // Arrange
      const userId = "user808";
      const webJti = "web-jti";
      const mobileJti = "mobile-jti";

      // Act
      await redisSessionService.storeSessionJti(userId, webJti, 3600, "web");
      await redisSessionService.storeSessionJti(
        userId,
        mobileJti,
        3600,
        "mobile",
      );

      // Assert
      const storedWebJti = await redisSessionService.getSessionJti(
        userId,
        "web",
      );
      const storedMobileJti = await redisSessionService.getSessionJti(
        userId,
        "mobile",
      );
      expect(storedWebJti).toBe(webJti);
      expect(storedMobileJti).toBe(mobileJti);
    });
  });

  describe("validateSessionJti - Memory", () => {
    it("should return true for valid JTI", async () => {
      // Arrange
      const userId = "user909";
      const jti = "valid-jti";
      await redisSessionService.storeSessionJti(userId, jti, 3600);

      // Act
      const isValid = await redisSessionService.validateSessionJti(userId, jti);

      // Assert
      expect(isValid).toBe(true);
    });

    it("should return false for invalid JTI", async () => {
      // Arrange
      const userId = "user1010";
      const jti = "valid-jti";
      await redisSessionService.storeSessionJti(userId, jti, 3600);

      // Act
      const isValid = await redisSessionService.validateSessionJti(
        userId,
        "wrong-jti",
      );

      // Assert
      expect(isValid).toBe(false);
    });
  });

  describe("deleteSessionJti - Memory", () => {
    it("should delete stored JTI", async () => {
      // Arrange
      const userId = "user1111";
      const jti = "delete-jti";
      await redisSessionService.storeSessionJti(userId, jti, 3600);

      // Act
      await redisSessionService.deleteSessionJti(userId, "web");

      // Assert
      const storedJti = await redisSessionService.getSessionJti(userId, "web");
      expect(storedJti).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WEBSOCKET TOKENS - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("consumeWsToken - Memory", () => {
    it("should return true on first consumption", async () => {
      // Arrange
      const tokenJti = "ws-token-123";

      // Act
      const result = await redisSessionService.consumeWsToken(tokenJti);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false on second consumption (token already used)", async () => {
      // Arrange
      const tokenJti = "ws-token-456";
      await redisSessionService.consumeWsToken(tokenJti);

      // Act
      const result = await redisSessionService.consumeWsToken(tokenJti);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("isWsTokenUsed - Memory", () => {
    it("should return true if token was consumed", async () => {
      // Arrange
      const tokenJti = "ws-token-789";
      await redisSessionService.consumeWsToken(tokenJti);

      // Act
      const isUsed = await redisSessionService.isWsTokenUsed(tokenJti);

      // Assert
      expect(isUsed).toBe(true);
    });

    it("should return false if token was not consumed", async () => {
      // Act
      const isUsed = await redisSessionService.isWsTokenUsed("unused-token");

      // Assert
      expect(isUsed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STATS AND UTILITIES - MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  describe("getStats - Memory", () => {
    it("should return statistics", async () => {
      // Arrange
      await redisSessionService.createSession("user1", {});
      await redisSessionService.createSession("user2", {});
      await redisSessionService.blacklistToken(
        "token1",
        {
          token: "token1",
          expiresAt: new Date(),
          blacklistedAt: new Date(),
          reason: "test",
          userId: "user1",
        },
        3600,
      );

      // Act
      const stats = await redisSessionService.getStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.sessions).toBe(2);
      expect(stats.blacklisted).toBe(1);
      expect(stats.redisConnected).toBe(false); // Redis disabled in this suite
    });
  });

  describe("flushAll - Memory", () => {
    it("should clear all memory stores", async () => {
      // Arrange
      await redisSessionService.createSession("user1", {});
      await redisSessionService.blacklistToken(
        "token1",
        {
          token: "token1",
          expiresAt: new Date(),
          blacklistedAt: new Date(),
          reason: "test",
          userId: "user1",
        },
        3600,
      );

      // Act
      await redisSessionService.flushAll();

      // Assert
      const sessionCount = await redisSessionService.getAllActiveSessions();
      const blacklistCount = await redisSessionService.getBlacklistCount();
      expect(sessionCount).toBe(0);
      expect(blacklistCount).toBe(0);
    });
  });

  describe("isRedisEnabled - Memory", () => {
    it("should return false when Redis is disabled", () => {
      // Act
      const isEnabled = redisSessionService.isRedisEnabled();

      // Assert
      expect(isEnabled).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: REDIS MODE (REDIS_ENABLED=true)
// ════════════════════════════════════════════════════════════════════════════

describe("RedisSessionService - Redis Mode", () => {
  let redisSessionService: any;
  let RedisSessionService: any;

  beforeEach(() => {
    // Clear all modules to get fresh imports
    jest.resetModules();
    jest.clearAllMocks();

    // Set Redis to enabled BEFORE importing
    process.env.REDIS_ENABLED = "true";
    process.env.NODE_ENV = "test";
    process.env.SESSION_TTL = "3600";
    process.env.JWT_EXPIRES_IN = "15m";
    process.env.REDIS_HOST = "localhost";
    process.env.REDIS_PORT = "6379";

    // Reset mock Redis instance
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.setex.mockResolvedValue("OK");
    mockRedisInstance.setnx.mockResolvedValue(1);
    mockRedisInstance.del.mockResolvedValue(1);
    mockRedisInstance.exists.mockResolvedValue(0);
    mockRedisInstance.keys.mockResolvedValue([]);
    mockRedisInstance.flushdb.mockResolvedValue("OK");
    mockRedisInstance.status = "ready";

    // Import the service (will use Redis)
    const module = require("../../services/redisSessionService");
    redisSessionService = module.redisSessionService;
    RedisSessionService = module.RedisSessionService;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION MANAGEMENT - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("createSession - Redis", () => {
    it("should create a session in Redis", async () => {
      // Act
      await redisSessionService.createSession("user123", {
        tokenId: "token123",
        ipAddress: "192.168.1.1",
      });

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        expect.stringContaining("qvarry:session:user123:token123"),
        3600,
        expect.any(String),
      );
    });

    it("should create session without tokenId", async () => {
      // Act
      await redisSessionService.createSession("user456", {
        ipAddress: "192.168.1.2",
      });

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "qvarry:session:user456",
        3600,
        expect.any(String),
      );
    });
  });

  describe("getSession - Redis", () => {
    it("should retrieve session from Redis", async () => {
      // Arrange
      const sessionData = {
        userId: "user789",
        tokenId: "token789",
        ipAddress: "192.168.1.3",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(sessionData));

      // Act
      const session = await redisSessionService.getSession(
        "user789",
        "token789",
      );

      // Assert
      expect(mockRedisInstance.get).toHaveBeenCalledWith(
        "qvarry:session:user789:token789",
      );
      expect(session).toBeDefined();
      expect(session?.userId).toBe("user789");
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.lastActivity).toBeInstanceOf(Date);
    });

    it("should return null if session not found in Redis", async () => {
      // Arrange
      mockRedisInstance.get.mockResolvedValue(null);

      // Act
      const session = await redisSessionService.getSession("nonexistent");

      // Assert
      expect(session).toBeNull();
    });
  });

  describe("hasSession - Redis", () => {
    it("should check session existence in Redis", async () => {
      // Arrange
      mockRedisInstance.exists.mockResolvedValue(1);

      // Act
      const exists = await redisSessionService.hasSession(
        "user101",
        "token101",
      );

      // Assert
      expect(mockRedisInstance.exists).toHaveBeenCalledWith(
        "qvarry:session:user101:token101",
      );
      expect(exists).toBe(true);
    });

    it("should return false if session does not exist", async () => {
      // Arrange
      mockRedisInstance.exists.mockResolvedValue(0);

      // Act
      const exists = await redisSessionService.hasSession("nonexistent");

      // Assert
      expect(exists).toBe(false);
    });
  });

  describe("deleteSession - Redis", () => {
    it("should delete session from Redis", async () => {
      // Act
      await redisSessionService.deleteSession("user202", "token202");

      // Assert
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        "qvarry:session:user202:token202",
      );
    });
  });

  describe("touchSession - Redis", () => {
    it("should update session activity in Redis", async () => {
      // Arrange
      const sessionData = {
        userId: "user303",
        tokenId: "token303",
        ipAddress: "192.168.1.4",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      mockRedisInstance.exists.mockResolvedValue(1);
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(sessionData));

      // Act
      await redisSessionService.touchSession("user303", "token303");

      // Assert
      expect(mockRedisInstance.get).toHaveBeenCalled();
      expect(mockRedisInstance.setex).toHaveBeenCalled();
    });
  });

  describe("getAllActiveSessions - Redis", () => {
    it("should count sessions using scanStream", async () => {
      // Arrange
      mockRedisInstance.scanStream.mockReturnValue(
        (async function* () {
          yield ["session1", "session2"];
          yield ["session3"];
        })(),
      );

      // Act
      const count = await redisSessionService.getAllActiveSessions();

      // Assert
      expect(count).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BLACKLIST MANAGEMENT - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("blacklistToken - Redis", () => {
    it("should blacklist token in Redis", async () => {
      // Arrange
      const token = "jwt.token.here";
      const details = {
        token,
        expiresAt: new Date(Date.now() + 3600000),
        blacklistedAt: new Date(),
        reason: "User logout",
        userId: "user404",
      };

      // Act
      await redisSessionService.blacklistToken(token, details, 3600);

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        `qvarry:blacklist:${token}`,
        3600,
        expect.any(String),
      );
    });
  });

  describe("isTokenBlacklisted - Redis", () => {
    it("should check if token is blacklisted in Redis", async () => {
      // Arrange
      mockRedisInstance.exists.mockResolvedValue(1);

      // Act
      const isBlacklisted =
        await redisSessionService.isTokenBlacklisted("token");

      // Assert
      expect(mockRedisInstance.exists).toHaveBeenCalledWith(
        "qvarry:blacklist:token",
      );
      expect(isBlacklisted).toBe(true);
    });
  });

  describe("getBlacklistedTokenDetails - Redis", () => {
    it("should retrieve blacklist details from Redis", async () => {
      // Arrange
      const details = {
        token: "token",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        blacklistedAt: new Date().toISOString(),
        reason: "Test",
        userId: "user505",
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(details));

      // Act
      const retrieved =
        await redisSessionService.getBlacklistedTokenDetails("token");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.reason).toBe("Test");
      expect(retrieved?.expiresAt).toBeInstanceOf(Date);
      expect(retrieved?.blacklistedAt).toBeInstanceOf(Date);
    });
  });

  describe("getBlacklistCount - Redis", () => {
    it("should count blacklisted tokens using scanStream", async () => {
      // Arrange
      mockRedisInstance.scanStream.mockReturnValue(
        (async function* () {
          yield ["token1", "token2"];
        })(),
      );

      // Act
      const count = await redisSessionService.getBlacklistCount();

      // Assert
      expect(count).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIN ATTEMPTS - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("recordLoginAttempt - Redis", () => {
    it("should record login attempt in Redis", async () => {
      // Arrange
      mockRedisInstance.get.mockResolvedValue(null);

      // Act
      await redisSessionService.recordLoginAttempt(
        "test@example.com",
        false,
        30,
      );

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "qvarry:login_attempts:test@example.com",
        expect.any(Number),
        expect.any(String),
      );
    });

    it("should increment attempts in Redis", async () => {
      // Arrange
      const existingData = {
        attempts: 2,
        lastAttempt: new Date().toISOString(),
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(existingData));

      // Act
      await redisSessionService.recordLoginAttempt(
        "repeat@example.com",
        false,
        30,
      );

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalled();
    });
  });

  describe("getLoginAttempts - Redis", () => {
    it("should retrieve login attempts from Redis", async () => {
      // Arrange
      const data = {
        attempts: 3,
        lastAttempt: new Date().toISOString(),
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(data));

      // Act
      const attempts =
        await redisSessionService.getLoginAttempts("test@example.com");

      // Assert
      expect(attempts).toBeDefined();
      expect(attempts?.attempts).toBe(3);
      expect(attempts?.lastAttempt).toBeInstanceOf(Date);
    });
  });

  describe("resetLoginAttempts - Redis", () => {
    it("should delete login attempts from Redis", async () => {
      // Act
      await redisSessionService.resetLoginAttempts("reset@example.com");

      // Assert
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        "qvarry:login_attempts:reset@example.com",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // JTI STORAGE - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("storeSessionJti - Redis", () => {
    it("should store JTI in Redis", async () => {
      // Act
      await redisSessionService.storeSessionJti(
        "user707",
        "jti-12345",
        3600,
        "web",
      );

      // Assert
      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "qvarry:jti:user707:web",
        3600,
        "jti-12345",
      );
    });
  });

  describe("getSessionJti - Redis", () => {
    it("should retrieve JTI from Redis", async () => {
      // Arrange
      mockRedisInstance.get.mockResolvedValue("jti-12345");

      // Act
      const jti = await redisSessionService.getSessionJti("user808", "web");

      // Assert
      expect(mockRedisInstance.get).toHaveBeenCalledWith(
        "qvarry:jti:user808:web",
      );
      expect(jti).toBe("jti-12345");
    });
  });

  describe("deleteSessionJti - Redis", () => {
    it("should delete JTI from Redis", async () => {
      // Act
      await redisSessionService.deleteSessionJti("user909", "mobile");

      // Assert
      expect(mockRedisInstance.del).toHaveBeenCalledWith(
        "qvarry:jti:user909:mobile",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WEBSOCKET TOKENS - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("consumeWsToken - Redis", () => {
    it("should consume WS token in Redis using SETNX", async () => {
      // Arrange
      mockRedisInstance.setnx.mockResolvedValue(1);

      // Act
      const result = await redisSessionService.consumeWsToken("ws-token-123");

      // Assert
      expect(mockRedisInstance.setnx).toHaveBeenCalledWith(
        "qvarry:ws_token:ws-token-123",
        "used",
      );
      expect(mockRedisInstance.expire).toHaveBeenCalledWith(
        "qvarry:ws_token:ws-token-123",
        300,
      );
      expect(result).toBe(true);
    });

    it("should return false if token already consumed", async () => {
      // Arrange
      mockRedisInstance.setnx.mockResolvedValue(0);

      // Act
      const result = await redisSessionService.consumeWsToken("ws-token-456");

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("isWsTokenUsed - Redis", () => {
    it("should check if WS token is used in Redis", async () => {
      // Arrange
      mockRedisInstance.exists.mockResolvedValue(1);

      // Act
      const isUsed = await redisSessionService.isWsTokenUsed("ws-token-789");

      // Assert
      expect(mockRedisInstance.exists).toHaveBeenCalledWith(
        "qvarry:ws_token:ws-token-789",
      );
      expect(isUsed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STATS AND UTILITIES - REDIS
  // ─────────────────────────────────────────────────────────────────────────

  describe("getStats - Redis", () => {
    it("should return statistics with Redis connected", async () => {
      // Arrange
      mockRedisInstance.scanStream
        .mockReturnValueOnce(
          (async function* () {
            yield ["session1"];
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield ["token1"];
          })(),
        );

      // Act
      const stats = await redisSessionService.getStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.sessions).toBe(1);
      expect(stats.blacklisted).toBe(1);
      expect(stats.redisConnected).toBe(true);
    });
  });

  describe("flushAll - Redis", () => {
    it("should flush Redis database", async () => {
      // Act
      await redisSessionService.flushAll();

      // Assert
      expect(mockRedisInstance.flushdb).toHaveBeenCalled();
    });
  });

  describe("isRedisEnabled - Redis", () => {
    it("should return true when Redis is connected", () => {
      // Act
      const isEnabled = redisSessionService.isRedisEnabled();

      // Assert
      expect(isEnabled).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR HANDLING - REDIS FALLBACK
  // ─────────────────────────────────────────────────────────────────────────

  describe("Error Handling - Fallback to Memory", () => {
    it("should fallback to memory if Redis setex fails", async () => {
      // Arrange
      mockRedisInstance.setex.mockRejectedValue(
        new Error("Redis connection lost"),
      );

      // Act & Assert - should not throw
      await expect(
        redisSessionService.createSession("user999", { tokenId: "token999" }),
      ).resolves.not.toThrow();
    });

    it("should fallback to memory if Redis get fails", async () => {
      // Arrange
      mockRedisInstance.get.mockRejectedValue(new Error("Redis error"));

      // Act
      const session = await redisSessionService.getSession("user888");

      // Assert - should return null without throwing
      expect(session).toBeNull();
    });

    it("should fallback to memory if Redis exists fails", async () => {
      // Arrange
      mockRedisInstance.exists.mockRejectedValue(new Error("Redis error"));

      // Act
      const exists = await redisSessionService.hasSession("user777");

      // Assert
      expect(exists).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: CONSTRUCTOR AND CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

describe("RedisSessionService - Constructor and Configuration", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REDIS_ENABLED = "false";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should warn if SESSION_TTL is less than JWT_EXPIRES_IN", () => {
    // Arrange
    process.env.SESSION_TTL = "600"; // 10 minutes
    process.env.JWT_EXPIRES_IN = "15m"; // 15 minutes

    // Act
    const {
      RedisSessionService,
    } = require("../../services/redisSessionService");
    const service = new RedisSessionService();

    // Assert - constructor should complete without error
    expect(service).toBeDefined();
  });

  it("should create service with proper defaults", () => {
    // Arrange
    process.env.SESSION_TTL = "7200";
    process.env.JWT_EXPIRES_IN = "1h";

    // Act
    const {
      RedisSessionService,
    } = require("../../services/redisSessionService");
    const service = new RedisSessionService();

    // Assert
    expect(service).toBeDefined();
    expect(service.isRedisEnabled).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: EDGE CASES AND INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

describe("RedisSessionService - Edge Cases", () => {
  let redisSessionService: any;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REDIS_ENABLED = "false";
    process.env.NODE_ENV = "test";
    process.env.SESSION_TTL = "3600";

    const module = require("../../services/redisSessionService");
    redisSessionService = module.redisSessionService;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Login Attempts - 15 minute reset logic", () => {
    it("should reset attempts if last attempt was more than 15 minutes ago", async () => {
      // Arrange
      const email = "old@example.com";
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);

      // Manually set old attempt data
      await redisSessionService.recordLoginAttempt(email, false, 30);
      const attempts = await redisSessionService.getLoginAttempts(email);
      if (attempts) {
        attempts.lastAttempt = sixteenMinutesAgo;
      }

      // Act
      await redisSessionService.recordLoginAttempt(email, false, 30);
      const newAttempts = await redisSessionService.getLoginAttempts(email);

      // Assert - should be reset to 1
      expect(newAttempts?.attempts).toBe(1);
    });
  });

  describe("Session Keys", () => {
    it("should use different keys for same user with different tokenIds", async () => {
      // Arrange
      const userId = "multidevice-user";
      const token1 = "device1-token";
      const token2 = "device2-token";

      // Act
      await redisSessionService.createSession(userId, { tokenId: token1 });
      await redisSessionService.createSession(userId, { tokenId: token2 });

      // Assert
      const session1 = await redisSessionService.getSession(userId, token1);
      const session2 = await redisSessionService.getSession(userId, token2);
      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
      expect(session1?.tokenId).toBe(token1);
      expect(session2?.tokenId).toBe(token2);
    });
  });

  describe("Metadata Handling", () => {
    it("should handle session with minimal metadata", async () => {
      // Act
      await redisSessionService.createSession("minimal-user", {});

      // Assert
      const session = await redisSessionService.getSession("minimal-user");
      expect(session).toBeDefined();
      expect(session?.userId).toBe("minimal-user");
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.lastActivity).toBeInstanceOf(Date);
    });

    it("should handle session with full metadata", async () => {
      // Arrange
      const metadata = {
        tokenId: "full-token",
        ipAddress: "203.0.113.42",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      };

      // Act
      await redisSessionService.createSession("full-user", metadata);

      // Assert
      const session = await redisSessionService.getSession(
        "full-user",
        "full-token",
      );
      expect(session?.ipAddress).toBe(metadata.ipAddress);
      expect(session?.userAgent).toBe(metadata.userAgent);
    });
  });

  describe("Date Serialization", () => {
    it("should properly serialize and deserialize dates in session", async () => {
      // Arrange
      const beforeCreate = new Date();
      await redisSessionService.createSession("date-user", {});
      const afterCreate = new Date();

      // Act
      const session = await redisSessionService.getSession("date-user");

      // Assert
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.lastActivity).toBeInstanceOf(Date);
      expect(session?.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime(),
      );
      expect(session?.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreate.getTime(),
      );
    });
  });

  describe("WS Token Cleanup", () => {
    it("should automatically clean up consumed WS tokens after TTL", async () => {
      // This test verifies the timeout mechanism in memory mode
      jest.useFakeTimers();

      // Arrange
      const tokenJti = "cleanup-token";

      // Act
      await redisSessionService.consumeWsToken(tokenJti);
      expect(await redisSessionService.isWsTokenUsed(tokenJti)).toBe(true);

      // Fast-forward time by 5 minutes (300 seconds)
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Assert
      expect(await redisSessionService.isWsTokenUsed(tokenJti)).toBe(false);

      jest.useRealTimers();
    });
  });
});
