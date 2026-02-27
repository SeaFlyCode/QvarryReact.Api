/**
 * Tests unitaires pour adminControllers
 * Teste les fonctions d'administration (gestion utilisateurs, statistiques, sécurité)
 */

jest.mock("../../models/users");
jest.mock("../../models/points");
jest.mock("../../models/fiches");
jest.mock("../../models/lists");
jest.mock("../../models/dataShare");
jest.mock("../../models/conversations");
jest.mock("../../models/messages");
jest.mock("../../models/auditLogs");
jest.mock("../../services/auditService");
jest.mock("../../services/securityAlertService");
jest.mock("../../services/refreshTokenService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/logUtils");

import { Request, Response } from "express";
import {
  getGlobalStats,
  listUsers,
  getUserDetails,
  blockUser,
  unblockUser,
  approveUser,
  listPendingUsers,
  getAuditLogs,
  getSecurityDashboard,
  blockIp,
  unblockIp,
} from "../../controllers/adminControllers";
import { mockRequest, mockResponse } from "../mocks";
import UserModel from "../../models/users";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import DataShareModel from "../../models/dataShare";
import ConversationModel from "../../models/conversations";
import MessageModel from "../../models/messages";
import AuditLogModel from "../../models/auditLogs";
import { auditService } from "../../services/auditService";
import { securityAlertService } from "../../services/securityAlertService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { decrypt } from "../../utils/masterEncryptionUtils";
import { maskEmail } from "../../utils/logUtils";

describe("adminControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (decrypt as jest.Mock).mockImplementation((val) =>
      val ? val.replace("encrypted-", "") : "",
    );
    (maskEmail as jest.Mock).mockImplementation((email) =>
      email ? email.replace(/(.{2}).*(@.*)/, "$1***$2") : "",
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: getGlobalStats
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getGlobalStats", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let originalDateNow: () => number;
    let currentTime: number;

    beforeEach(() => {
      // Mock Date.now to control cache timing
      currentTime = Date.now();
      originalDateNow = Date.now;
      Date.now = jest.fn(() => currentTime);

      req = mockRequest({ user: { id: "admin123", isAdmin: true } });
      res = mockResponse();

      // Mock tous les countDocuments avec la structure attendue (chaîne avec maxTimeMS)
      const mockCountDocuments = (value: number) => ({
        maxTimeMS: jest.fn().mockResolvedValue(value),
      });

      (UserModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(100),
      );
      (PointModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(500),
      );
      (FicheModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(200),
      );
      (ListModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(50),
      );
      (DataShareModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(30),
      );
      (ConversationModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(80),
      );
      (MessageModel.countDocuments as jest.Mock).mockReturnValue(
        mockCountDocuments(1000),
      );
    });

    afterEach(() => {
      Date.now = originalDateNow;
    });

    it("devrait retourner les statistiques globales", async () => {
      await getGlobalStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          users: expect.objectContaining({
            total: expect.any(Number),
            verified: expect.any(Number),
            blocked: expect.any(Number),
            admins: expect.any(Number),
          }),
          content: expect.objectContaining({
            points: expect.any(Object),
            fiches: expect.any(Object),
            lists: expect.any(Object),
          }),
          sharing: expect.objectContaining({
            total: expect.any(Number),
            active: expect.any(Number),
            accepted: expect.any(Number),
          }),
          messaging: expect.objectContaining({
            conversations: expect.any(Number),
            messages: expect.any(Number),
          }),
        }),
      );
    });

    it("devrait gérer les erreurs de base de données", async () => {
      // Advance time to expire any existing cache (5 minutes + 1ms)
      currentTime += 5 * 60 * 1000 + 1;

      (UserModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await getGlobalStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("statistiques"),
        }),
      );
    });

    it("devrait utiliser le cache pour les requêtes rapprochées", async () => {
      // Advance time to expire any previous cache
      currentTime += 6 * 60 * 1000; // 6 minutes

      // Première requête - populate the cache
      await getGlobalStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);

      // Clear mocks but keep the cache by not advancing time
      jest.clearAllMocks();

      // Create new response mock for second request
      const res2 = mockResponse();

      // Deuxième requête immédiate (devrait utiliser le cache)
      await getGlobalStats(req as Request, res2 as Response);

      expect(res2.json).toHaveBeenCalled();
      // Le cache devrait empêcher les appels à la DB
      expect(UserModel.countDocuments).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: listUsers
  // ═══════════════════════════════════════════════════════════════════════════

  describe("listUsers", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        query: { page: "1", limit: "20" },
      });
      res = mockResponse();

      const mockUsers = [
        {
          _id: "user1",
          name: "encrypted-John",
          surname: "encrypted-Doe",
          pseudo: "encrypted-johndoe",
          email: "encrypted-john@test.com",
          is_admin: false,
          is_blocked: false,
          is_verified: true,
          creation_date: new Date(),
          last_connection: new Date(),
        },
        {
          _id: "user2",
          name: "encrypted-Jane",
          surname: "encrypted-Smith",
          email: "encrypted-jane@test.com",
          is_admin: true,
          is_blocked: false,
          is_verified: true,
          creation_date: new Date(),
          last_connection: new Date(),
        },
      ];

      (UserModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockUsers),
      });

      (UserModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(2),
      });
    });

    it("devrait lister les utilisateurs avec pagination", async () => {
      await listUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          users: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
              surname: expect.any(String),
              email: expect.any(String),
            }),
          ]),
          pagination: expect.objectContaining({
            page: 1,
            limit: 20,
            total: 2,
            totalPages: 1,
          }),
        }),
      );
    });

    it("devrait valider et limiter la recherche", async () => {
      req.query = { search: "a".repeat(150) }; // Trop long

      await listUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("recherche"),
          code: "SEARCH_TOO_LONG",
        }),
      );
    });

    it("devrait filtrer par statut", async () => {
      req.query = { is_blocked: "true", is_verified: "false" };

      await listUsers(req as Request, res as Response);

      expect(UserModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          is_blocked: true,
          is_verified: false,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await listUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("utilisateurs"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: getUserDetails
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getUserDetails", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { userId: "507f1f77bcf86cd799439011" },
      });
      res = mockResponse();

      const mockUser = {
        _id: "507f1f77bcf86cd799439011",
        name: "encrypted-John",
        surname: "encrypted-Doe",
        pseudo: "encrypted-johndoe",
        email: "encrypted-john@test.com",
        is_admin: false,
        is_blocked: false,
        is_verified: true,
        creation_date: new Date(),
        last_connection: new Date(),
        contact_code: 123456,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockUser),
      });

      (PointModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(10),
      });
      (FicheModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(5),
      });
      (ListModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(3),
      });
      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockResolvedValue([{ id: "session1" }]);
    });

    it("devrait retourner les détails d'un utilisateur", async () => {
      await getUserDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({
            id: "507f1f77bcf86cd799439011",
            name: "John",
            surname: "Doe",
            email: "john@test.com",
          }),
          stats: expect.objectContaining({
            points: 10,
            fiches: 5,
            lists: 3,
            activeSessions: 1,
          }),
        }),
      );
    });

    it("devrait rejeter un ID invalide", async () => {
      req.params = { userId: "invalid-id" };

      await getUserDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID utilisateur invalide"),
        }),
      );
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      await getUserDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvé"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await getUserDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("utilisateur"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: blockUser
  // ═══════════════════════════════════════════════════════════════════════════

  describe("blockUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockUser: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { userId: "507f1f77bcf86cd799439011" }, // Valid ObjectId
        body: { reason: "Test blocking" },
        ip: "192.168.1.1",
      });
      res = mockResponse();

      mockUser = {
        _id: "507f1f77bcf86cd799439011",
        name: "encrypted-John",
        email: "encrypted-john@test.com",
        is_admin: false,
        is_blocked: false,
        blocked_at: undefined,
        blocked_reason: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (refreshTokenService.revokeAllUserTokens as jest.Mock).mockResolvedValue(
        2,
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait bloquer un utilisateur avec succès", async () => {
      await blockUser(req as Request, res as Response);

      expect(mockUser.is_blocked).toBe(true);
      expect(mockUser.blocked_reason).toBe("Test blocking");
      expect(mockUser.save).toHaveBeenCalled();
      expect(refreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "user_blocked",
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ADMIN_BLOCK_USER",
          level: "warning",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("bloqué"),
        }),
      );
    });

    it("devrait rejeter un ID invalide", async () => {
      req.params = { userId: "invalid-id" };

      await blockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID utilisateur invalide"),
        }),
      );
    });

    it("devrait empêcher de se bloquer soi-même", async () => {
      req = mockRequest({
        user: { id: "507f1f77bcf86cd799439012", isAdmin: true },
        params: { userId: "507f1f77bcf86cd799439012" }, // Same ID
        body: { reason: "Test blocking" },
        ip: "192.168.1.1",
      });

      await blockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("vous-même"),
        }),
      );
    });

    it("devrait empêcher de bloquer un autre admin", async () => {
      mockUser.is_admin = true;
      req.params = { userId: "507f1f77bcf86cd799439013" }; // Valid ObjectId different from admin

      await blockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("administrateur"),
        }),
      );
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockResolvedValue(null);
      req.params = { userId: "507f1f77bcf86cd799439014" }; // Valid ObjectId

      await blockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvé"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );
      req.params = { userId: "507f1f77bcf86cd799439015" }; // Valid ObjectId

      await blockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("blocage"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: unblockUser
  // ═══════════════════════════════════════════════════════════════════════════

  describe("unblockUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockUser: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { userId: "507f1f77bcf86cd799439011" }, // Valid ObjectId
        ip: "192.168.1.1",
      });
      res = mockResponse();

      mockUser = {
        _id: "507f1f77bcf86cd799439011",
        email: "encrypted-john@test.com",
        is_blocked: true,
        blocked_at: new Date(),
        blocked_reason: "Test reason",
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait débloquer un utilisateur avec succès", async () => {
      await unblockUser(req as Request, res as Response);

      expect(mockUser.is_blocked).toBe(false);
      expect(mockUser.blocked_at).toBeUndefined();
      expect(mockUser.blocked_reason).toBeUndefined();
      expect(mockUser.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ADMIN_UNBLOCK_USER",
          level: "info",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("débloqué"),
        }),
      );
    });

    it("devrait rejeter un ID invalide", async () => {
      req.params = { userId: "invalid-id" };

      await unblockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID utilisateur invalide"),
        }),
      );
    });

    it("devrait rejeter si l'utilisateur n'est pas bloqué", async () => {
      mockUser.is_blocked = false;
      req.params = { userId: "507f1f77bcf86cd799439012" }; // Valid ObjectId

      await unblockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("pas bloqué"),
        }),
      );
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockResolvedValue(null);
      req.params = { userId: "507f1f77bcf86cd799439013" }; // Valid ObjectId

      await unblockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvé"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );
      req.params = { userId: "507f1f77bcf86cd799439014" }; // Valid ObjectId

      await unblockUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("déblocage"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: approveUser
  // ═══════════════════════════════════════════════════════════════════════════

  describe("approveUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let mockUser: any;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { userId: "507f1f77bcf86cd799439011" },
        ip: "192.168.1.1",
      });
      res = mockResponse();

      mockUser = {
        _id: "507f1f77bcf86cd799439011",
        name: "encrypted-John",
        surname: "encrypted-Doe",
        email: "encrypted-john@test.com",
        is_admin_validated: false,
        admin_validated_at: undefined,
        admin_validated_by: undefined,
        admin_validation_rejected: false,
        admin_rejection_reason: "",
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait approuver un utilisateur avec succès", async () => {
      await approveUser(req as Request, res as Response);

      expect(mockUser.is_admin_validated).toBe(true);
      expect(mockUser.admin_validated_by).toBe("admin123");
      expect(mockUser.admin_validation_rejected).toBe(false);
      expect(mockUser.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "USER_APPROVED",
          level: "info",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter un ID invalide", async () => {
      req.params = { userId: "invalid-id" };

      await approveUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID utilisateur invalide"),
        }),
      );
    });

    it("devrait rejeter si l'utilisateur est déjà validé", async () => {
      mockUser.is_admin_validated = true;

      await approveUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("déjà validé"),
        }),
      );
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      await approveUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvé"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await approveUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: listPendingUsers
  // ═══════════════════════════════════════════════════════════════════════════

  describe("listPendingUsers", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        query: { page: "1", limit: "20" },
      });
      res = mockResponse();

      const mockUsers = [
        {
          _id: "user1",
          name: "encrypted-John",
          surname: "encrypted-Doe",
          pseudo: "encrypted-johndoe",
          email: "encrypted-john@test.com",
          is_verified: true,
          is_admin_validated: false,
          creation_date: new Date(),
        },
      ];

      (UserModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockUsers),
      });

      (UserModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(1),
      });
    });

    it("devrait lister les utilisateurs en attente", async () => {
      await listPendingUsers(req as Request, res as Response);

      expect(UserModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          is_verified: true,
          is_admin_validated: false,
          admin_validation_rejected: { $ne: true },
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          users: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            limit: 20,
            total: 1,
          }),
        }),
      );
    });

    it("devrait gérer la pagination", async () => {
      req.query = { page: "2", limit: "10" };

      await listPendingUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await listPendingUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("utilisateurs en attente"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: getAuditLogs
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getAuditLogs", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        query: { page: "1", limit: "50" },
      });
      res = mockResponse();

      const mockLogs = [
        {
          _id: "log1",
          userId: "user123",
          action: "LOGIN",
          level: "info",
          timestamp: new Date(),
          ipAddress: "192.168.1.1",
        },
        {
          _id: "log2",
          userId: "user456",
          action: "LOGOUT",
          level: "info",
          timestamp: new Date(),
          ipAddress: "192.168.1.2",
        },
      ];

      (AuditLogModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockResolvedValue(mockLogs),
      });

      (AuditLogModel.countDocuments as jest.Mock).mockReturnValue({
        maxTimeMS: jest.fn().mockResolvedValue(2),
      });
    });

    it("devrait retourner les logs d'audit", async () => {
      await getAuditLogs(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          logs: expect.arrayContaining([
            expect.objectContaining({
              _id: expect.any(String),
              action: expect.any(String),
            }),
          ]),
          pagination: expect.objectContaining({
            page: 1,
            limit: 50,
            total: 2,
          }),
        }),
      );
    });

    it("devrait filtrer par action (whitelist)", async () => {
      req.query = { action: "LOGIN" };

      await getAuditLogs(req as Request, res as Response);

      expect(AuditLogModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "LOGIN",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait filtrer par niveau (whitelist)", async () => {
      req.query = { level: "error" };

      await getAuditLogs(req as Request, res as Response);

      expect(AuditLogModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait filtrer par dates", async () => {
      req.query = {
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      };

      await getAuditLogs(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer les erreurs serveur", async () => {
      (AuditLogModel.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await getAuditLogs(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("logs"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: getSecurityDashboard
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getSecurityDashboard", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({ user: { id: "admin123", isAdmin: true } });
      res = mockResponse();

      (securityAlertService.getSecurityStats as jest.Mock).mockResolvedValue({
        blockedIps: 5,
        recentAlerts: 10,
        threatScore: 2,
      });
    });

    it("devrait retourner les statistiques de sécurité", async () => {
      await getSecurityDashboard(req as Request, res as Response);

      expect(securityAlertService.getSecurityStats).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          blockedIps: 5,
          recentAlerts: 10,
          threatScore: 2,
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (securityAlertService.getSecurityStats as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await getSecurityDashboard(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("sécurité"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: blockIp
  // ═══════════════════════════════════════════════════════════════════════════

  describe("blockIp", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        body: {
          ipAddress: "192.168.1.100",
          reason: "Suspicious activity",
          durationHours: 24,
        },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      (securityAlertService.blockIp as jest.Mock).mockResolvedValue({
        ipAddress: "192.168.1.100",
        reason: "Suspicious activity",
        blockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait bloquer une IP avec succès", async () => {
      await blockIp(req as Request, res as Response);

      expect(securityAlertService.blockIp).toHaveBeenCalledWith(
        "192.168.1.100",
        "Suspicious activity",
        24,
        "admin123",
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ADMIN_IP_BLOCKED",
          level: "warning",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("bloquée"),
        }),
      );
    });

    it("devrait rejeter si IP ou raison manquants", async () => {
      req.body = { ipAddress: "192.168.1.100" }; // Manque reason

      await blockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("requises"),
        }),
      );
    });

    it("devrait valider le format de l'IP", async () => {
      req.body = {
        ipAddress: "invalid-ip",
        reason: "Test",
      };

      await blockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Format d'adresse IP invalide"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (securityAlertService.blockIp as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await blockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("blocage de l'IP"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: unblockIp
  // ═══════════════════════════════════════════════════════════════════════════

  describe("unblockIp", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { ipAddress: "192.168.1.100" },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      (securityAlertService.unblockIp as jest.Mock).mockResolvedValue(true);
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait débloquer une IP avec succès", async () => {
      await unblockIp(req as Request, res as Response);

      expect(securityAlertService.unblockIp).toHaveBeenCalledWith(
        "192.168.1.100",
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ADMIN_IP_UNBLOCKED",
          level: "info",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("débloquée"),
        }),
      );
    });

    it("devrait rejeter si IP manquante", async () => {
      req.params = {};

      await unblockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Adresse IP requise"),
        }),
      );
    });

    it("devrait retourner 404 si IP non trouvée", async () => {
      (securityAlertService.unblockIp as jest.Mock).mockResolvedValue(false);

      await unblockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("non trouvée"),
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (securityAlertService.unblockIp as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await unblockIp(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("déblocage de l'IP"),
        }),
      );
    });
  });
});
