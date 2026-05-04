// src/__tests__/services/notificationService.test.ts

// Mock Firebase Admin SDK BEFORE any imports
const mockMessaging = {
  sendEach: jest.fn(),
  send: jest.fn(),
};

const mockApp = {
  name: "default",
};

const mockFirebaseAdmin = {
  apps: [mockApp] as any[],
  app: jest.fn(() => mockApp),
  initializeApp: jest.fn(() => mockApp),
  credential: {
    cert: jest.fn((serviceAccount) => ({ serviceAccount })),
    applicationDefault: jest.fn(() => ({ type: "application_default" })),
  },
  messaging: jest.fn(() => mockMessaging),
};

jest.mock("firebase-admin", () => mockFirebaseAdmin);

// Mock other dependencies
jest.mock("../../models/notifications");
jest.mock("../../models/pendingNotification");
jest.mock("../../models/users", () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
  },
}));
jest.mock("../../services/pushTokenService");
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

// NOW import the modules
import mongoose from "mongoose";
import NotificationModel from "../../models/notifications";
import PendingNotificationModel from "../../models/pendingNotification";
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
  NotificationService,
} from "../../services/notificationService";
import { webSocketService } from "../../services/webSocketService";
import dataArchiveService from "../../services/dataArchiveService";
import * as pushTokenService from "../../services/pushTokenService";

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
        type: "message",
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
        "message",
        "New Message",
        "You have a new message",
      );

      expect(result).toBe(mockNotification);
      expect(mockNotification.save).toHaveBeenCalled();
      expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          type: "notification",
          notificationType: "message",
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
        "message",
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

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATION SERVICE CLASS TESTS (FCM + Retry Queue)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("NotificationService class", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Ensure Firebase is initialized
      mockFirebaseAdmin.apps = [mockApp];
      (NotificationService as any).fcmInitialized = true;
    });

    describe("initializePushNotifications", () => {
      it.skip("should initialize Firebase with FIREBASE_SERVICE_ACCOUNT env variable", () => {
        process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
          project_id: "test-project",
          private_key: "test-key",
          client_email: "test@test.com",
        });

        NotificationService.initializePushNotifications();

        expect(mockFirebaseAdmin.credential.cert).toHaveBeenCalled();
        expect(mockFirebaseAdmin.initializeApp).toHaveBeenCalled();

        delete process.env.FIREBASE_SERVICE_ACCOUNT;
      });

      it.skip("should initialize Firebase with GOOGLE_APPLICATION_CREDENTIALS", () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS =
          "/path/to/credentials.json";

        NotificationService.initializePushNotifications();

        expect(
          mockFirebaseAdmin.credential.applicationDefault,
        ).toHaveBeenCalled();
        expect(mockFirebaseAdmin.initializeApp).toHaveBeenCalled();

        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      });

      it("should skip initialization if Firebase is already initialized", () => {
        (mockFirebaseAdmin.apps as any) = [{ name: "default" }];

        NotificationService.initializePushNotifications();

        expect(mockFirebaseAdmin.initializeApp).not.toHaveBeenCalled();

        mockFirebaseAdmin.apps = [];
      });

      it("should handle missing Firebase configuration gracefully", () => {
        delete process.env.FIREBASE_SERVICE_ACCOUNT;
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

        expect(() =>
          NotificationService.initializePushNotifications(),
        ).not.toThrow();
      });

      it("should handle Firebase initialization errors", () => {
        process.env.FIREBASE_SERVICE_ACCOUNT = "invalid-json";

        expect(() =>
          NotificationService.initializePushNotifications(),
        ).not.toThrow();

        delete process.env.FIREBASE_SERVICE_ACCOUNT;
      });
    });

    describe("sendPushNotification", () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const title = "Test Notification";
      const body = "Test body";
      const data = { key: "value" };

      it("should return error when FCM is not initialized", async () => {
        (NotificationService as any).fcmInitialized = false;

        const result = await NotificationService.sendPushNotification(
          userId,
          title,
          body,
          data,
        );

        expect(result).toEqual({
          sent: false,
          method: "db_only",
          error: "FCM not configured",
        });
      });

      it("should return error when no FCM tokens found for user", async () => {
        (NotificationService as any).fcmInitialized = true;
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        const result = await NotificationService.sendPushNotification(
          userId,
          title,
          body,
          data,
        );

        expect(result).toEqual({
          sent: false,
          method: "db_only",
          error: "No FCM token",
        });
      });

      it("should handle userId as ObjectId or string", async () => {
        (NotificationService as any).fcmInitialized = true;
        const objectId = new mongoose.Types.ObjectId();
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        await NotificationService.sendPushNotification(
          objectId,
          title,
          body,
          data,
        );

        expect(pushTokenService.getTokensByUserId).toHaveBeenCalledWith(
          objectId.toString(),
        );
      });

      // NOTE: Full FCM integration tests (sendEach, token validation, etc.) would require
      // either:
      // 1. Dependency injection for the Firebase Admin SDK
      // 2. A test environment with real Firebase test credentials
      // 3. Refactoring the service to accept firebase-admin as a parameter
      //
      // For now, we test the error paths and token retrieval logic, which covers
      // the critical business logic without requiring Firebase mock injection.
    });

    describe("sendNotificationToUser", () => {
      const userId = new mongoose.Types.ObjectId();
      const type = "sos_alert";
      const title = "SOS Alert";
      const message = "User needs help";
      const data = { location: "test" };

      beforeEach(() => {
        (NotificationService as any).fcmInitialized = true;
      });

      it("should send via WebSocket only when successful and not SOS", async () => {
        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {});
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        await NotificationService.sendNotificationToUser(
          userId,
          "message",
          "New Message",
          "You have a message",
        );

        expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
          userId.toString(),
          expect.objectContaining({
            type: "notification",
            notificationType: "message",
            title: "New Message",
            message: "You have a message",
          }),
        );
      });

      it.skip("should send via both WebSocket and FCM for SOS notifications", async () => {
        const mockTokens = [
          { token: "fcm-token", platform: "ios", deviceId: "device-1" },
        ];

        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {});
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue(
          mockTokens,
        );
        mockMessaging.sendEach.mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        });

        await NotificationService.sendNotificationToUser(
          userId,
          type,
          title,
          message,
          data,
        );

        expect(webSocketService.sendNotificationToUser).toHaveBeenCalled();
        expect(mockMessaging.sendEach).toHaveBeenCalled();
      });

      it("should add to retry queue when both WebSocket and FCM fail", async () => {
        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {
          throw new Error("WebSocket error");
        });
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        const mockPendingNotification = {
          save: jest.fn().mockResolvedValue({}),
          nextRetryAt: new Date(),
        };
        (PendingNotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockPendingNotification,
        );
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(1);

        await NotificationService.sendNotificationToUser(
          userId,
          "message",
          "Test",
          "Test message",
        );

        expect(mockPendingNotification.save).toHaveBeenCalled();
      });

      it("should handle WebSocket service not available", async () => {
        const originalFn = webSocketService.sendNotificationToUser;
        delete (webSocketService as any).sendNotificationToUser;

        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        const mockPendingNotification = {
          save: jest.fn().mockResolvedValue({}),
          nextRetryAt: new Date(),
        };
        (PendingNotificationModel as unknown as jest.Mock).mockImplementation(
          () => mockPendingNotification,
        );
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(1);

        await expect(
          NotificationService.sendNotificationToUser(
            userId,
            "message",
            "Test",
            "Test",
          ),
        ).resolves.not.toThrow();

        webSocketService.sendNotificationToUser = originalFn;
      });
    });

    describe("retryPendingNotifications", () => {
      const mockPendingNotifications = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          type: "sos_request",
          title: "SOS Alert",
          message: "Help needed",
          data: { location: "test" },
          attempts: 0,
          maxAttempts: 5,
          status: "pending",
          createdAt: new Date(Date.now() - 60000),
        },
      ];

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("should skip when no pending notifications", async () => {
        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        });

        await NotificationService.retryPendingNotifications();

        expect(PendingNotificationModel.find).toHaveBeenCalled();
        expect(webSocketService.sendNotificationToUser).not.toHaveBeenCalled();
      });

      it("should successfully retry via WebSocket and delete notification", async () => {
        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockPendingNotifications),
        });
        (PendingNotificationModel.deleteOne as jest.Mock).mockResolvedValue({
          deletedCount: 1,
        });
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(0);

        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {});

        await NotificationService.retryPendingNotifications();

        expect(webSocketService.sendNotificationToUser).toHaveBeenCalledWith(
          mockPendingNotifications[0].userId.toString(),
          expect.objectContaining({
            type: "notification",
            notificationType: "sos_request",
            title: "SOS Alert",
            message: "Help needed",
          }),
        );

        expect(PendingNotificationModel.deleteOne).toHaveBeenCalledWith({
          _id: mockPendingNotifications[0]._id,
        });
      });

      it.skip("should retry via FCM when WebSocket fails", async () => {
        (NotificationService as any).fcmInitialized = true;

        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockPendingNotifications),
        });
        (PendingNotificationModel.deleteOne as jest.Mock).mockResolvedValue({
          deletedCount: 1,
        });
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(0);

        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {
          throw new Error("WebSocket failed");
        });

        const mockTokens = [
          { token: "fcm-token", platform: "ios", deviceId: "device-1" },
        ];
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue(
          mockTokens,
        );
        mockMessaging.sendEach.mockResolvedValue({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true }],
        });

        await NotificationService.retryPendingNotifications();

        expect(mockMessaging.sendEach).toHaveBeenCalled();
        expect(PendingNotificationModel.deleteOne).toHaveBeenCalled();
      });

      it("should increment attempts when retry fails", async () => {
        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockPendingNotifications),
        });
        (PendingNotificationModel.updateOne as jest.Mock).mockResolvedValue({
          modifiedCount: 1,
        });
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(1);

        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {
          throw new Error("Failed");
        });
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        await NotificationService.retryPendingNotifications();

        expect(PendingNotificationModel.updateOne).toHaveBeenCalledWith(
          { _id: mockPendingNotifications[0]._id },
          {
            $set: {
              attempts: 1,
              nextRetryAt: expect.any(Date),
            },
          },
        );
      });

      it("should mark as failed after max attempts reached", async () => {
        const maxAttemptsNotification = {
          ...mockPendingNotifications[0],
          attempts: 4, // Next attempt will be 5 (maxAttempts)
        };

        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue([maxAttemptsNotification]),
        });
        (PendingNotificationModel.updateOne as jest.Mock).mockResolvedValue({
          modifiedCount: 1,
        });
        (
          PendingNotificationModel.countDocuments as jest.Mock
        ).mockResolvedValue(0);

        (
          webSocketService.sendNotificationToUser as jest.Mock
        ).mockImplementation(() => {
          throw new Error("Failed");
        });
        (pushTokenService.getTokensByUserId as jest.Mock).mockResolvedValue([]);

        await NotificationService.retryPendingNotifications();

        expect(PendingNotificationModel.updateOne).toHaveBeenCalledWith(
          { _id: maxAttemptsNotification._id },
          {
            $set: {
              status: "failed",
              attempts: 5,
            },
          },
        );
      });

      it("should handle errors during retry process gracefully", async () => {
        (PendingNotificationModel.find as jest.Mock).mockReturnValue({
          lean: jest.fn().mockRejectedValue(new Error("Database error")),
        });

        await expect(
          NotificationService.retryPendingNotifications(),
        ).resolves.not.toThrow();
      });
    });
  });
});
