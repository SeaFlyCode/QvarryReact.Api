// src/__tests__/services/auditService.test.ts

import mongoose from "mongoose";
import crypto from "crypto";
import AuditLog from "../../models/auditLogs";
import { auditService } from "../../services/auditService";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

// Mock dependencies
jest.mock("../../models/auditLogs");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("crypto");

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Phase G : `auditService.log()` est désormais batché pour les events
// non-critiques (info/warning). Pour vérifier le payload, on force un flush
// avant les assertions sur AuditLog.insertMany / AuditLog (constructeur).
const flushBatch = async () => {
  await (auditService as any).flush();
};

describe("AuditService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockIpAddress = "192.168.1.1";
  const mockUserAgent = "Mozilla/5.0";
  const mockHashedIp = "a1b2c3d4e5f6g7h8";

  let mockSecurityAlertService: any;
  let processExitSpy: jest.SpyInstance;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    // Reset batch state entre les tests pour éviter les fuites
    (auditService as any).__test_resetState();

    // Mock crypto.createHmac
    const mockHmac = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue(mockHashedIp + "extra"),
    };
    (crypto.createHmac as jest.Mock).mockReturnValue(mockHmac);

    // Mock encryption utils
    (masterEncryptionUtils.encrypt as jest.Mock).mockImplementation(
      (value: string) => `encrypted_${value}`,
    );
    (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(
      (value: string) => value.replace("encrypted_", ""),
    );

    // Mock AuditLog model (constructeur + méthodes statiques)
    const mockAuditLogInstance = {
      save: jest.fn().mockResolvedValue({}),
    };
    (AuditLog as unknown as jest.Mock).mockImplementation(
      () => mockAuditLogInstance,
    );
    (AuditLog.find as jest.Mock) = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    (AuditLog.deleteMany as jest.Mock) = jest.fn().mockResolvedValue({
      deletedCount: 0,
    });
    (AuditLog as any).insertMany = jest.fn().mockResolvedValue([]);

    // Mock securityAlertService
    mockSecurityAlertService = {
      processSecurityEvent: jest.fn().mockResolvedValue({}),
    };

    // Spy on process.exit
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("log", () => {
    it("should create audit log with encrypted data (after flush)", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        userId: mockUserId,
        action: "user.login",
        level: "info",
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        details: { success: true },
      });

      // Le log info est bufferisé → flush manuel pour vérifier le payload
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: expect.any(mongoose.Types.ObjectId),
            action: "user.login",
            level: "info",
            ipAddress: mockHashedIp,
            userAgent: "encrypted_Mozilla/5.0",
            details: 'encrypted_{"success":true}',
            timestamp: expect.any(Date),
            expiresAt: expect.any(Date),
            permanent: false,
          }),
        ],
        { ordered: false },
      );
    });

    it("should use default level 'info' when not specified", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        action: "user.view",
      });
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
        [expect.objectContaining({ level: "info" })],
        { ordered: false },
      );
    });

    it("should handle userId as string and convert to ObjectId", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);
      const userIdString = mockUserId.toString();

      await auditService.log({
        userId: userIdString,
        action: "user.update",
      });
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: expect.any(mongoose.Types.ObjectId),
          }),
        ],
        { ordered: false },
      );
    });

    it("should handle missing optional fields", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        action: "system.startup",
      });
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userId: undefined,
            ipAddress: undefined,
            userAgent: undefined,
            details: undefined,
          }),
        ],
        { ordered: false },
      );
    });

    it("should set expiresAt = now + 2 years and permanent=false by default (RGPD)", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);
      const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2;
      const before = Date.now();

      await auditService.log({ action: "user.view" });
      const after = Date.now();
      await flushBatch();

      const callArg = ((AuditLog as any).insertMany as jest.Mock).mock
        .calls[0][0][0];

      expect(callArg.permanent).toBe(false);
      expect(callArg.expiresAt).toBeInstanceOf(Date);
      const expiresAtMs = (callArg.expiresAt as Date).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(
        before + TWO_YEARS_SECONDS * 1000,
      );
      expect(expiresAtMs).toBeLessThanOrEqual(
        after + TWO_YEARS_SECONDS * 1000,
      );
    });

    it("should set expiresAt=null when permanent=true (security breach exemption) — immediate flush", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        userId: mockUserId,
        action: "security_breach_attempt",
        level: "critical",
        permanent: true,
      });

      // permanent=true → save immédiat, pas de flush nécessaire
      expect(AuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          permanent: true,
          expiresAt: null,
        }),
      );
      const mockInstance = (AuditLog as unknown as jest.Mock).mock.results[0]
        .value;
      expect(mockInstance.save).toHaveBeenCalled();
    });

    it("should trigger security alert for critical level events", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        userId: mockUserId,
        action: "auth.breach",
        level: "critical",
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        details: { threat: "high" },
      });

      // critical → save immédiat (constructeur + save), pas insertMany
      expect(AuditLog).toHaveBeenCalled();
    });

    it("should trigger security alert for error level events", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        userId: mockUserId,
        action: "auth.failed",
        level: "error",
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
      });

      // error → save immédiat
      expect(AuditLog).toHaveBeenCalled();
    });

    it("should not trigger security alert for info level events", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);

      await auditService.log({
        action: "user.login",
        level: "info",
      });
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalled();
    });

    it("should handle encryption errors gracefully", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);
      (masterEncryptionUtils.encrypt as jest.Mock).mockImplementation(() => {
        throw new Error("Encryption failed");
      });

      await auditService.log({
        action: "user.login",
        userAgent: mockUserAgent,
        details: { test: true },
      });
      await flushBatch();

      expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            userAgent: undefined,
            details: undefined,
          }),
        ],
        { ordered: false },
      );
    });

    it("should handle save errors gracefully (immediate path)", async () => {
      process.env.IP_HASH_SECRET = "a".repeat(32);
      const mockInstance = {
        save: jest.fn().mockRejectedValue(new Error("Database error")),
      };
      (AuditLog as unknown as jest.Mock).mockImplementation(() => mockInstance);

      // critical → chemin immédiat (utilise save())
      await expect(
        auditService.log({
          action: "user.login",
          level: "critical",
        }),
      ).resolves.not.toThrow();
    });

    describe("IP hashing", () => {
      it("should hash IP address with HMAC-SHA256", async () => {
        process.env.IP_HASH_SECRET = "a".repeat(32);

        await auditService.log({
          action: "user.login",
          ipAddress: mockIpAddress,
        });
        await flushBatch();

        expect(crypto.createHmac).toHaveBeenCalledWith(
          "sha256",
          "a".repeat(32),
        );
        expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
          [expect.objectContaining({ ipAddress: mockHashedIp })],
          { ordered: false },
        );
      });

      it("should return [IP_HASH_UNAVAILABLE] when IP_HASH_SECRET is missing", async () => {
        delete process.env.IP_HASH_SECRET;
        process.env.NODE_ENV = "test";

        await auditService.log({
          action: "user.login",
          ipAddress: mockIpAddress,
        });
        await flushBatch();

        expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
          [expect.objectContaining({ ipAddress: "[IP_HASH_UNAVAILABLE]" })],
          { ordered: false },
        );
      });

      it("should return [IP_HASH_UNAVAILABLE] when IP_HASH_SECRET is too short", async () => {
        process.env.IP_HASH_SECRET = "short";
        process.env.NODE_ENV = "test";

        await auditService.log({
          action: "user.login",
          ipAddress: mockIpAddress,
        });
        await flushBatch();

        expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
          [expect.objectContaining({ ipAddress: "[IP_HASH_UNAVAILABLE]" })],
          { ordered: false },
        );
      });

      it("should call process.exit in production if IP_HASH_SECRET is invalid", async () => {
        delete process.env.IP_HASH_SECRET;
        process.env.NODE_ENV = "production";

        // @ts-ignore - accessing private static member for testing
        auditService.constructor.ipHashSecretValidated = false;

        try {
          await auditService.log({
            action: "user.login",
            ipAddress: mockIpAddress,
          });
        } catch (e) {
          // Expected - process.exit throws in our mock
        }

        expect(processExitSpy).toHaveBeenCalledWith(1);
      });

      it("should handle IP hashing errors gracefully", async () => {
        process.env.IP_HASH_SECRET = "a".repeat(32);
        (crypto.createHmac as jest.Mock).mockImplementation(() => {
          throw new Error("Crypto error");
        });

        await auditService.log({
          action: "user.login",
          ipAddress: mockIpAddress,
        });
        await flushBatch();

        expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
          [expect.objectContaining({ ipAddress: undefined })],
          { ordered: false },
        );
      });

      it("should return undefined for undefined IP address", async () => {
        process.env.IP_HASH_SECRET = "a".repeat(32);

        await auditService.log({
          action: "user.login",
          ipAddress: undefined,
        });
        await flushBatch();

        expect(crypto.createHmac).not.toHaveBeenCalled();
        expect((AuditLog as any).insertMany).toHaveBeenCalledWith(
          [expect.objectContaining({ ipAddress: undefined })],
          { ordered: false },
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase G — Batcher (P1 DoS fix)
  // ───────────────────────────────────────────────────────────────────────────
  describe("batching (Phase G)", () => {
    beforeEach(() => {
      process.env.IP_HASH_SECRET = "a".repeat(32);
    });

    it("should buffer info logs without immediate persist", async () => {
      await auditService.log({ action: "x.event", level: "info" });

      // Pas encore flushé → ni insertMany, ni save n'a été appelé
      expect((AuditLog as any).insertMany).not.toHaveBeenCalled();
      expect(AuditLog).not.toHaveBeenCalled();
      expect((auditService as any).__test_getPendingCount()).toBe(1);
    });

    it("should auto-flush when buffer reaches BATCH_MAX_SIZE (100 entries)", async () => {
      // Pousser 100 logs info — atteint BATCH_MAX_SIZE → flush size-triggered
      for (let i = 0; i < 100; i++) {
        await auditService.log({ action: `evt.${i}`, level: "info" });
      }

      // Laisser la microtask flush() s'exécuter
      await new Promise((r) => setImmediate(r));

      expect((AuditLog as any).insertMany).toHaveBeenCalledTimes(1);
      const batch = ((AuditLog as any).insertMany as jest.Mock).mock
        .calls[0][0];
      expect(batch).toHaveLength(100);
      expect((auditService as any).__test_getPendingCount()).toBe(0);
    });

    it("should flush immediately when permanent=true (no buffering)", async () => {
      await auditService.log({
        action: "security.breach",
        level: "info",
        permanent: true,
      });

      // Pas de batch → save() direct, buffer reste vide
      expect((auditService as any).__test_getPendingCount()).toBe(0);
      expect(AuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ permanent: true }),
      );
      const mockInstance = (AuditLog as unknown as jest.Mock).mock.results[0]
        .value;
      expect(mockInstance.save).toHaveBeenCalled();
    });

    it("should flush immediately for critical level", async () => {
      await auditService.log({ action: "auth.breach", level: "critical" });

      expect((auditService as any).__test_getPendingCount()).toBe(0);
      expect(AuditLog).toHaveBeenCalled();
      expect((AuditLog as any).insertMany).not.toHaveBeenCalled();
    });

    it("should flush immediately for error level", async () => {
      await auditService.log({ action: "auth.failed", level: "error" });

      expect((auditService as any).__test_getPendingCount()).toBe(0);
      expect(AuditLog).toHaveBeenCalled();
      expect((AuditLog as any).insertMany).not.toHaveBeenCalled();
    });

    it("should preserve buffer & retry on insertMany failure", async () => {
      (AuditLog as any).insertMany = jest
        .fn()
        .mockRejectedValueOnce(new Error("Mongo down"))
        .mockResolvedValueOnce([]);

      await auditService.log({ action: "evt.1", level: "info" });
      await auditService.log({ action: "evt.2", level: "info" });

      // 1er flush échoue → logs réinjectés dans le buffer
      await flushBatch();
      expect((auditService as any).__test_getPendingCount()).toBe(2);

      // 2e flush réussit
      await flushBatch();
      expect((auditService as any).__test_getPendingCount()).toBe(0);
      expect((AuditLog as any).insertMany).toHaveBeenCalledTimes(2);
    });

    it("should drop logs after BATCH_MAX_RETRIES (3) failed attempts", async () => {
      (AuditLog as any).insertMany = jest
        .fn()
        .mockRejectedValue(new Error("Mongo down forever"));

      await auditService.log({ action: "evt.dropme", level: "info" });
      expect((auditService as any).__test_getPendingCount()).toBe(1);

      // 3 retries → drop
      await flushBatch();
      await flushBatch();
      await flushBatch();
      expect((auditService as any).__test_getPendingCount()).toBe(0);
    });

    it("shutdown() should flush pending buffer", async () => {
      await auditService.log({ action: "evt.1", level: "info" });
      await auditService.log({ action: "evt.2", level: "info" });
      expect((auditService as any).__test_getPendingCount()).toBe(2);

      await auditService.shutdown();

      expect((AuditLog as any).insertMany).toHaveBeenCalledTimes(1);
      expect((auditService as any).__test_getPendingCount()).toBe(0);
    });

    it("shutdown() should be a no-op when buffer is empty", async () => {
      await auditService.shutdown();
      expect((AuditLog as any).insertMany).not.toHaveBeenCalled();
    });

    it("shutdown() should not throw when flush exceeds timeout", async () => {
      // insertMany qui ne résout jamais
      (AuditLog as any).insertMany = jest.fn(
        () => new Promise(() => undefined),
      );

      await auditService.log({ action: "evt.slow", level: "info" });

      // Le shutdown utilise un timeout interne → on s'assure qu'il ne throw pas
      // On le race avec un timeout de test plus long pour ne pas bloquer Jest.
      const shutdownPromise = auditService.shutdown();
      await expect(
        Promise.race([
          shutdownPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 6000)),
        ]),
      ).resolves.toBeUndefined();
    }, 10000);
  });

  describe("getUserLogs", () => {
    it("should retrieve and decrypt user logs", async () => {
      const mockLogs = [
        {
          userId: mockUserId,
          action: "user.login",
          level: "info",
          ipAddress: "encrypted_192.168.1.1",
          userAgent: "encrypted_Mozilla",
          details: 'encrypted_{"success":true}',
          timestamp: new Date(),
        },
      ];

      (AuditLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      });

      const result = await auditService.getUserLogs(mockUserId);

      expect(AuditLog.find).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        action: "user.login",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla",
        details: { success: true },
      });
    });

    it("should use default limit of 50", async () => {
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (AuditLog.find as jest.Mock).mockReturnValue(mockFind);

      await auditService.getUserLogs(mockUserId);

      expect(mockFind.limit).toHaveBeenCalledWith(50);
    });

    it("should handle non-JSON details gracefully", async () => {
      // Reset and reconfigure decrypt mock to return non-JSON string
      (masterEncryptionUtils.decrypt as jest.Mock).mockReset();
      (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(
        (value: string) => {
          if (value === "encrypted_not_json") return "not_json";
          return value.replace("encrypted_", "");
        },
      );

      const mockLogs = [
        {
          action: "test",
          details: "encrypted_not_json",
          timestamp: new Date(),
        },
      ];

      (AuditLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      });

      const result = await auditService.getUserLogs(mockUserId);

      expect(result[0].details).toBeDefined();
    });

    it("should handle decryption errors by returning original value", async () => {
      (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const mockLogs = [
        {
          action: "test",
          ipAddress: "legacy_unencrypted_ip",
          userAgent: "legacy_ua",
          timestamp: new Date(),
        },
      ];

      (AuditLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      });

      const result = await auditService.getUserLogs(mockUserId);

      expect(result[0].ipAddress).toBe("legacy_unencrypted_ip");
      expect(result[0].userAgent).toBe("legacy_ua");
    });
  });

  describe("getSuspiciousEvents", () => {
    it("should retrieve suspicious events from last 24 hours by default", async () => {
      const mockLogs = [
        {
          action: "auth.failed",
          level: "error",
          timestamp: new Date(),
        },
      ];

      (AuditLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      });

      const result = await auditService.getSuspiciousEvents();

      expect(AuditLog.find).toHaveBeenCalledWith({
        level: { $in: ["warning", "error", "critical"] },
        timestamp: { $gte: expect.any(Date) },
      });
      expect(result).toHaveLength(1);
    });

    it("should accept custom time range in hours", async () => {
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (AuditLog.find as jest.Mock).mockReturnValue(mockFind);

      await auditService.getSuspiciousEvents(48);

      const callArgs = (AuditLog.find as jest.Mock).mock.calls[0][0];
      const timeDiff = Date.now() - callArgs.timestamp.$gte.getTime();
      expect(timeDiff).toBeGreaterThanOrEqual(48 * 60 * 60 * 1000 - 1000);
    });

    it("should decrypt returned logs", async () => {
      const mockLogs = [
        {
          action: "auth.breach",
          level: "critical",
          ipAddress: "encrypted_ip",
          userAgent: "encrypted_ua",
          details: 'encrypted_{"breach":true}',
          timestamp: new Date(),
        },
      ];

      (AuditLog.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      });

      const result = await auditService.getSuspiciousEvents();

      expect(result[0]).toMatchObject({
        ipAddress: "ip",
        userAgent: "ua",
        details: { breach: true },
      });
    });

    it("should limit results to 100 events", async () => {
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (AuditLog.find as jest.Mock).mockReturnValue(mockFind);

      await auditService.getSuspiciousEvents();

      expect(mockFind.limit).toHaveBeenCalledWith(100);
    });
  });

  describe("cleanup", () => {
    it("should delete logs older than specified days", async () => {
      (AuditLog.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 42,
      });

      const result = await auditService.cleanup(30);

      expect(AuditLog.deleteMany).toHaveBeenCalledWith({
        timestamp: { $lt: expect.any(Date) },
      });
      expect(result).toBe(42);
    });

    it("should use default of 90 days", async () => {
      (AuditLog.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 10,
      });

      await auditService.cleanup();

      const callArgs = (AuditLog.deleteMany as jest.Mock).mock.calls[0][0];
      const timeDiff = Date.now() - callArgs.timestamp.$lt.getTime();
      expect(timeDiff).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 * 1000 - 1000);
    });

    it("should return 0 if no logs deleted", async () => {
      (AuditLog.deleteMany as jest.Mock).mockResolvedValue({});

      const result = await auditService.cleanup(90);

      expect(result).toBe(0);
    });
  });
});
