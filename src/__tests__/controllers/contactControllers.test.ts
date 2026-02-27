/**
 * Tests unitaires pour contactControllers
 * Tests basiques pour les opérations de gestion des contacts
 * Note: Tests simplifiés en raison de la complexité du memoryStorage et des services de chiffrement
 */

// Set env var before imports to prevent communicationEncryptionUtils from throwing
// Must be 64-char hex string (32 bytes)
process.env.ENCRYPTION_KEY_COMMUNICATION =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Mock webSocketService FIRST to prevent setInterval from running
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    initialize: jest.fn(),
    sendNotificationToUser: jest.fn(),
    sendMessageToUser: jest.fn(),
  },
}));

jest.mock("../../models/contacts");
jest.mock("../../models/users");
jest.mock("../../services/memoryStorageService", () => {
  // Prevent MemoryStorageService from being instantiated with setInterval
  class MockMemoryStorage {
    initUserSession = jest.fn();
    getSession = jest.fn();
    invalidateSession = jest.fn();
    touchSession = jest.fn();
    getUserEncryptionKey = jest.fn();
    hasSession = jest.fn().mockReturnValue(false);
    deleteContact = jest.fn();
    storeContact = jest.fn();
  }
  return {
    memoryStorage: new MockMemoryStorage(),
    MemoryStorageService: MockMemoryStorage,
  };
});
jest.mock("../../services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({ _id: "notif123" }),
}));
jest.mock("../../services/emailService", () => ({
  sendContactRequestEmail: jest.fn().mockResolvedValue(true),
  sendContactAcceptedEmail: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    sendNotificationToUser: jest.fn(),
  },
}));
jest.mock("../../utils/communicationEncryptionUtils", () => ({
  decrypt: jest.fn((val) => val),
  encrypt: jest.fn((val) => val),
}));
jest.mock("../../utils/masterEncryptionUtils", () => ({
  decrypt: jest.fn((val) => val),
  encrypt: jest.fn((val) => val),
}));

import { Request, Response } from "express";
import {
  listContacts,
  deleteContact,
} from "../../controllers/contactControllers";
import Contact from "../../models/contacts";
import { mockRequest, mockResponse } from "../mocks";
import mongoose from "mongoose";

// Create valid ObjectId strings for tests
const testUserId = new mongoose.Types.ObjectId().toString();
const testContactId = new mongoose.Types.ObjectId().toString();
const testUser2Id = new mongoose.Types.ObjectId().toString();

describe("contactControllers", () => {
  describe("listContacts", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await listContacts(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
      });
    });

    it("devrait retourner les contacts avec succès", async () => {
      req.user = { id: testUserId, isAdmin: false };
      req.query = {};

      const mockContacts = [
        {
          _id: testContactId,
          userId: {
            _id: testUserId,
            name: "User",
            surname: "Name",
            contact_code: 123456,
          },
          contactId: {
            _id: testUser2Id,
            name: "John",
            surname: "Doe",
            contact_code: 123456,
          },
          contactCode: "@123456",
          status: "accepted",
          isBlocked: false,
          createdAt: new Date(),
        },
      ];

      const populateMock = jest.fn().mockReturnThis();
      const sortMock = jest.fn().mockResolvedValue(mockContacts);

      (Contact.find as jest.Mock).mockReturnValue({
        populate: populateMock,
        sort: sortMock,
      });

      await listContacts(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      // Should call populate twice (contactId and userId)
      expect(populateMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("deleteContact", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      req.params = {};
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;
      req.params = { contactId: testContactId };

      await deleteContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non authentifié",
      });
    });

    it("devrait supprimer un contact avec succès", async () => {
      req.user = { id: testUserId, isAdmin: false };
      req.params = { contactId: testUser2Id };

      (Contact.findOneAndDelete as jest.Mock).mockResolvedValue({
        _id: testContactId,
        userId: testUserId,
        contactId: testUser2Id,
      });

      await deleteContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it("devrait retourner 404 si le contact n'existe pas", async () => {
      req.user = { id: testUserId, isAdmin: false };
      req.params = { contactId: testUser2Id };

      (Contact.findOneAndDelete as jest.Mock).mockResolvedValue(null);

      await deleteContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Contact introuvable",
      });
    });
  });
});
