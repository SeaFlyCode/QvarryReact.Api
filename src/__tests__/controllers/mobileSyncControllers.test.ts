/**
 * Tests unitaires pour mobileSyncControllers
 * Teste les fonctions de synchronisation mobile
 */

jest.mock("../../services/mobileSyncService");
jest.mock("../../services/webSocketService");
jest.mock("../../services/memoryStorageService");
jest.mock("../../controllers/auth");
jest.mock("../../services/loggerService");

import { Request, Response } from "express";
import {
  handleMobileSync,
  handleMobileSyncPush,
  handleMobileFullData,
  handleMobileSyncStatus,
} from "../../controllers/mobileSyncControllers";
import { mockRequest, mockResponse } from "../mocks";
import { mobileSyncService } from "../../services/mobileSyncService";
import { webSocketService } from "../../services/webSocketService";
import { memoryStorage } from "../../services/memoryStorageService";

describe("mobileSyncControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleMobileSync", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        query: {},
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait effectuer une sync incrémentale avec succès", async () => {
      req.query = { since: "2026-01-01T00:00:00Z" };

      const mockResult = {
        points: { created: [], updated: [], deleted: [] },
        fiches: { created: [], updated: [], deleted: [] },
        lists: { created: [], updated: [], deleted: [] },
        sosContacts: { created: [], updated: [], deleted: [] },
        activeSosSession: null,
        lastSyncDate: "2026-02-27T10:00:00Z",
        totalChanges: 0,
      };

      (mobileSyncService.getIncrementalChanges as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleMobileSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalChanges: 0,
        }),
      );
      expect(mobileSyncService.getIncrementalChanges).toHaveBeenCalledWith(
        "user-123",
        expect.any(Date),
      );
    });

    it("devrait effectuer une sync complète si pas de paramètre since", async () => {
      const mockResult = {
        points: { created: [{ id: "point-1" }], updated: [], deleted: [] },
        fiches: { created: [], updated: [], deleted: [] },
        lists: { created: [], updated: [], deleted: [] },
        sosContacts: { created: [], updated: [], deleted: [] },
        activeSosSession: null,
        lastSyncDate: "2026-02-27T10:00:00Z",
        totalChanges: 1,
      };

      (mobileSyncService.getFullData as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleMobileSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalChanges: 1,
        }),
      );
      expect(mobileSyncService.getFullData).toHaveBeenCalledWith("user-123");
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await handleMobileSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
        code: "UNAUTHORIZED",
      });
    });

    it("devrait rejeter si format de date invalide", async () => {
      req.query = { since: "invalid-date" };

      await handleMobileSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_DATE_FORMAT",
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      req.query = { since: "2026-01-01T00:00:00Z" };

      (mobileSyncService.getIncrementalChanges as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleMobileSync(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Erreur lors de la synchronisation",
          code: "SYNC_ERROR",
        }),
      );
    });
  });

  describe("handleMobileSyncPush", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          changes: [],
        },
        user: { id: "user-123" },
      });
      res = mockResponse();

      (memoryStorage.getLastRefreshedAt as jest.Mock).mockReturnValue(
        new Date(),
      );
      (memoryStorage.setLastRefreshedAt as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait appliquer les changements avec succès", async () => {
      const changes = [
        {
          type: "point",
          action: "create",
          localId: "local-1",
          data: { name: "New Point" },
          timestamp: "2026-02-27T10:00:00Z",
        },
      ];

      req.body.changes = changes;

      const mockResult = {
        synced: [
          {
            type: "point",
            action: "create",
            localId: "local-1",
            id: "server-point-1",
          },
        ],
        conflicts: [],
        errors: [],
      };

      (mobileSyncService.applyLocalChanges as jest.Mock).mockResolvedValue(
        mockResult,
      );

      // Mock refreshFromDB
      const mockRefreshFromDB = jest.fn().mockResolvedValue(undefined);
      jest.doMock("../../controllers/auth", () => ({
        refreshFromDB: mockRefreshFromDB,
      }));

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          synced: expect.arrayContaining([
            expect.objectContaining({
              type: "point",
              action: "create",
            }),
          ]),
          idMapping: expect.objectContaining({
            "local-1": "server-point-1",
          }),
        }),
      );
    });

    it("devrait accepter une liste vide de changements", async () => {
      req.body.changes = [];

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          synced: [],
          message: "Aucun changement à appliquer",
        }),
      );
    });

    it("devrait rejeter si changes n'est pas un tableau", async () => {
      req.body.changes = "invalid";

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le champ 'changes' doit être un tableau",
        code: "INVALID_CHANGES_FORMAT",
      });
    });

    it("devrait valider le type des changements", async () => {
      req.body.changes = [
        {
          type: "invalid-type",
          action: "create",
          data: {},
        },
      ];

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_CHANGE_TYPE",
        }),
      );
    });

    it("devrait valider l'action des changements", async () => {
      req.body.changes = [
        {
          type: "point",
          action: "invalid-action",
          data: {},
        },
      ];

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_CHANGE_ACTION",
        }),
      );
    });

    it("devrait vérifier la présence d'ID pour update/delete", async () => {
      req.body.changes = [
        {
          type: "point",
          action: "update",
          data: {},
        },
      ];

      await handleMobileSyncPush(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "L'ID est requis pour les actions update et delete",
        code: "MISSING_ID",
      });
    });
  });

  describe("handleMobileFullData", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner toutes les données de l'utilisateur", async () => {
      const mockResult = {
        points: {
          created: [{ id: "point-1" }, { id: "point-2" }],
          updated: [],
          deleted: [],
        },
        fiches: { created: [{ id: "fiche-1" }], updated: [], deleted: [] },
        lists: { created: [], updated: [], deleted: [] },
        sosContacts: { created: [], updated: [], deleted: [] },
        activeSosSession: null,
        lastSyncDate: "2026-02-27T10:00:00Z",
        totalChanges: 3,
      };

      (mobileSyncService.getFullData as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleMobileFullData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalChanges: 3,
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await handleMobileFullData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
        code: "UNAUTHORIZED",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (mobileSyncService.getFullData as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleMobileFullData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des données",
        code: "FULL_DATA_ERROR",
      });
    });
  });

  describe("handleMobileSyncStatus", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        query: { since: "2026-02-20T00:00:00Z" },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner le statut de synchronisation", async () => {
      const mockResult = {
        points: 1,
        fiches: 1,
        lists: 0,
        sosContacts: 0,
        total: 2,
      };

      (mobileSyncService.countChanges as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleMobileSyncStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          hasChanges: true,
          changeCount: 2,
          breakdown: {
            points: 1,
            fiches: 1,
            lists: 0,
            sosContacts: 0,
          },
        }),
      );
    });

    it("devrait rejeter si paramètre since manquant", async () => {
      req.query = {};

      await handleMobileSyncStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le paramètre 'since' est obligatoire",
        code: "MISSING_SINCE_PARAM",
      });
    });

    it("devrait rejeter si format de date invalide", async () => {
      req.query = { since: "invalid-date" };

      await handleMobileSyncStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Format de date invalide",
        code: "INVALID_DATE_FORMAT",
      });
    });

    it("devrait retourner hasChanges: false si aucun changement", async () => {
      const mockResult = {
        points: 0,
        fiches: 0,
        lists: 0,
        sosContacts: 0,
        total: 0,
      };

      (mobileSyncService.countChanges as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleMobileSyncStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          hasChanges: false,
          changeCount: 0,
        }),
      );
    });
  });
});
