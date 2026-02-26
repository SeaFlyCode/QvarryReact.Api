// src/__tests__/services/notificationService.test.ts

import mongoose from "mongoose";
import NotificationModel from "../../models/notifications";
import {
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUserNotifications,
  deleteNotification,
  cleanupOldNotifications,
  getUnreadNotificationsCount,
  notifyShareReceived,
  notifyShareAccepted,
  notifyShareDeclined,
  notifyShareRead,
} from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import dataArchiveService from "../../services/dataArchiveService";

// Mock dependencies
jest.mock("../../models/notifications");
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    sendNotificationToUser: jest.fn(),
  },
}));
jest.mock("../../services/dataArchiveService", () => ({
  __esModule: true,
  default: {
    archiveAndRecordDeletion: jest.fn().mockResolvedValue({}),
  },
}));

describe("NotificationService", () => {
  const mockUserId = "507f1f77bcf86cd799439011";
  const mockNotificationId = "507f1f77bcf86cd799439012";
  const mockSenderId = "507f1f77bcf86cd799439013";
  const mockShareId = "507f1f77bcf86cd799439014";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createNotification", () => {
    it("should create a notification and send via WebSocket", async () => {
      const mockNotification = {
        _id: new mongoose.Types.ObjectId(mockNotificationId),
        userId: new mongoose.Types.ObjectId(mockUserId),
        type: "new_message",
        title: "New Message",
        message: "You have a new message",
        read: false,
        createdAt: new Date(),
        save: jest.fn().mockResolvedValue({}),
      };

      (NotificationModel as unknown as jest.Mock).mockImplementation(
        () => mockNotification,
      );

      const result = await createNotification(
        new mongoose.Types.ObjectId(mockUserId),
        "new_message",
        "New Message",
        "You have a new message",
      );

      expect(result).toBe(mockNotification);
      expect(mockNotification.save).toHaveBeenCalled();
      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          type: "notification",
          notificationType: "new_message",
          title: "New Message",
          message: "You have a new message",
        }),
      );
    });

    it("should create notification with additional data", async () => {
      const mockNotification = {
        _id: new mongoose.Types.ObjectId(mockNotificationId),
        save: jest.fn().mockResolvedValue({}),
        createdAt: new Date(),
      };

      (NotificationModel as unknown as jest.Mock).mockImplementation(
        () => mockNotification,
      );

      await createNotification(
        new mongoose.Types.ObjectId(mockUserId),
        "share_received",
        "Share Received",
        "You received a share",
        {
          shareId: new mongoose.Types.ObjectId(mockShareId),
          senderId: new mongoose.Types.ObjectId(mockSenderId),
        },
      );

      expect(NotificationModel).toHaveBeenCalledWith(
        expect.objectContaining({
          shareId: expect.any(mongoose.Types.ObjectId),
          senderId: expect.any(mongoose.Types.ObjectId),
        }),
      );
    });

    it("should handle WebSocket service not available", async () => {
      const mockNotification = {
        _id: new mongoose.Types.ObjectId(mockNotificationId),
        save: jest.fn().mockResolvedValue({}),
        createdAt: new Date(),
      };

      (NotificationModel as unknown as jest.Mock).mockImplementation(
        () => mockNotification,
      );

      // Temporarily remove sendNotificationToUser
      const originalFn = webSocketService.sendNotificationToUser;
      delete (webSocketService as any).sendNotificationToUser;

      await createNotification(
        new mongoose.Types.ObjectId(mockUserId),
        "new_message",
        "Test",
        "Test message",
      );

      // Restore
      webSocketService.sendNotificationToUser = originalFn;

      // Should not throw
      expect(mockNotification.save).toHaveBeenCalled();
    });
  });

  describe("markNotificationAsRead", () => {
    it("should mark a notification as read", async () => {
      (NotificationModel.updateOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ modifiedCount: 1 });

      await markNotificationAsRead(
        new mongoose.Types.ObjectId(mockNotificationId),
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(NotificationModel.updateOne).toHaveBeenCalledWith(
        {
          _id: expect.any(mongoose.Types.ObjectId),
          userId: expect.any(mongoose.Types.ObjectId),
        },
        {
          $set: {
            read: true,
            readAt: expect.any(Date),
          },
        },
      );
    });
  });

  describe("markAllNotificationsAsRead", () => {
    it("should mark all unread notifications as read", async () => {
      (NotificationModel.updateMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ modifiedCount: 5 });

      const count = await markAllNotificationsAsRead(
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(count).toBe(5);
      expect(NotificationModel.updateMany).toHaveBeenCalledWith(
        {
          userId: expect.any(mongoose.Types.ObjectId),
          read: false,
        },
        {
          $set: {
            read: true,
            readAt: expect.any(Date),
          },
        },
      );
    });

    it("should return 0 when no notifications were updated", async () => {
      (NotificationModel.updateMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ modifiedCount: 0 });

      const count = await markAllNotificationsAsRead(
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(count).toBe(0);
    });
  });

  describe("getUserNotifications", () => {
    it("should get all user notifications", async () => {
      const mockNotifications = [
        { _id: "1", type: "new_message", read: false },
        { _id: "2", type: "share_received", read: true },
      ];

      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockNotifications),
      };

      (NotificationModel.find as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockQuery);

      const result = await getUserNotifications(
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(result).toEqual(mockNotifications);
      expect(NotificationModel.find).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
      });
      expect(mockQuery.limit).toHaveBeenCalledWith(50);
    });

    it("should get only unread notifications when unreadOnly is true", async () => {
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue([]),
      };

      (NotificationModel.find as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockQuery);

      await getUserNotifications(new mongoose.Types.ObjectId(mockUserId), true);

      expect(NotificationModel.find).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        read: false,
      });
    });
  });

  describe("deleteNotification", () => {
    it("should archive and delete a notification", async () => {
      const mockNotification = {
        _id: mockNotificationId,
        userId: mockUserId,
        type: "new_message",
        message: "Test",
      };

      const mockFindQuery = {
        lean: jest.fn().mockResolvedValue(mockNotification),
      };

      (NotificationModel.findOne as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockFindQuery);
      (NotificationModel.deleteOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 1 });

      await deleteNotification(
        new mongoose.Types.ObjectId(mockNotificationId),
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(dataArchiveService.archiveAndRecordDeletion).toHaveBeenCalledWith(
        "notification",
        expect.any(mongoose.Types.ObjectId),
        mockNotification,
        expect.any(mongoose.Types.ObjectId),
        { reason: "Notification supprimée par utilisateur" },
      );

      expect(NotificationModel.deleteOne).toHaveBeenCalledWith({
        _id: expect.any(mongoose.Types.ObjectId),
        userId: expect.any(mongoose.Types.ObjectId),
      });
    });

    it("should handle notification not found", async () => {
      const mockFindQuery = {
        lean: jest.fn().mockResolvedValue(null),
      };

      (NotificationModel.findOne as jest.Mock) = jest
        .fn()
        .mockReturnValue(mockFindQuery);
      (NotificationModel.deleteOne as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      await deleteNotification(
        new mongoose.Types.ObjectId(mockNotificationId),
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(
        dataArchiveService.archiveAndRecordDeletion,
      ).not.toHaveBeenCalled();
      expect(NotificationModel.deleteOne).toHaveBeenCalled();
    });
  });

  describe("cleanupOldNotifications", () => {
    it("should delete old read notifications", async () => {
      (NotificationModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 10 });

      const count = await cleanupOldNotifications();

      expect(count).toBe(10);
      expect(NotificationModel.deleteMany).toHaveBeenCalledWith({
        createdAt: { $lt: expect.any(Date) },
        read: true,
      });
    });

    it("should return 0 when no notifications were deleted", async () => {
      (NotificationModel.deleteMany as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ deletedCount: 0 });

      const count = await cleanupOldNotifications();

      expect(count).toBe(0);
    });
  });

  describe("getUnreadNotificationsCount", () => {
    it("should count unread notifications", async () => {
      (NotificationModel.countDocuments as jest.Mock) = jest
        .fn()
        .mockResolvedValue(3);

      const count = await getUnreadNotificationsCount(
        new mongoose.Types.ObjectId(mockUserId),
      );

      expect(count).toBe(3);
      expect(NotificationModel.countDocuments).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        read: false,
      });
    });
  });

  describe("Share-specific notifications", () => {
    describe("notifyShareReceived", () => {
      it("should notify multiple receivers about a share", async () => {
        const receiverIds = [
          new mongoose.Types.ObjectId(),
          new mongoose.Types.ObjectId(),
        ];

        const mockNotification = {
          save: jest.fn().mockResolvedValue({}),
          _id: mockNotificationId,
          createdAt: new Date(),
        };

        (NotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockNotification,
        );

        await notifyShareReceived(
          receiverIds,
          new mongoose.Types.ObjectId(mockSenderId),
          new mongoose.Types.ObjectId(mockShareId),
          "fiche",
          "John Doe",
        );

        expect(NotificationModel).toHaveBeenCalledTimes(2);
        expect(mockNotification.save).toHaveBeenCalledTimes(2);
      });

      it("should handle different data types in message", async () => {
        const mockNotification = {
          save: jest.fn().mockResolvedValue({}),
          _id: mockNotificationId,
          createdAt: new Date(),
        };

        (NotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockNotification,
        );

        // Test with liste
        await notifyShareReceived(
          [new mongoose.Types.ObjectId()],
          new mongoose.Types.ObjectId(mockSenderId),
          new mongoose.Types.ObjectId(mockShareId),
          "liste",
          "Jane Doe",
        );

        expect(NotificationModel).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining("une liste"),
          }),
        );
      });
    });

    describe("notifyShareAccepted", () => {
      it("should notify sender when share is accepted", async () => {
        const mockNotification = {
          save: jest.fn().mockResolvedValue({}),
          _id: mockNotificationId,
          createdAt: new Date(),
        };

        (NotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockNotification,
        );

        await notifyShareAccepted(
          new mongoose.Types.ObjectId(mockSenderId),
          new mongoose.Types.ObjectId(mockUserId),
          new mongoose.Types.ObjectId(mockShareId),
          "John Doe",
        );

        expect(NotificationModel).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "share_accepted",
            title: "Partage accepté",
          }),
        );
      });
    });

    describe("notifyShareDeclined", () => {
      it("should notify sender when share is declined", async () => {
        const mockNotification = {
          save: jest.fn().mockResolvedValue({}),
          _id: mockNotificationId,
          createdAt: new Date(),
        };

        (NotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockNotification,
        );

        await notifyShareDeclined(
          new mongoose.Types.ObjectId(mockSenderId),
          new mongoose.Types.ObjectId(mockUserId),
          new mongoose.Types.ObjectId(mockShareId),
          "Jane Doe",
        );

        expect(NotificationModel).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "share_declined",
            title: "Partage refusé",
          }),
        );
      });
    });

    describe("notifyShareRead", () => {
      it("should notify sender when share is read", async () => {
        const mockNotification = {
          save: jest.fn().mockResolvedValue({}),
          _id: mockNotificationId,
          createdAt: new Date(),
        };

        (NotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockNotification,
        );

        await notifyShareRead(
          new mongoose.Types.ObjectId(mockSenderId),
          new mongoose.Types.ObjectId(mockUserId),
          new mongoose.Types.ObjectId(mockShareId),
          "Bob Smith",
        );

        expect(NotificationModel).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "share_read",
            title: "Partage lu",
          }),
        );
      });
    });
  });
});
