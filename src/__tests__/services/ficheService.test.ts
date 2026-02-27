// ═══════════════════════════════════════════════════════════════════════════
// TESTS: ficheService
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import FicheModel from "../../models/fiches";
import {
  createFiche,
  getAllFiches,
  getFicheById,
  getFichesByUserId,
  updateFicheById,
  deleteFicheById,
  searchFiches,
  findFichesNearLocation,
  addPointToFiche,
  removePointFromFiche,
} from "../../services/ficheService";

jest.mock("../../models/fiches");

describe("FicheService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockFicheId = "507f1f77bcf86cd799439012";
  const mockPointId = "507f1f77bcf86cd799439013";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createFiche", () => {
    it("should create fiche with provided data", async () => {
      const ficheData = {
        userId: mockUserId,
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
      };
      (FicheModel.create as jest.Mock) = jest.fn().mockResolvedValue({
        _id: mockFicheId,
        ...ficheData,
      });

      const result = await createFiche(ficheData);

      expect(FicheModel.create).toHaveBeenCalledWith(ficheData);
      expect(result).toHaveProperty("_id", mockFicheId);
    });
  });

  describe("getAllFiches", () => {
    it("should return all fiches with limit and timeout", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ name: "Fiche 1" }]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getAllFiches();

      expect(mockQuery.limit).toHaveBeenCalledWith(1000);
      expect(mockQuery.maxTimeMS).toHaveBeenCalledWith(10000);
      expect(result).toHaveLength(1);
    });
  });

  describe("getFicheById", () => {
    it("should return fiche by ID", async () => {
      const mockFiche = { _id: mockFicheId, name: "Test" };
      const mockQuery = {
        lean: jest.fn().mockResolvedValue(mockFiche),
      };
      (FicheModel.findById as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getFicheById(mockFicheId);

      expect(FicheModel.findById).toHaveBeenCalledWith(mockFicheId);
      expect(result).toEqual(mockFiche);
    });

    it("should throw error for invalid ID", async () => {
      await expect(getFicheById("invalid-id")).rejects.toThrow(
        "ID de fiche fourni n'est pas valide"
      );
    });
  });

  describe("getFichesByUserId", () => {
    it("should return fiches for user", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ userId: mockUserId }]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      const result = await getFichesByUserId(mockUserId);

      expect(FicheModel.find).toHaveBeenCalledWith({ userId: mockUserId });
      expect(result).toHaveLength(1);
    });

    it("should throw error for invalid user ID", async () => {
      await expect(getFichesByUserId("invalid")).rejects.toThrow(
        "ID utilisateur fourni n'est pas valide"
      );
    });
  });

  describe("updateFicheById", () => {
    it("should update fiche and set modification date", async () => {
      const updateData = { name: "Updated" };
      (FicheModel.findByIdAndUpdate as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ _id: mockFicheId, ...updateData });

      const result = await updateFicheById(mockFicheId, updateData);

      expect(FicheModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockFicheId,
        expect.objectContaining({
          name: "Updated",
          date_modification: expect.any(Date),
        }),
        { new: true }
      );
    });

    it("should throw error for invalid ID", async () => {
      await expect(updateFicheById("invalid", {})).rejects.toThrow(
        "ID de fiche fourni n'est pas valide"
      );
    });
  });

  describe("deleteFicheById", () => {
    it("should delete fiche and return true", async () => {
      (FicheModel.findByIdAndDelete as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ _id: mockFicheId });

      const result = await deleteFicheById(mockFicheId);

      expect(result).toBe(true);
      expect(FicheModel.findByIdAndDelete).toHaveBeenCalledWith(mockFicheId);
    });

    it("should return false when fiche not found", async () => {
      (FicheModel.findByIdAndDelete as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      const result = await deleteFicheById(mockFicheId);

      expect(result).toBe(false);
    });
  });

  describe("searchFiches", () => {
    it("should sanitize and search by criteria", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await searchFiches({ name: "test", type: "carriere" });

      expect(FicheModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "carriere",
        })
      );
    });

    it("should use regex for name and ville fields", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await searchFiches({ name: "Paris" });

      const callArgs = (FicheModel.find as jest.Mock).mock.calls[0][0];
      expect(callArgs.name).toHaveProperty("$regex");
      expect(callArgs.name).toHaveProperty("$options", "i");
    });

    it("should ignore non-whitelisted fields", async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await searchFiches({ invalidField: "test", name: "valid" });

      const callArgs = (FicheModel.find as jest.Mock).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("invalidField");
    });
  });

  describe("findFichesNearLocation", () => {
    it("should find fiches near coordinates", async () => {
      const mockQuery = {
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await findFichesNearLocation(2.3522, 48.8566, 5000);

      expect(FicheModel.find).toHaveBeenCalledWith({
        "center_cavite.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [2.3522, 48.8566],
            },
            $maxDistance: 5000,
          },
        },
      });
    });

    it("should throw error for invalid coordinates", async () => {
      await expect(findFichesNearLocation(200, 48.8566)).rejects.toThrow(
        "longitude doit être entre -180 et 180"
      );
      await expect(findFichesNearLocation(2.3522, 100)).rejects.toThrow(
        "latitude doit être entre -90 et 90"
      );
    });

    it("should throw error for invalid maxDistance", async () => {
      await expect(findFichesNearLocation(2.3522, 48.8566, 0)).rejects.toThrow(
        "distance maximale doit être entre 1m et 50km"
      );
      await expect(findFichesNearLocation(2.3522, 48.8566, 60000)).rejects.toThrow(
        "distance maximale doit être entre 1m et 50km"
      );
    });

    it("should use default maxDistance of 5000m", async () => {
      const mockQuery = {
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };
      (FicheModel.find as jest.Mock) = jest.fn().mockReturnValue(mockQuery);

      await findFichesNearLocation(2.3522, 48.8566);

      const callArgs = (FicheModel.find as jest.Mock).mock.calls[0][0];
      expect(callArgs["center_cavite.coordinates"].$near.$maxDistance).toBe(5000);
    });
  });

  describe("addPointToFiche", () => {
    it("should add point to fiche using $addToSet", async () => {
      (FicheModel.findByIdAndUpdate as jest.Mock) = jest.fn().mockResolvedValue({});

      await addPointToFiche(mockFicheId, mockPointId);

      expect(FicheModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockFicheId,
        { $addToSet: { points_ids: mockPointId } },
        { new: true }
      );
    });

    it("should throw error for invalid IDs", async () => {
      await expect(addPointToFiche("invalid", mockPointId)).rejects.toThrow();
      await expect(addPointToFiche(mockFicheId, "invalid")).rejects.toThrow();
    });
  });

  describe("removePointFromFiche", () => {
    it("should remove point from fiche using $pull", async () => {
      (FicheModel.findByIdAndUpdate as jest.Mock) = jest.fn().mockResolvedValue({});

      await removePointFromFiche(mockFicheId, mockPointId);

      expect(FicheModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockFicheId,
        { $pull: { points_ids: mockPointId } },
        { new: true }
      );
    });

    it("should throw error for invalid IDs", async () => {
      await expect(removePointFromFiche("invalid", mockPointId)).rejects.toThrow();
      await expect(removePointFromFiche(mockFicheId, "invalid")).rejects.toThrow();
    });
  });
});
