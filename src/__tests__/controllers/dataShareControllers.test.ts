/**
 * Tests unitaires pour dataShareControllers
 * Teste le partage de données (fiches, listes, points)
 */

jest.mock("../../models/fiches");
jest.mock("../../models/points");
jest.mock("../../models/lists");
jest.mock("../../models/users");
jest.mock("../../services/dataShareService", () => ({
  shareData: jest.fn(),
  getSharedData: jest.fn(),
  updateShareStatus: jest.fn(),
  getReceivedShares: jest.fn(),
  getSentShares: jest.fn(),
}));
jest.mock("../../services/syncService", () => ({
  syncService: {
    syncNow: jest.fn(),
  },
}));
jest.mock("../../services/emailService", () => ({
  sendShareNotificationEmail: jest.fn(),
}));
jest.mock("../../utils/masterEncryptionUtils", () => ({
  decrypt: jest.fn((val) => val),
  encrypt: jest.fn((val) => val),
}));

import { Request, Response } from "express";
import {
  handleShareData,
  handleGetSharedData,
  handleUpdateShareStatus,
  handleGetReceivedShares,
  handleGetSentShares,
} from "../../controllers/dataShareControllers";
import * as dataShareService from "../../services/dataShareService";
import { syncService } from "../../services/syncService";
import { sendShareNotificationEmail } from "../../services/emailService";
import FicheModel from "../../models/fiches";
import Point from "../../models/points";
import ListModel from "../../models/lists";
import User from "../../models/users";
import { mockRequest, mockResponse } from "../mocks";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

describe("dataShareControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();

    // Setup default mocks that should apply to all tests
    (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(
      (val: string) => val,
    );
    (syncService.syncNow as jest.Mock).mockResolvedValue({
      success: true,
      message: "Synchronisation effectuée avec succès",
    });
    (sendShareNotificationEmail as jest.Mock).mockResolvedValue(undefined);
  });

  describe("handleShareData", () => {
    it("devrait partager une fiche avec succès", async () => {
      req.user = { id: "507f1f77bcf86cd799439011" };
      req.body = {
        receiverIds: ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439013"],
        dataType: "fiche",
        dataId: "507f1f77bcf86cd799439014",
        message: "Voici ma fiche",
      };

      const mockFiche = {
        _id: "507f1f77bcf86cd799439014",
        userId: "507f1f77bcf86cd799439011",
        deletedAt: null,
      };

      const mockSender = {
        _id: "507f1f77bcf86cd799439011",
        name: "Sender",
        surname: "User",
        emailHash: "senderhash",
        showPseudo: false,
      };

      const mockReceivers = [
        {
          _id: "507f1f77bcf86cd799439012",
          name: "John",
          surname: "Doe",
          emailHash: "hash1",
          email: "john@test.com",
        },
        {
          _id: "507f1f77bcf86cd799439013",
          name: "Jane",
          surname: "Smith",
          emailHash: "hash2",
          email: "jane@test.com",
        },
      ];

      (FicheModel.findOne as jest.Mock).mockResolvedValue(mockFiche);
      (User.findById as jest.Mock).mockImplementation((id: any) => {
        const idStr = id.toString();
        if (idStr === "507f1f77bcf86cd799439011") {
          return Promise.resolve({
            ...mockSender,
            select: jest.fn().mockReturnThis(),
          });
        }
        const user = mockReceivers.find((u) => u._id === idStr);
        return Promise.resolve(
          user
            ? {
                ...user,
                select: jest.fn().mockReturnThis(),
              }
            : null,
        );
      });
      (dataShareService.shareData as jest.Mock).mockResolvedValue({
        _id: "share123",
        senderId: "507f1f77bcf86cd799439011",
        receiverId: "507f1f77bcf86cd799439012",
        expiresAt: new Date(Date.now() + 86400000),
      });

      await handleShareData(req as Request, res as Response);

      expect(dataShareService.shareData).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "fiche partagé avec succès",
          receiverCount: 2,
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = {
        receiverIds: ["user456"],
        dataType: "fiche",
        dataId: "id123",
      };

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentification requise",
      });
    });

    it("devrait rejeter si aucun destinataire", async () => {
      req.user = { id: "user123" };
      req.body = { receiverIds: [], dataType: "fiche", dataId: "id123" };

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Au moins un destinataire est requis",
      });
    });

    it("devrait rejeter si type de données invalide", async () => {
      req.user = { id: "user123" };
      req.body = {
        receiverIds: ["user456"],
        dataType: "invalid",
        dataId: "id123",
      };

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Type de données invalide",
      });
    });

    it("devrait rejeter si dataId invalide", async () => {
      req.user = { id: "user123" };
      req.body = {
        receiverIds: ["user456"],
        dataType: "fiche",
        dataId: "invalid-id",
      };

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "ID de données invalide",
      });
    });

    it("devrait rejeter si utilisateur n'est pas propriétaire", async () => {
      req.user = { id: "507f1f77bcf86cd799439015" };
      req.body = {
        receiverIds: ["507f1f77bcf86cd799439016"],
        dataType: "fiche",
        dataId: "507f1f77bcf86cd799439011",
      };

      (FicheModel.findOne as jest.Mock).mockResolvedValue(null);

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Vous n'êtes pas autorisé à partager cette donnée",
      });
    });

    it("devrait partager un point avec succès", async () => {
      req.user = { id: "507f1f77bcf86cd799439017" };
      req.body = {
        receiverIds: ["507f1f77bcf86cd799439018"],
        dataType: "point",
        dataId: "507f1f77bcf86cd799439019",
      };

      const mockPoint = {
        _id: "507f1f77bcf86cd799439019",
        userId: "507f1f77bcf86cd799439017",
        deletedAt: null,
      };

      const mockSender = {
        _id: "507f1f77bcf86cd799439017",
        name: "Sender",
        surname: "User",
        emailHash: "senderhash",
        showPseudo: false,
      };

      const mockReceiver = {
        _id: "507f1f77bcf86cd799439018",
        name: "John",
        surname: "Doe",
        emailHash: "hash1",
        email: "john@test.com",
      };

      (Point.findOne as jest.Mock).mockResolvedValue(mockPoint);
      (User.findById as jest.Mock).mockImplementation((id: any) => {
        const idStr = id.toString();
        if (idStr === "507f1f77bcf86cd799439017") {
          return Promise.resolve({
            ...mockSender,
            select: jest.fn().mockReturnThis(),
          });
        }
        if (idStr === "507f1f77bcf86cd799439018") {
          return Promise.resolve({
            ...mockReceiver,
            select: jest.fn().mockReturnThis(),
          });
        }
        return Promise.resolve(null);
      });
      (dataShareService.shareData as jest.Mock).mockResolvedValue({
        _id: "share123",
        senderId: "507f1f77bcf86cd799439017",
        receiverId: "507f1f77bcf86cd799439018",
        expiresAt: new Date(Date.now() + 86400000),
      });

      await handleShareData(req as Request, res as Response);

      expect(Point.findOne).toHaveBeenCalled();
      expect(dataShareService.shareData).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("devrait partager une liste avec succès", async () => {
      req.user = { id: "507f1f77bcf86cd799439020" };
      req.body = {
        receiverIds: ["507f1f77bcf86cd799439021"],
        dataType: "liste",
        dataId: "507f1f77bcf86cd799439022",
      };

      const mockList = {
        _id: "507f1f77bcf86cd799439022",
        userId: "507f1f77bcf86cd799439020",
        deletedAt: null,
      };

      const mockSender = {
        _id: "507f1f77bcf86cd799439020",
        name: "Sender",
        surname: "User",
        emailHash: "senderhash",
        showPseudo: false,
      };

      const mockReceiver = {
        _id: "507f1f77bcf86cd799439021",
        name: "John",
        surname: "Doe",
        emailHash: "hash1",
        email: "john@test.com",
      };

      (ListModel.findOne as jest.Mock).mockResolvedValue(mockList);
      (User.findById as jest.Mock).mockImplementation((id: any) => {
        const idStr = id.toString();
        if (idStr === "507f1f77bcf86cd799439020") {
          return Promise.resolve({
            ...mockSender,
            select: jest.fn().mockReturnThis(),
          });
        }
        if (idStr === "507f1f77bcf86cd799439021") {
          return Promise.resolve({
            ...mockReceiver,
            select: jest.fn().mockReturnThis(),
          });
        }
        return Promise.resolve(null);
      });
      (dataShareService.shareData as jest.Mock).mockResolvedValue({
        _id: "share123",
        senderId: "507f1f77bcf86cd799439020",
        receiverId: "507f1f77bcf86cd799439021",
        expiresAt: new Date(Date.now() + 86400000),
      });

      await handleShareData(req as Request, res as Response);

      expect(ListModel.findOne).toHaveBeenCalled();
      expect(dataShareService.shareData).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("devrait gérer les erreurs", async () => {
      req.user = { id: "user123" };
      req.body = {
        receiverIds: ["user456"],
        dataType: "fiche",
        dataId: "507f1f77bcf86cd799439011",
      };

      (FicheModel.findOne as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await handleShareData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors du partage des données",
      });
    });
  });

  describe("handleGetSharedData", () => {
    it("devrait récupérer une donnée partagée", async () => {
      req.user = { id: "507f1f77bcf86cd799439023" };
      req.params = { shareId: "507f1f77bcf86cd799439024" };

      const mockResult = {
        data: { _id: "fiche123", title: "Ma fiche" },
        message: "Test message",
        sender: {
          _id: "507f1f77bcf86cd799439025",
          name: "John",
          surname: "Doe",
        },
        sharedAt: new Date(),
        expiresAt: new Date(),
        dataType: "fiche",
        signatureValid: true,
      };

      (dataShareService.getSharedData as jest.Mock).mockResolvedValue(
        mockResult,
      );

      await handleGetSharedData(req as Request, res as Response);

      expect(dataShareService.getSharedData).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          dataType: "fiche",
          signatureValid: true,
        }),
      );
    });

    it("devrait rejeter si shareId manquant", async () => {
      req.user = { id: "user456" };
      req.params = {};

      await handleGetSharedData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "ID de partage invalide",
      });
    });

    it("devrait rejeter si partage non trouvé", async () => {
      req.user = { id: "user456" };
      req.params = { shareId: "507f1f77bcf86cd799439012" };

      (dataShareService.getSharedData as jest.Mock).mockRejectedValue(
        new Error("Partage non trouvé"),
      );

      await handleGetSharedData(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des données partagées",
      });
    });
  });

  describe("handleUpdateShareStatus", () => {
    it("devrait accepter un partage", async () => {
      req.user = { id: "507f1f77bcf86cd799439026" };
      req.params = { shareId: "507f1f77bcf86cd799439027" };
      req.body = { status: "accepted" };

      const mockUpdatedShare = {
        _id: "507f1f77bcf86cd799439027",
        receiverId: "507f1f77bcf86cd799439026",
        status: "accepted",
      };

      (dataShareService.updateShareStatus as jest.Mock).mockResolvedValue({
        ...mockUpdatedShare,
        copiedData: null,
      });

      await handleUpdateShareStatus(req as Request, res as Response);

      expect(dataShareService.updateShareStatus).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Partage accepté",
      });
    });

    it("devrait rejeter un partage", async () => {
      req.user = { id: "507f1f77bcf86cd799439028" };
      req.params = { shareId: "507f1f77bcf86cd799439029" };
      req.body = { status: "declined" };

      const mockUpdatedShare = {
        _id: "507f1f77bcf86cd799439029",
        receiverId: "507f1f77bcf86cd799439028",
        status: "declined",
      };

      (dataShareService.updateShareStatus as jest.Mock).mockResolvedValue({
        ...mockUpdatedShare,
        copiedData: null,
      });

      await handleUpdateShareStatus(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Partage refusé",
        }),
      );
    });

    it("devrait rejeter si statut invalide", async () => {
      req.user = { id: "user456" };
      req.params = { shareId: "507f1f77bcf86cd799439012" };
      req.body = { status: "invalid" };

      await handleUpdateShareStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Statut invalide (accepted ou declined)",
      });
    });
  });

  describe("handleGetReceivedShares", () => {
    it("devrait récupérer les partages reçus", async () => {
      req.user = { id: "507f1f77bcf86cd799439030" };
      req.query = { status: "pending" };

      const mockShares = [
        {
          _id: "share1",
          senderId: {
            _id: "507f1f77bcf86cd799439031",
            name: "John",
            surname: "Doe",
          },
          receiverId: "507f1f77bcf86cd799439030",
          dataType: "fiche",
          status: "pending",
          encryptedDataPerReceiver: [
            { receiverId: "507f1f77bcf86cd799439030", status: "pending" },
          ],
          messagePerReceiver: [],
          sharedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          relatedPointsIds: [],
          readBy: [],
        },
        {
          _id: "share2",
          senderId: {
            _id: "507f1f77bcf86cd799439032",
            name: "Jane",
            surname: "Smith",
          },
          receiverId: "507f1f77bcf86cd799439030",
          dataType: "point",
          status: "pending",
          encryptedDataPerReceiver: [
            { receiverId: "507f1f77bcf86cd799439030", status: "pending" },
          ],
          messagePerReceiver: [],
          sharedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          relatedPointsIds: [],
          readBy: [],
        },
      ];

      (dataShareService.getReceivedShares as jest.Mock).mockResolvedValue(
        mockShares,
      );

      await handleGetReceivedShares(req as Request, res as Response);

      expect(dataShareService.getReceivedShares).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          pagination: expect.objectContaining({
            total: 2,
          }),
        }),
      );
    });

    it("devrait récupérer tous les partages sans filtre", async () => {
      req.user = { id: "507f1f77bcf86cd799439033" };
      req.query = {};

      (dataShareService.getReceivedShares as jest.Mock).mockResolvedValue([]);

      await handleGetReceivedShares(req as Request, res as Response);

      expect(dataShareService.getReceivedShares).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [],
          pagination: expect.objectContaining({
            total: 0,
          }),
        }),
      );
    });
  });

  describe("handleGetSentShares", () => {
    it("devrait récupérer les partages envoyés", async () => {
      req.user = { id: "507f1f77bcf86cd799439034" };
      req.query = { status: "accepted" };

      const mockShares = [
        {
          _id: "share1",
          senderId: "507f1f77bcf86cd799439034",
          receiverIds: [
            {
              _id: "507f1f77bcf86cd799439035",
              name: "John",
              surname: "Doe",
            },
          ],
          dataType: "fiche",
          status: "accepted",
          encryptedDataPerReceiver: [
            { receiverId: "507f1f77bcf86cd799439035", status: "accepted" },
          ],
          sharedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          relatedPointsIds: [],
          readBy: [],
        },
        {
          _id: "share2",
          senderId: "507f1f77bcf86cd799439034",
          receiverIds: [
            {
              _id: "507f1f77bcf86cd799439036",
              name: "Jane",
              surname: "Smith",
            },
          ],
          dataType: "liste",
          status: "accepted",
          encryptedDataPerReceiver: [
            { receiverId: "507f1f77bcf86cd799439036", status: "accepted" },
          ],
          sharedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          relatedPointsIds: [],
          readBy: [],
        },
      ];

      (dataShareService.getSentShares as jest.Mock).mockResolvedValue(
        mockShares,
      );

      await handleGetSentShares(req as Request, res as Response);

      expect(dataShareService.getSentShares).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          pagination: expect.objectContaining({
            total: 2,
          }),
        }),
      );
    });

    it("devrait gérer les erreurs", async () => {
      req.user = { id: "507f1f77bcf86cd799439037" };
      req.query = {};

      (dataShareService.getSentShares as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await handleGetSentShares(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des partages envoyés",
      });
    });
  });
});
