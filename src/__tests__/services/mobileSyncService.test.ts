// src/__tests__/services/mobileSyncService.test.ts

// Mock dependencies BEFORE imports
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));
jest.mock("../../models/points");
jest.mock("../../models/fiches");
jest.mock("../../models/lists");
jest.mock("../../models/sosContact");
jest.mock("../../models/sosSession");
jest.mock("../../models/keys");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/userEncryptionUtils");

import mongoose from "mongoose";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import SosContactModel from "../../models/sosContact";
import SosSessionModel from "../../models/sosSession";
import KeysModel from "../../models/keys";
import { decrypt } from "../../utils/masterEncryptionUtils";
import { mobileSyncService } from "../../services/mobileSyncService";

describe("MobileSyncService", () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockUserKey = "test-user-key-32-bytes-long!!!";

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock getUserKey dependencies
    (KeysModel.findOne as jest.Mock).mockResolvedValue({
      key: "encrypted-user-key",
    });
    (decrypt as jest.Mock).mockReturnValue(mockUserKey);

    // Mock SosContact and SosSession for getFullData
    (SosContactModel.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    (SosSessionModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
  });

  describe("getUserKey", () => {
    it("should retrieve and decrypt user key", async () => {
      const result = await mobileSyncService.getUserKey(mockUserId);

      expect(KeysModel.findOne).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        type: "user",
      });
      expect(result).toBe(mockUserKey);
    });

    it("should throw error if key not found", async () => {
      (KeysModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(mobileSyncService.getUserKey(mockUserId)).rejects.toThrow(
        "Clé utilisateur non trouvée",
      );
    });
  });

  describe("getFullData", () => {
    it("should return all user data with correct structure", async () => {
      const mockPoints = [
        { _id: new mongoose.Types.ObjectId(), name: "Point1" },
      ];
      const mockFiches = [
        { _id: new mongoose.Types.ObjectId(), name: "Fiche1" },
      ];
      const mockLists = [
        { _id: new mongoose.Types.ObjectId(), title: "List1" },
      ];

      (PointModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockPoints),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockFiches),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockLists),
      });

      const result = await mobileSyncService.getFullData(mockUserId);

      // Result has nested created/updated/deleted structure
      expect(result).toHaveProperty("points");
      expect(result).toHaveProperty("fiches");
      expect(result).toHaveProperty("lists");
      expect(result.points).toHaveProperty("created");
      expect(result.points).toHaveProperty("updated");
      expect(result.points).toHaveProperty("deleted");
    });
  });

  describe("softDeletePoint", () => {
    it("should soft delete a point", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();

      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeletePoint(
        pointId,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(PointModel.updateOne).toHaveBeenCalledWith(
        { _id: pointId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });

    it("should return false if point not found", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();

      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      const result = await mobileSyncService.softDeletePoint(
        pointId,
        mockUserId,
      );

      expect(result).toBe(false);
    });
  });

  describe("softDeleteFiche", () => {
    it("should soft delete a fiche", async () => {
      const ficheId = new mongoose.Types.ObjectId().toString();

      (FicheModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeleteFiche(
        ficheId,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(FicheModel.updateOne).toHaveBeenCalledWith(
        { _id: ficheId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });
  });

  describe("softDeleteList", () => {
    it("should soft delete a list", async () => {
      const listId = new mongoose.Types.ObjectId().toString();

      (ListModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeleteList(listId, mockUserId);

      expect(result).toBe(true);
      expect(ListModel.updateOne).toHaveBeenCalledWith(
        { _id: listId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });
  });
});
