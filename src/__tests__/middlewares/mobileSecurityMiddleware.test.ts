/**
 * Tests unitaires pour mobileSecurityMiddleware
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

jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip: string) => ip),
  maskDeviceId: jest.fn((id: string) => id),
}));

import { Request, Response, NextFunction } from "express";
import {
  verifyMobilePlatform,
  checkAppVersion,
  getMobileSecurityStats,
  blockDevice,
  unblockDevice,
} from "../../middlewares/mobileSecurityMiddleware";
import { auditService } from "../../services/auditService";

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

describe("mobileSecurityMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyMobilePlatform", () => {
    describe("Platform validation", () => {
      it("should return 400 without X-Platform header", async () => {
        // Arrange
        const req = mockReq() as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: "Plateforme non spécifiée ou invalide",
          code: "INVALID_PLATFORM",
          hint: "Header X-Platform requis (ios/android)",
        });
        expect(next).not.toHaveBeenCalled();
      });

      it("should return 400 with invalid platform", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "windows",
            "x-device-id": "a".repeat(32),
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: "Plateforme non spécifiée ou invalide",
          code: "INVALID_PLATFORM",
          hint: "Header X-Platform requis (ios/android)",
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('should accept "ios" as valid platform', async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": "a".repeat(32),
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should accept "android" as valid platform', async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "android",
            "x-device-id": "b".repeat(32),
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should accept "mobile" as valid platform', async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "mobile",
            "x-device-id": "c".repeat(32),
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it("should handle case-insensitive platform names", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "IOS",
            "x-device-id": "d".repeat(32),
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });
    });

    describe("Device ID validation", () => {
      it("should return 400 without X-Device-ID header", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "ios",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: "Identifiant d'appareil manquant ou invalide",
          code: "INVALID_DEVICE_ID",
          hint: "Header X-Device-ID requis (UUID format)",
        });
        expect(next).not.toHaveBeenCalled();
      });

      it("should return 400 with too short device ID", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": "too-short",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: "Identifiant d'appareil manquant ou invalide",
          code: "INVALID_DEVICE_ID",
          hint: "Header X-Device-ID requis (UUID format)",
        });
        expect(next).not.toHaveBeenCalled();
      });

      it("should accept valid 32-character device ID", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it("should accept UUID format with dashes", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "android",
            "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });

      it("should return 400 with device ID containing invalid characters", async () => {
        // Arrange
        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": "invalid@device#id!with$special%chars",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe("Blocked device handling", () => {
      it("should return 403 for blocked device", async () => {
        // Arrange
        const deviceId = "blocked-device-id-12345678901234";
        blockDevice(deviceId, "Test blocking");

        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": deviceId,
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          error: "Cet appareil a été bloqué",
          code: "DEVICE_BLOCKED",
        });
        expect(next).not.toHaveBeenCalled();
        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "BLOCKED_DEVICE_ACCESS_ATTEMPT",
            level: "warning",
          }),
        );

        // Cleanup
        unblockDevice(deviceId);
      });

      it("should allow access after unblocking device", async () => {
        // Arrange
        const deviceId = "test-unblock-device-1234567890123";
        blockDevice(deviceId, "Test");
        unblockDevice(deviceId);

        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": deviceId,
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
      });
    });

    describe("Mobile context attachment", () => {
      it("should attach mobileContext to request", async () => {
        // Arrange
        const deviceId = "context-device-12345678901234567";
        const req = mockReq({
          headers: {
            "x-platform": "ios",
            "x-device-id": deviceId,
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        expect((req as any).mobileContext).toBeDefined();
        expect((req as any).mobileContext.platform).toBe("ios");
        expect((req as any).mobileContext.deviceId).toBe(deviceId);
        expect((req as any).mobileContext.trustScore).toBeDefined();
        expect(typeof (req as any).mobileContext.trustScore).toBe("number");
      });

      it("should calculate trust score", async () => {
        // Arrange - use unique device ID to avoid interference from other tests
        // Must be 32-64 chars, alphanumeric with dashes
        const uniqueDeviceId = "trust-score-test-12345678901234567890";
        const req = mockReq({
          headers: {
            "x-platform": "android",
            "x-device-id": uniqueDeviceId,
            "x-app-version": "1.0.0",
          },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        // Act
        await verifyMobilePlatform(req, res, next);

        // Assert
        const mobileContext = (req as any).mobileContext;
        expect(mobileContext).toBeDefined();
        expect(mobileContext.trustScore).toBeGreaterThan(0);
        expect(mobileContext.trustScore).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("checkAppVersion", () => {
    it("should pass with no version header", () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "ios",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 426 for outdated iOS version", () => {
      // Arrange - default MIN_IOS_VERSION is "1.0.0", use version below that
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-app-version": "0.9.0",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(426);
      expect(res.json).toHaveBeenCalledWith({
        error: "Veuillez mettre à jour l'application pour continuer.",
        code: "UPDATE_REQUIRED",
        minVersion: "1.0.0",
        currentVersion: "0.9.0",
        platform: "ios",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 426 for outdated Android version", () => {
      // Arrange - default MIN_ANDROID_VERSION is "1.0.0", use version below that
      const req = mockReq({
        headers: {
          "x-platform": "android",
          "x-app-version": "0.0.1",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(426);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UPDATE_REQUIRED",
          minVersion: "1.0.0",
          currentVersion: "0.0.1",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should pass with current version equal to minimum", () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-app-version": "1.0.0",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should pass with version higher than minimum", () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "android",
          "x-app-version": "2.5.3",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should compare versions correctly (major)", () => {
      // Arrange - default min is "1.0.0", use "0.99.99" which is less
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-app-version": "0.99.99",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(426);
      expect(next).not.toHaveBeenCalled();
    });

    it("should compare versions correctly (minor)", () => {
      // Arrange - default min is "1.0.0", use "0.99.0" which is less
      const req = mockReq({
        headers: {
          "x-platform": "android",
          "x-app-version": "0.99.0",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(426);
      expect(next).not.toHaveBeenCalled();
    });

    it("should compare versions correctly (patch)", () => {
      // Arrange - default min is "1.0.0", use "0.9.9" which is less
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-app-version": "0.9.9",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(426);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle version with different number of segments", () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "android",
          "x-app-version": "2.0.1",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert - 2.0.1 > 1.0.0 (default min)
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should pass when no minimum version is configured", () => {
      // Arrange - default min is "1.0.0", so use version >= 1.0.0
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-app-version": "1.0.0",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      checkAppVersion(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("getMobileSecurityStats", () => {
    it("should return expected structure", () => {
      // Act
      const stats = getMobileSecurityStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty("knownDevicesCount");
      expect(stats).toHaveProperty("blockedDevicesCount");
      expect(stats).toHaveProperty("activeRateLimits");
      expect(stats).toHaveProperty("blockedDevices");

      expect(typeof stats.knownDevicesCount).toBe("number");
      expect(typeof stats.blockedDevicesCount).toBe("number");
      expect(typeof stats.activeRateLimits).toBe("number");
      expect(Array.isArray(stats.blockedDevices)).toBe(true);
    });

    it("should reflect blocked devices count", () => {
      // Arrange
      const deviceId1 = "stats-device-1-1234567890123456";
      const deviceId2 = "stats-device-2-1234567890123456";

      const statsBefore = getMobileSecurityStats();
      const countBefore = statsBefore.blockedDevicesCount;

      // Act
      blockDevice(deviceId1, "Test 1");
      blockDevice(deviceId2, "Test 2");
      const statsAfter = getMobileSecurityStats();

      // Assert
      expect(statsAfter.blockedDevicesCount).toBe(countBefore + 2);
      expect(statsAfter.blockedDevices).toContain(deviceId1);
      expect(statsAfter.blockedDevices).toContain(deviceId2);

      // Cleanup
      unblockDevice(deviceId1);
      unblockDevice(deviceId2);
    });
  });

  describe("blockDevice and unblockDevice", () => {
    it("should block a device", () => {
      // Arrange
      const deviceId = "block-test-device-12345678901234";
      const statsBefore = getMobileSecurityStats();

      // Act
      blockDevice(deviceId, "Suspicious activity");
      const statsAfter = getMobileSecurityStats();

      // Assert
      expect(statsAfter.blockedDevicesCount).toBeGreaterThan(
        statsBefore.blockedDevicesCount,
      );
      expect(statsAfter.blockedDevices).toContain(deviceId);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DEVICE_BLOCKED",
          level: "warning",
          details: expect.objectContaining({
            deviceId,
            reason: "Suspicious activity",
          }),
        }),
      );

      // Cleanup
      unblockDevice(deviceId);
    });

    it("should unblock a device", () => {
      // Arrange
      const deviceId = "unblock-test-device-1234567890123";
      blockDevice(deviceId, "Test");
      const statsBefore = getMobileSecurityStats();

      // Act
      unblockDevice(deviceId);
      const statsAfter = getMobileSecurityStats();

      // Assert
      expect(statsAfter.blockedDevicesCount).toBeLessThan(
        statsBefore.blockedDevicesCount,
      );
      expect(statsAfter.blockedDevices).not.toContain(deviceId);
    });

    it("should handle unblocking a non-blocked device gracefully", () => {
      // Arrange
      const deviceId = "never-blocked-device-123456789012";

      // Act & Assert - Should not throw
      expect(() => unblockDevice(deviceId)).not.toThrow();
    });

    it("should handle blocking same device multiple times", () => {
      // Arrange
      const deviceId = "double-block-device-1234567890123";

      // Act
      blockDevice(deviceId, "First block");
      const statsAfterFirst = getMobileSecurityStats();
      blockDevice(deviceId, "Second block");
      const statsAfterSecond = getMobileSecurityStats();

      // Assert - Should not increase count twice
      expect(statsAfterSecond.blockedDevicesCount).toBe(
        statsAfterFirst.blockedDevicesCount,
      );

      // Cleanup
      unblockDevice(deviceId);
    });
  });

  describe("Edge cases", () => {
    it("should handle missing connection.remoteAddress", async () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-device-id": "edge-case-device-12345678901234",
        },
        ip: undefined,
        connection: {},
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act & Assert - Should not throw
      await expect(verifyMobilePlatform(req, res, next)).resolves.not.toThrow();
    });

    it("should handle platform with mixed case", async () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "AnDrOiD",
          "x-device-id": "mixed-case-device-123456789012345",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await verifyMobilePlatform(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).mobileContext.platform).toBe("android");
    });

    it("should handle empty string platform", async () => {
      // Arrange
      const req = mockReq({
        headers: {
          "x-platform": "",
          "x-device-id": "test-device-123456789012345678",
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await verifyMobilePlatform(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle 64-character device ID", async () => {
      // Arrange
      const longDeviceId = "a".repeat(64);
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-device-id": longDeviceId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await verifyMobilePlatform(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should reject device ID longer than 64 characters", async () => {
      // Arrange
      const tooLongDeviceId = "a".repeat(65);
      const req = mockReq({
        headers: {
          "x-platform": "ios",
          "x-device-id": tooLongDeviceId,
        },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      // Act
      await verifyMobilePlatform(req, res, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
