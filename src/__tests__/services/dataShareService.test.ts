// src/__tests__/services/dataShareService.test.ts

// Mock dependencies BEFORE imports
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock("../../models/dataShare");
jest.mock("../../models/fiches");
jest.mock("../../models/points");
jest.mock("../../models/lists");
jest.mock("../../models/keys");
jest.mock("../../models/users");
jest.mock("../../models/contacts");
jest.mock("../../utils/userEncryptionUtils");
jest.mock("../../utils/rsaEncryptionUtils", () => ({
  encryptWithPublicKey: jest.fn(),
  decryptWithPrivateKey: jest.fn(),
  signData: jest.fn(),
  verifySignature: jest.fn(),
  createDataHash: jest.fn(),
}));
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../services/memoryStorageService", () => ({
  memoryStorage: {
    hasSession: jest.fn().mockReturnValue(true),
    updatePoint: jest.fn(),
    updateFiche: jest.fn(),
    updateList: jest.fn(),
    deletePoint: jest.fn(),
    deleteFiche: jest.fn(),
    deleteList: jest.fn(),
    addPoint: jest.fn(),
    addFiche: jest.fn(),
    addList: jest.fn(),
  },
}));
jest.mock("../../services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));

import mongoose from "mongoose";
import DataShareModel, { DataType } from "../../models/dataShare";
import KeysModel from "../../models/keys";
import UserModel from "../../models/users";
import { createNotification } from "../../services/notificationService";
import {
  decryptWithPrivateKey,
  verifySignature,
} from "../../utils/rsaEncryptionUtils";
import { decrypt as decryptMaster } from "../../utils/masterEncryptionUtils";
import {
  cleanupExpiredShares,
  getReceivedShares,
  getSentShares,
  updateShareStatus,
} from "../../services/dataShareService";

describe("DataShareService", () => {
  const mockUserId = new mongoose.Types.ObjectId();
  const mockShareId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock common KeysModel calls
    (KeysModel.findOne as jest.Mock).mockImplementation(({ type }) => ({
      lean: jest.fn().mockResolvedValue({
        key:
          type === "rsa-public"
            ? "mock-public-key"
            : "encrypted-private-key-mock",
      }),
    }));

    // Mock decryption and signature verification
    (decryptMaster as jest.Mock).mockReturnValue("decrypted-private-key");
    (decryptWithPrivateKey as jest.Mock).mockReturnValue(
      JSON.stringify({ name: "test", data: "test-data" }),
    );
    (verifySignature as jest.Mock).mockReturnValue(true);
  });

  describe("cleanupExpiredShares", () => {
    it("should cleanup expired shares and return count", async () => {
      (DataShareModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 5,
      });

      const result = await cleanupExpiredShares();

      expect(DataShareModel.updateMany).toHaveBeenCalledWith(
        {
          expiresAt: { $lt: expect.any(Date) },
          isActive: true,
        },
        {
          $set: { isActive: false },
        },
      );
      expect(result).toBe(5);
    });

    it("should return 0 if no expired shares", async () => {
      (DataShareModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      const result = await cleanupExpiredShares();

      expect(result).toBe(0);
    });
  });

  describe("updateShareStatus", () => {
    it("should update share status to declined", async () => {
      const mockSenderId = new mongoose.Types.ObjectId();
      const mockShare = {
        _id: mockShareId,
        status: "pending",
        receiverIds: [mockUserId],
        senderId: mockSenderId,
        encryptedDataPerReceiver: [
          {
            receiverId: mockUserId,
            status: "pending",
          },
        ],
        save: jest.fn().mockResolvedValue({}),
      };

      (DataShareModel.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockShare),
      });

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            name: "John",
            surname: "Doe",
            showPseudo: false,
          }),
        }),
      });

      await updateShareStatus(mockUserId, mockShareId, "declined");

      expect(mockShare.encryptedDataPerReceiver[0].status).toBe("declined");
      expect(mockShare.save).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalled();
    });

    it("should throw error if share not found", async () => {
      (DataShareModel.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      await expect(
        updateShareStatus(mockUserId, mockShareId, "accepted"),
      ).rejects.toThrow("Partage non trouvé");
    });

    it("should throw error if receiver data not found", async () => {
      const mockShare = {
        _id: mockShareId,
        receiverIds: [mockUserId],
        encryptedDataPerReceiver: [], // Empty array
      };

      (DataShareModel.findOne as jest.Mock).mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockShare),
      });

      await expect(
        updateShareStatus(mockUserId, mockShareId, "accepted"),
      ).rejects.toThrow("Données non trouvées pour ce destinataire");
    });
  });

  describe("getReceivedShares", () => {
    it("should get received shares for user (excluding expired)", async () => {
      const mockShares = [
        {
          _id: new mongoose.Types.ObjectId(),
          dataType: "point",
          status: "pending",
          createdAt: new Date(),
        },
        {
          _id: new mongoose.Types.ObjectId(),
          dataType: "fiche",
          status: "accepted",
          createdAt: new Date(),
        },
      ];

      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockShares),
        }),
      });

      const result = await getReceivedShares(mockUserId);

      expect(DataShareModel.find).toHaveBeenCalledWith({
        receiverIds: mockUserId,
        isActive: true,
        expiresAt: { $gte: expect.any(Date) },
      });
      expect(result).toEqual(mockShares);
    });

    it("should get received shares including expired when specified", async () => {
      const mockShares = [
        {
          _id: new mongoose.Types.ObjectId(),
          dataType: "point",
          status: "pending",
          createdAt: new Date(),
        },
      ];

      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockShares),
        }),
      });

      const result = await getReceivedShares(mockUserId, true);

      expect(DataShareModel.find).toHaveBeenCalledWith({
        receiverIds: mockUserId,
        isActive: true,
      });
      expect(result).toEqual(mockShares);
    });

    it("should return empty array if no shares found", async () => {
      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await getReceivedShares(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe("getSentShares", () => {
    it("should get sent shares for user (excluding expired)", async () => {
      const mockShares = [
        {
          _id: new mongoose.Types.ObjectId(),
          dataType: "liste",
          status: "accepted",
          createdAt: new Date(),
        },
      ];

      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockShares),
        }),
      });

      const result = await getSentShares(mockUserId);

      expect(DataShareModel.find).toHaveBeenCalledWith({
        senderId: mockUserId,
        isActive: true,
        expiresAt: { $gte: expect.any(Date) },
      });
      expect(result).toEqual(mockShares);
    });

    it("should get sent shares including expired when specified", async () => {
      const mockShares = [
        {
          _id: new mongoose.Types.ObjectId(),
          dataType: "liste",
          status: "accepted",
          createdAt: new Date(),
        },
      ];

      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue(mockShares),
        }),
      });

      const result = await getSentShares(mockUserId, true);

      expect(DataShareModel.find).toHaveBeenCalledWith({
        senderId: mockUserId,
        isActive: true,
      });
      expect(result).toEqual(mockShares);
    });

    it("should return empty array if no shares sent", async () => {
      (DataShareModel.find as jest.Mock).mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await getSentShares(mockUserId);

      expect(result).toEqual([]);
    });
  });
});
