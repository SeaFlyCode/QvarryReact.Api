// src/__tests__/services/sosService.test.ts

import mongoose from "mongoose";
import { sosService } from "../../services/sosService";
import SosSessionModel from "../../models/sosSession";
import SosContactModel from "../../models/sosContact";
import SosEventModel from "../../models/sosEvent";
import UserModel from "../../models/users";
import { vonageService } from "../../services/vonageService";
import { createNotification } from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import { auditService } from "../../services/auditService";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

// Mock all dependencies
jest.mock("../../models/sosSession");
jest.mock("../../models/sosContact");
jest.mock("../../models/sosEvent");
jest.mock("../../models/users");
jest.mock("../../services/vonageService", () => ({
  vonageService: {
    sendSosAlertToMultiple: jest.fn(),
  },
}));
jest.mock("../../services/notificationService", () => ({
  createNotification: jest.fn(),
}));
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    sendNotificationToUser: jest.fn(),
  },
}));
jest.mock("../../services/auditService", () => ({
  auditService: {
    log: jest.fn(),
  },
}));
jest.mock("../../utils/masterEncryptionUtils", () => ({
  decrypt: jest.fn((value) => value),
  encrypt: jest.fn((value) => value),
}));

describe("SosService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockUserId2 = "507f1f77bcf86cd799439012";
  const mockSessionId = "507f1f77bcf86cd799439013";
  const mockContactId = "507f1f77bcf86cd799439014";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // ACTIVATE SESSION
  // ═══════════════════════════════════════════════════════════════════

  describe("activateSession", () => {
    it("should activate a new SOS session successfully", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        status: "ACTIVE",
        currentStage: -1,
        activatedAt: new Date(),
        expectedDuration: 60,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            currentStage: -1,
            joinedAt: new Date(),
          },
        ],
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(1);
      (SosSessionModel as unknown as jest.Mock).mockImplementation(
        () => mockSession,
      );
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: mockUserId,
          name: "John Doe",
        }),
      });

      const result = await sosService.activateSession({
        userId: mockUserId,
        expectedDuration: 60,
        note: "Test dive",
        lat: 48.8566,
        lng: 2.3522,
      });

      expect(result).toBeDefined();
      expect(mockSession.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          action: "SOS_SESSION_ACTIVATED",
        }),
      );
    });

    it("should reject if user already has an active session", async () => {
      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([
        {
          _id: mockSessionId,
          status: "ACTIVE",
        },
      ]);

      await expect(
        sosService.activateSession({
          userId: mockUserId,
          expectedDuration: 60,
        }),
      ).rejects.toThrow("SESSION_ALREADY_ACTIVE");
    });

    it("should reject if duration is invalid", async () => {
      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(1);

      await expect(
        sosService.activateSession({
          userId: mockUserId,
          expectedDuration: 10, // Too short
        }),
      ).rejects.toThrow("INVALID_DURATION");

      await expect(
        sosService.activateSession({
          userId: mockUserId,
          expectedDuration: 500, // Too long
        }),
      ).rejects.toThrow("INVALID_DURATION");
    });

    it("should reject if no emergency contacts", async () => {
      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(0);

      await expect(
        sosService.activateSession({
          userId: mockUserId,
          expectedDuration: 60,
        }),
      ).rejects.toThrow("NO_EMERGENCY_CONTACTS");
    });

    it("should support group sessions with multiple participants", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
          {
            userId: new mongoose.Types.ObjectId(mockUserId2),
            status: "ACTIVE",
          },
        ],
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (UserModel.find as jest.Mock) = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: mockUserId2 }]),
      });
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(1);
      (SosSessionModel as unknown as jest.Mock).mockImplementation(
        () => mockSession,
      );
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: mockUserId,
          name: "Creator",
        }),
      });

      await sosService.activateSession({
        userId: mockUserId,
        expectedDuration: 60,
        participantIds: [mockUserId2],
      });

      expect(mockSession.save).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(
        expect.any(mongoose.Types.ObjectId),
        "sos_alert",
        expect.stringContaining("ajouté à une session SOS"),
        expect.any(String),
        expect.any(Object),
      );
    });

    it("should validate participant IDs exist", async () => {
      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (UserModel.find as jest.Mock) = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]), // Empty array = invalid IDs
      });
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(1);

      await expect(
        sosService.activateSession({
          userId: mockUserId,
          expectedDuration: 60,
          participantIds: [mockUserId2],
        }),
      ).rejects.toThrow("INVALID_PARTICIPANT_IDS");
    });

    it("should accept custom session contacts", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [],
        save: jest.fn().mockResolvedValue({}),
        sessionContactIds: [],
      };

      const mockPermanentContact = {
        _id: new mongoose.Types.ObjectId(mockContactId),
      };

      (SosSessionModel.find as jest.Mock) = jest.fn().mockResolvedValue([]);
      (SosContactModel.find as jest.Mock) = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([mockPermanentContact]),
        }),
      });
      (SosSessionModel as unknown as jest.Mock).mockImplementation(
        () => mockSession,
      );
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test",
        }),
      });

      await sosService.activateSession({
        userId: mockUserId,
        expectedDuration: 60,
        sessionContacts: {
          permanentContactIds: [mockContactId],
        },
      });

      expect(mockSession.save).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════

  describe("heartbeat", () => {
    it("should process heartbeat and extend expiration", async () => {
      const now = new Date();
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            currentStage: -1,
            lastHeartbeatAt: null,
            consecutiveHeartbeats: 0,
            surfaceDetectionSent: false,
            reconnectionDetectionSent: false,
          },
        ],
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        heartbeatCount: 0,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      const result = await sosService.heartbeat({
        userId: mockUserId,
        lat: 48.8566,
        lng: 2.3522,
      });

      expect(result).toBeDefined();
      expect(mockSession.save).toHaveBeenCalled();
      expect(mockSession.heartbeatCount).toBe(1);
      expect(mockSession.participants[0].lastHeartbeatAt).not.toBeNull();
      expect(mockSession.participants[0].consecutiveHeartbeats).toBe(1);
    });

    it("should throw error if no active session", async () => {
      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        sosService.heartbeat({
          userId: mockUserId,
        }),
      ).rejects.toThrow("NO_ACTIVE_SESSION");
    });

    it("should reactivate participant from ESCALATING status", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ESCALATING",
            currentStage: 1,
            lastHeartbeatAt: null,
            consecutiveHeartbeats: 0,
            surfaceDetectionSent: false,
            reconnectionDetectionSent: false,
          },
        ],
        expiresAt: new Date(),
        heartbeatCount: 0,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await sosService.heartbeat({
        userId: mockUserId,
      });

      expect(mockSession.participants[0].status).toBe("ACTIVE");
      expect(mockSession.participants[0].currentStage).toBe(-1);
    });

    it("should detect surface movement and send notification", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            lastHeartbeatAt: null,
            consecutiveHeartbeats: 0,
            surfaceDetectionSent: false,
            reconnectionDetectionSent: false,
          },
        ],
        entryLat: 48.8566,
        entryLng: 2.3522,
        expiresAt: new Date(),
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await sosService.heartbeat({
        userId: mockUserId,
        lat: 48.8586, // Moved 200+ meters
        lng: 2.3542,
      });

      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          type: "sos_surface_detected",
        }),
      );
      expect(mockSession.participants[0].surfaceDetectionSent).toBe(true);
    });

    it("should detect reconnection after consecutive heartbeats", async () => {
      const firstReconnection = new Date(Date.now() - 6 * 60 * 1000); // 6 min ago

      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            lastHeartbeatAt: null,
            consecutiveHeartbeats: 4,
            firstReconnectionAt: firstReconnection,
            surfaceDetectionSent: false,
            reconnectionDetectionSent: false,
          },
        ],
        expiresAt: new Date(),
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await sosService.heartbeat({
        userId: mockUserId,
      });

      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          type: "sos_reconnection_detected",
        }),
      );
      expect(mockSession.participants[0].reconnectionDetectionSent).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // EXTEND SESSION
  // ═══════════════════════════════════════════════════════════════════

  describe("extendSession", () => {
    it("should extend session duration", async () => {
      const originalExpires = new Date(Date.now() + 30 * 60 * 1000);
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
        ],
        status: "ACTIVE",
        expiresAt: originalExpires,
        extensionCount: 0,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await sosService.extendSession({
        userId: mockUserId,
        additionalMinutes: 30,
      });

      expect(mockSession.save).toHaveBeenCalled();
      expect(mockSession.extensionCount).toBe(1);
      expect(mockSession.expiresAt.getTime()).toBeGreaterThan(
        originalExpires.getTime(),
      );
    });

    it("should reject invalid extension duration", async () => {
      const mockSession = {
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
        ],
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await expect(
        sosService.extendSession({
          userId: mockUserId,
          additionalMinutes: 10, // Too short
        }),
      ).rejects.toThrow("INVALID_EXTENSION_DURATION");

      await expect(
        sosService.extendSession({
          userId: mockUserId,
          additionalMinutes: 500, // Too long
        }),
      ).rejects.toThrow("INVALID_EXTENSION_DURATION");
    });

    it("should reactivate ESCALATING session when extended", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ESCALATING",
            currentStage: 1,
          },
        ],
        status: "ESCALATING",
        currentStage: 1,
        expiresAt: new Date(),
        extensionCount: 0,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      await sosService.extendSession({
        userId: mockUserId,
        additionalMinutes: 30,
      });

      expect(mockSession.status).toBe("ACTIVE");
      expect(mockSession.currentStage).toBe(-1);
      expect(mockSession.participants[0].status).toBe("ACTIVE");
    });

    it("should throw error if no active session", async () => {
      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        sosService.extendSession({
          userId: mockUserId,
          additionalMinutes: 30,
        }),
      ).rejects.toThrow("NO_ACTIVE_SESSION");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEACTIVATE SESSION
  // ═══════════════════════════════════════════════════════════════════

  describe("deactivateSession", () => {
    it("should deactivate session with scope 'all'", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
          {
            userId: new mongoose.Types.ObjectId(mockUserId2),
            status: "ACTIVE",
          },
        ],
        status: "ACTIVE",
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test User",
        }),
      });
      (SosContactModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      await sosService.deactivateSession(mockUserId, undefined, "all");

      expect(mockSession.status).toBe("RESOLVED");
      expect(mockSession.resolvedBy).toBe("USER");
      expect(mockSession.participants[0].status).toBe("LEFT");
      expect(mockSession.participants[1].status).toBe("LEFT");
      expect(webSocketService.sendNotificationToUser).toHaveBeenCalled();
    });

    it("should deactivate session with scope 'self' for single participant", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
        ],
        status: "ACTIVE",
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test User",
        }),
      });
      (SosContactModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      await sosService.deactivateSession(mockUserId, undefined, "self");

      expect(mockSession.status).toBe("RESOLVED");
      expect(mockSession.participants[0].status).toBe("LEFT");
    });

    it("should only remove one participant with scope 'self' in group session", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
          {
            userId: new mongoose.Types.ObjectId(mockUserId2),
            status: "ACTIVE",
          },
        ],
        status: "ACTIVE",
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test User",
        }),
      });

      await sosService.deactivateSession(mockUserId, undefined, "self");

      expect(mockSession.status).toBe("ACTIVE"); // Session continues
      expect(mockSession.participants[0].status).toBe("LEFT");
      expect(mockSession.participants[1].status).toBe("ACTIVE");
      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId2,
        expect.objectContaining({
          type: "sos_participant_left",
        }),
      );
    });

    it("should throw error if no active session", async () => {
      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      await expect(sosService.deactivateSession(mockUserId)).rejects.toThrow(
        "NO_ACTIVE_SESSION",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONFIRM SAFE
  // ═══════════════════════════════════════════════════════════════════

  describe("confirmSafe", () => {
    it("should resolve session when contact confirms user is safe", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ESCALATING",
          },
        ],
        status: "ESCALATING",
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);
      (SosContactModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      const confirmerId = "507f1f77bcf86cd799439099";
      await sosService.confirmSafe(mockSessionId, confirmerId);

      expect(mockSession.status).toBe("RESOLVED");
      expect(mockSession.resolvedBy).toBe("CONTACT_CONFIRM");
      expect(mockSession.participants[0].status).toBe("LEFT");
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: confirmerId,
          action: "SOS_CONTACT_CONFIRMED_SAFE",
        }),
      );
    });

    it("should throw error if session not found or not escalating", async () => {
      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        sosService.confirmSafe(mockSessionId, mockUserId),
      ).rejects.toThrow("SESSION_NOT_FOUND_OR_NOT_ESCALATING");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET ACTIVE SESSION
  // ═══════════════════════════════════════════════════════════════════

  describe("getActiveSession", () => {
    it("should return active session for user", async () => {
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        status: "ACTIVE",
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);

      const result = await sosService.getActiveSession(mockUserId);

      expect(result).toEqual(mockSession);
      expect(SosSessionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: ["ACTIVE", "ESCALATING"] },
        }),
      );
    });

    it("should return null if no active session", async () => {
      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      const result = await sosService.getActiveSession(mockUserId);

      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET SESSION HISTORY
  // ═══════════════════════════════════════════════════════════════════

  describe("getSessionHistory", () => {
    it("should return session history with statistics", async () => {
      const mockSessions = [
        {
          _id: mockSessionId,
          userId: new mongoose.Types.ObjectId(mockUserId),
          expectedDuration: 60,
          heartbeatCount: 5,
          status: "RESOLVED",
          currentStage: -1,
          siteName: "Test Site",
          activatedAt: new Date("2024-01-01T10:00:00Z"),
          resolvedAt: new Date("2024-01-01T11:00:00Z"),
        },
      ];

      const mockFind = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockSessions),
        select: jest.fn().mockReturnThis(),
      });

      (SosSessionModel.find as jest.Mock) = mockFind;

      const result = await sosService.getSessionHistory(mockUserId, 20);

      expect(result.sessions).toBeDefined();
      expect(result.stats).toBeDefined();
      expect(result.stats.totalSessions).toBe(1);
      expect(result.stats.totalDuration).toBeGreaterThan(0);
      expect(result.stats.averageDuration).toBeGreaterThan(0);
    });

    it("should calculate escalation rate correctly", async () => {
      const mockSessions = [
        {
          status: "RESOLVED",
          currentStage: -1,
          heartbeatCount: 5,
          activatedAt: new Date(),
          resolvedAt: new Date(),
        },
        {
          status: "ESCALATING",
          currentStage: 1,
          heartbeatCount: 3,
          activatedAt: new Date(),
          resolvedAt: new Date(),
        },
      ];

      const mockFind = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockSessions),
        select: jest.fn().mockReturnThis(),
      });

      (SosSessionModel.find as jest.Mock) = mockFind;

      const result = await sosService.getSessionHistory(mockUserId);

      expect(result.stats.escalationRate).toBe(50); // 1 out of 2
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET ACTIVE SESSIONS (MAP VIEW)
  // ═══════════════════════════════════════════════════════════════════

  describe("getActiveSessions", () => {
    it("should return escalating sessions visible to user", async () => {
      const mockSessions = [
        {
          _id: mockSessionId,
          status: "ESCALATING",
          currentStage: 1,
        },
      ];

      const mockFind = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockSessions),
      });

      (SosSessionModel.find as jest.Mock) = mockFind;

      const result = await sosService.getActiveSessions(mockUserId);

      expect(result).toEqual(mockSessions);
      expect(SosSessionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ESCALATING",
          currentStage: { $gte: 1 },
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PROCESS EXPIRED SESSIONS (CRON)
  // ═══════════════════════════════════════════════════════════════════

  describe("processExpiredSessions", () => {
    it("should process no sessions if none are expired", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        status: "ACTIVE",
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            currentStage: -1,
            lastHeartbeatAt: futureDate,
          },
        ],
        expiresAt: futureDate,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.find as jest.Mock) = jest
        .fn()
        .mockResolvedValue([mockSession]);

      await sosService.processExpiredSessions();

      expect(mockSession.save).not.toHaveBeenCalled();
    });

    it("should trigger stage 0 for expired participant", async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        status: "ACTIVE",
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
            currentStage: -1,
            lastHeartbeatAt: null,
          },
        ],
        expiresAt: pastDate,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.find as jest.Mock) = jest
        .fn()
        .mockResolvedValue([mockSession]);

      await sosService.processExpiredSessions();

      expect(mockSession.participants[0].status).toBe("DISCONNECTED");
      expect(mockSession.participants[0].currentStage).toBe(0);
      expect(createNotification).toHaveBeenCalled();
      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          type: "sos_alarm",
          stage: 0,
        }),
      );
    });

    it("should trigger stage 1 after stage 0 delay", async () => {
      const stage0Time = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        status: "ACTIVE",
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "DISCONNECTED",
            currentStage: 0,
            stage0TriggeredAt: stage0Time,
            lastHeartbeatAt: null,
          },
        ],
        expiresAt: stage0Time,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.find as jest.Mock) = jest
        .fn()
        .mockResolvedValue([mockSession]);
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test User",
        }),
      });
      (UserModel.find as jest.Mock) = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue([{ _id: mockUserId2, name: "Other User" }]),
      });

      await sosService.processExpiredSessions();

      expect(mockSession.participants[0].status).toBe("ESCALATING");
      expect(mockSession.participants[0].currentStage).toBe(1);
      expect(mockSession.status).toBe("ESCALATING");
    });

    it("should trigger stage 2 after stage 2 delay", async () => {
      const stage0Time = new Date(Date.now() - 35 * 60 * 1000); // 35 min ago
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        status: "ESCALATING",
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ESCALATING",
            currentStage: 1,
            stage0TriggeredAt: stage0Time,
            stage1TriggeredAt: new Date(Date.now() - 20 * 60 * 1000),
            lastHeartbeatAt: null,
          },
        ],
        expiresAt: stage0Time,
        useDefaultContacts: true,
        save: jest.fn().mockResolvedValue({}),
      };

      const mockContacts = [
        {
          _id: mockContactId,
          name: "Emergency Contact",
          phone: "+33612345678",
        },
      ];

      (SosSessionModel.find as jest.Mock) = jest
        .fn()
        .mockResolvedValue([mockSession]);
      (UserModel.findById as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          name: "Test",
          surname: "User",
        }),
      });
      (SosContactModel.find as jest.Mock) = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockContacts),
      });
      (SosContactModel.findByIdAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue({});
      (vonageService.sendSosAlertToMultiple as jest.Mock) = jest
        .fn()
        .mockResolvedValue([{ success: true, messageId: "msg-123" }]);

      await sosService.processExpiredSessions();

      expect(mockSession.participants[0].currentStage).toBe(2);
      expect(vonageService.sendSosAlertToMultiple).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONTACT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  describe("addContact", () => {
    it("should add a new emergency contact", async () => {
      const mockContact = {
        _id: new mongoose.Types.ObjectId(mockContactId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        name: "Emergency Contact",
        phone: "+33612345678",
        relationship: "Friend",
        isDefault: true,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(0);
      (SosContactModel as unknown as jest.Mock).mockImplementation(
        () => mockContact,
      );

      const result = await sosService.addContact(mockUserId, {
        name: "Emergency Contact",
        phone: "+33612345678",
        relationship: "Friend",
        isDefault: true,
      });

      expect(result).toBeDefined();
      expect(mockContact.save).toHaveBeenCalled();
    });

    it("should add contact with any phone format (no validation)", async () => {
      // Note: addContact doesn't validate phone format - it saves any string
      const mockContact = {
        _id: new mongoose.Types.ObjectId(mockContactId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        name: "Contact",
        phone: "invalid-phone",
        isDefault: false,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(0);
      (SosContactModel as unknown as jest.Mock).mockImplementation(
        () => mockContact,
      );

      await sosService.addContact(mockUserId, {
        name: "Contact",
        phone: "invalid-phone",
        isDefault: false,
      });

      expect(mockContact.save).toHaveBeenCalled();
    });

    it("should enforce maximum contact limit", async () => {
      (SosContactModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(10);

      await expect(
        sosService.addContact(mockUserId, {
          name: "Contact",
          phone: "+33612345678",
          isDefault: false,
        }),
      ).rejects.toThrow("MAX_CONTACTS_REACHED");
    });
  });

  describe("getContacts", () => {
    it("should return user's emergency contacts", async () => {
      const mockContacts = [
        {
          _id: mockContactId,
          name: "Contact 1",
          phone: "+33612345678",
          isDefault: true,
        },
      ];

      const mockFind = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockContacts),
      });

      (SosContactModel.find as jest.Mock) = mockFind;

      const result = await sosService.getContacts(mockUserId);

      expect(result).toEqual(mockContacts);
    });
  });

  describe("updateContact", () => {
    it("should update an existing contact", async () => {
      const mockContact = {
        _id: new mongoose.Types.ObjectId(mockContactId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        name: "New Name",
        phone: "+33612345678",
      };

      (SosContactModel.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockContact);

      const result = await sosService.updateContact(mockUserId, mockContactId, {
        name: "New Name",
      });

      expect(result).toBeDefined();
      expect(result?.name).toBe("New Name");
    });

    it("should allow any phone format (no validation)", async () => {
      // Note: updateContact doesn't validate phone format
      const mockContact = {
        _id: new mongoose.Types.ObjectId(mockContactId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        phone: "invalid",
      };

      (SosContactModel.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockContact);

      const result = await sosService.updateContact(mockUserId, mockContactId, {
        phone: "invalid",
      });

      expect(result).toBeDefined();
    });

    it("should return null if contact not found", async () => {
      (SosContactModel.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      const result = await sosService.updateContact(mockUserId, mockContactId, {
        name: "Test",
      });

      expect(result).toBeNull();
    });
  });

  describe("deleteContact", () => {
    it("should delete a contact", async () => {
      const mockDeleteResult = { deletedCount: 1 };

      (SosContactModel.deleteOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockDeleteResult);

      const result = await sosService.deleteContact(mockUserId, mockContactId);

      expect(result).toBe(true);
      expect(SosContactModel.deleteOne).toHaveBeenCalledWith({
        _id: expect.any(mongoose.Types.ObjectId),
        userId: expect.any(mongoose.Types.ObjectId),
      });
    });

    it("should return false if contact not found", async () => {
      const mockDeleteResult = { deletedCount: 0 };

      (SosContactModel.deleteOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockDeleteResult);

      const result = await sosService.deleteContact(mockUserId, mockContactId);

      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  describe("getAdminDashboard", () => {
    it("should return admin dashboard statistics", async () => {
      const mockSessions = [
        {
          status: "ACTIVE",
          currentStage: -1,
          participants: [{ status: "ACTIVE" }],
          expiresAt: new Date(Date.now() + 3600000),
        },
        {
          status: "ESCALATING",
          currentStage: 1,
          participants: [{ status: "ESCALATING" }],
          expiresAt: new Date(Date.now() + 3600000),
        },
      ];

      const mockFind = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockSessions),
      });

      (SosSessionModel.find as jest.Mock) = mockFind;
      (SosSessionModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(100);

      const result = await sosService.getAdminDashboard();

      expect(result).toBeDefined();
      expect(result.activeSessions).toBeDefined();
      expect(result.escalatingSessions).toBeDefined();
      expect(result.totalSessions24h).toBeDefined();
    });
  });

  describe("adminCancelSession", () => {
    it("should allow admin to cancel a session", async () => {
      const adminId = "507f1f77bcf86cd799439099";
      const mockSession = {
        _id: new mongoose.Types.ObjectId(mockSessionId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        participants: [
          {
            userId: new mongoose.Types.ObjectId(mockUserId),
            status: "ACTIVE",
          },
        ],
        status: "ACTIVE",
        resolvedBy: undefined,
        resolvedByUserId: undefined,
        resolvedAt: undefined,
        adminCancelReason: undefined,
        save: jest.fn().mockResolvedValue({}),
      };

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockSession);
      (SosContactModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      // Note: Parameter order is (sessionId, adminId, reason)
      await sosService.adminCancelSession(
        mockSessionId,
        adminId,
        "Safety concern",
      );

      expect(mockSession.status).toBe("RESOLVED");
      expect(mockSession.resolvedBy).toBe("ADMIN");
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: adminId,
          action: "ADMIN_SOS_SESSION_CANCELLED",
          level: "critical",
        }),
      );
    });

    it("should throw error if session not found", async () => {
      const adminId = "507f1f77bcf86cd799439099";

      (SosSessionModel.findOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        sosService.adminCancelSession(mockSessionId, adminId, "Test"),
      ).rejects.toThrow("SESSION_NOT_FOUND");
    });
  });
});
