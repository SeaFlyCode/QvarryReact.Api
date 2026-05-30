/**
 * Tests unitaires pour listsControllers
 * Teste la création, récupération, mise à jour et suppression de listes
 */

jest.mock("../../models/lists");
jest.mock("../../models/points");
jest.mock("../../services/memoryStorageService");
jest.mock("../../services/syncService");
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    broadcastSyncUpdate: jest.fn(),
    broadcastNotificationRead: jest.fn(),
  },
}));

import { Request, Response } from "express";
import {
  handleCreateList,
  handleGetAllLists,
  handleGetListById,
  handleDeleteList,
  handleUpdateList,
  handleAddPointToList,
  handleRemovePointFromList,
  handleBulkAddPointsToList,
} from "../../controllers/listsControllers";
import { memoryStorage } from "../../services/memoryStorageService";
import { syncService } from "../../services/syncService";
import { mockRequest, mockResponse } from "../mocks";

// [LIST-OFF 2026-05-30] désactivation temporaire du système de listes — réactiver en décommentant (describe.skip → describe)
describe.skip("listsControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();
    jest.clearAllMocks();

    // Setup default mock behaviors
    (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
      success: true,
    });
  });

  describe("handleCreateList", () => {
    it("devrait créer une liste avec succès", async () => {
      req.user = { id: "user123" };
      req.body = {
        name: "Ma liste",
        description: "Description de la liste",
        color: "#FF0000",
      };

      (memoryStorage.storeList as jest.Mock) = jest.fn();
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleCreateList(req as Request, res as Response);

      expect(memoryStorage.storeList).toHaveBeenCalled();
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: "Liste créée avec succès",
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { name: "Test" };

      await handleCreateList(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "L'identifiant utilisateur et le nom sont requis",
      });
    });

    it("devrait rejeter si nom manquant", async () => {
      req.user = { id: "user123" };
      req.body = {};

      await handleCreateList(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "L'identifiant utilisateur et le nom sont requis",
      });
    });
  });

  describe("handleGetAllLists", () => {
    it("devrait récupérer toutes les listes d'un utilisateur", async () => {
      req.user = { id: "user123" };

      const mockLists = [
        { _id: "list1", name: "Liste 1", points: [] },
        { _id: "list2", name: "Liste 2", points: [] },
      ];

      (memoryStorage.getAllLists as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockLists);

      await handleGetAllLists(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: mockLists,
        pagination: {
          page: 1,
          limit: 50,
          total: 2,
          totalPages: 1,
        },
      });
    });

    it("devrait retourner un tableau vide si aucune liste", async () => {
      req.user = { id: "user123" };

      (memoryStorage.getAllLists as jest.Mock) = jest.fn().mockReturnValue([]);

      await handleGetAllLists(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
        },
      });
    });
  });

  describe("handleGetListById", () => {
    it("devrait récupérer une liste par ID", async () => {
      req.user = { id: "user123" };
      req.params = { id: "list123" };

      const mockList = {
        _id: "list123",
        userId: "user123",
        name: "Ma liste",
      };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockList);

      await handleGetListById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockList);
    });

    it("devrait rejeter si liste non trouvée", async () => {
      req.user = { id: "user123" };
      req.params = { id: "list999" };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(null);

      await handleGetListById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: "Liste non trouvée" });
    });
  });

  describe("handleUpdateList", () => {
    it("devrait mettre à jour une liste", async () => {
      req.user = { id: "user123" };
      req.params = { id: "list123" };
      req.body = {
        name: "Liste mise à jour",
        description: "Nouvelle description",
      };

      const mockUpdatedList = {
        _id: "list123",
        userId: "user123",
        name: "Liste mise à jour",
        description: "Nouvelle description",
      };

      (memoryStorage.updateList as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockUpdatedList);
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleUpdateList(req as Request, res as Response);

      expect(memoryStorage.updateList).toHaveBeenCalledWith(
        "user123",
        "list123",
        expect.objectContaining({
          name: "Liste mise à jour",
          description: "Nouvelle description",
        }),
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("handleDeleteList", () => {
    it("devrait supprimer une liste", async () => {
      req.user = { id: "user123" };
      req.params = { id: "list123" };

      (memoryStorage.deleteList as jest.Mock) = jest.fn().mockReturnValue(true);
      (syncService.syncNow as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
      });

      await handleDeleteList(req as Request, res as Response);

      expect(memoryStorage.deleteList).toHaveBeenCalledWith(
        "user123",
        "list123",
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Liste supprimée avec succès",
      });
    });
  });

  describe("handleAddPointToList", () => {
    it("devrait ajouter un point à une liste", async () => {
      req.user = { id: "user123" };
      req.params = { listId: "list123", pointId: "point123" };

      const mockList = {
        _id: "list123",
        userId: "user123",
        points: [],
      };

      const mockPoint = {
        _id: "point123",
        userId: "user123",
      };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockList);
      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockPoint);
      (memoryStorage.addPointToList as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      await handleAddPointToList(req as Request, res as Response);

      expect(memoryStorage.addPointToList).toHaveBeenCalledWith(
        "user123",
        "list123",
        "point123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Point ajouté à la liste avec succès",
        listId: "list123",
        pointId: "point123",
      });
    });

    it("devrait rejeter si point déjà dans la liste", async () => {
      req.user = { id: "user123" };
      req.params = { listId: "list123", pointId: "point123" };

      const mockList = {
        _id: "list123",
        userId: "user123",
        points: ["point123"],
      };

      const mockPoint = {
        _id: "point123",
        userId: "user123",
      };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockList);
      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockPoint);
      (memoryStorage.addPointToList as jest.Mock) = jest
        .fn()
        .mockReturnValue(false);

      await handleAddPointToList(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Le point est déjà dans la liste ou l'ajout a échoué",
      });
    });
  });

  describe("handleRemovePointFromList", () => {
    it("devrait retirer un point d'une liste", async () => {
      req.user = { id: "user123" };
      req.params = { listId: "list123", pointId: "point123" };

      const mockList = {
        _id: "list123",
        userId: "user123",
        points: ["point123", "point456"],
      };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockList);
      (memoryStorage.removePointFromList as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      await handleRemovePointFromList(req as Request, res as Response);

      expect(memoryStorage.removePointFromList).toHaveBeenCalledWith(
        "user123",
        "list123",
        "point123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Point retiré de la liste avec succès",
        listId: "list123",
        pointId: "point123",
      });
    });
  });

  describe("handleBulkAddPointsToList", () => {
    it("devrait ajouter plusieurs points à une liste", async () => {
      req.user = { id: "user123" };
      req.params = { listId: "list123" };
      req.body = { pointIds: ["point1", "point2", "point3"] };

      const mockList = {
        _id: "list123",
        userId: "user123",
        points: [],
      };

      (memoryStorage.getListById as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockList);
      (memoryStorage.getPointById as jest.Mock) = jest
        .fn()
        .mockImplementation((userId, pointId) => ({
          _id: pointId,
          userId: "user123",
        }));
      (memoryStorage.addPointToList as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      await handleBulkAddPointsToList(req as Request, res as Response);

      expect(memoryStorage.addPointToList).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "3 points ajoutés, 0 déjà présents, 0 non trouvés",
        results: {
          added: ["point1", "point2", "point3"],
          alreadyInList: [],
          notFound: [],
        },
      });
    });

    it("devrait rejeter si tableau de points vide", async () => {
      req.user = { id: "user123" };
      req.params = { listId: "list123" };
      req.body = { pointIds: [] };

      await handleBulkAddPointsToList(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "La liste des identifiants de points doit être un tableau non vide",
      });
    });
  });
});
