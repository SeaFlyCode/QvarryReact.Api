/**
 * Tests unitaires pour conversationsControllers
 * Teste les fonctions de gestion des conversations et groupes
 */

jest.mock("../../models/conversations");
jest.mock("../../models/messages");
jest.mock("../../models/users");
jest.mock("../../models/contacts");
jest.mock("../../models/notifications");
jest.mock("../../services/memoryStorageService");
jest.mock("../../utils/communicationEncryptionUtils");
jest.mock("../../services/notificationService");
jest.mock("../../services/webSocketService");
jest.mock("../../services/dataArchiveService");

import { Request, Response } from "express";
import {
  createPrivateConversation,
  createGroupConversation,
  listConversations,
  getConversationDetails,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  deleteGroup,
  updateGroupName,
  markConversationAsRead,
  deleteConversation,
} from "../../controllers/conversationsControllers";
import { mockRequest, mockResponse } from "../mocks";
import Conversation from "../../models/conversations";
import Message from "../../models/messages";
import User from "../../models/users";
import NotificationModel from "../../models/notifications";
import { memoryStorage } from "../../services/memoryStorageService";
import {
  encrypt as encryptCommunication,
  decrypt as decryptCommunication,
} from "../../utils/communicationEncryptionUtils";
import { createNotification } from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import dataArchiveService from "../../services/dataArchiveService";
import mongoose from "mongoose";

describe("conversationsControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (encryptCommunication as jest.Mock).mockImplementation((val) => {
      if (val === undefined || val === null) return val;
      return `encrypted-${val}`;
    });
    (decryptCommunication as jest.Mock).mockImplementation((val) =>
      val.replace("encrypted-", ""),
    );
    (memoryStorage.storeConversation as jest.Mock).mockReturnValue(undefined);
    (memoryStorage.removeConversation as jest.Mock).mockReturnValue(undefined);

    // Mock all webSocketService methods
    (webSocketService.notifyNewConversation as jest.Mock) = jest
      .fn()
      .mockReturnValue(undefined);
    (webSocketService.notifyMemberRemoved as jest.Mock) = jest
      .fn()
      .mockReturnValue(undefined);
    (webSocketService.notifyMessagesRead as jest.Mock) = jest
      .fn()
      .mockReturnValue(undefined);
    (webSocketService.notifyGroupDeleted as jest.Mock) = jest
      .fn()
      .mockReturnValue(undefined);
    (webSocketService.notifyGroupNameChanged as jest.Mock) = jest
      .fn()
      .mockReturnValue(undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: createPrivateConversation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createPrivateConversation", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" }, // user123 -> valid ObjectId
        body: { participantId: "507f1f77bcf86cd799439456", name: "Chat privé" }, // user456 -> valid ObjectId
      });
      res = mockResponse();

      const ContactModel = require("../../models/contacts").default;
      (ContactModel.findOne as jest.Mock).mockResolvedValue({
        userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
        contactId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456"),
        status: "accepted",
        isBlocked: false,
      });

      (Conversation.findOne as jest.Mock).mockResolvedValue(null);
      (Conversation.create as jest.Mock).mockResolvedValue({
        _id: "conv123",
        name: "encrypted-Chat privé",
        isGroup: false,
        creatorId: "507f1f77bcf86cd799439011",
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "member" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("devrait créer une conversation privée", async () => {
      await createPrivateConversation(req as Request, res as Response);

      expect(Conversation.create).toHaveBeenCalled();
      expect(memoryStorage.storeConversation).toHaveBeenCalledTimes(2); // Pour les 2 participants
      expect(webSocketService.notifyNewConversation).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv123",
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await createPrivateConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non authentifié"),
        }),
      );
    });

    it("devrait rejeter si participantId manquant", async () => {
      req.body = {};

      await createPrivateConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("requis"),
        }),
      );
    });

    it("devrait rejeter si pas de lien de contact", async () => {
      const ContactModel = require("../../models/contacts").default;
      (ContactModel.findOne as jest.Mock).mockResolvedValue(null);

      await createPrivateConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("contacts"),
        }),
      );
    });

    it("devrait retourner la conversation existante", async () => {
      (Conversation.findOne as jest.Mock).mockResolvedValue({
        _id: "conv123",
        name: null,
        isGroup: false,
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "member" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
        ],
        deletedBy: [],
      });

      await createPrivateConversation(req as Request, res as Response);

      expect(Conversation.create).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv123",
          existing: true,
        }),
      );
    });

    it("devrait réactiver une conversation masquée", async () => {
      (Conversation.findOne as jest.Mock).mockResolvedValue({
        _id: "conv123",
        deletedBy: [new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")],
      });

      (Conversation.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "conv123",
        name: null,
        isGroup: false,
        participants: [],
        deletedBy: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await createPrivateConversation(req as Request, res as Response);

      expect(Conversation.updateOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          reactivated: true,
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.create as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await createPrivateConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("conversation privée"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: createGroupConversation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createGroupConversation", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        body: {
          name: "Mon Groupe",
          participantIds: [
            "507f1f77bcf86cd799439456",
            "507f1f77bcf86cd799439789",
          ],
        },
      });
      res = mockResponse();

      (Conversation.create as jest.Mock).mockResolvedValue({
        _id: "groupConv123",
        name: "encrypted-Mon Groupe",
        isGroup: true,
        creatorId: "507f1f77bcf86cd799439011",
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "admin" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
          { userId: "507f1f77bcf86cd799439789", role: "member" },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue({
          name: "encrypted-John",
          surname: "encrypted-Doe",
          pseudo: "encrypted-johndoe",
          showPseudo: false,
        }),
      });

      (createNotification as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait créer un groupe", async () => {
      await createGroupConversation(req as Request, res as Response);

      expect(Conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "encrypted-Mon Groupe",
          isGroup: true,
        }),
      );
      expect(memoryStorage.storeConversation).toHaveBeenCalledTimes(3); // Pour les 3 participants
      expect(webSocketService.notifyNewConversation).toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledTimes(2); // Notifications pour les 2 invités
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "groupConv123",
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await createGroupConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non authentifié"),
        }),
      );
    });

    it("devrait rejeter si nom ou participantIds manquants", async () => {
      req.body = { name: "Mon Groupe" }; // Manque participantIds

      await createGroupConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("requis"),
        }),
      );
    });

    it("devrait rejeter si liste de participants vide", async () => {
      req.body = { name: "Mon Groupe", participantIds: [] };

      await createGroupConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("requis"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.create as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await createGroupConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("création du groupe"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: listConversations
  // ═══════════════════════════════════════════════════════════════════════════

  describe("listConversations", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        query: { page: "1", limit: "20" },
      });
      res = mockResponse();

      (memoryStorage.getAllConversations as jest.Mock).mockReturnValue([]);

      (Conversation.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: "507f1f77bcf86cd799440005", // conv1 -> valid ObjectId
            name: "encrypted-Groupe Test",
            isGroup: true,
            participants: [
              {
                userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
              },
            ],
            deletedBy: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      });

      (Conversation.countDocuments as jest.Mock).mockResolvedValue(1);

      // Message.aggregate returns an Aggregate object that has .option() method
      // which returns a Promise
      const aggregateResult = Promise.resolve([]);
      const aggregateMock = {
        option: jest.fn().mockReturnValue(aggregateResult),
      };
      (Message.aggregate as jest.Mock).mockReturnValue(aggregateMock);
    });

    it("devrait lister les conversations", async () => {
      await listConversations(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            limit: 20,
            total: 1,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await listConversations(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non authentifié"),
        }),
      );
    });

    it("devrait paginer correctement", async () => {
      req.query = { page: "2", limit: "10" };

      await listConversations(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({
            page: 2,
            limit: 10,
          }),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await listConversations(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("conversations"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: getConversationDetails
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getConversationDetails", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "conv123" },
      });
      res = mockResponse();

      (Conversation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "conv123",
          name: "encrypted-Mon Groupe",
          isGroup: true,
          participants: [
            { userId: "507f1f77bcf86cd799439011", role: "admin" },
            { userId: "507f1f77bcf86cd799439456", role: "member" },
          ],
          createdAt: new Date(),
        }),
      });
    });

    it("devrait retourner les détails d'une conversation", async () => {
      await getConversationDetails(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "conv123",
          name: "Mon Groupe",
          isGroup: true,
          participants: expect.any(Array),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined, params: { id: "conv123" } });

      await getConversationDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non authentifié"),
        }),
      );
    });

    it("devrait rejeter si ID manquant", async () => {
      req.params = {};

      await getConversationDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("requis"),
        }),
      );
    });

    it("devrait retourner 404 si conversation non trouvée", async () => {
      (Conversation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await getConversationDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvée"),
        }),
      );
    });

    it("devrait rejeter si utilisateur n'est pas participant", async () => {
      (Conversation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "conv123",
          participants: [{ userId: "507f1f77bcf86cd799439999" }],
        }),
      });

      await getConversationDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvée"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await getConversationDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("détails"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: addGroupMembers
  // ═══════════════════════════════════════════════════════════════════════════

  describe("addGroupMembers", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockConversation: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "507f1f77bcf86cd799440003" }, // groupConv123 -> valid ObjectId
        body: {
          userIds: ["507f1f77bcf86cd799440010", "507f1f77bcf86cd799440011"],
        }, // newUser1, newUser2 -> valid ObjectIds
      });
      res = mockResponse();

      mockConversation = {
        _id: "507f1f77bcf86cd799440003",
        isGroup: true,
        participants: [
          {
            userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
            role: "admin",
          },
          {
            userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456"),
            role: "member",
          },
        ],
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
        toObject: jest.fn().mockReturnThis(),
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
    });

    it("devrait ajouter des membres au groupe", async () => {
      await addGroupMembers(req as Request, res as Response);

      expect(mockConversation.participants.length).toBe(4); // 2 + 2 nouveaux
      expect(mockConversation.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await addGroupMembers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si userIds manquants", async () => {
      req.body = {};

      await addGroupMembers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait rejeter si pas admin", async () => {
      mockConversation.participants = [
        { userId: "507f1f77bcf86cd799439011", role: "member" }, // Plus admin
        { userId: "507f1f77bcf86cd799439456", role: "admin" },
      ];

      await addGroupMembers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("admin"),
        }),
      );
    });

    it("devrait retourner 404 si groupe non trouvé", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue(null);

      await addGroupMembers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await addGroupMembers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: removeGroupMember
  // ═══════════════════════════════════════════════════════════════════════════

  describe("removeGroupMember", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockConversation: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "groupConv123", userId: "507f1f77bcf86cd799439456" },
      });
      res = mockResponse();

      mockConversation = {
        _id: "groupConv123",
        isGroup: true,
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "admin" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
          { userId: "507f1f77bcf86cd799439789", role: "member" },
        ],
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
        toObject: jest.fn().mockReturnThis(),
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
      (memoryStorage.getSession as jest.Mock).mockReturnValue({
        conversations: new Map(),
      });
      (webSocketService.notifyMemberRemoved as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait retirer un membre du groupe", async () => {
      await removeGroupMember(req as Request, res as Response);

      expect(mockConversation.participants.length).toBe(2); // 3 - 1
      expect(mockConversation.save).toHaveBeenCalled();
      expect(webSocketService.notifyMemberRemoved).toHaveBeenCalledWith(
        "groupConv123",
        "507f1f77bcf86cd799439456",
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await removeGroupMember(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si pas admin", async () => {
      mockConversation.participants = [
        { userId: "507f1f77bcf86cd799439011", role: "member" }, // Plus admin
        { userId: "507f1f77bcf86cd799439456", role: "admin" },
      ];

      await removeGroupMember(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait empêcher de retirer le dernier admin", async () => {
      req.params = { id: "groupConv123", userId: "507f1f77bcf86cd799439011" }; // Retirer soi-même
      mockConversation.participants = [
        { userId: "507f1f77bcf86cd799439011", role: "admin" }, // Seul admin
        { userId: "507f1f77bcf86cd799439456", role: "member" },
      ];

      await removeGroupMember(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("dernier admin"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await removeGroupMember(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: leaveGroup
  // ═══════════════════════════════════════════════════════════════════════════

  describe("leaveGroup", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockConversation: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439456" },
        params: { id: "groupConv123" },
      });
      res = mockResponse();

      mockConversation = {
        _id: "groupConv123",
        isGroup: true,
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "admin" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
        ],
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
      (memoryStorage.getSession as jest.Mock).mockReturnValue({
        conversations: new Map(),
      });
      (webSocketService.notifyMemberRemoved as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait permettre de quitter un groupe", async () => {
      await leaveGroup(req as Request, res as Response);

      expect(mockConversation.participants.length).toBe(1);
      expect(mockConversation.save).toHaveBeenCalled();
      expect(webSocketService.notifyMemberRemoved).toHaveBeenCalledWith(
        "groupConv123",
        "507f1f77bcf86cd799439456",
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await leaveGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait empêcher le dernier admin de quitter", async () => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "groupConv123" },
      });

      mockConversation.participants = [
        { userId: "507f1f77bcf86cd799439011", role: "admin" }, // Seul admin
        { userId: "507f1f77bcf86cd799439456", role: "member" },
      ];

      await leaveGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("dernier admin"),
        }),
      );
    });

    it("devrait retourner 404 si groupe non trouvé", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue(null);

      await leaveGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await leaveGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: deleteGroup
  // ═══════════════════════════════════════════════════════════════════════════

  describe("deleteGroup", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockConversation: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "507f1f77bcf86cd799440004" }, // groupConv123 -> valid ObjectId
      });
      res = mockResponse();

      mockConversation = {
        _id: "507f1f77bcf86cd799440004",
        isGroup: true,
        participants: [
          {
            userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
            role: "admin",
          },
          {
            userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456"),
            role: "member",
          },
        ],
        toObject: jest.fn().mockReturnThis(),
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
      (Conversation.deleteOne as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (Message.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: "msg1", content: "test" },
          { _id: "msg2", content: "test2" },
        ]),
      });
      (Message.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 2 });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue(undefined);
      (dataArchiveService.archiveEntity as jest.Mock).mockResolvedValue(
        undefined,
      );
      (memoryStorage.getSession as jest.Mock).mockReturnValue({
        conversations: new Map(),
      });
      (webSocketService.notifyGroupDeleted as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait supprimer un groupe", async () => {
      await deleteGroup(req as Request, res as Response);

      expect(dataArchiveService.archiveAndRecordDeletion).toHaveBeenCalled();
      expect(Message.deleteMany).toHaveBeenCalled();
      expect(Conversation.deleteOne).toHaveBeenCalled();
      expect(webSocketService.notifyGroupDeleted).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("supprimé"),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await deleteGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si pas admin", async () => {
      mockConversation.participants = [
        {
          userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
          role: "member",
        }, // Plus admin
        {
          userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456"),
          role: "admin",
        },
      ];

      await deleteGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait retourner 404 si groupe non trouvé", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue(null);

      await deleteGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await deleteGroup(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: updateGroupName
  // ═══════════════════════════════════════════════════════════════════════════

  describe("updateGroupName", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockConversation: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" },
        params: { id: "groupConv123" },
        body: { name: "Nouveau Nom" },
      });
      res = mockResponse();

      mockConversation = {
        _id: "groupConv123",
        isGroup: true,
        participants: [
          { userId: "507f1f77bcf86cd799439011", role: "admin" },
          { userId: "507f1f77bcf86cd799439456", role: "member" },
        ],
        name: "encrypted-Ancien Nom",
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
        toObject: jest.fn().mockReturnThis(),
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
      (webSocketService.notifyGroupNameChanged as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait modifier le nom du groupe", async () => {
      await updateGroupName(req as Request, res as Response);

      expect(mockConversation.name).toBe("encrypted-Nouveau Nom");
      expect(mockConversation.save).toHaveBeenCalled();
      expect(webSocketService.notifyGroupNameChanged).toHaveBeenCalledWith(
        "groupConv123",
        "Nouveau Nom",
        expect.any(Array),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await updateGroupName(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si nom manquant", async () => {
      req.body = {};

      await updateGroupName(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait rejeter si pas admin", async () => {
      mockConversation.participants = [
        {
          userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
          role: "member",
        }, // Plus admin
        {
          userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456"),
          role: "admin",
        },
      ];

      await updateGroupName(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await updateGroupName(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: markConversationAsRead
  // ═══════════════════════════════════════════════════════════════════════════

  describe("markConversationAsRead", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" }, // user123 -> valid ObjectId
        params: { id: "507f1f77bcf86cd799440002" }, // conv123 -> valid ObjectId
      });
      res = mockResponse();

      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "507f1f77bcf86cd799440002",
        participants: [
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011") },
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456") },
        ],
      });

      (Message.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue([
            { _id: "msg1" },
            { _id: "msg2" },
            { _id: "msg3" },
          ]),
      });

      (Message.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 3 });

      (NotificationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 2,
      });

      (webSocketService.notifyMessagesRead as jest.Mock).mockReturnValue(
        undefined,
      );
    });

    it("devrait marquer les messages comme lus", async () => {
      await markConversationAsRead(req as Request, res as Response);

      expect(Message.updateMany).toHaveBeenCalled();
      expect(webSocketService.notifyMessagesRead).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          markedAsRead: 3,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await markConversationAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si pas participant", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "507f1f77bcf86cd799440002",
        participants: [
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439999") },
        ],
      });

      await markConversationAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait retourner 404 si conversation non trouvée", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue(null);

      await markConversationAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await markConversationAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: deleteConversation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("deleteConversation", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439011" }, // user123 -> valid ObjectId
        params: { id: "507f1f77bcf86cd799440001" }, // conv123 -> valid ObjectId
      });
      res = mockResponse();

      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "507f1f77bcf86cd799440001",
        isGroup: false,
        participants: [
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011") },
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439456") },
        ],
        deletedBy: [],
      });

      (Conversation.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });
    });

    it("devrait masquer une conversation", async () => {
      await deleteConversation(req as Request, res as Response);

      expect(Conversation.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(mongoose.Types.ObjectId) },
        { $addToSet: { deletedBy: expect.any(mongoose.Types.ObjectId) } },
      );
      expect(memoryStorage.removeConversation).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799440001",
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          hidden: true,
          message: expect.stringContaining("masquée"),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await deleteConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter si conversation de groupe", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "507f1f77bcf86cd799440001",
        isGroup: true,
        participants: [
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011") },
        ],
      });

      await deleteConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "USE_LEAVE_GROUP",
        }),
      );
    });

    it("devrait rejeter si déjà masquée", async () => {
      (Conversation.findById as jest.Mock).mockResolvedValue({
        _id: "507f1f77bcf86cd799440001",
        isGroup: false,
        participants: [
          { userId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011") },
        ],
        deletedBy: [new mongoose.Types.ObjectId("507f1f77bcf86cd799439011")],
      });

      await deleteConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("déjà masquée"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await deleteConversation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
