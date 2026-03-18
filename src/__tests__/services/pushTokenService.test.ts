// src/__tests__/services/pushTokenService.test.ts

import mongoose from "mongoose";
import * as pushTokenService from "../../services/pushTokenService";
import PushTokenModel from "../../models/pushToken";

// Mock dependencies
jest.mock("../../models/pushToken");
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  },
}));

describe("PushTokenService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockUserId2 = "507f1f77bcf86cd799439012";
  const mockToken = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
  const mockDeviceId = "device-abc-123";
  const mockDeviceId2 = "device-def-456";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // REGISTER TOKEN
  // ═══════════════════════════════════════════════════════════════════

  describe("registerToken", () => {
    it("should register a new push token successfully", async () => {
      const mockPushToken = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(mockUserId),
        deviceId: mockDeviceId,
        token: mockToken,
        platform: "ios",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (PushTokenModel.findOneAndUpdate as jest.Mock).mockResolvedValue(
        mockPushToken,
      );

      const result = await pushTokenService.registerToken(
        mockUserId,
        mockToken,
        "ios",
        mockDeviceId,
      );

      expect(result).toBeDefined();
      expect(result.token).toBe(mockToken);
      expect(result.deviceId).toBe(mockDeviceId);
      expect(PushTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          userId: expect.any(mongoose.Types.ObjectId),
          deviceId: mockDeviceId,
        },
        {
          token: mockToken,
          platform: "ios",
          updatedAt: expect.any(Date),
        },
        { upsert: true, new: true },
      );
    });

    it("should update an existing token via upsert", async () => {
      const mockExistingToken = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(mockUserId),
        deviceId: mockDeviceId,
        token: "old-token",
        platform: "android",
        createdAt: new Date(Date.now() - 86400000), // Yesterday
        updatedAt: new Date(),
      };

      (PushTokenModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
        ...mockExistingToken,
        token: mockToken,
      });

      const result = await pushTokenService.registerToken(
        mockUserId,
        mockToken,
        "android",
        mockDeviceId,
      );

      expect(result).toBeDefined();
      expect(result.token).toBe(mockToken);
      expect(PushTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: mockDeviceId,
        }),
        expect.objectContaining({
          token: mockToken,
          platform: "android",
        }),
        { upsert: true, new: true },
      );
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.findOneAndUpdate as jest.Mock).mockRejectedValue(
        mockError,
      );

      await expect(
        pushTokenService.registerToken(
          mockUserId,
          mockToken,
          "ios",
          mockDeviceId,
        ),
      ).rejects.toThrow("Database error");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REMOVE TOKEN
  // ═══════════════════════════════════════════════════════════════════

  describe("removeToken", () => {
    it("should remove token successfully", async () => {
      (PushTokenModel.deleteOne as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });

      const result = await pushTokenService.removeToken(
        mockUserId,
        mockDeviceId,
      );

      expect(result).toBe(true);
      expect(PushTokenModel.deleteOne).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        deviceId: mockDeviceId,
      });
    });

    it("should return false if token not found", async () => {
      (PushTokenModel.deleteOne as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });

      const result = await pushTokenService.removeToken(
        mockUserId,
        mockDeviceId,
      );

      expect(result).toBe(false);
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.deleteOne as jest.Mock).mockRejectedValue(mockError);

      await expect(
        pushTokenService.removeToken(mockUserId, mockDeviceId),
      ).rejects.toThrow("Database error");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET TOKENS BY USER ID
  // ═══════════════════════════════════════════════════════════════════

  describe("getTokensByUserId", () => {
    it("should return all tokens for a user", async () => {
      const mockTokens = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(mockUserId),
          deviceId: mockDeviceId,
          token: mockToken,
          platform: "ios",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(mockUserId),
          deviceId: mockDeviceId2,
          token: "another-token",
          platform: "android",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTokens),
      });

      const result = await pushTokenService.getTokensByUserId(mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0].deviceId).toBe(mockDeviceId);
      expect(result[1].deviceId).toBe(mockDeviceId2);
      expect(PushTokenModel.find).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
      });
    });

    it("should return empty array if no tokens found", async () => {
      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await pushTokenService.getTokensByUserId(mockUserId);

      expect(result).toEqual([]);
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockRejectedValue(mockError),
      });

      await expect(
        pushTokenService.getTokensByUserId(mockUserId),
      ).rejects.toThrow("Database error");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET TOKENS BY USER IDS (BATCH)
  // ═══════════════════════════════════════════════════════════════════

  describe("getTokensByUserIds", () => {
    it("should return tokens grouped by userId", async () => {
      const mockTokens = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(mockUserId),
          deviceId: mockDeviceId,
          token: mockToken,
          platform: "ios",
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(mockUserId),
          deviceId: mockDeviceId2,
          token: "token-2",
          platform: "android",
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(mockUserId2),
          deviceId: "device-ghi-789",
          token: "token-3",
          platform: "ios",
        },
      ];

      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTokens),
      });

      const result = await pushTokenService.getTokensByUserIds([
        mockUserId,
        mockUserId2,
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get(mockUserId)).toHaveLength(2);
      expect(result.get(mockUserId2)).toHaveLength(1);
      expect(PushTokenModel.find).toHaveBeenCalledWith({
        userId: { $in: expect.any(Array) },
      });
    });

    it("should return empty map if no tokens found", async () => {
      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await pushTokenService.getTokensByUserIds([mockUserId]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it("should handle empty userIds array", async () => {
      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await pushTokenService.getTokensByUserIds([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockRejectedValue(mockError),
      });

      await expect(
        pushTokenService.getTokensByUserIds([mockUserId]),
      ).rejects.toThrow("Database error");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REMOVE INVALID TOKENS
  // ═══════════════════════════════════════════════════════════════════

  describe("removeInvalidTokens", () => {
    it("should remove invalid tokens by deviceId", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 2,
      });

      const result = await pushTokenService.removeInvalidTokens([
        mockDeviceId,
        mockDeviceId2,
      ]);

      expect(result).toBe(2);
      expect(PushTokenModel.deleteMany).toHaveBeenCalledWith({
        deviceId: { $in: [mockDeviceId, mockDeviceId2] },
      });
    });

    it("should return 0 if empty deviceIds array", async () => {
      const result = await pushTokenService.removeInvalidTokens([]);

      expect(result).toBe(0);
      expect(PushTokenModel.deleteMany).not.toHaveBeenCalled();
    });

    it("should return 0 if no tokens deleted", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });

      const result = await pushTokenService.removeInvalidTokens([
        "non-existent-device",
      ]);

      expect(result).toBe(0);
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.deleteMany as jest.Mock).mockRejectedValue(mockError);

      await expect(
        pushTokenService.removeInvalidTokens([mockDeviceId]),
      ).rejects.toThrow("Database error");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CLEANUP OLD TOKENS
  // ═══════════════════════════════════════════════════════════════════

  describe("cleanupOldTokens", () => {
    it("should remove tokens older than specified days", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 5,
      });

      const result = await pushTokenService.cleanupOldTokens(90);

      expect(result).toBe(5);
      expect(PushTokenModel.deleteMany).toHaveBeenCalledWith({
        updatedAt: { $lt: expect.any(Date) },
      });
    });

    it("should use default 90 days if not specified", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 3,
      });

      const result = await pushTokenService.cleanupOldTokens();

      expect(result).toBe(3);
      expect(PushTokenModel.deleteMany).toHaveBeenCalledWith({
        updatedAt: { $lt: expect.any(Date) },
      });
    });

    it("should return 0 if no old tokens found", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });

      const result = await pushTokenService.cleanupOldTokens(90);

      expect(result).toBe(0);
    });

    it("should handle custom days parameter", async () => {
      (PushTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 2,
      });

      const result = await pushTokenService.cleanupOldTokens(30);

      expect(result).toBe(2);
    });

    it("should handle errors and rethrow", async () => {
      const mockError = new Error("Database error");
      (PushTokenModel.deleteMany as jest.Mock).mockRejectedValue(mockError);

      await expect(pushTokenService.cleanupOldTokens(90)).rejects.toThrow(
        "Database error",
      );
    });
  });
});
