/**
 * Tests unitaires pour syncControllers
 * Teste les fonctions de synchronisation PC
 */

jest.mock("../../services/syncService");
jest.mock("../../services/memoryStorageService");
jest.mock("../../services/loggerService");

import { Request, Response } from "express";
import {
  handleManualSync,
  handleSyncRefresh,
} from "../../controllers/syncControllers";
import { mockRequest, mockResponse } from "../mocks";
import { syncService } from "../../services/syncService";
import { memoryStorage } from "../../services/memoryStorageService";

// Mock dynamique pour refreshFromDB
jest.mock("../../controllers/auth/authHelpers", () => ({
  refreshFromDB: jest.fn(),
}));

import { refreshFromDB } from "../../controllers/auth/authHelpers";

describe("syncControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleManualSync", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait synchroniser avec succès", async () => {
      (syncService.syncNow as jest.Mock).mockResolvedValue(true);

      await handleManualSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Synchronisation réussie",
        synced: true,
      });
      expect(syncService.syncNow).toHaveBeenCalledWith("user-123");
    });

    it("devrait retourner message si aucune donnée à synchroniser", async () => {
      (syncService.syncNow as jest.Mock).mockResolvedValue(false);

      await handleManualSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Aucune donnée à synchroniser",
        synced: false,
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await handleManualSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (syncService.syncNow as jest.Mock).mockRejectedValue(
        new Error("Sync service error"),
      );

      await handleManualSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Erreur lors de la synchronisation",
        error: "Une erreur interne est survenue",
      });
    });
  });

  describe("handleSyncRefresh", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait rafraîchir les données avec des changements", async () => {
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (refreshFromDB as jest.Mock).mockResolvedValue({
        added: 5,
        updated: 3,
        deleted: 2,
      });

      await handleSyncRefresh(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        hasChanges: true,
        changes: {
          added: 5,
          updated: 3,
          deleted: 2,
        },
        message: "5 ajoutés, 3 mis à jour, 2 supprimés",
      });
    });

    it("devrait retourner aucun changement si pas de modifications", async () => {
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (refreshFromDB as jest.Mock).mockResolvedValue({
        added: 0,
        updated: 0,
        deleted: 0,
      });

      await handleSyncRefresh(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        hasChanges: false,
        changes: {
          added: 0,
          updated: 0,
          deleted: 0,
        },
        message: "Aucun changement depuis le dernier refresh",
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await handleSyncRefresh(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si session mémoire non initialisée", async () => {
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(false);

      await handleSyncRefresh(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Session mémoire non initialisée. Veuillez vous reconnecter.",
      });
    });

    it("devrait gérer les erreurs de refresh", async () => {
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (refreshFromDB as jest.Mock).mockRejectedValue(
        new Error("Refresh error"),
      );

      await handleSyncRefresh(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Erreur lors du refresh",
        error: "Une erreur interne est survenue",
      });
    });
  });
});
