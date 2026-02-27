// ═══════════════════════════════════════════════════════════════════════════
// TESTS: dataArchiveService
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import DeletedData from "../../models/deletedData";
import { dataArchiveService } from "../../services/dataArchiveService";

jest.mock("../../models/deletedData");

describe("DataArchiveService", () => {
  const mockUserId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  const mockEntityId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("archiveEntity", () => {
    it("should archive entity with all required fields", async () => {
      const mockArchived = { _id: "archived123", entityId: mockEntityId };
      (DeletedData.create as jest.Mock) = jest.fn().mockResolvedValue(mockArchived);

      const result = await dataArchiveService.archiveEntity(
        "fiche",
        mockEntityId,
        { name: "Test" },
        mockUserId
      );

      expect(DeletedData.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "fiche",
          entityId: expect.any(mongoose.Types.ObjectId),
          data: { name: "Test" },
          deletedBy: expect.any(mongoose.Types.ObjectId),
          deletedAt: expect.any(Date),
          isRestored: false,
        })
      );
      expect(result).toEqual(mockArchived);
    });

    it("should include optional reason and context", async () => {
      const mockArchived = { _id: "archived456" };
      (DeletedData.create as jest.Mock) = jest.fn().mockResolvedValue(mockArchived);

      await dataArchiveService.archiveEntity(
        "point",
        mockEntityId,
        {},
        mockUserId,
        {
          reason: "Test deletion",
          context: { ipAddress: "127.0.0.1" },
        }
      );

      expect(DeletedData.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deletionReason: "Test deletion",
          deletionContext: { ipAddress: "127.0.0.1" },
        })
      );
    });

    it("should handle parent entity relationship", async () => {
      const parentId = new mongoose.Types.ObjectId();
      (DeletedData.create as jest.Mock) = jest.fn().mockResolvedValue({});

      await dataArchiveService.archiveEntity(
        "point",
        mockEntityId,
        {},
        mockUserId,
        {
          parentEntityType: "fiche",
          parentEntityId: parentId,
        }
      );

      expect(DeletedData.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentEntityType: "fiche",
          parentEntityId: expect.any(mongoose.Types.ObjectId),
        })
      );
    });

    it("should throw error on database failure", async () => {
      (DeletedData.create as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error("DB error"));

      await expect(
        dataArchiveService.archiveEntity("fiche", mockEntityId, {}, mockUserId)
      ).rejects.toThrow("DB error");
    });
  });

  describe("archiveAndRecordDeletion", () => {
    it("should delegate to archiveEntity", async () => {
      const mockResult = { _id: "result123" };
      (DeletedData.create as jest.Mock) = jest.fn().mockResolvedValue(mockResult);

      const result = await dataArchiveService.archiveAndRecordDeletion(
        "user",
        mockEntityId,
        { email: "test@test.com" },
        mockUserId
      );

      expect(DeletedData.create).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe("getDeletedByUser", () => {
    it("should return deleted entities for user", async () => {
      const mockDeleted = [{ entityId: mockEntityId }];
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockDeleted),
      };
      (DeletedData.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await dataArchiveService.getDeletedByUser(mockUserId);

      expect(DeletedData.find).toHaveBeenCalledWith({
        deletedBy: expect.any(mongoose.Types.ObjectId),
        isRestored: false,
      });
      expect(result).toEqual(mockDeleted);
    });

    it("should filter by entity type if provided", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      (DeletedData.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await dataArchiveService.getDeletedByUser(mockUserId, { entityType: "fiche" });

      expect(DeletedData.find).toHaveBeenCalledWith({
        deletedBy: expect.any(mongoose.Types.ObjectId),
        isRestored: false,
        entityType: "fiche",
      });
    });

    it("should use pagination options", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      (DeletedData.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await dataArchiveService.getDeletedByUser(mockUserId, {
        limit: 20,
        skip: 10,
      });

      expect(mockQuery.limit).toHaveBeenCalledWith(20);
      expect(mockQuery.skip).toHaveBeenCalledWith(10);
    });
  });

  describe("getArchivedEntity", () => {
    it("should find archived entity by ID and type", async () => {
      const mockEntity = { entityId: mockEntityId };
      (DeletedData.findOne as jest.Mock) = jest.fn().mockResolvedValue(mockEntity);

      const result = await dataArchiveService.getArchivedEntity("fiche", mockEntityId);

      expect(DeletedData.findOne).toHaveBeenCalledWith({
        entityType: "fiche",
        entityId: expect.any(mongoose.Types.ObjectId),
        isRestored: false,
      });
      expect(result).toEqual(mockEntity);
    });

    it("should return null when not found", async () => {
      (DeletedData.findOne as jest.Mock) = jest.fn().mockResolvedValue(null);

      const result = await dataArchiveService.getArchivedEntity("point", mockEntityId);

      expect(result).toBeNull();
    });
  });

  describe("markAsRestored", () => {
    it("should mark entity as restored", async () => {
      const mockRestored = {
        entityId: mockEntityId,
        isRestored: true,
        restoredAt: expect.any(Date),
      };
      (DeletedData.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockRestored);

      const result = await dataArchiveService.markAsRestored(
        "fiche",
        mockEntityId,
        mockUserId
      );

      expect(DeletedData.findOneAndUpdate).toHaveBeenCalledWith(
        {
          entityType: "fiche",
          entityId: expect.any(mongoose.Types.ObjectId),
          isRestored: false,
        },
        {
          isRestored: true,
          restoredAt: expect.any(Date),
          restoredBy: expect.any(mongoose.Types.ObjectId),
        },
        { new: true }
      );
      expect(result).toEqual(mockRestored);
    });

    it("should return null if entity not found or already restored", async () => {
      (DeletedData.findOneAndUpdate as jest.Mock) = jest.fn().mockResolvedValue(null);

      const result = await dataArchiveService.markAsRestored(
        "point",
        mockEntityId,
        mockUserId
      );

      expect(result).toBeNull();
    });
  });

  describe("getArchiveStats", () => {
    it("should return statistics about archived data", async () => {
      (DeletedData.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValueOnce(100) // totalDeleted
        .mockResolvedValueOnce(10) // totalRestored
        .mockResolvedValueOnce(5); // recentDeletions

      (DeletedData.aggregate as jest.Mock) = jest.fn().mockResolvedValue([
        { _id: "fiche", count: 50 },
        { _id: "point", count: 30 },
        { _id: "user", count: 20 },
      ]);

      const stats = await dataArchiveService.getArchiveStats();

      expect(stats).toEqual({
        totalDeleted: 100,
        deletedByType: {
          fiche: 50,
          point: 30,
          user: 20,
        },
        totalRestored: 10,
        recentDeletions: 5,
      });
    });

    it("should handle empty aggregation result", async () => {
      (DeletedData.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(0);
      (DeletedData.aggregate as jest.Mock) = jest.fn().mockResolvedValue([]);

      const stats = await dataArchiveService.getArchiveStats();

      expect(stats.deletedByType).toEqual({});
    });
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = dataArchiveService;
      const instance2 = dataArchiveService;

      expect(instance1).toBe(instance2);
    });
  });
});
