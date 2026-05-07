/**
 * Tests unitaires pour userControllers
 * Teste les fonctions de gestion des utilisateurs
 */

// ═══════════════════════════════════════════════════════════════════════════
// MOCKS - DOIVENT ÊTRE AVANT LES IMPORTS
// ═══════════════════════════════════════════════════════════════════════════

jest.mock("../../services/userService");
jest.mock("../../services/emailService");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/redisSessionService");
jest.mock("../../services/auditService");
jest.mock("../../services/webSocketService", () => ({
  webSocketService: {
    broadcastSyncUpdate: jest.fn(),
    broadcastNotificationRead: jest.fn(),
  },
}));
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/passwordUtils");
jest.mock("../../utils/emailUtils");
jest.mock("../../models/users");
jest.mock("bcrypt");
jest.mock("crypto");
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import {
  handleCreateUser,
  handleGetAllUsers,
  handleGetUserById,
  handleDeleteUser,
  handleUpdateUser,
  handleVerifyEmailByCode,
  handleResendVerificationEmail,
} from "../../controllers/userControllers";
import { mockRequest, mockResponse, mockUser } from "../mocks";

// Étendre le type Request pour inclure la propriété user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        is_admin?: boolean;
        isAdmin?: boolean;
        tokenIssuedAt?: number;
        tokenId?: string;
        clientType?: "web" | "mobile";
      };
    }
  }
}
import {
  createUser,
  deleteUserById,
  updateUserById,
  getUserByEmail,
} from "../../services/userService";
import {
  sendWelcomeEmail,
  generateVerificationCode,
  sendVerificationEmail,
  sendAdminPendingValidationEmail,
} from "../../services/emailService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { auditService } from "../../services/auditService";
import { encrypt, decrypt, hashEmail } from "../../utils/masterEncryptionUtils";
import {
  validatePasswordStrength,
  isPasswordInHistory,
} from "../../utils/passwordUtils";
import { validateEmail } from "../../utils/emailUtils";
import UserModel from "../../models/users";
import bcrypt from "bcrypt";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("userControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (encrypt as jest.Mock).mockImplementation((val) => `encrypted-${val}`);
    (decrypt as jest.Mock).mockImplementation((val) =>
      val.replace("encrypted-", ""),
    );
    (hashEmail as jest.Mock).mockReturnValue("hashed-email");
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-password");
    (validateEmail as jest.Mock).mockReturnValue({ isValid: true });
    (validatePasswordStrength as jest.Mock).mockReturnValue({
      isValid: true,
    });
    (isPasswordInHistory as jest.Mock).mockResolvedValue(false);
  });

  describe("handleCreateUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          name: "John",
          surname: "Doe",
          password: "SecurePass123!",
          email: "john.doe@test.com",
        },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      (getUserByEmail as jest.Mock).mockResolvedValue(null);
      (generateVerificationCode as jest.Mock).mockReturnValue("123456");
      (crypto.randomBytes as jest.Mock).mockImplementation((size: number) => {
        if (size === 32) {
          return {
            toString: jest.fn().mockReturnValue("token-123"),
          };
        }
        if (size === 4) {
          return {
            readUInt32BE: jest.fn().mockReturnValue(500000),
          };
        }
        return {
          toString: jest.fn().mockReturnValue("random"),
          readUInt32BE: jest.fn().mockReturnValue(0),
        };
      });
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);
      (UserModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (createUser as jest.Mock).mockResolvedValue({
        _id: "user123",
        ...req.body,
      });
      (sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait créer un nouvel utilisateur avec succès", async () => {
      await handleCreateUser(req as Request, res as Response);

      expect(validateEmail).toHaveBeenCalledWith("john.doe@test.com");
      expect(validatePasswordStrength).toHaveBeenCalledWith("SecurePass123!");
      expect(createUser).toHaveBeenCalled();
      expect(sendWelcomeEmail).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("créé avec succès"),
          userId: "user123",
          requiresEmailVerification: true,
        }),
      );
    });

    it("devrait rejeter les champs manquants", async () => {
      req.body = { name: "John" };

      await handleCreateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("requis"),
        }),
      );
    });

    it("devrait rejeter un email invalide", async () => {
      (validateEmail as jest.Mock).mockReturnValue({
        isValid: false,
        message: "Format d'email invalide.",
      });

      await handleCreateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Format d'email invalide.",
        }),
      );
    });

    it("devrait rejeter un mot de passe faible", async () => {
      (validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: false,
        message: "Le mot de passe ne respecte pas les critères de force.",
      });

      await handleCreateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Le mot de passe ne respecte pas les critères de force.",
        }),
      );
    });

    it("devrait rejeter un email déjà existant", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser({ email: "john.doe@test.com" }),
      );

      await handleCreateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Si cet email est associé à un compte, vous recevrez un email pour continuer.",
        }),
      );
    });

    it("devrait gérer les erreurs de création", async () => {
      (createUser as jest.Mock).mockRejectedValue(new Error("Database error"));

      await handleCreateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Erreur lors de la création de l'utilisateur.",
        }),
      );
    });
  });

  describe("handleGetAllUsers", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        query: { page: "1", limit: "50" },
      });
      res = mockResponse();

      const mockUsers = [
        {
          ...mockUser({ _id: "user1" as any }),
          toObject: jest
            .fn()
            .mockReturnValue(mockUser({ _id: "user1" as any })),
        },
        {
          ...mockUser({ _id: "user2" as any }),
          toObject: jest
            .fn()
            .mockReturnValue(mockUser({ _id: "user2" as any })),
        },
      ];

      const mockChain = {
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(mockUsers),
      };

      (UserModel.find as jest.Mock).mockReturnValue(mockChain);
      (UserModel.countDocuments as jest.Mock).mockResolvedValue(2);
    });

    it("devrait retourner tous les utilisateurs avec pagination", async () => {
      await handleGetAllUsers(req as Request, res as Response);

      expect(UserModel.find).toHaveBeenCalled();
      expect(UserModel.countDocuments).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          pagination: expect.objectContaining({
            page: 1,
            limit: 50,
            total: 2,
            totalPages: 1,
          }),
        }),
      );
    });

    it("devrait gérer les erreurs de récupération", async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error("Database error")),
      };

      (UserModel.find as jest.Mock).mockReturnValue(mockChain);

      await handleGetAllUsers(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("handleGetUserById", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { id: "user123" },
        user: { id: "user123", isAdmin: false },
      });
      res = mockResponse();

      const mockUserData = {
        ...mockUser({ _id: "user123" as any, name: "encrypted-John" }),
        toObject: jest
          .fn()
          .mockReturnValue(
            mockUser({ _id: "user123" as any, name: "encrypted-John" }),
          ),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUserData),
      });
    });

    it("devrait retourner un utilisateur par ID", async () => {
      await handleGetUserById(req as Request, res as Response);

      expect(UserModel.findById).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.any(Object));
    });

    it("devrait rejeter sans ID", async () => {
      req.params = {};

      await handleGetUserById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait rejeter sans authentification", async () => {
      req.user = undefined;

      await handleGetUserById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Authentification requise",
        }),
      );
    });

    it("devrait rejeter un accès non autorisé", async () => {
      req.user = { id: "other-user", isAdmin: false };

      await handleGetUserById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Vous n'êtes pas autorisé à accéder à ce profil.",
        }),
      );
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      await handleGetUserById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait autoriser un admin à voir n'importe quel profil", async () => {
      req.user = { id: "admin-id", isAdmin: true };

      await handleGetUserById(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("handleDeleteUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { id: "user123" },
        user: { id: "user123", isAdmin: false },
      });
      res = mockResponse();

      (deleteUserById as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait supprimer un utilisateur avec succès", async () => {
      await handleDeleteUser(req as Request, res as Response);

      expect(deleteUserById).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Utilisateur supprimé avec succès.",
        }),
      );
    });

    it("devrait rejeter sans ID", async () => {
      req.params = {};

      await handleDeleteUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait rejeter sans authentification", async () => {
      req.user = undefined;

      await handleDeleteUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait rejeter un accès non autorisé", async () => {
      req.user = { id: "other-user", isAdmin: false };

      await handleDeleteUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait gérer les erreurs de suppression", async () => {
      (deleteUserById as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleDeleteUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("handleUpdateUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { id: "user123" },
        body: { name: "UpdatedName", currentPassword: "OldPass123!" },
        user: { id: "user123" },
      });
      res = mockResponse();

      (UserModel.findById as jest.Mock).mockResolvedValue({
        _id: "user123",
        password: "hashed-password",
        password_history: [],
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (updateUserById as jest.Mock).mockResolvedValue(
        mockUser({ _id: "user123" as any, name: "encrypted-UpdatedName" }),
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait mettre à jour un utilisateur", async () => {
      await handleUpdateUser(req as Request, res as Response);

      expect(bcrypt.compare).toHaveBeenCalledWith(
        "OldPass123!",
        "hashed-password",
      );
      expect(updateUserById).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter sans ID valide (403 si params vide)", async () => {
      req.params = {};

      await handleUpdateUser(req as Request, res as Response);

      // Avec params vide, userId devient undefined, ce qui déclenche 403 (requestingUser.id !== userId)
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("devrait rejeter sans currentPassword", async () => {
      req.body = { name: "UpdatedName" };

      await handleUpdateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requiresCurrentPassword: true,
        }),
      );
    });

    it("devrait rejeter un mot de passe actuel incorrect", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await handleUpdateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          invalidPassword: true,
        }),
      );
    });

    it("devrait rejeter sans authentification", async () => {
      req.user = undefined;

      await handleUpdateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("devrait retourner 404 si utilisateur non trouvé", async () => {
      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      await handleUpdateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("devrait vérifier l'historique des mots de passe", async () => {
      req.body = {
        name: "UpdatedName",
        currentPassword: "OldPass123!",
        password: "NewPass123!",
      };
      (isPasswordInHistory as jest.Mock).mockResolvedValue(true);

      await handleUpdateUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordReused: true,
        }),
      );
    });

    it("devrait révoquer les tokens lors d'un changement de mot de passe", async () => {
      req.body = {
        name: "UpdatedName",
        currentPassword: "OldPass123!",
        password: "NewPass123!",
      };
      (refreshTokenService.revokeAllUserTokens as jest.Mock).mockResolvedValue(
        2,
      );
      (redisSessionService.deleteSession as jest.Mock).mockResolvedValue(
        undefined,
      );

      await handleUpdateUser(req as Request, res as Response);

      expect(refreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        "user123",
        "password_changed",
      );
      expect(redisSessionService.deleteSession).toHaveBeenCalledWith("user123");
    });
  });

  describe("handleVerifyEmailByCode", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { email: "user@test.com", code: "123456" },
      });
      res = mockResponse();

      const mockUserData = {
        ...mockUser({
          name: "encrypted-John",
          surname: "encrypted-Doe",
          email: "encrypted-user@test.com",
          is_verified: false,
          email_verification_code: "123456",
          email_verification_expires: new Date(Date.now() + 3600000),
          creation_date: new Date(),
        }),
        save: jest.fn().mockResolvedValue(undefined),
      };

      // Premier appel : recherche de l'utilisateur à vérifier
      // Deuxième appel : recherche des admins avec .lean()
      (UserModel.find as jest.Mock).mockImplementation((criteria: any) => {
        if (criteria.email_verification_code) {
          // Premier appel pour trouver l'utilisateur
          return Promise.resolve([mockUserData]);
        }
        if (criteria.is_admin === true) {
          // Deuxième appel pour trouver les admins
          return {
            lean: jest.fn().mockResolvedValue([
              {
                name: "encrypted-Admin",
                surname: "encrypted-User",
                email: "encrypted-admin@test.com",
                is_admin: true,
              },
            ]),
          };
        }
        return Promise.resolve([]);
      });

      (sendAdminPendingValidationEmail as jest.Mock).mockResolvedValue(
        undefined,
      );
    });

    it("devrait vérifier l'email avec le bon code", async () => {
      await handleVerifyEmailByCode(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("vérifié"),
          verified: true,
          pendingAdminValidation: true,
        }),
      );
    });

    it("devrait rejeter sans email ou code", async () => {
      req.body = {};

      await handleVerifyEmailByCode(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait rejeter un code invalide", async () => {
      (UserModel.find as jest.Mock).mockResolvedValue([]);

      await handleVerifyEmailByCode(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          expired: true,
        }),
      );
    });

    it("devrait rejeter un code expiré", async () => {
      const expiredUser = {
        ...mockUser({
          name: "encrypted-John",
          surname: "encrypted-Doe",
          email: "encrypted-user@test.com",
          email_verification_code: "123456",
          email_verification_expires: new Date(Date.now() - 1000),
        }),
        save: jest.fn(),
      };

      // Le code est expiré donc la requête avec $gt ne retourne rien
      (UserModel.find as jest.Mock).mockImplementation((criteria: any) => {
        if (criteria.email_verification_code) {
          // Date expirée, donc $gt retourne []
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      await handleVerifyEmailByCode(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait notifier les administrateurs", async () => {
      const mockAdmins = [
        {
          name: "encrypted-Admin",
          surname: "encrypted-User",
          email: "encrypted-admin@test.com",
          is_admin: true,
        },
      ];

      (UserModel.find as jest.Mock)
        .mockResolvedValueOnce([
          {
            ...mockUser({
              name: "encrypted-John",
              surname: "encrypted-Doe",
              email: "encrypted-user@test.com",
              is_verified: false,
              creation_date: new Date(),
            }),
            save: jest.fn().mockResolvedValue(undefined),
          },
        ])
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(mockAdmins),
        });

      await handleVerifyEmailByCode(req as Request, res as Response);

      expect(sendAdminPendingValidationEmail).toHaveBeenCalled();
    });
  });

  describe("handleResendVerificationEmail", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { email: "user@test.com" },
      });
      res = mockResponse();

      (generateVerificationCode as jest.Mock).mockReturnValue("654321");
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("new-token-456"),
      });
      const mockUserData = {
        ...mockUser({ email: "encrypted-user@test.com", is_verified: false }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(mockUserData);
      (sendVerificationEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait renvoyer l'email de vérification", async () => {
      await handleResendVerificationEmail(req as Request, res as Response);

      expect(sendVerificationEmail).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("associé à un compte"),
        }),
      );
    });

    it("devrait rejeter sans email", async () => {
      req.body = {};

      await handleResendVerificationEmail(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("devrait retourner un message générique si utilisateur non trouvé", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(null);

      await handleResendVerificationEmail(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("associé à un compte"),
        }),
      );
    });

    it("devrait rejeter un email déjà vérifié", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue({
        ...mockUser({ is_verified: true }),
        save: jest.fn(),
      });

      await handleResendVerificationEmail(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("déjà vérifié"),
        }),
      );
    });
  });
});
