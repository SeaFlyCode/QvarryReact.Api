// src/__tests__/services/securityAlertService.test.ts

/**
 * Tests pour le SecurityAlertService
 *
 * Ce service gère :
 * - Le traitement des événements de sécurité
 * - Les scores de menace avec cache
 * - Le blocage automatique d'IP
 * - La détection de patterns d'attaque
 * - Les notifications aux admins
 * - L'export des logs d'audit
 */

import mongoose from "mongoose";
import BlockedIpModel from "../../models/blockedIps";
import AuditLogModel from "../../models/auditLogs";
import UserModel from "../../models/users";
import * as emailService from "../../services/emailService";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";
import * as logUtils from "../../utils/logUtils";

// Mock dependencies BEFORE importing the service
jest.mock("../../models/blockedIps");
jest.mock("../../models/auditLogs");
jest.mock("../../models/users");
jest.mock("../../services/emailService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/logUtils");

// Import the service after mocks are set up
import { securityAlertService } from "../../services/securityAlertService";

describe("SecurityAlertService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockUserAgent = "Mozilla/5.0 Test Agent";

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations
    (logUtils.anonymizeIp as jest.Mock).mockImplementation((ip: string) =>
      ip.replace(/\d+$/, "***"),
    );
    (logUtils.maskEmail as jest.Mock).mockImplementation((email: string) =>
      email.replace(/(.{2}).*(@.*)/, "$1***$2"),
    );
    (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(
      (value: string) => value.replace("encrypted_", ""),
    );
    (masterEncryptionUtils.encrypt as jest.Mock).mockImplementation(
      (value: string) => `encrypted_${value}`,
    );

    // Setup default email service mock
    (emailService.sendEmail as jest.Mock).mockResolvedValue(true);
  });

  describe("processSecurityEvent", () => {
    it("should process a basic security event", async () => {
      const mockIp = "192.168.1.1";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await securityAlertService.processSecurityEvent({
        type: "LOGIN_FAILED",
        level: "warning",
        ipAddress: mockIp,
      });

      // Should have updated threat score
      const threatScore = securityAlertService.getThreatScore(mockIp);
      expect(threatScore).toBeTruthy();
      expect(threatScore?.score).toBeGreaterThanOrEqual(2);
    });

    it("should notify admins on critical events", async () => {
      const mockIp = "192.168.1.2";
      const mockAdmin = {
        _id: new mongoose.Types.ObjectId(),
        email: "encrypted_admin@test.com",
        is_admin: true,
        is_blocked: false,
      };

      (UserModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockAdmin]),
      });
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (emailService.sendEmail as jest.Mock).mockResolvedValue(true);

      await securityAlertService.processSecurityEvent({
        type: "TOKEN_THEFT_DETECTED",
        level: "critical",
        ipAddress: mockIp,
        userId: mockUserId,
        userAgent: mockUserAgent,
        details: { severity: "high" },
      });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@test.com",
          template: "security-alert-admin",
        }),
      );
    });

    it("should not notify admins on warning events", async () => {
      const mockIp = "192.168.1.3";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await securityAlertService.processSecurityEvent({
        type: "LOGIN_FAILED",
        level: "warning",
        ipAddress: mockIp,
      });

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      const mockIp = "192.168.1.4";
      (BlockedIpModel.findOne as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Should not throw
      await expect(
        securityAlertService.processSecurityEvent({
          type: "LOGIN_FAILED",
          level: "warning",
          ipAddress: mockIp,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("updateThreatScore", () => {
    it("should create new threat score entry", async () => {
      const mockIp = "192.168.1.5";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await securityAlertService.processSecurityEvent({
        type: "LOGIN_FAILED",
        level: "warning",
        ipAddress: mockIp,
        autoBlock: false,
      });

      const threatScore = securityAlertService.getThreatScore(mockIp);
      expect(threatScore).toMatchObject({
        ip: mockIp,
        reasons: expect.arrayContaining(["LOGIN_FAILED (+2)"]),
      });
      expect(threatScore?.score).toBeGreaterThanOrEqual(2);
    });

    it("should increment existing threat score", async () => {
      const mockIp = "192.168.1.6";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      // First event
      await securityAlertService.processSecurityEvent({
        type: "LOGIN_FAILED",
        level: "warning",
        ipAddress: mockIp,
        autoBlock: false,
      });

      const firstScore = securityAlertService.getThreatScore(mockIp);

      // Second event
      await securityAlertService.processSecurityEvent({
        type: "RATE_LIMIT_TRIGGERED",
        level: "warning",
        ipAddress: mockIp,
        autoBlock: false,
      });

      const secondScore = securityAlertService.getThreatScore(mockIp);
      expect(secondScore?.score).toBeGreaterThanOrEqual(firstScore?.score || 0);
      expect(secondScore?.score).toBe(5); // LOGIN_FAILED (2) + RATE_LIMIT_TRIGGERED (3)
      expect(secondScore?.reasons.length).toBe(2);
    });

    it("should limit reasons array to 20 entries", async () => {
      const mockIp = "192.168.1.7";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      // Process 25 events
      for (let i = 0; i < 25; i++) {
        await securityAlertService.processSecurityEvent({
          type: "LOGIN_FAILED",
          level: "warning",
          ipAddress: mockIp,
          autoBlock: false,
        });
      }

      const threatScore = securityAlertService.getThreatScore(mockIp);
      expect(threatScore?.reasons.length).toBeLessThanOrEqual(20);
    });
  });

  describe("checkAndAutoBlock", () => {
    it("should auto-block IP when threshold exceeded", async () => {
      const mockIp = "192.168.1.8";
      const mockBlockedIp = {
        save: jest.fn().mockResolvedValue(true),
      };

      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (BlockedIpModel as any).mockImplementation(() => mockBlockedIp);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (UserModel.find as jest.Mock).mockResolvedValue([
        { email: "admin@test.com", is_admin: true, is_blocked: false },
      ]);
      (emailService.sendEmail as jest.Mock).mockResolvedValue(true);

      // Process events to exceed threshold (default is 10)
      for (let i = 0; i < 6; i++) {
        await securityAlertService.processSecurityEvent({
          type: "LOGIN_FAILED",
          level: "warning",
          ipAddress: mockIp,
        });
      }

      expect(mockBlockedIp.save).toHaveBeenCalled();
    });

    it("should increment attempt count for existing block", async () => {
      const mockIp = "192.168.1.9";
      const mockExistingBlock = {
        ipAddress: mockIp,
        isActive: true,
        blockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        attemptCount: 5,
        save: jest.fn().mockResolvedValue(true),
      };

      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(
        mockExistingBlock,
      );
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      // Build up threat score
      for (let i = 0; i < 6; i++) {
        await securityAlertService.processSecurityEvent({
          type: "LOGIN_FAILED",
          level: "warning",
          ipAddress: mockIp,
        });
      }

      expect(mockExistingBlock.attemptCount).toBeGreaterThan(5);
      expect(mockExistingBlock.save).toHaveBeenCalled();
    });
  });

  describe("notifyAdmins", () => {
    it("should send email to all active admins", async () => {
      const mockIp = "192.168.1.10";
      const mockAdmins = [
        {
          _id: new mongoose.Types.ObjectId(),
          email: "encrypted_admin1@test.com",
          is_admin: true,
          is_blocked: false,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          email: "encrypted_admin2@test.com",
          is_admin: true,
          is_blocked: false,
        },
      ];

      (UserModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockAdmins),
      });
      (emailService.sendEmail as jest.Mock).mockResolvedValue(true);

      await securityAlertService.notifyAdmins({
        type: "TEST_ALERT",
        level: "critical",
        ipAddress: mockIp,
      });

      expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
    });

    it("should not send emails when no admins found", async () => {
      (UserModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await securityAlertService.notifyAdmins({
        type: "TEST_ALERT",
        level: "critical",
      });

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it("should handle decryption errors gracefully", async () => {
      const mockAdmin = {
        email: "plaintext@test.com",
        is_admin: true,
        is_blocked: false,
      };

      (UserModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockAdmin]),
      });
      (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(() => {
        throw new Error("Decryption failed");
      });
      (emailService.sendEmail as jest.Mock).mockResolvedValue(true);

      await securityAlertService.notifyAdmins({
        type: "TEST_ALERT",
        level: "critical",
      });

      // Should use original email when decryption fails
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "plaintext@test.com",
        }),
      );
    });

    it("should include user email in alert when userId provided", async () => {
      const mockAdmin = {
        email: "admin@test.com",
        is_admin: true,
        is_blocked: false,
      };

      const mockUser = {
        _id: mockUserId,
        email: "encrypted_user@test.com",
      };

      (UserModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockAdmin]),
      });
      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (emailService.sendEmail as jest.Mock).mockResolvedValue(true);

      await securityAlertService.notifyAdmins({
        type: "TEST_ALERT",
        level: "critical",
        userId: mockUserId,
      });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            USER_EMAIL: "user@test.com",
          }),
        }),
      );
    });
  });

  describe("isIpBlocked", () => {
    it("should return blocked status for active block", async () => {
      const mockIp = "192.168.1.11";
      const mockBlock = {
        ipAddress: mockIp,
        isActive: true,
        reason: "Brute force attack",
        blockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      (BlockedIpModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockBlock),
      });

      const result = await securityAlertService.isIpBlocked(mockIp);

      expect(result).toEqual({
        blocked: true,
        reason: "Brute force attack",
        until: mockBlock.blockedUntil,
      });
    });

    it("should return not blocked for clean IP", async () => {
      const mockIp = "192.168.1.12";
      (BlockedIpModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const result = await securityAlertService.isIpBlocked(mockIp);

      expect(result).toEqual({ blocked: false });
    });
  });

  describe("blockIp", () => {
    it("should create new IP block", async () => {
      const mockIp = "192.168.1.13";
      const validAdminId = new mongoose.Types.ObjectId().toString();
      const mockBlockedIp = {
        save: jest.fn().mockResolvedValue(true),
      };

      (BlockedIpModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (BlockedIpModel as any).mockImplementation(() => mockBlockedIp);

      await securityAlertService.blockIp(
        mockIp,
        "Admin blocked",
        24,
        validAdminId,
      );

      expect(BlockedIpModel.updateMany).toHaveBeenCalled();
      expect(mockBlockedIp.save).toHaveBeenCalled();
    });

    it("should create permanent block when no duration specified", async () => {
      const mockIp = "192.168.1.14";
      const mockBlockedIp = {
        blockedUntil: null as Date | null,
        save: jest.fn().mockResolvedValue(true),
      };

      (BlockedIpModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (BlockedIpModel as any).mockImplementation((data: any) => {
        mockBlockedIp.blockedUntil = data.blockedUntil;
        return mockBlockedIp;
      });

      await securityAlertService.blockIp(mockIp, "Permanent ban");

      expect(mockBlockedIp.blockedUntil).toBeNull();
    });
  });

  describe("unblockIp", () => {
    it("should deactivate all active blocks for IP", async () => {
      const mockIp = "192.168.1.15";
      (BlockedIpModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await securityAlertService.unblockIp(mockIp);

      expect(BlockedIpModel.updateMany).toHaveBeenCalledWith(
        { ipAddress: mockIp, isActive: true },
        { isActive: false },
      );
      expect(result).toBe(true);
    });

    it("should return false when no blocks found", async () => {
      const mockIp = "192.168.1.16";
      (BlockedIpModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      const result = await securityAlertService.unblockIp(mockIp);

      expect(result).toBe(false);
    });
  });

  describe("listBlockedIps", () => {
    it("should return paginated list of blocked IPs", async () => {
      const mockIps = [
        { ipAddress: "192.168.1.1", isActive: true },
        { ipAddress: "192.168.1.2", isActive: true },
      ];

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockIps),
      };

      (BlockedIpModel.find as jest.Mock).mockReturnValue(mockQuery);
      (BlockedIpModel.countDocuments as jest.Mock).mockResolvedValue(100);

      const result = await securityAlertService.listBlockedIps(1, 50);

      expect(result).toEqual({
        ips: mockIps,
        total: 100,
        totalPages: 2,
      });
    });

    it("should use default pagination values", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };

      (BlockedIpModel.find as jest.Mock).mockReturnValue(mockQuery);
      (BlockedIpModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await securityAlertService.listBlockedIps();

      expect(mockQuery.skip).toHaveBeenCalledWith(0);
      expect(mockQuery.limit).toHaveBeenCalledWith(50);
    });
  });

  describe("getThreatScore", () => {
    it("should return null for unknown IP", () => {
      const score = securityAlertService.getThreatScore("unknown.ip");
      expect(score).toBeNull();
    });

    it("should return threat score for known IP", async () => {
      const mockIp = "192.168.1.17";
      (BlockedIpModel.findOne as jest.Mock).mockResolvedValue(null);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await securityAlertService.processSecurityEvent({
        type: "LOGIN_FAILED",
        level: "warning",
        ipAddress: mockIp,
        autoBlock: false,
      });

      const score = securityAlertService.getThreatScore(mockIp);
      expect(score).toMatchObject({
        ip: mockIp,
        reasons: expect.any(Array),
        lastUpdated: expect.any(Date),
      });
      expect(score?.score).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getSecurityStats", () => {
    it("should return comprehensive security statistics", async () => {
      (BlockedIpModel.countDocuments as jest.Mock)
        .mockResolvedValueOnce(10) // active
        .mockResolvedValueOnce(50) // total
        .mockResolvedValueOnce(5); // last 24h

      (AuditLogModel.countDocuments as jest.Mock)
        .mockResolvedValueOnce(3) // critical last 24h
        .mockResolvedValueOnce(15) // critical last 7 days
        .mockResolvedValueOnce(25); // warning last 24h

      (AuditLogModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await securityAlertService.getSecurityStats();

      expect(stats).toMatchObject({
        blockedIps: {
          active: 10,
          total: 50,
          last24h: 5,
        },
        events: {
          criticalLast24h: 3,
          criticalLast7Days: 15,
          warningLast24h: 25,
        },
        topAttackTypes: expect.any(Array),
        hourlyData: expect.any(Array),
        dailyData: expect.any(Array),
        threatScoreCacheSize: expect.any(Number),
      });
    });

    it("should return 24 hours of hourly data", async () => {
      (BlockedIpModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (AuditLogModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await securityAlertService.getSecurityStats();

      expect(stats.hourlyData).toHaveLength(24);
      expect(stats.hourlyData[0]).toMatchObject({
        hour: 0,
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      });
    });

    it("should return 7 days of daily data", async () => {
      (BlockedIpModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (AuditLogModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (AuditLogModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await securityAlertService.getSecurityStats();

      expect(stats.dailyData).toHaveLength(7);
      expect(stats.dailyData[0]).toMatchObject({
        date: expect.any(String),
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      });
    });
  });

  describe("exportAuditLogs", () => {
    const mockLogs = [
      {
        _id: new mongoose.Types.ObjectId(),
        timestamp: new Date("2026-02-26T10:00:00Z"),
        level: "warning",
        action: "LOGIN_FAILED",
        userId: new mongoose.Types.ObjectId(mockUserId),
        ipAddress: "encrypted_192.168.1.1",
        userAgent: "encrypted_Mozilla/5.0",
        details: 'encrypted_{"attempt":1}',
      },
    ];

    beforeEach(() => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLogs),
      };
      (AuditLogModel.find as jest.Mock).mockReturnValue(mockQuery);
    });

    it("should export logs as JSON", async () => {
      const result = await securityAlertService.exportAuditLogs({
        format: "json",
      });

      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        level: "warning",
        action: "LOGIN_FAILED",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });
    });

    it("should export logs as CSV", async () => {
      const result = await securityAlertService.exportAuditLogs({
        format: "csv",
      });

      const lines = result.split("\n");
      expect(lines[0]).toBe(
        "timestamp,level,action,userId,ipAddress,userAgent,details",
      );
      expect(lines[1]).toContain("LOGIN_FAILED");
    });

    it("should filter by date range", async () => {
      const startDate = new Date("2026-02-01");
      const endDate = new Date("2026-02-28");

      await securityAlertService.exportAuditLogs({
        format: "json",
        startDate,
        endDate,
      });

      expect(AuditLogModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: {
            $gte: startDate,
            $lte: endDate,
          },
        }),
      );
    });

    it("should respect limit parameter", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (AuditLogModel.find as jest.Mock).mockReturnValue(mockQuery);

      await securityAlertService.exportAuditLogs({
        format: "json",
        limit: 500,
      });

      expect(mockQuery.limit).toHaveBeenCalledWith(500);
    });
  });
});
