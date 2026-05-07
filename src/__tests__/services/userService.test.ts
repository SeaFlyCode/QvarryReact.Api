// ═══════════════════════════════════════════════════════════════════════════
// TESTS: userService
// ═══════════════════════════════════════════════════════════════════════════

// Mock all dependencies FIRST (before imports)
jest.mock("../../models/users");
jest.mock("../../models/keys", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
  },
}));
jest.mock("../../models/points");
jest.mock("../../models/fiches");
jest.mock("../../models/lists");
jest.mock("../../models/messages");
jest.mock("../../models/conversations");
jest.mock("../../models/dataShare");
jest.mock("../../models/contacts");
jest.mock("../../models/notifications");
jest.mock("../../models/refreshTokens");
jest.mock("../../models/auditLogs");
jest.mock("../../services/dataArchiveService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/rsaEncryptionUtils");
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomBytes: jest.fn((size: number) => ({
    toString: jest.fn(() => "a".repeat(size * 2)),
  })),
}));

import mongoose from "mongoose";
import {
  createUser,
  deleteUserById,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUserById,
} from "../../services/userService";
import UserModel from "../../models/users";
import KeyModel from "../../models/keys";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import MessageModel from "../../models/messages";
import ConversationModel from "../../models/conversations";
import DataShareModel from "../../models/dataShare";
import ContactModel from "../../models/contacts";
import NotificationModel from "../../models/notifications";
import RefreshTokenModel from "../../models/refreshTokens";
import AuditLogModel from "../../models/auditLogs";
import dataArchiveService from "../../services/dataArchiveService";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";
import * as rsaEncryptionUtils from "../../utils/rsaEncryptionUtils";

describe("userService", () => {
  const mockUserId = new mongoose.Types.ObjectId();
  const mockUserData = {
    name: "John",
    surname: "Doe",
    pseudo: "johndoe",
    showPseudo: false,
    email: "encrypted-email",
    emailHash: "hashed-email",
    password: "hashed-password",
    ip_creation: "127.0.0.1",
    creation_date: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // createUser - Création utilisateur avec clés RSA/AES
  // ═════════════════════════════════════════════════════════════════════════

  describe("createUser", () => {
    beforeEach(() => {
      // resetMocks: true clears jest.mock factory implementations, re-setup here
      const crypto = require("crypto");
      crypto.randomBytes.mockImplementation((size: number) => ({
        toString: jest.fn(() => "a".repeat(size * 2)),
      }));

      // Re-setup KeyModel.create to return resolved promise
      (KeyModel.create as jest.Mock).mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        key: "mocked-key",
      });
    });

    it("creates user with AES-256 and RSA-4096 keys successfully", async () => {
      const newUser = { _id: mockUserId, ...mockUserData };

      (UserModel.create as jest.Mock).mockResolvedValue(newUser);
      (KeyModel.create as jest.Mock).mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        key: "mocked-key",
      });
      (masterEncryptionUtils.encrypt as jest.Mock).mockReturnValue(
        "encrypted-aes-key",
      );
      (rsaEncryptionUtils.generateRSAKeyPair as jest.Mock).mockReturnValue({
        publicKey: "rsa-public-key",
        privateKey: "rsa-private-key",
      });
      (rsaEncryptionUtils.encryptPrivateKey as jest.Mock).mockReturnValue(
        "encrypted-rsa-private-key",
      );

      const result = await createUser(mockUserData as any);

      expect(UserModel.create).toHaveBeenCalledWith(mockUserData);
      expect(masterEncryptionUtils.encrypt).toHaveBeenCalledWith(
        "a".repeat(64),
      ); // 32 bytes * 2 hex chars
      expect(rsaEncryptionUtils.generateRSAKeyPair).toHaveBeenCalled();
      expect(rsaEncryptionUtils.encryptPrivateKey).toHaveBeenCalledWith(
        "rsa-private-key",
      );

      // Verify 3 keys created: AES, RSA public, RSA private
      expect(KeyModel.create).toHaveBeenCalledTimes(3);
      expect(KeyModel.create).toHaveBeenCalledWith({
        userId: mockUserId,
        key: "encrypted-aes-key",
        type: "user",
        date: expect.any(Date),
      });
      expect(KeyModel.create).toHaveBeenCalledWith({
        userId: mockUserId,
        key: "rsa-public-key",
        type: "rsa-public",
        date: expect.any(Date),
      });
      expect(KeyModel.create).toHaveBeenCalledWith({
        userId: mockUserId,
        key: "encrypted-rsa-private-key",
        type: "rsa-private",
        date: expect.any(Date),
      });

      expect(result).toEqual(newUser);
    });

    it("rolls back user creation if key generation fails", async () => {
      const newUser = { _id: mockUserId, ...mockUserData };

      (UserModel.create as jest.Mock).mockResolvedValue(newUser);
      (masterEncryptionUtils.encrypt as jest.Mock).mockReturnValue(
        "encrypted-aes-key",
      );
      (rsaEncryptionUtils.generateRSAKeyPair as jest.Mock).mockReturnValue({
        publicKey: "rsa-public-key",
        privateKey: "rsa-private-key",
      });
      (rsaEncryptionUtils.encryptPrivateKey as jest.Mock).mockReturnValue(
        "encrypted-rsa-private-key",
      );
      // Override the beforeEach setup to simulate failure
      (KeyModel.create as jest.Mock).mockRejectedValue(
        new Error("Key creation failed"),
      );
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(newUser);

      await expect(createUser(mockUserData as any)).rejects.toThrow(
        "Erreur lors de la création du compte utilisateur",
      );

      expect(UserModel.findByIdAndDelete).toHaveBeenCalledWith(mockUserId);
    });

    it("creates keys in parallel using Promise.all", async () => {
      const newUser = { _id: mockUserId, ...mockUserData };

      (UserModel.create as jest.Mock).mockResolvedValue(newUser);
      (masterEncryptionUtils.encrypt as jest.Mock).mockReturnValue(
        "encrypted-aes-key",
      );
      (rsaEncryptionUtils.generateRSAKeyPair as jest.Mock).mockReturnValue({
        publicKey: "rsa-public-key",
        privateKey: "rsa-private-key",
      });
      (rsaEncryptionUtils.encryptPrivateKey as jest.Mock).mockReturnValue(
        "encrypted-rsa-private-key",
      );

      await createUser(mockUserData as any);

      // All 3 KeyModel.create calls should happen
      expect(KeyModel.create).toHaveBeenCalledTimes(3);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // deleteUserById - Suppression RGPD cascade complète
  // ═════════════════════════════════════════════════════════════════════════

  describe("deleteUserById", () => {
    it("throws error for invalid ObjectId", async () => {
      await expect(deleteUserById("invalid-id")).rejects.toThrow(
        "L'ID utilisateur fourni n'est pas valide.",
      );
    });

    it("deletes user and all related data (RGPD cascade)", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 5,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 3,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 2,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 10,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 2,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 4,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 7,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 2,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 3 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 15,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      const result = await deleteUserById(userId);

      expect(result.success).toBe(true);
      expect(result.deletedData).toEqual({
        points: 5,
        fiches: 3,
        lists: 2,
        messages: 10,
        conversations: 2,
        dataShares: 1,
        contacts: 4,
        notifications: 7,
        refreshTokens: 2,
        keys: 3,
        auditLogs: 15,
      });
    });

    it("archives user data before deletion", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      await deleteUserById(userId);

      expect(dataArchiveService.archiveAndRecordDeletion).toHaveBeenCalledWith(
        "user",
        mockUserId,
        mockUser,
        mockUserId,
        { reason: "Suppression RGPD - Droit à l'effacement (Art. 17)" },
      );
    });

    it("archives points with cascade metadata", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };
      const mockPoints = [
        { _id: new mongoose.Types.ObjectId(), name: "Point 1" },
        { _id: new mongoose.Types.ObjectId(), name: "Point 2" },
      ];

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (dataArchiveService.archiveEntity as jest.Mock).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockPoints),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 2,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      await deleteUserById(userId);

      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "point",
        mockPoints[0]._id,
        mockPoints[0],
        mockUserId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: mockUserId,
        },
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "point",
        mockPoints[1]._id,
        mockPoints[1],
        mockUserId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: mockUserId,
        },
      );
    });

    it("archives fiches, lists, messages, dataShares, contacts, notifications", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };
      const mockFiches = [
        { _id: new mongoose.Types.ObjectId(), name: "Fiche 1" },
      ];
      const mockLists = [
        { _id: new mongoose.Types.ObjectId(), name: "List 1" },
      ];
      const mockMessages = [
        { _id: new mongoose.Types.ObjectId(), text: "Message 1" },
      ];
      const mockDataShares = [
        { _id: new mongoose.Types.ObjectId(), status: "active" },
      ];
      const mockContacts = [
        { _id: new mongoose.Types.ObjectId(), name: "Contact 1" },
      ];
      const mockNotifications = [
        { _id: new mongoose.Types.ObjectId(), message: "Notif 1" },
      ];

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (dataArchiveService.archiveEntity as jest.Mock).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockFiches),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockLists),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMessages),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockDataShares),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockContacts),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockNotifications),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      await deleteUserById(userId);

      // Verify archiving for each entity type
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "fiche",
        mockFiches[0]._id,
        mockFiches[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "list",
        mockLists[0]._id,
        mockLists[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "message",
        mockMessages[0]._id,
        mockMessages[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "dataShare",
        mockDataShares[0]._id,
        mockDataShares[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "contact",
        mockContacts[0]._id,
        mockContacts[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
      expect(dataArchiveService.archiveEntity).toHaveBeenCalledWith(
        "notification",
        mockNotifications[0]._id,
        mockNotifications[0],
        mockUserId,
        expect.objectContaining({
          reason: "Suppression RGPD - cascade utilisateur",
        }),
      );
    });

    it("removes user from conversations (does not delete conversations)", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 3,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      const result = await deleteUserById(userId);

      expect(ConversationModel.updateMany).toHaveBeenCalledWith(
        { participants: mockUserId },
        { $pull: { participants: mockUserId } },
      );
      expect(result.deletedData.conversations).toBe(3);
    });

    it("anonymizes audit logs (does not delete them)", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 20,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      const result = await deleteUserById(userId);

      expect(AuditLogModel.updateMany).toHaveBeenCalledWith(
        { userId: mockUserId },
        {
          $set: {
            userId: null,
            details: "[RGPD] Données anonymisées suite à suppression de compte",
          },
        },
      );
      expect(result.deletedData.auditLogs).toBe(20);
    });

    it("deletes all encryption keys (AES + RSA)", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 3 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      const result = await deleteUserById(userId);

      expect(KeyModel.deleteMany).toHaveBeenCalledWith({ userId: mockUserId });
      expect(result.deletedData.keys).toBe(3);
    });

    it("throws error if user not found", async () => {
      const userId = mockUserId.toString();

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(null);

      await expect(deleteUserById(userId)).rejects.toThrow(
        "Utilisateur non trouvé.",
      );
    });

    it("deletes dataShares where user is sender or recipient", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 5,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      await deleteUserById(userId);

      expect(DataShareModel.deleteMany).toHaveBeenCalledWith({
        $or: [{ senderId: mockUserId }, { recipientId: mockUserId }],
      });
    });

    it("deletes contacts where user is owner or contact", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });
      (
        dataArchiveService.archiveAndRecordDeletion as jest.Mock
      ).mockResolvedValue({});
      (PointModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        setOptions: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      (MessageModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (DataShareModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (ContactModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      (NotificationModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      (PointModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (FicheModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ListModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (MessageModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ConversationModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (DataShareModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (ContactModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 8,
      });
      (NotificationModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (RefreshTokenModel.deleteMany as jest.Mock).mockResolvedValue({
        deletedCount: 0,
      });
      (KeyModel.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
      (AuditLogModel.updateMany as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });
      (UserModel.findByIdAndDelete as jest.Mock).mockResolvedValue(mockUser);

      await deleteUserById(userId);

      expect(ContactModel.deleteMany).toHaveBeenCalledWith({
        $or: [{ userId: mockUserId }, { contactId: mockUserId }],
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getAllUsers
  // ═════════════════════════════════════════════════════════════════════════

  describe("getAllUsers", () => {
    it("returns all users", async () => {
      const mockUsers = [
        { _id: mockUserId, ...mockUserData },
        {
          _id: new mongoose.Types.ObjectId(),
          name: "Jane",
          email: "jane@test.com",
        },
      ];

      (UserModel.find as jest.Mock).mockResolvedValue(mockUsers);

      const result = await getAllUsers();

      expect(UserModel.find).toHaveBeenCalledWith({});
      expect(result).toEqual(mockUsers);
    });

    it("returns empty array when no users exist", async () => {
      (UserModel.find as jest.Mock).mockResolvedValue([]);

      const result = await getAllUsers();

      expect(result).toEqual([]);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getUserByEmail - Recherche par hash avec fallback migration
  // ═════════════════════════════════════════════════════════════════════════

  describe("getUserByEmail", () => {
    it("finds user by emailHash (fast lookup)", async () => {
      const email = "john.doe@test.com";
      const mockUser = { _id: mockUserId, ...mockUserData };

      (masterEncryptionUtils.hashEmail as jest.Mock).mockReturnValue(
        "hashed-email",
      );
      (UserModel.findOne as jest.Mock).mockResolvedValue(mockUser);

      const result = await getUserByEmail(email);

      expect(masterEncryptionUtils.hashEmail).toHaveBeenCalledWith(email);
      expect(UserModel.findOne).toHaveBeenCalledWith({
        emailHash: "hashed-email",
      });
      expect(result).toEqual(mockUser);
    });

    it("falls back to decryption scan for users without emailHash", async () => {
      const email = "john.doe@test.com";
      const mockUser = {
        _id: mockUserId,
        ...mockUserData,
        emailHash: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (masterEncryptionUtils.hashEmail as jest.Mock).mockReturnValue(
        "hashed-email",
      );
      (UserModel.findOne as jest.Mock).mockResolvedValue(null); // No hash match
      (UserModel.find as jest.Mock).mockResolvedValue([mockUser]);
      (masterEncryptionUtils.decrypt as jest.Mock).mockReturnValue(email);

      const result = await getUserByEmail(email);

      expect(UserModel.find).toHaveBeenCalledWith({
        emailHash: { $exists: false },
      });
      expect(masterEncryptionUtils.decrypt).toHaveBeenCalledWith(
        mockUser.email,
      );
      expect(mockUser.save).toHaveBeenCalled(); // Migrates user by adding hash
      expect(result).toEqual(mockUser);
    });

    it("migrates user by adding emailHash during fallback", async () => {
      const email = "john.doe@test.com";
      const mockUser = {
        _id: mockUserId,
        ...mockUserData,
        emailHash: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (masterEncryptionUtils.hashEmail as jest.Mock).mockReturnValue(
        "new-hashed-email",
      );
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);
      (UserModel.find as jest.Mock).mockResolvedValue([mockUser]);
      (masterEncryptionUtils.decrypt as jest.Mock).mockReturnValue(email);

      await getUserByEmail(email);

      expect(mockUser.emailHash).toBe("new-hashed-email");
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("returns null if user not found by hash or decryption", async () => {
      const email = "nonexistent@test.com";

      (masterEncryptionUtils.hashEmail as jest.Mock).mockReturnValue(
        "hashed-email",
      );
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);
      (UserModel.find as jest.Mock).mockResolvedValue([]);

      const result = await getUserByEmail(email);

      expect(result).toBeNull();
    });

    it("throws error for invalid email input", async () => {
      await expect(getUserByEmail("")).rejects.toThrow(
        "L'email fourni n'est pas valide.",
      );
      await expect(getUserByEmail(null as any)).rejects.toThrow(
        "L'email fourni n'est pas valide.",
      );
      await expect(getUserByEmail(undefined as any)).rejects.toThrow(
        "L'email fourni n'est pas valide.",
      );
      await expect(getUserByEmail(123 as any)).rejects.toThrow(
        "L'email fourni n'est pas valide.",
      );
    });

    it("scans multiple users without emailHash during fallback", async () => {
      const email = "jane@test.com";
      const mockUser1 = {
        _id: mockUserId,
        email: "encrypted-email-1",
        save: jest.fn(),
      };
      const mockUser2 = {
        _id: new mongoose.Types.ObjectId(),
        email: "encrypted-email-2",
        save: jest.fn(),
      };

      (masterEncryptionUtils.hashEmail as jest.Mock).mockReturnValue(
        "hashed-email",
      );
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);
      (UserModel.find as jest.Mock).mockResolvedValue([mockUser1, mockUser2]);
      (masterEncryptionUtils.decrypt as jest.Mock)
        .mockReturnValueOnce("john@test.com") // mockUser1
        .mockReturnValueOnce("jane@test.com"); // mockUser2

      const result = await getUserByEmail(email);

      expect(masterEncryptionUtils.decrypt).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockUser2);
      expect(mockUser2.save).toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // getUserById
  // ═════════════════════════════════════════════════════════════════════════

  describe("getUserById", () => {
    it("returns user by valid ObjectId", async () => {
      const userId = mockUserId.toString();
      const mockUser = { _id: mockUserId, ...mockUserData };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await getUserById(userId);

      expect(UserModel.findById).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockUser);
    });

    it("throws error for invalid ObjectId", async () => {
      await expect(getUserById("invalid-id")).rejects.toThrow(
        "L'ID fourni n'est pas valide.",
      );
    });

    it("returns null if user not found", async () => {
      const userId = mockUserId.toString();

      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      const result = await getUserById(userId);

      expect(result).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // updateUserById
  // ═════════════════════════════════════════════════════════════════════════

  describe("updateUserById", () => {
    it("updates user successfully", async () => {
      const userId = mockUserId.toString();
      const updatedData = { name: "Jane", surname: "Smith" };

      (UserModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      await updateUserById(userId, updatedData);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId },
        { $set: updatedData },
      );
    });

    it("throws error for invalid ObjectId", async () => {
      await expect(updateUserById("invalid-id", {})).rejects.toThrow(
        "L'ID fourni n'est pas valide.",
      );
    });

    it("throws error if user not found", async () => {
      const userId = mockUserId.toString();

      (UserModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      await expect(updateUserById(userId, { name: "Jane" })).rejects.toThrow(
        "Aucun utilisateur trouvé avec cet ID ou aucune mise à jour effectuée.",
      );
    });

    it("throws error if no modifications made", async () => {
      const userId = mockUserId.toString();

      (UserModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      await expect(updateUserById(userId, {})).rejects.toThrow(
        "Aucun utilisateur trouvé avec cet ID ou aucune mise à jour effectuée.",
      );
    });

    it("updates partial user data", async () => {
      const userId = mockUserId.toString();
      const partialUpdate = { pseudo: "newpseudo", showPseudo: true };

      (UserModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      await updateUserById(userId, partialUpdate);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId },
        { $set: partialUpdate },
      );
    });
  });
});
