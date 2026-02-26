// ═══════════════════════════════════════════════════════════════════════════
// TESTS: refreshTokenService
// ═══════════════════════════════════════════════════════════════════════════

import { refreshTokenService } from "../../services/refreshTokenService";
import RefreshTokenModel from "../../models/refreshTokens";
import { auditService } from "../../services/auditService";
import crypto from "crypto";

// Mock dependencies
jest.mock("../../models/refreshTokens");
jest.mock("../../services/auditService");
jest.mock("../../utils/masterEncryptionUtils", () => ({
  encrypt: jest.fn((value) => `encrypted_${value}`),
  decrypt: jest.fn((value) =>
    value.startsWith("encrypted_") ? value.substring(10) : value,
  ),
}));

describe("refreshTokenService", () => {
  const testUserId = "507f1f77bcf86cd799439011";
  const testTokenId = "test-token-id-123";
  const testIpAddress = "127.0.0.1";
  const testUserAgent = "test-user-agent";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Token Generation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Token Generation", () => {
    it("should generate a random refresh token", () => {
      const token1 = refreshTokenService.generateRefreshToken();
      const token2 = refreshTokenService.generateRefreshToken();

      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(128); // 64 bytes hex = 128 chars
    });

    it("should hash a token consistently", () => {
      const token = "test-token-abc123";
      const hash1 = refreshTokenService.hashToken(token);
      const hash2 = refreshTokenService.hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA256 hex = 64 chars
    });

    it("should generate different hashes for different tokens", () => {
      const hash1 = refreshTokenService.hashToken("token1");
      const hash2 = refreshTokenService.hashToken("token2");

      expect(hash1).not.toBe(hash2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Create Refresh Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createRefreshToken", () => {
    beforeEach(() => {
      // Mock find to return empty array (no existing sessions)
      (RefreshTokenModel.find as jest.Mock).mockResolvedValue([]);
      (RefreshTokenModel.create as jest.Mock).mockResolvedValue({});
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("should create a new refresh token", async () => {
      const token = await refreshTokenService.createRefreshToken({
        userId: testUserId,
        tokenId: testTokenId,
        ipAddress: testIpAddress,
        userAgent: testUserAgent,
      });

      expect(token).toBeTruthy();
      expect(token.length).toBe(128);
      expect(RefreshTokenModel.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "REFRESH_TOKEN_CREATED",
          level: "info",
        }),
      );
    });

    it("should encrypt sensitive data when creating token", async () => {
      await refreshTokenService.createRefreshToken({
        userId: testUserId,
        tokenId: testTokenId,
        ipAddress: testIpAddress,
        userAgent: testUserAgent,
        deviceFingerprint: "test-fingerprint",
      });

      const createCall = (RefreshTokenModel.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.ipAddress).toBe(`encrypted_${testIpAddress}`);
      expect(createCall.userAgent).toBe(`encrypted_${testUserAgent}`);
      expect(createCall.deviceFingerprint).toBe("encrypted_test-fingerprint");
    });

    it("should enforce session limit and revoke old sessions", async () => {
      // Mock 10 existing active sessions (at the limit)
      const existingSessions = Array.from({ length: 10 }, (_, i) => ({
        tokenId: `old-token-${i}`,
        lastUsedAt: new Date(Date.now() - (10 - i) * 1000),
      }));
      (RefreshTokenModel.find as jest.Mock).mockResolvedValue(existingSessions);
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({});

      await refreshTokenService.createRefreshToken({
        userId: testUserId,
        tokenId: testTokenId,
      });

      expect(RefreshTokenModel.updateMany).toHaveBeenCalledWith(
        { tokenId: { $in: ["old-token-0"] } },
        expect.objectContaining({
          revoked: true,
          revokedReason: "session_limit_exceeded",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Validate Refresh Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("validateRefreshToken", () => {
    it("should validate a valid token", async () => {
      const testToken = "valid-token-123";
      const hashedToken = refreshTokenService.hashToken(testToken);

      const mockRefreshToken = {
        tokenId: testTokenId,
        userId: testUserId,
        lastUsedAt: new Date(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      (RefreshTokenModel.findOne as jest.Mock).mockResolvedValue(
        mockRefreshToken,
      );

      const result = await refreshTokenService.validateRefreshToken(testToken);

      expect(result).toBeDefined();
      expect(mockRefreshToken.save).toHaveBeenCalled();
      expect(RefreshTokenModel.findOne).toHaveBeenCalledWith({
        token: hashedToken,
        revoked: false,
        expiresAt: { $gt: expect.any(Date) },
      });
    });

    it("should return null for invalid token", async () => {
      (RefreshTokenModel.findOne as jest.Mock).mockResolvedValue(null);

      const result =
        await refreshTokenService.validateRefreshToken("invalid-token");

      expect(result).toBeNull();
    });

    it("should update lastUsedAt timestamp on validation", async () => {
      const mockToken = {
        lastUsedAt: new Date(Date.now() - 1000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      (RefreshTokenModel.findOne as jest.Mock).mockResolvedValue(mockToken);

      await refreshTokenService.validateRefreshToken("valid-token");

      expect(mockToken.lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 1000);
      expect(mockToken.save).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Revoke Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("revokeToken", () => {
    it("should not revoke token when reason is 'used'", async () => {
      await refreshTokenService.revokeToken(testTokenId, "used");

      expect(RefreshTokenModel.updateOne).not.toHaveBeenCalled();
    });

    it("should revoke token for other reasons", async () => {
      (RefreshTokenModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });
      (auditService.log as jest.Mock).mockResolvedValue(undefined);

      await refreshTokenService.revokeToken(testTokenId, "logout");

      expect(RefreshTokenModel.updateOne).toHaveBeenCalledWith(
        { tokenId: testTokenId },
        expect.objectContaining({
          revoked: true,
          revokedReason: "logout",
        }),
      );
      expect(auditService.log).toHaveBeenCalled();
    });

    it("should not log audit when token was not found", async () => {
      (RefreshTokenModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      await refreshTokenService.revokeToken(testTokenId, "logout");

      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Rotate Token
  // ═══════════════════════════════════════════════════════════════════════════

  describe("rotateToken", () => {
    it("should rotate token successfully", async () => {
      const newTokenId = "new-token-id";
      const mockResult = { tokenId: newTokenId };

      (RefreshTokenModel.findOneAndUpdate as jest.Mock).mockResolvedValue(
        mockResult,
      );

      const newToken = await refreshTokenService.rotateToken(
        testTokenId,
        newTokenId,
        testIpAddress,
        testUserAgent,
      );

      expect(newToken).toBeTruthy();
      expect(newToken.length).toBe(128);
      expect(RefreshTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tokenId: testTokenId, revoked: false },
        expect.objectContaining({
          tokenId: newTokenId,
          ipAddress: `encrypted_${testIpAddress}`,
          userAgent: `encrypted_${testUserAgent}`,
        }),
        { new: true },
      );
    });

    it("should throw error when token not found for rotation", async () => {
      (RefreshTokenModel.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

      await expect(
        refreshTokenService.rotateToken(testTokenId, "new-id"),
      ).rejects.toThrow("Token non trouvé pour rotation");
    });

    it("should generate new expiration date on rotation", async () => {
      (RefreshTokenModel.findOneAndUpdate as jest.Mock).mockResolvedValue({});

      await refreshTokenService.rotateToken(testTokenId, "new-id");

      const updateCall = (RefreshTokenModel.findOneAndUpdate as jest.Mock).mock
        .calls[0][1];
      expect(updateCall.expiresAt).toBeInstanceOf(Date);
      expect(updateCall.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Revoke All User Tokens
  // ═══════════════════════════════════════════════════════════════════════════

  describe("revokeAllUserTokens", () => {
    it("should revoke all tokens for a user", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 5,
      });
      (auditService.log as jest.Mock).mockResolvedValue(undefined);

      const count = await refreshTokenService.revokeAllUserTokens(testUserId);

      expect(count).toBe(5);
      expect(RefreshTokenModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: expect.any(Object), revoked: false }),
        expect.objectContaining({
          revoked: true,
          revokedReason: "logout_all",
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "ALL_TOKENS_REVOKED",
          level: "warning",
        }),
      );
    });

    it("should accept custom revocation reason", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });

      await refreshTokenService.revokeAllUserTokens(
        testUserId,
        "security_breach",
      );

      expect(RefreshTokenModel.updateMany).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          revokedReason: "security_breach",
        }),
      );
    });

    it("should return 0 when no tokens were revoked", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: undefined,
      });

      const count = await refreshTokenService.revokeAllUserTokens(testUserId);

      expect(count).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Token Theft Detection
  // ═══════════════════════════════════════════════════════════════════════════

  describe("detectTokenTheft", () => {
    const tokenFamily = "test-family-abc";

    it("should detect token theft when revoked token is reused", async () => {
      const revokedToken = {
        tokenId: "revoked-token-id",
        tokenFamily,
        revoked: true,
      };
      (RefreshTokenModel.findOne as jest.Mock).mockResolvedValue(revokedToken);
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });
      (auditService.log as jest.Mock).mockResolvedValue(undefined);

      const isTheft = await refreshTokenService.detectTokenTheft(
        tokenFamily,
        testUserId,
        testIpAddress,
      );

      expect(isTheft).toBe(true);
      expect(RefreshTokenModel.updateMany).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "TOKEN_THEFT_DETECTED",
          level: "critical",
        }),
      );
    });

    it("should not detect theft when no revoked token found", async () => {
      (RefreshTokenModel.findOne as jest.Mock).mockResolvedValue(null);

      const isTheft = await refreshTokenService.detectTokenTheft(
        tokenFamily,
        testUserId,
      );

      expect(isTheft).toBe(false);
      expect(RefreshTokenModel.updateMany).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Get User Active Sessions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getUserActiveSessions", () => {
    it("should return decrypted active sessions", async () => {
      const mockSessions = [
        {
          tokenId: "session-1",
          ipAddress: "encrypted_192.168.1.1",
          userAgent: "encrypted_Mozilla",
          deviceFingerprint: "encrypted_fingerprint",
          lastUsedAt: new Date(),
        },
        {
          tokenId: "session-2",
          ipAddress: "encrypted_10.0.0.1",
          userAgent: "encrypted_Chrome",
          lastUsedAt: new Date(),
        },
      ];

      (RefreshTokenModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockSessions),
        }),
      });

      const sessions =
        await refreshTokenService.getUserActiveSessions(testUserId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].ipAddress).toBe("192.168.1.1");
      expect(sessions[0].userAgent).toBe("Mozilla");
      expect(sessions[1].ipAddress).toBe("10.0.0.1");
    });

    it("should query only active non-revoked sessions", async () => {
      (RefreshTokenModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      await refreshTokenService.getUserActiveSessions(testUserId);

      expect(RefreshTokenModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          revoked: false,
          expiresAt: { $gt: expect.any(Date) },
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cleanup Functions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cleanupExpiredTokens", () => {
    it("should clean up expired and old revoked tokens", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 5,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 10,
      });

      const count = await refreshTokenService.cleanupExpiredTokens();

      expect(count).toBe(15); // 5 inactive + 10 deleted
      expect(RefreshTokenModel.updateMany).toHaveBeenCalled();
      expect(RefreshTokenModel.deleteMany).toHaveBeenCalled();
    });

    it("should revoke inactive sessions (>24h)", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });

      await refreshTokenService.cleanupExpiredTokens();

      const updateCall = (RefreshTokenModel.updateMany as jest.Mock).mock
        .calls[0];
      expect(updateCall[0]).toHaveProperty("lastUsedAt");
      expect(updateCall[1]).toMatchObject({
        revoked: true,
        revokedReason: "inactive_cleanup",
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge Cases", () => {
    it("should handle errors gracefully during token creation", async () => {
      (RefreshTokenModel.find as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await expect(
        refreshTokenService.createRefreshToken({
          userId: testUserId,
          tokenId: testTokenId,
        }),
      ).rejects.toThrow();
    });

    it("should handle missing optional fields in createRefreshToken", async () => {
      (RefreshTokenModel.find as jest.Mock).mockResolvedValue([]);
      (RefreshTokenModel.create as jest.Mock).mockResolvedValue({});

      const token = await refreshTokenService.createRefreshToken({
        userId: testUserId,
        tokenId: testTokenId,
        // No ipAddress, userAgent, etc.
      });

      expect(token).toBeTruthy();
      const createCall = (RefreshTokenModel.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.ipAddress).toBeUndefined();
      expect(createCall.userAgent).toBeUndefined();
    });

    it("should return 0 when revokeInactiveSessions finds nothing", async () => {
      (RefreshTokenModel.updateMany as jest.Mock).mockResolvedValue({});
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({});

      const count = await refreshTokenService.cleanupExpiredTokens();

      expect(count).toBe(0);
    });
  });
});
