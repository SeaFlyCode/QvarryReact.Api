/**
 * Tests unitaires pour pointsControllers
 * Teste la création, récupération, mise à jour et suppression de points
 */

jest.mock("../../models/points");
jest.mock("../../models/fiches");
jest.mock("../../models/lists");
jest.mock("../../services/memoryStorageService");
jest.mock("../../services/syncService");

import { Request, Response } from "express";
import {
  handleCreatePoint,
  handleGetAllPointsByUserId,
  handleSearchPoints,
  handleGetPointById,
  handleDeletePoint,
  handleUpdatePoint,
  handleLinkPointToFiche,
} from "../../controllers/pointsControllers";
import { mockRequest, mockResponse } from "../mocks";
import { memoryStorage } from "../../services/memoryStorageService";
import { syncService } from "../../services/syncService";

describe("pointsControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();
    jest.clearAllMocks();

    // Setup default mocks
    (memoryStorage.storePoint as jest.Mock) = jest.fn().mockReturnValue(true);
    (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
      success: true,
    });
  });

  describe("handleCreatePoint", () => {
    it("devrait créer un point avec succès", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.body = {
        name: "Mon point",
        description: "Description du point",
        longitude: 2.3522,
        latitude: 48.8566,
        accessType: "private",
      };

      await handleCreatePoint(req as Request, res as Response);

      expect(memoryStorage.storePoint).toHaveBeenCalled();
      expect(syncService.syncNow).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { name: "Test", longitude: 2.0, latitude: 48.0 };

      await handleCreatePoint(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si champs requis manquants", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.body = { name: "Test" };

      await handleCreatePoint(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("handleGetAllPointsByUserId", () => {
    it("devrait récupérer tous les points d'un utilisateur", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };

      const mockPoints = [
        {
          _id: "point1",
          name: "Point 1",
          location: { type: "Point", coordinates: [2.0, 48.0] },
        },
        {
          _id: "point2",
          name: "Point 2",
          location: { type: "Point", coordinates: [2.5, 48.5] },
        },
      ];

      (memoryStorage.getAllPoints as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockPoints);

      await handleGetAllPointsByUserId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: mockPoints,
        pagination: expect.objectContaining({
          page: 1,
          limit: 500,
          total: 2,
        }),
      });
    });
  });

  describe("handleSearchPoints", () => {
    it("devrait rechercher des points par nom", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.query = { query: "test" };

      const mockResults = [
        {
          _id: "point1",
          name: "Test Point",
          location: { type: "Point", coordinates: [2.0, 48.0] },
        },
      ];

      (memoryStorage.searchPoints as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockResults);

      await handleSearchPoints(req as Request, res as Response);

      expect(memoryStorage.searchPoints).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        { query: "test" },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("handleGetPointById", () => {
    it("devrait récupérer un point par ID", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.params = { id: "507f1f77bcf86cd799439012" };

      const mockPoint = {
        _id: "507f1f77bcf86cd799439012",
        userId: "507f1f77bcf86cd799439011",
        name: "Mon point",
        location: { type: "Point", coordinates: [2.0, 48.0] },
      };

      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockPoint);

      await handleGetPointById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockPoint);
    });

    it("devrait rejeter si point non trouvé", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.params = { id: "507f1f77bcf86cd799439012" };

      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockReturnValue(null);

      await handleGetPointById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait rejeter si ID invalide", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.params = { id: "invalid-id" };

      await handleGetPointById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("handleUpdatePoint", () => {
    it("devrait mettre à jour un point", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.params = { id: "507f1f77bcf86cd799439012" };
      req.body = {
        name: "Point mis à jour",
        description: "Nouvelle description",
      };

      const mockPoint = {
        _id: "507f1f77bcf86cd799439012",
        userId: "507f1f77bcf86cd799439011",
        name: "Ancien nom",
        description: "Ancienne description",
        location: { type: "Point", coordinates: [2.0, 48.0] },
      };

      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockPoint);
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleUpdatePoint(req as Request, res as Response);

      expect(mockPoint.name).toBe("Point mis à jour");
      expect(mockPoint.description).toBe("Nouvelle description");
      expect(syncService.syncNow).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("handleDeletePoint", () => {
    it("devrait supprimer un point", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.params = { id: "507f1f77bcf86cd799439012" };

      (memoryStorage.getPointById as jest.Mock) = jest.fn().mockReturnValue({
        _id: "507f1f77bcf86cd799439012",
        userId: "507f1f77bcf86cd799439011",
      });
      (memoryStorage.deletePoint as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleDeletePoint(req as Request, res as Response);

      expect(memoryStorage.deletePoint).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439012",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("handleLinkPointToFiche", () => {
    it("devrait lier un point à une fiche", async () => {
      req.user = { id: "507f1f77bcf86cd799439011", isAdmin: false };
      req.body = {
        pointId: "507f1f77bcf86cd799439012",
        ficheId: "507f1f77bcf86cd799439013",
      };

      (memoryStorage.addPointToFiche as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleLinkPointToFiche(req as Request, res as Response);

      expect(memoryStorage.addPointToFiche).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439013",
        "507f1f77bcf86cd799439012",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
