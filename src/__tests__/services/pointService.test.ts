// ═══════════════════════════════════════════════════════════════════════════
// TESTS: pointService
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import PointModel from "../../models/points";
import {
  createPoint,
  getAllPointsByUserId,
  getPointById,
  deletePoint,
  updatePoint,
  getPointsByFicheId,
  linkPointToFiche,
  unlinkPointFromFiche,
  getPointsByIds,
} from "../../services/pointService";

// Mock dependencies
jest.mock("../../models/points");

describe("PointService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockPointId = "507f1f77bcf86cd799439012";
  const mockFicheId = "507f1f77bcf86cd799439013";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // createPoint
  // ═════════════════════════════════════════════════════════════════════════

  describe("createPoint", () => {
    it("should create point with required fields", async () => {
      const pointData = {
        userId: mockUserId,
        name: "Point Test",
        location_encrypted: "encrypted:location:data",
      };

      const mockSave = jest
        .fn()
        .mockResolvedValue({ _id: mockPointId, ...pointData });
      (PointModel as unknown as jest.Mock) = jest
        .fn()
        .mockImplementation(() => ({
          save: mockSave,
        }));

      const result = await createPoint(pointData);

      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it("should create point with optional description", async () => {
      const pointData = {
        userId: mockUserId,
        name: "Point with description",
        description: "Test description",
        location_encrypted: "encrypted:location",
      };

      const mockSave = jest.fn().mockResolvedValue(pointData);
      (PointModel as unknown as jest.Mock) = jest
        .fn()
        .mockImplementation(() => ({
          save: mockSave,
        }));

      await createPoint(pointData);

      expect(mockSave).toHaveBeenCalled();
    });

    it("should associate point with fiche if ficheId provided", async () => {
      const pointData = {
        userId: mockUserId,
        name: "Point with fiche",
        location_encrypted: "encrypted:location",
        ficheId: mockFicheId,
      };

      const mockSave = jest.fn().mockResolvedValue(pointData);
      (PointModel as unknown as jest.Mock) = jest
        .fn()
        .mockImplementation(() => ({
          save: mockSave,
        }));

      await createPoint(pointData);

      expect(mockSave).toHaveBeenCalled();
    });

    it("should throw error on database failure", async () => {
      const pointData = {
        userId: mockUserId,
        name: "Fail point",
        location_encrypted: "encrypted:location",
      };

      const mockSave = jest.fn().mockRejectedValue(new Error("DB error"));
      (PointModel as unknown as jest.Mock) = jest
        .fn()
        .mockImplementation(() => ({
          save: mockSave,
        }));

      await expect(createPoint(pointData)).rejects.toThrow("DB error");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getAllPointsByUserId
  // ═════════════════════════════════════════════════════════════════════════

  describe("getAllPointsByUserId", () => {
    it("should return points for valid user ID", async () => {
      const mockPoints = [
        { _id: "1", name: "Point 1", userId: mockUserId },
        { _id: "2", name: "Point 2", userId: mockUserId },
      ];

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockPoints),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getAllPointsByUserId(mockUserId);

      expect(PointModel.find).toHaveBeenCalledWith({
        userId: mockUserId,
        is_active: true,
      });
      expect(result).toEqual(mockPoints);
    });

    it("should throw error for invalid user ID", async () => {
      await expect(getAllPointsByUserId("invalid-id")).rejects.toThrow(
        "L'ID utilisateur fourni n'est pas valide",
      );
    });

    it("should sort points by created_at descending", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue([]),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await getAllPointsByUserId(mockUserId);

      expect(mockQuery.sort).toHaveBeenCalledWith({ created_at: -1 });
    });

    it("should apply maxTimeMS timeout", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue([]),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await getAllPointsByUserId(mockUserId);

      expect(mockQuery.maxTimeMS).toHaveBeenCalledWith(5000);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getPointById
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getPointById", () => {
    it("should return point when found", async () => {
      const mockPoint = { _id: mockPointId, name: "Test Point" };
      const mockQuery = {
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockPoint),
      };
      (PointModel.findOne as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getPointById(mockPointId, mockUserId);

      expect(PointModel.findOne).toHaveBeenCalledWith({
        _id: mockPointId,
        userId: mockUserId,
        is_active: true,
      });
      expect(result).toEqual(mockPoint);
    });

    it("should throw error for invalid point ID", async () => {
      await expect(getPointById("invalid", mockUserId)).rejects.toThrow(
        "L'ID du point n'est pas valide",
      );
    });

    it("should return null when point not found", async () => {
      const mockQuery = {
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(null),
      };
      (PointModel.findOne as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getPointById(mockPointId, mockUserId);

      expect(result).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // deletePoint
  // ═════════════════════════════════════════════════════════════════════════

  describe("deletePoint", () => {
    it("should delete point and return it", async () => {
      const mockPoint = { _id: mockPointId, name: "Deleted point" };
      (PointModel.findByIdAndDelete as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockPoint);

      const result = await deletePoint(mockPointId);

      expect(PointModel.findByIdAndDelete).toHaveBeenCalledWith(mockPointId);
      expect(result).toEqual(mockPoint);
    });

    it("should throw error for invalid ID", async () => {
      await expect(deletePoint("invalid-id")).rejects.toThrow(
        "L'ID du point n'est pas valide",
      );
    });

    it("should return null when point not found", async () => {
      (PointModel.findByIdAndDelete as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      const result = await deletePoint(mockPointId);

      expect(result).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // updatePoint
  // ═════════════════════════════════════════════════════════════════════════

  describe("updatePoint", () => {
    it("should update point with new data", async () => {
      const updateData = { name: "Updated name" };
      const mockUpdated = { ...updateData, _id: mockPointId };
      (PointModel.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockUpdated);

      const result = await updatePoint(mockPointId, mockUserId, updateData);

      expect(PointModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: mockPointId, userId: mockUserId, is_active: true },
        expect.objectContaining({
          name: "Updated name",
          updated_at: expect.any(Date),
        }),
        { new: true, runValidators: true },
      );
      expect(result).toEqual(mockUpdated);
    });

    it("should throw error for invalid point ID", async () => {
      await expect(updatePoint("invalid", mockUserId, {})).rejects.toThrow(
        "L'ID du point n'est pas valide",
      );
    });

    it("should set updated_at timestamp", async () => {
      (PointModel.findOneAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue({});

      await updatePoint(mockPointId, mockUserId, { name: "Test" });

      const updateCall = (PointModel.findOneAndUpdate as jest.Mock).mock
        .calls[0];
      expect(updateCall[1]).toHaveProperty("updated_at");
      expect(updateCall[1].updated_at).toBeInstanceOf(Date);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getPointsByFicheId
  // ═════════════════════════════════════════════════════════════════════════

  describe("getPointsByFicheId", () => {
    it("should return points linked to fiche", async () => {
      const mockPoints = [
        { _id: "1", ficheId: mockFicheId },
        { _id: "2", ficheId: mockFicheId },
      ];
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockPoints),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getPointsByFicheId(mockFicheId);

      expect(PointModel.find).toHaveBeenCalledWith({
        ficheId: mockFicheId,
        is_active: true,
      });
      expect(result).toEqual(mockPoints);
    });

    it("should throw error for invalid fiche ID", async () => {
      await expect(getPointsByFicheId("invalid")).rejects.toThrow(
        "L'ID de la fiche n'est pas valide",
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // linkPointToFiche
  // ═════════════════════════════════════════════════════════════════════════

  describe("linkPointToFiche", () => {
    it("should link point to fiche", async () => {
      const mockLinked = { _id: mockPointId, ficheId: mockFicheId };
      (PointModel.findByIdAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockLinked);

      const result = await linkPointToFiche(mockPointId, mockFicheId);

      expect(PointModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockPointId,
        { ficheId: mockFicheId },
        { new: true },
      );
      expect(result).toEqual(mockLinked);
    });

    it("should throw error for invalid point ID", async () => {
      await expect(linkPointToFiche("invalid", mockFicheId)).rejects.toThrow(
        "L'ID du point ou de la fiche n'est pas valide",
      );
    });

    it("should throw error for invalid fiche ID", async () => {
      await expect(linkPointToFiche(mockPointId, "invalid")).rejects.toThrow(
        "L'ID du point ou de la fiche n'est pas valide",
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // unlinkPointFromFiche
  // ═════════════════════════════════════════════════════════════════════════

  describe("unlinkPointFromFiche", () => {
    it("should unlink point from fiche", async () => {
      const mockUnlinked = { _id: mockPointId, ficheId: null };
      (PointModel.findByIdAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockUnlinked);

      const result = await unlinkPointFromFiche(mockPointId);

      expect(PointModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockPointId,
        { ficheId: null },
        { new: true },
      );
      expect(result).toEqual(mockUnlinked);
    });

    it("should throw error for invalid point ID", async () => {
      await expect(unlinkPointFromFiche("invalid")).rejects.toThrow(
        "L'ID du point n'est pas valide",
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getPointsByIds
  // ═════════════════════════════════════════════════════════════════════════

  describe("getPointsByIds", () => {
    it("should return points for valid IDs", async () => {
      const ids = [mockPointId, "507f1f77bcf86cd799439014"];
      const mockPoints = [{ _id: ids[0] }, { _id: ids[1] }];
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockPoints),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getPointsByIds(ids);

      expect(PointModel.find).toHaveBeenCalledWith({
        _id: { $in: ids },
        is_active: true,
      });
      expect(result).toEqual(mockPoints);
    });

    it("should return empty array for empty input", async () => {
      const result = await getPointsByIds([]);

      expect(result).toEqual([]);
      expect(PointModel.find).not.toHaveBeenCalled();
    });

    it("should filter out invalid IDs", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue([]),
      };
      (PointModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await getPointsByIds([mockPointId, "invalid-id", "also-invalid"]);

      expect(PointModel.find).toHaveBeenCalledWith({
        _id: { $in: [mockPointId] },
        is_active: true,
      });
    });

    it("should return empty array when all IDs invalid", async () => {
      const result = await getPointsByIds(["invalid1", "invalid2"]);

      expect(result).toEqual([]);
      expect(PointModel.find).not.toHaveBeenCalled();
    });
  });
});
