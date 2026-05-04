/**
 * Tests unitaires pour fichesControllers
 * Teste la création, récupération, mise à jour et suppression de fiches
 */

jest.mock("../../services/memoryStorageService");
jest.mock("../../services/syncService");
jest.mock("../../services/validationService");
jest.mock("../../controllers/auth/authHelpers");
jest.mock("../../models/fiches", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

import { Request, Response } from "express";
import {
  handleCreateFiche,
  handleUpdateFiche,
  handleDeleteFiche,
  handleGetAllFiches,
  handleGetFicheById,
  handleGetUserFiches,
  handleAddPointToFiche,
  handleRemovePointFromFiche,
  handleSearchFiches,
  handleGetPointsByFicheId,
  handleGetFicheByPointId,
} from "../../controllers/fichesControllers";
import { mockRequest, mockResponse } from "../mocks";
import { memoryStorage } from "../../services/memoryStorageService";
import { syncService } from "../../services/syncService";
import { validateFicheData } from "../../services/validationService";
import { loadAndDecryptUserData } from "../../controllers/auth/authHelpers";
import FicheModel from "../../models/fiches";
import mongoose from "mongoose";

describe("fichesControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Round-trip Mongo round-trip mock — par défaut renvoie une fiche existante.
    (FicheModel.findById as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "mocked" }),
      }),
    });
    req = mockRequest();
    res = mockResponse();
  });

  // ════════════════════════════════════════════════════════
  // handleCreateFiche
  // ════════════════════════════════════════════════════════
  describe("handleCreateFiche", () => {
    it("devrait créer une fiche avec succès", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = {
        name: "Grotte de Lascaux",
        ville: "Montignac",
        type: "Grotte",
        etat: "Ouvert",
        accessibilite: "Accès libre",
        difficulte_acces: "1",
        risque_oxygene: "1",
        acces_souterrain: "Ouvert",
        praticite_souterrain: ["Sol dégagé"],
        etat_general: "1",
        points_ids: [],
        equipement_conseille: ["Casque", "Éclairage (frontale)"],
        surface: ["< 500 m²"],
        type_galeries: ["Galeries hautes (> 2m)"],
        interets: "Peintures rupestres",
        commentaire: "Site historique",
        center_cavite: { type: "Point", coordinates: [1.5, 45.0] },
      };

      (validateFicheData as jest.Mock).mockReturnValue({ isValid: true });
      (memoryStorage.storeFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleCreateFiche(req as Request, res as Response);

      expect(validateFicheData).toHaveBeenCalledWith(req.body);
      expect(memoryStorage.storeFiche).toHaveBeenCalled();
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Fiche créée avec succès",
          syncSuccess: true,
        }),
      );
    });

    it("devrait rejeter si validation échouée", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = {
        name: "",
        ville: "",
      };

      (validateFicheData as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ["Le nom est requis", "La ville est requise"],
      });

      await handleCreateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Validation échouée",
        errors: ["Le nom est requis", "La ville est requise"],
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { name: "Test", ville: "Paris" };

      (validateFicheData as jest.Mock).mockReturnValue({ isValid: true });

      await handleCreateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait retourner erreur 500 si sync échoue", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = {
        name: "Grotte",
        ville: "Paris",
        type: "Grotte",
        etat: "Ouvert",
        difficulte_acces: "1",
        risque_oxygene: "1",
        acces_souterrain: "Ouvert",
        praticite_souterrain: ["Sol dégagé"],
        etat_general: "1",
      };

      (validateFicheData as jest.Mock).mockReturnValue({ isValid: true });
      (memoryStorage.storeFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({
        success: false,
        error: "Sync failed",
      });

      await handleCreateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          persisted: false,
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { name: "Test", ville: "Paris" };

      (validateFicheData as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur de validation");
      });

      await handleCreateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la création de la fiche.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleUpdateFiche
  // ════════════════════════════════════════════════════════
  describe("handleUpdateFiche", () => {
    it("devrait mettre à jour une fiche avec succès", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };
      req.body = {
        name: "Nom mis à jour",
        ville: "Ville mise à jour",
      };

      const mockFiche = {
        _id: "fiche123",
        userId: "user123",
        name: "Ancien nom",
        ville: "Ancienne ville",
        date_modification: new Date("2024-01-01"),
      };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);
      (memoryStorage.storeFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleUpdateFiche(req as Request, res as Response);

      expect(memoryStorage.getFicheById).toHaveBeenCalledWith(
        "user123",
        "fiche123",
      );
      expect(mockFiche.name).toBe("Nom mis à jour");
      expect(mockFiche.ville).toBe("Ville mise à jour");
      expect(mockFiche.date_modification).not.toEqual(new Date("2024-01-01"));
      expect(memoryStorage.storeFiche).toHaveBeenCalledWith(
        "user123",
        mockFiche,
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Fiche mise à jour avec succès",
          syncSuccess: true,
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { id: "fiche123" };
      req.body = { name: "Test" };

      await handleUpdateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si fiche non trouvée", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche999" };
      req.body = { name: "Test" };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(null);

      await handleUpdateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Fiche non trouvée.",
      });
    });

    it("devrait retourner erreur 500 si sync échoue", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };
      req.body = { name: "Nom mis à jour" };

      const mockFiche = {
        _id: "fiche123",
        userId: "user123",
        name: "Ancien nom",
        date_modification: new Date(),
      };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);
      (memoryStorage.storeFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({
        success: false,
        error: "Sync failed",
      });

      await handleUpdateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "La fiche a été mise à jour en mémoire mais n'a pas pu être synchronisée avec la base de données",
          syncFailed: true,
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };
      req.body = { name: "Test" };

      (memoryStorage.getFicheById as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleUpdateFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la mise à jour de la fiche.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleDeleteFiche
  // ════════════════════════════════════════════════════════
  describe("handleDeleteFiche", () => {
    it("devrait supprimer une fiche avec succès", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };

      const mockFiche = {
        _id: "fiche123",
        userId: "user123",
        points_ids: [],
      };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);
      (memoryStorage.deleteFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleDeleteFiche(req as Request, res as Response);

      expect(memoryStorage.deleteFiche).toHaveBeenCalledWith(
        "user123",
        "fiche123",
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Fiche supprimée avec succès",
        syncSuccess: true,
      });
    });

    it("devrait supprimer liens avec points associés", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };

      const mockPoint = {
        _id: "507f1f77bcf86cd799439011",
        ficheId: "fiche123",
      };

      const mockFiche = {
        _id: "fiche123",
        userId: "user123",
        points_ids: [new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")],
      };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);
      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.storePoint as jest.Mock).mockReturnValue(true);
      (memoryStorage.deleteFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleDeleteFiche(req as Request, res as Response);

      expect(memoryStorage.getPointById).toHaveBeenCalledWith(
        "user123",
        "507f1f77bcf86cd799439011",
      );
      expect(memoryStorage.storePoint).toHaveBeenCalledWith(
        "user123",
        expect.objectContaining({
          _id: "507f1f77bcf86cd799439011",
          ficheId: undefined,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { id: "fiche123" };

      await handleDeleteFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si fiche non trouvée", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche999" };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(null);

      await handleDeleteFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Fiche non trouvée.",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };

      (memoryStorage.getFicheById as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleDeleteFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la suppression de la fiche.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleGetAllFiches
  // ════════════════════════════════════════════════════════
  describe("handleGetAllFiches", () => {
    it("devrait récupérer toutes les fiches avec pagination", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { page: "1", limit: "10" };

      const mockFiches = [
        {
          _id: "fiche1",
          name: "Fiche 1",
          ville: "Paris",
          equipement_conseille: ["casque"],
          surface: ["calcaire"],
          type_galeries: ["horizontale"],
          interets: "Intéressant",
          commentaire: "Commentaire",
        },
        {
          _id: "fiche2",
          name: "Fiche 2",
          ville: "Lyon",
          equipement_conseille: [],
          surface: [],
          type_galeries: [],
          interets: "",
          commentaire: "",
        },
      ];

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);

      await handleGetAllFiches(req as Request, res as Response);

      expect(memoryStorage.getAllFiches).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: "Fiche 1" }),
          expect.objectContaining({ name: "Fiche 2" }),
        ]),
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        },
      });
    });

    it("devrait limiter la pagination à 500 items max", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { page: "1", limit: "1000" };

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue([]);

      await handleGetAllFiches(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({
            limit: 500,
          }),
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await handleGetAllFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };

      (memoryStorage.getAllFiches as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleGetAllFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la récupération des fiches.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleGetFicheById
  // ════════════════════════════════════════════════════════
  describe("handleGetFicheById", () => {
    it("devrait récupérer une fiche par ID", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };

      const mockFiche = {
        _id: "fiche123",
        name: "Ma Fiche",
        ville: "Paris",
        equipement_conseille: ["casque"],
        surface: ["calcaire"],
        type_galeries: ["horizontale"],
        interets: "Intéressant",
        commentaire: "Commentaire",
      };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);

      await handleGetFicheById(req as Request, res as Response);

      expect(memoryStorage.getFicheById).toHaveBeenCalledWith(
        "user123",
        "fiche123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Ma Fiche",
          ville: "Paris",
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { id: "fiche123" };

      await handleGetFicheById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si fiche non trouvée", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche999" };

      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(null);

      await handleGetFicheById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Fiche non trouvée.",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { id: "fiche123" };

      (memoryStorage.getFicheById as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleGetFicheById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la récupération de la fiche.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleGetUserFiches
  // ════════════════════════════════════════════════════════
  describe("handleGetUserFiches", () => {
    it("devrait récupérer les fiches de l'utilisateur courant", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { userId: "user123" };
      req.query = { page: "1", limit: "50" };

      const mockFiches = [
        { _id: "fiche1", name: "Fiche 1" },
        { _id: "fiche2", name: "Fiche 2" },
      ];

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);

      await handleGetUserFiches(req as Request, res as Response);

      expect(memoryStorage.getAllFiches).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: mockFiches,
        pagination: {
          page: 1,
          limit: 50,
          total: 2,
          totalPages: 1,
        },
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { userId: "user123" };

      await handleGetUserFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise.",
      });
    });

    it("devrait rejeter accès aux fiches d'un autre utilisateur sans admin", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { userId: "user456" };

      await handleGetUserFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Vous n'êtes pas autorisé à voir les fiches de cet utilisateur.",
      });
    });

    it("devrait limiter la pagination à 200 items max", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { userId: "user123" };
      req.query = { page: "1", limit: "500" };

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue([]);

      await handleGetUserFiches(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({
            limit: 200,
          }),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { userId: "user123" };

      (memoryStorage.getAllFiches as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleGetUserFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la récupération des fiches de l'utilisateur.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleAddPointToFiche
  // ════════════════════════════════════════════════════════
  describe("handleAddPointToFiche", () => {
    it("devrait ajouter un point à une fiche avec succès", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123", pointId: "point123" };

      (memoryStorage.addPointToFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleAddPointToFiche(req as Request, res as Response);

      expect(memoryStorage.addPointToFiche).toHaveBeenCalledWith(
        "user123",
        "fiche123",
        "point123",
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: "Point ajouté à la fiche avec succès",
        ficheId: "fiche123",
        pointId: "point123",
        syncSuccess: true,
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { ficheId: "fiche123", pointId: "point123" };

      await handleAddPointToFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si ficheId ou pointId manquant", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123" };

      await handleAddPointToFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "ID de la fiche et ID du point requis",
      });
    });

    it("devrait rejeter si fiche ou point non trouvé", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche999", pointId: "point999" };

      (memoryStorage.addPointToFiche as jest.Mock).mockReturnValue(false);

      await handleAddPointToFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Fiche ou point non trouvé",
      });
    });

    it("devrait retourner erreur 500 si sync échoue", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123", pointId: "point123" };

      (memoryStorage.addPointToFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({
        success: false,
        error: "Sync failed",
      });

      await handleAddPointToFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Le point a été ajouté à la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
          syncFailed: true,
        }),
      );
    });
  });

  // ════════════════════════════════════════════════════════
  // handleRemovePointFromFiche
  // ════════════════════════════════════════════════════════
  describe("handleRemovePointFromFiche", () => {
    it("devrait retirer un point d'une fiche avec succès", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123", pointId: "507f1f77bcf86cd799439011" };

      const mockPoint = { _id: "507f1f77bcf86cd799439011" };
      const mockFiche = {
        _id: "fiche123",
        points_ids: [new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")],
      };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);
      (memoryStorage.removePointFromFiche as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleRemovePointFromFiche(req as Request, res as Response);

      expect(memoryStorage.removePointFromFiche).toHaveBeenCalledWith(
        "user123",
        "fiche123",
        "507f1f77bcf86cd799439011",
      );
      expect(syncService.syncNow).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Point dissocié de la fiche avec succès",
        ficheId: "fiche123",
        pointId: "507f1f77bcf86cd799439011",
        syncSuccess: true,
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { ficheId: "fiche123", pointId: "point123" };

      await handleRemovePointFromFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si ficheId ou pointId manquant", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123" };

      await handleRemovePointFromFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "ID de la fiche et ID du point requis",
      });
    });

    it("devrait rejeter si point non trouvé", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123", pointId: "point999" };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(null);
      (memoryStorage.getFicheById as jest.Mock).mockReturnValue({
        _id: "fiche123",
      });

      await handleRemovePointFromFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Point non trouvé",
      });
    });

    it("devrait rejeter si point non associé à la fiche", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.body = { ficheId: "fiche123", pointId: "point123" };

      const mockPoint = { _id: "point123" };
      const mockFiche = {
        _id: "fiche123",
        points_ids: [], // point non associé
      };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);

      await handleRemovePointFromFiche(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Le point n'est pas associé à cette fiche",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleSearchFiches
  // ════════════════════════════════════════════════════════
  describe("handleSearchFiches", () => {
    it("devrait rechercher des fiches par texte", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { searchText: "grotte", page: "1", limit: "50" };

      const mockFiches = [
        {
          name: "Grotte de Lascaux",
          ville: "Montignac",
          type: "cavite",
          etat: "ouvert",
        },
        {
          name: "Grotte de Font-de-Gaume",
          ville: "Les Eyzies",
          type: "cavite",
          etat: "ouvert",
        },
      ];

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);

      await handleSearchFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: "Grotte de Lascaux" }),
          expect.objectContaining({ name: "Grotte de Font-de-Gaume" }),
        ]),
        pagination: expect.objectContaining({
          total: 2,
        }),
      });
    });

    it("devrait filtrer par ville", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { ville: "paris", page: "1", limit: "50" };

      const mockFiches = [
        { name: "Fiche 1", ville: "Paris", type: "cavite", etat: "ouvert" },
        { name: "Fiche 2", ville: "Lyon", type: "cavite", etat: "ouvert" },
      ];

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);

      await handleSearchFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ ville: "Paris" }),
          ]),
          pagination: expect.objectContaining({ total: 1 }),
        }),
      );
    });

    it("devrait filtrer par type", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { type: "cavite", page: "1", limit: "50" };

      const mockFiches = [
        { name: "Fiche 1", ville: "Paris", type: "cavite", etat: "ouvert" },
        { name: "Fiche 2", ville: "Lyon", type: "mine", etat: "ouvert" },
      ];

      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);

      await handleSearchFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      const call = (res.json as jest.Mock).mock.calls[0][0];
      expect(call.pagination.total).toBe(1);
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.query = { searchText: "test" };

      await handleSearchFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait recharger les données si mémoire vide", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { page: "1", limit: "50" };

      (memoryStorage.getAllFiches as jest.Mock)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([
          { name: "Fiche 1", ville: "Paris", type: "cavite", etat: "ouvert" },
        ]);
      (loadAndDecryptUserData as jest.Mock).mockResolvedValue(true);

      await handleSearchFiches(req as Request, res as Response);

      expect(loadAndDecryptUserData).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.query = { searchText: "test" };

      (memoryStorage.getAllFiches as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleSearchFiches(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la recherche avancée de fiches.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleGetPointsByFicheId
  // ════════════════════════════════════════════════════════
  describe("handleGetPointsByFicheId", () => {
    it("devrait récupérer tous les points d'une fiche", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { ficheId: "fiche123" };

      const mockPoints = [
        { _id: "point1", name: "Point 1" },
        { _id: "point2", name: "Point 2" },
      ];

      (memoryStorage.getPointsByFicheId as jest.Mock).mockReturnValue(
        mockPoints,
      );

      await handleGetPointsByFicheId(req as Request, res as Response);

      expect(memoryStorage.getPointsByFicheId).toHaveBeenCalledWith(
        "user123",
        "fiche123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        points: mockPoints,
        count: 2,
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { ficheId: "fiche123" };

      await handleGetPointsByFicheId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si ficheId manquant", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = {};

      await handleGetPointsByFicheId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "ID de fiche manquant",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { ficheId: "fiche123" };

      (memoryStorage.getPointsByFicheId as jest.Mock).mockImplementation(() => {
        throw new Error("Erreur mémoire");
      });

      await handleGetPointsByFicheId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Une erreur interne est survenue",
      });
    });
  });

  // ════════════════════════════════════════════════════════
  // handleGetFicheByPointId
  // ════════════════════════════════════════════════════════
  describe("handleGetFicheByPointId", () => {
    it("devrait récupérer la fiche associée à un point", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { pointId: "point123" };

      const mockPoint = {
        _id: "point123",
        ficheId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
      };
      const mockFiche = { _id: "507f1f77bcf86cd799439011", name: "Ma Fiche" };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.getFicheById as jest.Mock).mockReturnValue(mockFiche);

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(memoryStorage.getPointById).toHaveBeenCalledWith(
        "user123",
        "point123",
      );
      expect(memoryStorage.getFicheById).toHaveBeenCalledWith(
        "user123",
        "507f1f77bcf86cd799439011",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockFiche);
    });

    it("devrait trouver la fiche via parcours si ficheId non défini", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { pointId: "507f1f77bcf86cd799439011" };

      const mockPoint = { _id: "507f1f77bcf86cd799439011" };
      const mockFiches = [
        {
          _id: "fiche123",
          name: "Ma Fiche",
          points_ids: [new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")],
        },
      ];

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue(mockFiches);
      (memoryStorage.storePoint as jest.Mock).mockReturnValue(true);

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(memoryStorage.getAllFiches).toHaveBeenCalledWith("user123");
      expect(memoryStorage.storePoint).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Ma Fiche" }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { pointId: "point123" };

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Authentification requise",
      });
    });

    it("devrait rejeter si pointId manquant", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = {};

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "ID du point requis",
      });
    });

    it("devrait rejeter si point non trouvé", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { pointId: "point999" };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(null);

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Point non trouvé",
      });
    });

    it("devrait rejeter si aucune fiche associée", async () => {
      req.user = { id: "user123", isAdmin: false };
      req.params = { pointId: "point123" };

      const mockPoint = { _id: "point123" };

      (memoryStorage.getPointById as jest.Mock).mockReturnValue(mockPoint);
      (memoryStorage.getAllFiches as jest.Mock).mockReturnValue([]);

      await handleGetFicheByPointId(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Aucune fiche associée à ce point n'a été trouvée",
      });
    });
  });
});
