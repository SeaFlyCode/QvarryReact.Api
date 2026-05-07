/**
 * Tests unitaires pour notificationsControllers
 * Teste les fonctions CRUD pour les notifications
 */

jest.mock("../../models/notifications");
jest.mock("../../services/notificationService");
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    broadcastSyncUpdate: jest.fn(),
    broadcastNotificationRead: jest.fn(),
  },
}));
jest.mock("../../utils/communicationEncryptionUtils", () => ({
  decrypt: jest.fn((val) => val),
  encrypt: jest.fn((val) => val),
}));

import { Request, Response } from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
} from "../../controllers/notificationsControllers";
import NotificationModel from "../../models/notifications";
import { mockRequest, mockResponse } from "../mocks";
import mongoose from "mongoose";

// Helper: Create valid ObjectId strings for tests
const testUserId = new mongoose.Types.ObjectId().toString();
const testNotifId = new mongoose.Types.ObjectId().toString();
const testNotifId2 = new mongoose.Types.ObjectId().toString();

describe("notificationsControllers", () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getNotifications", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait retourner les notifications avec pagination", async () => {
      req.user = { id: testUserId, isAdmin: false };
      req.query = { page: "1", limit: "15" };

      const mockNotifications = [
        {
          _id: testNotifId,
          userId: testUserId,
          type: "contact_request",
          title: "Test",
          message: "Message test",
          read: false,
          createdAt: new Date(),
        },
      ];

      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockNotifications),
      });
      (NotificationModel.countDocuments as jest.Mock)
        .mockResolvedValueOnce(1) // total
        .mockResolvedValueOnce(1); // unreadCount

      await getNotifications(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        data: mockNotifications,
        pagination: {
          page: 1,
          limit: 15,
          total: 1,
          totalPages: 1,
        },
        unreadCount: 1,
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await getNotifications(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.user = { id: testUserId, isAdmin: false };

      (NotificationModel.deleteMany as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await getNotifications(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Erreur serveur" });
    });
  });

  describe("getUnreadCount", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait retourner le nombre de notifications non lues", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };

      (NotificationModel.countDocuments as jest.Mock).mockResolvedValue(5);

      await getUnreadCount(req as Request, res as Response);

      expect(NotificationModel.countDocuments).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        read: false,
      });
      expect(res.json).toHaveBeenCalledWith({ unreadCount: 5 });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await getUnreadCount(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });
  });

  describe("markAsRead", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      req.params = {};
    });

    it("devrait marquer une notification comme lue", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };
      req.params = { notificationId: testNotifId };

      const mockNotification = {
        _id: testNotifId,
        read: true,
        readAt: new Date(),
      };

      (NotificationModel.findOneAndUpdate as jest.Mock).mockResolvedValue(
        mockNotification,
      );

      await markAsRead(req as Request, res as Response);

      expect(NotificationModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: expect.any(mongoose.Types.ObjectId),
          userId: expect.any(mongoose.Types.ObjectId),
        },
        {
          read: true,
          readAt: expect.any(Date),
        },
        { new: true },
      );
      expect(res.json).toHaveBeenCalledWith({
        message: "Notification marquée comme lue",
      });
    });

    it("devrait retourner 404 si la notification n'existe pas", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };
      req.params = { notificationId: testNotifId };

      (NotificationModel.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

      await markAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Notification non trouvée",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;
      req.params = { notificationId: testNotifId };

      await markAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });
  });

  describe("markAllAsRead", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait marquer toutes les notifications comme lues", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };

      (NotificationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });

      await markAllAsRead(req as Request, res as Response);

      expect(NotificationModel.updateMany).toHaveBeenCalledWith(
        {
          userId: expect.any(mongoose.Types.ObjectId),
          read: false,
        },
        {
          read: true,
          readAt: expect.any(Date),
        },
      );
      expect(res.json).toHaveBeenCalledWith({
        message: "Toutes les notifications ont été marquées comme lues",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await markAllAsRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });
  });

  describe("deleteNotification", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      req.params = {};
    });

    it("devrait supprimer une notification", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };
      const validNotifId = new mongoose.Types.ObjectId().toString();
      req.params = { notificationId: validNotifId };

      const mockNotification = { _id: validNotifId, userId: validUserId };

      (NotificationModel.findOneAndDelete as jest.Mock).mockResolvedValue(
        mockNotification,
      );

      await deleteNotification(req as Request, res as Response);

      expect(NotificationModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: expect.any(mongoose.Types.ObjectId),
        userId: expect.any(mongoose.Types.ObjectId),
      });
      expect(res.json).toHaveBeenCalledWith({
        message: "Notification supprimée",
      });
    });

    it("devrait retourner 404 si la notification n'existe pas", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };
      const validNotifId = new mongoose.Types.ObjectId().toString();
      req.params = { notificationId: validNotifId };

      (NotificationModel.findOneAndDelete as jest.Mock).mockResolvedValue(null);

      await deleteNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Notification non trouvée",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;
      req.params = { notificationId: testNotifId };

      await deleteNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });
  });

  describe("deleteAllRead", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait supprimer toutes les notifications lues", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };

      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 5,
      });

      await deleteAllRead(req as Request, res as Response);

      expect(NotificationModel.deleteMany).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        read: true,
      });
      expect(res.json).toHaveBeenCalledWith({
        message: "Toutes les notifications lues ont été supprimées",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await deleteAllRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: "Non authentifié" });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      req.user = { id: validUserId, isAdmin: false };

      (NotificationModel.deleteMany as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await deleteAllRead(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ message: "Erreur serveur" });
    });
  });
});
