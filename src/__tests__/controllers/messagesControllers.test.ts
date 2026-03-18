/**
 * Tests unitaires pour messagesControllers
 * Teste l'envoi, la récupération, l'édition et la suppression de messages
 */

// Set encryption key BEFORE imports
process.env.ENCRYPTION_KEY_COMMUNICATION =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

jest.mock("../../models/messages");
jest.mock("../../models/conversations");
jest.mock("../../models/users");
jest.mock("../../utils/communicationEncryptionUtils");
jest.mock("../../services/notificationService");
jest.mock("../../services/webSocketService");
jest.mock("../../services/memoryStorageService");
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));
jest.mock("../../utils/masterEncryptionUtils", () => ({
  decrypt: jest.fn((val: string) => val),
  encrypt: jest.fn((val: string) => `encrypted_${val}`),
}));

import { Request, Response } from "express";
import {
  sendMessage,
  getMessages,
  markMessageAsRead,
  replyToMessage,
  editMessage,
  deleteMessage,
} from "../../controllers/messagesControllers";
import Message from "../../models/messages";
import Conversation from "../../models/conversations";
import User from "../../models/users";
import { mockRequest, mockResponse } from "../mocks";
import * as communicationEncryptionUtils from "../../utils/communicationEncryptionUtils";
import * as notificationService from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import { memoryStorage } from "../../services/memoryStorageService";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

// Valid MongoDB ObjectId constants
const USER_ID_1 = "507f1f77bcf86cd799439011";
const USER_ID_2 = "507f1f77bcf86cd799439012";
const USER_ID_3 = "507f1f77bcf86cd799439013";
const CONV_ID = "507f1f77bcf86cd799439021";
const MSG_ID = "507f1f77bcf86cd799439031";

describe("messagesControllers", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();

    // Clear all mocks
    jest.clearAllMocks();

    // Setup default mocks
    (communicationEncryptionUtils.encrypt as jest.Mock).mockReturnValue(
      "encrypted_content",
    );
    (communicationEncryptionUtils.decrypt as jest.Mock).mockReturnValue(
      "decrypted_content",
    );
    (notificationService.createNotification as jest.Mock).mockResolvedValue({});
    // Mock webSocketService methods
    (webSocketService.notifyNewConversation as any) = jest.fn();
    (webSocketService.notifyMessagesRead as any) = jest.fn();
    (webSocketService.broadcastNewMessage as any) = jest.fn();
    (memoryStorage.updateConversationLastMessage as jest.Mock).mockReturnValue(
      undefined,
    );
    // Mock masterEncryptionUtils decrypt to return plain values
    (masterEncryptionUtils.decrypt as jest.Mock).mockImplementation(
      (val: string) => val,
    );
  });

  describe("sendMessage", () => {
    it("devrait envoyer un message avec succès", async () => {
      req.user = { id: USER_ID_1 };
      req.body = {
        conversationId: CONV_ID,
        content: "Hello world",
        type: "text",
      };

      const mockConversation = {
        _id: CONV_ID,
        participants: [{ userId: USER_ID_1 }, { userId: USER_ID_2 }],
        lastMessage: null,
        updatedAt: new Date(),
        isGroup: false,
        deletedBy: [],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockMessage = {
        _id: MSG_ID,
        conversationId: CONV_ID,
        senderId: USER_ID_1,
        content: "encrypted_content",
        type: "text",
        readBy: [USER_ID_1],
        createdAt: new Date(),
      };

      const mockUser = {
        _id: USER_ID_1,
        name: "John",
        surname: "Doe",
        pseudo: "encryptedPseudo",
        showPseudo: false,
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);
      (Conversation.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (Message.create as jest.Mock).mockResolvedValue(mockMessage);
      (User.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      await sendMessage(req as Request, res as Response);

      expect(Message.create).toHaveBeenCalled();
      expect(mockConversation.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: MSG_ID,
          message: expect.objectContaining({
            _id: String(MSG_ID),
            conversationId: CONV_ID,
            senderId: String(USER_ID_1),
            content: "Hello world",
            type: "text",
            readBy: [USER_ID_1],
            replies: [],
            metadata: null,
          }),
        }),
      );
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.body = { conversationId: "conv123", content: "test" };

      await sendMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si conversationId ou content manquant", async () => {
      req.user = { id: "user123" };
      req.body = { conversationId: "conv123" }; // content manquant

      await sendMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "conversationId et content requis",
      });
    });

    it("devrait rejeter si conversation non trouvée", async () => {
      req.user = { id: "user123" };
      req.body = { conversationId: "conv123", content: "test" };

      (Conversation.findById as jest.Mock).mockResolvedValue(null);

      await sendMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Conversation non trouvée",
      });
    });

    it("devrait rejeter si utilisateur pas dans conversation", async () => {
      req.user = { id: "user999" };
      req.body = { conversationId: "conv123", content: "test" };

      const mockConversation = {
        participants: [{ userId: "user123" }, { userId: "user456" }],
      };

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      await sendMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Conversation non trouvée",
      });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.user = { id: "user123" };
      req.body = { conversationId: "conv123", content: "test" };

      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await sendMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de l'envoi du message",
      });
    });
  });

  describe("getMessages", () => {
    it("devrait récupérer les messages d'une conversation", async () => {
      req.user = { id: USER_ID_1 };
      req.params = { conversationId: CONV_ID };
      req.query = { limit: "20", offset: "0" };

      const mockConversation = {
        _id: CONV_ID,
        participants: [{ userId: USER_ID_1 }, { userId: USER_ID_2 }],
      };

      const msg1Id = "507f1f77bcf86cd799439032";
      const msg2Id = "507f1f77bcf86cd799439033";

      const mockMessages = [
        {
          _id: msg2Id,
          conversationId: CONV_ID,
          senderId: USER_ID_2,
          content: "encrypted_message_2",
          createdAt: new Date("2024-01-02"),
          replies: [],
        },
        {
          _id: msg1Id,
          conversationId: CONV_ID,
          senderId: USER_ID_1,
          content: "encrypted_message_1",
          createdAt: new Date("2024-01-01"),
          replies: [],
        },
      ];

      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      // Mock countDocuments with proper chaining
      const countDocumentsMock = jest.fn().mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(2),
      });
      (Message.countDocuments as jest.Mock).mockImplementation(
        countDocumentsMock,
      );

      // Mock find with proper chaining
      const findMock = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockMessages),
      });
      (Message.find as jest.Mock).mockImplementation(findMock);

      await getMessages(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        messages: expect.arrayContaining([
          expect.objectContaining({
            _id: msg1Id,
            content: "decrypted_content",
          }),
          expect.objectContaining({
            _id: msg2Id,
            content: "decrypted_content",
          }),
        ]),
        pagination: {
          offset: 0,
          limit: 20,
          total: 2,
          hasMore: false,
          oldestMessageId: msg1Id,
        },
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;
      req.params = { conversationId: "conv123" };

      await getMessages(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
      });
    });

    it("devrait rejeter si conversationId manquant", async () => {
      req.user = { id: "user123" };
      req.params = {};

      await getMessages(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "conversationId requis" });
    });

    it("devrait gérer les erreurs", async () => {
      req.user = { id: "user123" };
      req.params = { conversationId: "conv123" };

      (Conversation.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await getMessages(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des messages",
      });
    });
  });

  describe("markMessageAsRead", () => {
    it("devrait marquer un message comme lu", async () => {
      req.user = { id: USER_ID_1 };
      req.params = { messageId: MSG_ID };

      // Create a mock message with readBy as array of strings
      const mockMessage = {
        _id: MSG_ID,
        conversationId: CONV_ID,
        readBy: [USER_ID_2], // Already read by USER_ID_2, not by USER_ID_1
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      const mockConversation = {
        _id: CONV_ID,
        participants: [{ userId: USER_ID_1 }, { userId: USER_ID_2 }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findOne as jest.Mock).mockResolvedValue(mockConversation);

      await markMessageAsRead(req as Request, res as Response);

      // The controller should have called save (since USER_ID_1 hasn't read it yet)
      expect(mockMessage.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("devrait rejeter si message non trouvé", async () => {
      req.user = { id: "user123" };
      req.params = { messageId: "msg999" };

      (Message.findById as jest.Mock).mockResolvedValue(null);

      await markMessageAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Message non trouvé" });
    });
  });

  describe("replyToMessage", () => {
    it("devrait répondre à un message", async () => {
      req.user = { id: USER_ID_1 };
      req.params = { messageId: MSG_ID };
      req.body = { content: "Reply content" };

      // Create a mock message with empty replies array
      const mockMessage = {
        _id: MSG_ID,
        conversationId: CONV_ID,
        replies: [],
        updatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      const mockConversation = {
        _id: CONV_ID,
        participants: [{ userId: USER_ID_1 }, { userId: USER_ID_2 }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findOne as jest.Mock).mockResolvedValue(mockConversation);

      await replyToMessage(req as Request, res as Response);

      expect(mockMessage.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });
  });

  describe("editMessage", () => {
    it("devrait éditer un message", async () => {
      req.user = { id: "user123" };
      req.params = { messageId: "msg123" };
      req.body = { content: "Edited content" };

      const mockMessage = {
        _id: "msg123",
        conversationId: "conv123",
        senderId: "user123",
        content: "old_encrypted_content",
        metadata: {},
        save: jest.fn().mockResolvedValue(true),
      };

      const mockConversation = {
        _id: "conv123",
        participants: [{ userId: "user123" }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      await editMessage(req as Request, res as Response);

      expect(mockMessage.content).toBe("encrypted_content");
      expect(mockMessage.metadata.edited).toBe(true);
      expect(mockMessage.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("devrait rejeter si utilisateur n'est pas l'expéditeur", async () => {
      req.user = { id: "user999" };
      req.params = { messageId: "msg123" };
      req.body = { content: "Edited content" };

      const mockMessage = {
        _id: "msg123",
        conversationId: "conv123",
        senderId: "user123",
      };

      const mockConversation = {
        _id: "conv123",
        participants: [{ userId: "user123" }, { userId: "user999" }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      await editMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non autorisé",
      });
    });
  });

  describe("deleteMessage", () => {
    it("devrait supprimer un message (marquer comme supprimé)", async () => {
      req.user = { id: "user123" };
      req.params = { messageId: "msg123" };

      const mockMessage = {
        _id: "msg123",
        conversationId: "conv123",
        senderId: "user123",
        metadata: {},
        save: jest.fn().mockResolvedValue(true),
      };

      const mockConversation = {
        _id: "conv123",
        participants: [{ userId: "user123" }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      await deleteMessage(req as Request, res as Response);

      expect(mockMessage.metadata.deleted).toBe(true);
      expect(mockMessage.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("devrait rejeter si message non trouvé", async () => {
      req.user = { id: "user123" };
      req.params = { messageId: "msg999" };

      (Message.findById as jest.Mock).mockResolvedValue(null);

      await deleteMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Message non trouvé" });
    });

    it("devrait rejeter si utilisateur n'est pas l'expéditeur", async () => {
      req.user = { id: "user999" };
      req.params = { messageId: "msg123" };

      const mockMessage = {
        _id: "msg123",
        conversationId: "conv123",
        senderId: "user123",
      };

      const mockConversation = {
        _id: "conv123",
        participants: [{ userId: "user123" }, { userId: "user999" }],
      };

      (Message.findById as jest.Mock).mockResolvedValue(mockMessage);
      (Conversation.findById as jest.Mock).mockResolvedValue(mockConversation);

      await deleteMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non autorisé",
      });
    });
  });
});
