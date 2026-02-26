/**
 * Comprehensive Unit Tests for ALL Mongoose Models
 *
 * These tests validate schema definitions WITHOUT connecting to a real database.
 * We use Mongoose's validateSync() method and verify schema paths/options.
 *
 * Coverage: 18 models total
 */

// ═══════════════════════════════════════════════════════════════════════════
// SETUP & MOCKS
// ═══════════════════════════════════════════════════════════════════════════

// Set environment variables BEFORE any imports
process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";
process.env.JWT_SECRET = "test-jwt-secret";

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import UserModel from "../../models/users";
import FicheModel from "../../models/fiches";
import PointModel from "../../models/points";
import ContactModel from "../../models/contacts";
import ConversationModel from "../../models/conversations";
import MessageModel from "../../models/messages";
import DataShareModel from "../../models/dataShare";
import NotificationModel from "../../models/notifications";
import RefreshTokenModel from "../../models/refreshTokens";
import AuditLogModel from "../../models/auditLogs";
import BlockedIpModel from "../../models/blockedIps";
import KeysModel from "../../models/keys";
import MaintenanceModel from "../../models/maintenance";
import DeletedDataModel from "../../models/deletedData";
import ListModel from "../../models/lists";
import SosSessionModel from "../../models/sosSession";
import SosEventModel from "../../models/sosEvent";
import SosContactModel from "../../models/sosContact";

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

describe("Mongoose Models - Schema Validation Tests", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. USER MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("User Model", () => {
    it("should be defined with correct model name", () => {
      expect(UserModel).toBeDefined();
      expect(UserModel.modelName).toBe("User");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(UserModel.schema.paths);
      expect(paths).toContain("name");
      expect(paths).toContain("surname");
      expect(paths).toContain("password");
      expect(paths).toContain("email");
      expect(paths).toContain("ip_creation");
      expect(paths).toContain("ip_last_connection");
    });

    it("should have correct default values", () => {
      const user = new UserModel({
        name: "John",
        surname: "Doe",
        password: "hashedpassword",
        email: "john@example.com",
        ip_creation: "127.0.0.1",
        ip_last_connection: "127.0.0.1",
      });

      expect(user.is_admin).toBe(false);
      expect(user.is_blocked).toBe(false);
      expect(user.is_verified).toBe(false);
      expect(user.gdpr_consent).toBe(false);
      expect(user.two_factor_enabled).toBe(false);
    });

    it("should validate required fields", () => {
      const user = new UserModel({});
      const validationError = user.validateSync();

      expect(validationError).toBeDefined();
      expect(validationError?.errors.name).toBeDefined();
      expect(validationError?.errors.surname).toBeDefined();
      expect(validationError?.errors.password).toBeDefined();
      expect(validationError?.errors.email).toBeDefined();
      expect(validationError?.errors.ip_creation).toBeDefined();
      expect(validationError?.errors.ip_last_connection).toBeDefined();
    });

    it("should create a valid user document", () => {
      const user = new UserModel({
        name: "Jane",
        surname: "Smith",
        password: "hashedpassword123",
        email: "jane@example.com",
        ip_creation: "192.168.1.1",
        ip_last_connection: "192.168.1.1",
        is_admin: true,
        gdpr_consent: true,
      });

      const validationError = user.validateSync();
      expect(validationError).toBeUndefined();
      expect(user.name).toBe("Jane");
      expect(user.surname).toBe("Smith");
      expect(user.is_admin).toBe(true);
      expect(user.gdpr_consent).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. FICHE MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Fiche Model", () => {
    it("should be defined with correct model name", () => {
      expect(FicheModel).toBeDefined();
      expect(FicheModel.modelName).toBe("Fiche");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(FicheModel.schema.paths);
      expect(paths).toContain("name");
      expect(paths).toContain("ville");
      expect(paths).toContain("type");
      expect(paths).toContain("etat");
      expect(paths).toContain("userId");
      expect(paths).toContain("difficulte_acces");
      expect(paths).toContain("risque_oxygene");
      expect(paths).toContain("acces_souterrain");
      expect(paths).toContain("praticite_souterrain");
      expect(paths).toContain("etat_general");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const fiche = new FicheModel({
        name: "Test Fiche",
        ville: "Paris",
        type: "Carrière",
        etat: "Bon",
        userId,
        difficulte_acces: "Facile",
        risque_oxygene: "Faible",
        acces_souterrain: "Vertical",
        praticite_souterrain: "Bonne",
        etat_general: "Stable",
      });

      expect(fiche.deletedAt).toBeNull();
      expect(fiche.version).toBe(1);
      expect(fiche.points_ids).toEqual([]);
    });

    it("should validate required fields", () => {
      const fiche = new FicheModel({});
      const validationError = fiche.validateSync();

      expect(validationError).toBeDefined();
      expect(validationError?.errors.name).toBeDefined();
      expect(validationError?.errors.ville).toBeDefined();
      expect(validationError?.errors.type).toBeDefined();
      expect(validationError?.errors.etat).toBeDefined();
      expect(validationError?.errors.userId).toBeDefined();
    });

    it("should create a valid fiche document", () => {
      const userId = new mongoose.Types.ObjectId();
      const fiche = new FicheModel({
        name: "Carrière de Test",
        ville: "Lyon",
        type: "Mine",
        etat: "Excellent",
        userId,
        difficulte_acces: "Moyenne",
        risque_oxygene: "Moyen",
        acces_souterrain: "Horizontal",
        praticite_souterrain: "Moyenne",
        etat_general: "Bon",
        commentaire: "Très intéressant",
      });

      const validationError = fiche.validateSync();
      expect(validationError).toBeUndefined();
      expect(fiche.name).toBe("Carrière de Test");
      expect(fiche.ville).toBe("Lyon");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POINT MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Point Model", () => {
    it("should be defined with correct model name", () => {
      expect(PointModel).toBeDefined();
      expect(PointModel.modelName).toBe("Point");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(PointModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("name");
      expect(paths).toContain("location_encrypted");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const point = new PointModel({
        userId,
        name: "Test Point",
        location_encrypted: "encrypted_data_here",
      });

      expect(point.deletedAt).toBeNull();
      expect(point.version).toBe(1);
      expect(point.description).toBe("");
    });

    it("should validate required fields", () => {
      const point = new PointModel({});
      const validationError = point.validateSync();

      expect(validationError).toBeDefined();
      expect(validationError?.errors.userId).toBeDefined();
      expect(validationError?.errors.name).toBeDefined();
      expect(validationError?.errors.location_encrypted).toBeDefined();
    });

    it("should create a valid point document", () => {
      const userId = new mongoose.Types.ObjectId();
      const point = new PointModel({
        userId,
        name: "Entrance Point",
        location_encrypted: "encrypted_coords",
        description: "Main entrance",
        accessType: "Vertical",
      });

      const validationError = point.validateSync();
      expect(validationError).toBeUndefined();
      expect(point.name).toBe("Entrance Point");
      expect(point.description).toBe("Main entrance");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CONTACT MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Contact Model", () => {
    it("should be defined with correct model name", () => {
      expect(ContactModel).toBeDefined();
      expect(ContactModel.modelName).toBe("Contact");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(ContactModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("contactId");
      expect(paths).toContain("status");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const contactId = new mongoose.Types.ObjectId();
      const contact = new ContactModel({
        userId,
        contactId,
        status: "pending",
      });

      expect(contact.isBlocked).toBe(false);
    });

    it("should validate status enum", () => {
      const userId = new mongoose.Types.ObjectId();
      const contactId = new mongoose.Types.ObjectId();
      const contact = new ContactModel({
        userId,
        contactId,
        status: "invalid_status" as any,
      });

      const validationError = contact.validateSync();
      expect(validationError).toBeDefined();
      expect(validationError?.errors.status).toBeDefined();
    });

    it("should create a valid contact document", () => {
      const userId = new mongoose.Types.ObjectId();
      const contactId = new mongoose.Types.ObjectId();
      const contact = new ContactModel({
        userId,
        contactId,
        status: "accepted",
        isBlocked: false,
      });

      const validationError = contact.validateSync();
      expect(validationError).toBeUndefined();
      expect(contact.status).toBe("accepted");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. CONVERSATION MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Conversation Model", () => {
    it("should be defined with correct model name", () => {
      expect(ConversationModel).toBeDefined();
      expect(ConversationModel.modelName).toBe("Conversation");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(ConversationModel.schema.paths);
      expect(paths).toContain("isGroup");
      expect(paths).toContain("participants");
      expect(paths).toContain("creatorId");
    });

    it("should create a valid conversation document", () => {
      const creatorId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const conversation = new ConversationModel({
        isGroup: false,
        creatorId,
        participants: [
          {
            userId,
            role: "admin",
            joinedAt: new Date(),
          },
        ],
      });

      const validationError = conversation.validateSync();
      expect(validationError).toBeUndefined();
      expect(conversation.isGroup).toBe(false);
      expect(conversation.participants.length).toBe(1);
    });

    it("should validate participant role enum", () => {
      const creatorId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const conversation = new ConversationModel({
        isGroup: true,
        creatorId,
        participants: [
          {
            userId,
            role: "invalid_role" as any,
            joinedAt: new Date(),
          },
        ],
      });

      const validationError = conversation.validateSync();
      expect(validationError).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. MESSAGE MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Message Model", () => {
    it("should be defined with correct model name", () => {
      expect(MessageModel).toBeDefined();
      expect(MessageModel.modelName).toBe("Message");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(MessageModel.schema.paths);
      expect(paths).toContain("conversationId");
      expect(paths).toContain("senderId");
      expect(paths).toContain("content");
      expect(paths).toContain("type");
    });

    it("should have correct default values", () => {
      const conversationId = new mongoose.Types.ObjectId();
      const senderId = new mongoose.Types.ObjectId();
      const message = new MessageModel({
        conversationId,
        senderId,
        content: "Hello world",
      });

      expect(message.type).toBe("text");
      expect(message.readBy).toEqual([]);
      expect(message.replies).toEqual([]);
    });

    it("should validate message type enum", () => {
      const conversationId = new mongoose.Types.ObjectId();
      const senderId = new mongoose.Types.ObjectId();
      const message = new MessageModel({
        conversationId,
        senderId,
        content: "Test",
        type: "invalid_type" as any,
      });

      const validationError = message.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid message document", () => {
      const conversationId = new mongoose.Types.ObjectId();
      const senderId = new mongoose.Types.ObjectId();
      const message = new MessageModel({
        conversationId,
        senderId,
        content: "Test message",
        type: "text",
      });

      const validationError = message.validateSync();
      expect(validationError).toBeUndefined();
      expect(message.content).toBe("Test message");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. DATA SHARE MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("DataShare Model", () => {
    it("should be defined with correct model name", () => {
      expect(DataShareModel).toBeDefined();
      expect(DataShareModel.modelName).toBe("DataShare");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(DataShareModel.schema.paths);
      expect(paths).toContain("senderId");
      expect(paths).toContain("receiverIds");
      expect(paths).toContain("dataType");
      expect(paths).toContain("dataId");
      expect(paths).toContain("signature");
      expect(paths).toContain("dataHash");
    });

    it("should validate dataType enum", () => {
      const senderId = new mongoose.Types.ObjectId();
      const receiverId = new mongoose.Types.ObjectId();
      const dataId = new mongoose.Types.ObjectId();
      const dataShare = new DataShareModel({
        senderId,
        receiverIds: [receiverId],
        dataType: "invalid_type" as any,
        dataId,
        signature: "test_signature",
        dataHash: "test_hash",
        encryptedDataPerReceiver: [],
        expiresAt: new Date(),
      });

      const validationError = dataShare.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid dataShare document", () => {
      const senderId = new mongoose.Types.ObjectId();
      const receiverId = new mongoose.Types.ObjectId();
      const dataId = new mongoose.Types.ObjectId();
      const dataShare = new DataShareModel({
        senderId,
        receiverIds: [receiverId],
        dataType: "fiche",
        dataId,
        signature: "valid_signature",
        dataHash: "valid_hash",
        encryptedDataPerReceiver: [
          {
            receiverId,
            encryptedData: "encrypted_content",
            status: "pending",
          },
        ],
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      });

      const validationError = dataShare.validateSync();
      expect(validationError).toBeUndefined();
      expect(dataShare.dataType).toBe("fiche");
      expect(dataShare.isActive).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. NOTIFICATION MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Notification Model", () => {
    it("should be defined with correct model name", () => {
      expect(NotificationModel).toBeDefined();
      expect(NotificationModel.modelName).toBe("Notification");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(NotificationModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("type");
      expect(paths).toContain("title");
      expect(paths).toContain("message");
      expect(paths).toContain("read");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const notification = new NotificationModel({
        userId,
        type: "contact_request",
        title: "New Contact Request",
        message: "Someone wants to connect",
      });

      expect(notification.read).toBe(false);
    });

    it("should validate notification type enum", () => {
      const userId = new mongoose.Types.ObjectId();
      const notification = new NotificationModel({
        userId,
        type: "invalid_type" as any,
        title: "Test",
        message: "Test message",
      });

      const validationError = notification.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid notification document", () => {
      const userId = new mongoose.Types.ObjectId();
      const notification = new NotificationModel({
        userId,
        type: "share_received",
        title: "New Share",
        message: "You received a new share",
        read: false,
      });

      const validationError = notification.validateSync();
      expect(validationError).toBeUndefined();
      expect(notification.type).toBe("share_received");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. REFRESH TOKEN MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("RefreshToken Model", () => {
    it("should be defined with correct model name", () => {
      expect(RefreshTokenModel).toBeDefined();
      expect(RefreshTokenModel.modelName).toBe("RefreshToken");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(RefreshTokenModel.schema.paths);
      expect(paths).toContain("tokenId");
      expect(paths).toContain("userId");
      expect(paths).toContain("token");
      expect(paths).toContain("expiresAt");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const refreshToken = new RefreshTokenModel({
        tokenId: "unique-token-id",
        userId,
        token: "hashed_token",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      expect(refreshToken.revoked).toBe(false);
    });

    it("should create a valid refreshToken document", () => {
      const userId = new mongoose.Types.ObjectId();
      const refreshToken = new RefreshTokenModel({
        tokenId: "test-token-id",
        userId,
        token: "hashed_refresh_token",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });

      const validationError = refreshToken.validateSync();
      expect(validationError).toBeUndefined();
      expect(refreshToken.tokenId).toBe("test-token-id");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. AUDIT LOG MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("AuditLog Model", () => {
    it("should be defined with correct model name", () => {
      expect(AuditLogModel).toBeDefined();
      expect(AuditLogModel.modelName).toBe("AuditLog");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(AuditLogModel.schema.paths);
      expect(paths).toContain("action");
      expect(paths).toContain("level");
      expect(paths).toContain("timestamp");
    });

    it("should have correct default values", () => {
      const auditLog = new AuditLogModel({
        action: "user_login",
      });

      expect(auditLog.level).toBe("info");
    });

    it("should validate level enum", () => {
      const auditLog = new AuditLogModel({
        action: "test_action",
        level: "invalid_level" as any,
      });

      const validationError = auditLog.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid auditLog document", () => {
      const userId = new mongoose.Types.ObjectId();
      const auditLog = new AuditLogModel({
        userId,
        action: "data_access",
        level: "warning",
        ipAddress: "10.0.0.1",
        userAgent: "Test Agent",
        details: { resource: "fiches" },
      });

      const validationError = auditLog.validateSync();
      expect(validationError).toBeUndefined();
      expect(auditLog.action).toBe("data_access");
      expect(auditLog.level).toBe("warning");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. BLOCKED IP MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("BlockedIp Model", () => {
    it("should be defined with correct model name", () => {
      expect(BlockedIpModel).toBeDefined();
      expect(BlockedIpModel.modelName).toBe("BlockedIp");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(BlockedIpModel.schema.paths);
      expect(paths).toContain("ipAddress");
      expect(paths).toContain("reason");
      expect(paths).toContain("blockedBy");
      expect(paths).toContain("attackType");
    });

    it("should have correct default values", () => {
      const blockedIp = new BlockedIpModel({
        ipAddress: "192.168.1.100",
        reason: "Brute force attack",
        attackType: "brute_force",
      });

      expect(blockedIp.blockedBy).toBe("auto");
      expect(blockedIp.isActive).toBe(true);
      expect(blockedIp.attemptCount).toBe(1);
    });

    it("should validate blockedBy enum", () => {
      const blockedIp = new BlockedIpModel({
        ipAddress: "10.0.0.1",
        reason: "Test",
        attackType: "test",
        blockedBy: "invalid" as any,
      });

      const validationError = blockedIp.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid blockedIp document", () => {
      const blockedIp = new BlockedIpModel({
        ipAddress: "192.168.1.50",
        reason: "SQL injection attempt",
        attackType: "sql_injection",
        blockedBy: "admin",
        attemptCount: 5,
        isActive: true,
      });

      const validationError = blockedIp.validateSync();
      expect(validationError).toBeUndefined();
      expect(blockedIp.ipAddress).toBe("192.168.1.50");
      expect(blockedIp.blockedBy).toBe("admin");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. KEYS MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Keys Model", () => {
    it("should be defined with correct model name", () => {
      expect(KeysModel).toBeDefined();
      expect(KeysModel.modelName).toBe("Keys");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(KeysModel.schema.paths);
      expect(paths).toContain("key");
      expect(paths).toContain("type");
      expect(paths).toContain("date");
    });

    it("should validate type enum", () => {
      const key = new KeysModel({
        key: "test_key_data",
        type: "invalid_type" as any,
      });

      const validationError = key.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid key document", () => {
      const userId = new mongoose.Types.ObjectId();
      const key = new KeysModel({
        userId,
        key: "encrypted_key_content",
        type: "rsa-public",
      });

      const validationError = key.validateSync();
      expect(validationError).toBeUndefined();
      expect(key.type).toBe("rsa-public");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 13. MAINTENANCE MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("Maintenance Model", () => {
    it("should be defined with correct model name", () => {
      expect(MaintenanceModel).toBeDefined();
      expect(MaintenanceModel.modelName).toBe("Maintenance");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(MaintenanceModel.schema.paths);
      expect(paths).toContain("isActive");
      expect(paths).toContain("message");
    });

    it("should have correct default values", () => {
      const maintenance = new MaintenanceModel({
        isActive: false,
      });

      expect(maintenance.isActive).toBe(false);
      expect(maintenance.message).toContain("maintenance");
    });

    it("should create a valid maintenance document", () => {
      const activatedBy = new mongoose.Types.ObjectId();
      const maintenance = new MaintenanceModel({
        isActive: true,
        message: "Scheduled maintenance",
        activatedBy,
        activatedAt: new Date(),
      });

      const validationError = maintenance.validateSync();
      expect(validationError).toBeUndefined();
      expect(maintenance.isActive).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 14. DELETED DATA MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("DeletedData Model", () => {
    it("should be defined with correct model name", () => {
      expect(DeletedDataModel).toBeDefined();
      expect(DeletedDataModel.modelName).toBe("DeletedData");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(DeletedDataModel.schema.paths);
      expect(paths).toContain("entityType");
      expect(paths).toContain("entityId");
      expect(paths).toContain("data");
      expect(paths).toContain("deletedBy");
    });

    it("should have correct default values", () => {
      const entityId = new mongoose.Types.ObjectId();
      const deletedBy = new mongoose.Types.ObjectId();
      const deletedData = new DeletedDataModel({
        entityType: "fiche",
        entityId,
        data: { name: "Test Fiche" },
        deletedBy,
      });

      expect(deletedData.isRestored).toBe(false);
    });

    it("should validate entityType enum", () => {
      const entityId = new mongoose.Types.ObjectId();
      const deletedBy = new mongoose.Types.ObjectId();
      const deletedData = new DeletedDataModel({
        entityType: "invalid_type" as any,
        entityId,
        data: {},
        deletedBy,
      });

      const validationError = deletedData.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid deletedData document", () => {
      const entityId = new mongoose.Types.ObjectId();
      const deletedBy = new mongoose.Types.ObjectId();
      const deletedData = new DeletedDataModel({
        entityType: "point",
        entityId,
        data: { name: "Deleted Point", location: "test" },
        deletedBy,
        deletionReason: "User requested",
      });

      const validationError = deletedData.validateSync();
      expect(validationError).toBeUndefined();
      expect(deletedData.entityType).toBe("point");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 15. LIST MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("List Model", () => {
    it("should be defined with correct model name", () => {
      expect(ListModel).toBeDefined();
      expect(ListModel.modelName).toBe("List");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(ListModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("name");
      expect(paths).toContain("description");
      expect(paths).toContain("points");
      expect(paths).toContain("color");
      expect(paths).toContain("icon");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const list = new ListModel({
        userId,
        name: "My List",
      });

      expect(list.description).toBe("");
      expect(list.color).toBe("#000000");
      expect(list.icon).toBe("default-icon");
      expect(list.version).toBe(1);
      expect(list.deletedAt).toBeNull();
    });

    it("should create a valid list document", () => {
      const userId = new mongoose.Types.ObjectId();
      const list = new ListModel({
        userId,
        name: "Favorite Spots",
        description: "My favorite exploration spots",
        color: "#FF5733",
        icon: "star",
      });

      const validationError = list.validateSync();
      expect(validationError).toBeUndefined();
      expect(list.name).toBe("Favorite Spots");
      expect(list.color).toBe("#FF5733");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 16. SOS SESSION MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("SosSession Model", () => {
    it("should be defined with correct model name", () => {
      expect(SosSessionModel).toBeDefined();
      expect(SosSessionModel.modelName).toBe("SosSession");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(SosSessionModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("status");
      expect(paths).toContain("currentStage");
      expect(paths).toContain("activatedAt");
      expect(paths).toContain("expectedDuration");
      expect(paths).toContain("expiresAt");
      expect(paths).toContain("participants");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosSession = new SosSessionModel({
        userId,
        expectedDuration: 60,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      expect(sosSession.status).toBe("ACTIVE");
      expect(sosSession.currentStage).toBe(-1);
      expect(sosSession.consecutiveHeartbeats).toBe(0);
      expect(sosSession.surfaceDetectionSent).toBe(false);
      expect(sosSession.useDefaultContacts).toBe(true);
    });

    it("should validate status enum", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosSession = new SosSessionModel({
        userId,
        status: "INVALID_STATUS" as any,
        expectedDuration: 60,
        expiresAt: new Date(),
      });

      const validationError = sosSession.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid sosSession document", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosSession = new SosSessionModel({
        userId,
        status: "ACTIVE",
        currentStage: 0,
        activatedAt: new Date(),
        expectedDuration: 120,
        expiresAt: new Date(Date.now() + 120 * 60 * 1000),
        siteName: "Test Cave",
        zone: "Section A",
        depth: 50,
      });

      const validationError = sosSession.validateSync();
      expect(validationError).toBeUndefined();
      expect(sosSession.siteName).toBe("Test Cave");
      expect(sosSession.depth).toBe(50);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 17. SOS EVENT MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("SosEvent Model", () => {
    it("should be defined with correct model name", () => {
      expect(SosEventModel).toBeDefined();
      expect(SosEventModel.modelName).toBe("SosEvent");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(SosEventModel.schema.paths);
      expect(paths).toContain("sessionId");
      expect(paths).toContain("userId");
      expect(paths).toContain("type");
    });

    it("should validate type enum", () => {
      const sessionId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const sosEvent = new SosEventModel({
        sessionId,
        userId,
        type: "INVALID_TYPE" as any,
      });

      const validationError = sosEvent.validateSync();
      expect(validationError).toBeDefined();
    });

    it("should create a valid sosEvent document", () => {
      const sessionId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const sosEvent = new SosEventModel({
        sessionId,
        userId,
        type: "ACTIVATED",
        metadata: { duration: 60 },
      });

      const validationError = sosEvent.validateSync();
      expect(validationError).toBeUndefined();
      expect(sosEvent.type).toBe("ACTIVATED");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 18. SOS CONTACT MODEL
  // ───────────────────────────────────────────────────────────────────────────

  describe("SosContact Model", () => {
    it("should be defined with correct model name", () => {
      expect(SosContactModel).toBeDefined();
      expect(SosContactModel.modelName).toBe("SosContact");
    });

    it("should have all required schema paths", () => {
      const paths = Object.keys(SosContactModel.schema.paths);
      expect(paths).toContain("userId");
      expect(paths).toContain("name");
      expect(paths).toContain("phone");
      expect(paths).toContain("isDefault");
    });

    it("should have correct default values", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosContact = new SosContactModel({
        userId,
        name: "Emergency Contact",
        phone: "+33612345678",
      });

      expect(sosContact.isDefault).toBe(false);
    });

    it("should validate phone format", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosContact = new SosContactModel({
        userId,
        name: "Test Contact",
        phone: "invalid_phone",
      });

      const validationError = sosContact.validateSync();
      expect(validationError).toBeDefined();
      expect(validationError?.errors.phone).toBeDefined();
    });

    it("should accept valid E.164 phone format", () => {
      const userId = new mongoose.Types.ObjectId();
      const sosContact = new SosContactModel({
        userId,
        name: "Valid Contact",
        phone: "+33612345678",
        relationship: "Family",
        isDefault: true,
      });

      const validationError = sosContact.validateSync();
      expect(validationError).toBeUndefined();
      expect(sosContact.phone).toBe("+33612345678");
      expect(sosContact.isDefault).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUMMARY TEST
  // ───────────────────────────────────────────────────────────────────────────

  describe("All Models Summary", () => {
    it("should have all 18 models defined", () => {
      const models = [
        UserModel,
        FicheModel,
        PointModel,
        ContactModel,
        ConversationModel,
        MessageModel,
        DataShareModel,
        NotificationModel,
        RefreshTokenModel,
        AuditLogModel,
        BlockedIpModel,
        KeysModel,
        MaintenanceModel,
        DeletedDataModel,
        ListModel,
        SosSessionModel,
        SosEventModel,
        SosContactModel,
      ];

      models.forEach((model) => {
        expect(model).toBeDefined();
        expect(model.modelName).toBeDefined();
      });

      expect(models.length).toBe(18);
    });

    it("should have correct model names", () => {
      const expectedModelNames = [
        "User",
        "Fiche",
        "Point",
        "Contact",
        "Conversation",
        "Message",
        "DataShare",
        "Notification",
        "RefreshToken",
        "AuditLog",
        "BlockedIp",
        "Keys",
        "Maintenance",
        "DeletedData",
        "List",
        "SosSession",
        "SosEvent",
        "SosContact",
      ];

      const actualModelNames = [
        UserModel.modelName,
        FicheModel.modelName,
        PointModel.modelName,
        ContactModel.modelName,
        ConversationModel.modelName,
        MessageModel.modelName,
        DataShareModel.modelName,
        NotificationModel.modelName,
        RefreshTokenModel.modelName,
        AuditLogModel.modelName,
        BlockedIpModel.modelName,
        KeysModel.modelName,
        MaintenanceModel.modelName,
        DeletedDataModel.modelName,
        ListModel.modelName,
        SosSessionModel.modelName,
        SosEventModel.modelName,
        SosContactModel.modelName,
      ];

      expect(actualModelNames).toEqual(expectedModelNames);
    });
  });
});
