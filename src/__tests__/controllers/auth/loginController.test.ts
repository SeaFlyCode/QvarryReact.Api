/**
 * Tests unitaires pour loginController
 * Teste les fonctions de connexion utilisateur
 */

jest.mock("../../../services/userService");
jest.mock("../../../services/memoryStorageService");
jest.mock("../../../services/refreshTokenService");
jest.mock("../../../services/auditService");
jest.mock("../../../services/redisSessionService");
jest.mock("../../../services/emailService");
jest.mock("../../../models/maintenance");
jest.mock("../../../models/users");
jest.mock("../../../controllers/auth/authHelpers");
jest.mock("../../../middlewares/rateLimitMiddleware");
jest.mock("../../../utils/deviceFingerprint");
jest.mock("bcrypt");
jest.mock("jsonwebtoken");

import { Request, Response } from "express";
import {
  handleLoginUser,
  handleRefreshToken,
  checkAuth,
  completeLoginAfter2FA,
} from "../../../controllers/auth/loginController";
import { mockRequest, mockResponse, mockUser, mockUser2FA } from "../../mocks";
import { getUserByEmail, getUserById } from "../../../services/userService";
import { refreshTokenService } from "../../../services/refreshTokenService";
import { auditService } from "../../../services/auditService";
import { redisSessionService } from "../../../services/redisSessionService";
import { sendSecurityAlertEmail } from "../../../services/emailService";
import MaintenanceModel from "../../../models/maintenance";
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
  loadAndDecryptUserData,
} from "../../../controllers/auth/authHelpers";
import { resetRateLimit } from "../../../middlewares/rateLimitMiddleware";
import { generateDeviceFingerprint } from "../../../utils/deviceFingerprint";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

describe("loginController", () => {
  describe("handleLoginUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {},
        ip: "127.0.0.1",
      });
      res = mockResponse();

      // Mock defaults
      (checkLoginAttempts as jest.Mock).mockResolvedValue({ allowed: true });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (MaintenanceModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "jwt-token",
        tokenId: "token-id-123",
      });
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token-123",
      );
      (loadAndDecryptUserData as jest.Mock).mockResolvedValue(undefined);
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
      (resetLoginAttempts as jest.Mock).mockResolvedValue(undefined);
      (resetRateLimit as jest.Mock).mockReturnValue(undefined);
      (generateDeviceFingerprint as jest.Mock).mockReturnValue(
        "device-fingerprint-123",
      );
      (sendSecurityAlertEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait rejeter une requête sans email ou mot de passe", async () => {
      req.body = {};

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email et mot de passe requis.",
      });
    });

    it("devrait rejeter un format d'email invalide", async () => {
      req.body = { email: "invalid-email", password: "password123" };

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Format d'email invalide.",
      });
    });

    it("devrait bloquer après trop de tentatives", async () => {
      req.body = { email: "user@test.com", password: "password123" };
      (checkLoginAttempts as jest.Mock).mockResolvedValue({
        allowed: false,
        message: "Trop de tentatives",
        waitTime: 10,
      });

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: "Trop de tentatives",
        waitTime: 10,
        tooManyAttempts: true,
      });
    });

    it("devrait rejeter avec des identifiants incorrects", async () => {
      req.body = { email: "user@test.com", password: "wrong-password" };
      (getUserByEmail as jest.Mock).mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email ou mot de passe incorrect.",
      });
      expect(recordFailedLogin).toHaveBeenCalledWith(
        "user@test.com",
        expect.anything(),
      );
    });

    it("devrait bloquer la connexion en mode maintenance pour non-admin", async () => {
      const user = mockUser({ is_admin: false });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (MaintenanceModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          isActive: true,
          message: "Maintenance en cours",
        }),
      });

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("maintenance"),
        maintenance: true,
        message: "Maintenance en cours",
      });
    });

    it("devrait autoriser la connexion en mode maintenance pour admin", async () => {
      const user = mockUser({
        is_admin: true,
        is_verified: true,
        is_admin_validated: true,
      });
      req.body = { email: "admin@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (MaintenanceModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          isActive: true,
          message: "Maintenance en cours",
        }),
      });

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait bloquer un compte bloqué", async () => {
      const user = mockUser({ is_blocked: true });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      // P1 — shape unifié { error: "FORBIDDEN", code: "BLOCKED", message } + flag legacy
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "BLOCKED",
          message: expect.stringContaining("suspendu"),
          accountBlocked: true,
        }),
      );
    });

    it("devrait rejeter un email non vérifié", async () => {
      const user = mockUser({ is_verified: false });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      // P1 — shape unifié + flags legacy
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "UNVERIFIED",
          message: expect.stringContaining("vérifier votre adresse email"),
          emailNotVerified: true,
          email: "user@test.com",
        }),
      );
    });

    it("devrait rejeter un compte en attente de validation admin", async () => {
      const user = mockUser({ is_verified: true, is_admin_validated: false });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      // P1 — shape unifié + flag legacy
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "PENDING_VALIDATION",
          message: expect.stringContaining("attente de validation"),
          pendingAdminValidation: true,
        }),
      );
    });

    it("devrait rejeter un compte refusé par admin", async () => {
      const user = mockUser({
        is_verified: true,
        is_admin_validated: false,
        admin_validation_rejected: true,
        admin_rejection_reason: "Raison de refus",
      });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      // P1 — shape unifié (compte refusé = PENDING_VALIDATION + details.rejected)
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "PENDING_VALIDATION",
          message: expect.stringContaining("refusée"),
          accountRejected: true,
          rejectionReason: "Raison de refus",
        }),
      );
    });

    it("devrait demander le code 2FA si activé", async () => {
      const user = mockUser2FA({ is_verified: true, is_admin_validated: true });
      req.body = { email: "2fa@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (jwt.sign as jest.Mock).mockReturnValue("temp-token-2fa");

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        requiresTwoFactor: true,
        tempToken: "temp-token-2fa",
        message: expect.stringContaining("deux facteurs"),
      });
      expect(resetLoginAttempts).toHaveBeenCalledWith("2fa@test.com");
    });

    it("devrait connecter un utilisateur valide", async () => {
      const user = mockUser({
        _id: "user123" as any,
        is_admin: false,
        is_verified: true,
        is_admin_validated: true,
      });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      expect(generateSecureToken).toHaveBeenCalledWith("user123", false, "web");
      expect(refreshTokenService.createRefreshToken).toHaveBeenCalled();
      expect(loadAndDecryptUserData).toHaveBeenCalledWith("user123");
      expect(redisSessionService.createSession).toHaveBeenCalled();
      expect(resetLoginAttempts).toHaveBeenCalledWith("user@test.com");
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user123",
          action: "LOGIN_SUCCESS",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait configurer les cookies sécurisés", async () => {
      const user = mockUser({ is_verified: true, is_admin_validated: true });
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleLoginUser(req as Request, res as Response);

      // Source uses "token" and "refreshToken" as cookie names in test mode
      expect(res.cookie).toHaveBeenCalledWith(
        "token",
        "jwt-token",
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        "refresh-token-123",
        expect.any(Object),
      );
    });

    it("devrait gérer les erreurs inattendues", async () => {
      req.body = { email: "user@test.com", password: "password123" };
      (getUserByEmail as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleLoginUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Erreur lors de la connexion"),
        }),
      );
    });
  });

  describe("handleRefreshToken", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        cookies: { refreshToken: "refresh-token-123" },
      });
      res = mockResponse();

      // Source uses separate methods: validateRefreshToken, detectTokenTheft, rotateToken
      (refreshTokenService.validateRefreshToken as jest.Mock).mockResolvedValue(
        {
          userId: "user123",
          tokenId: "old-token-id",
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
          tokenFamily: "family-123",
        },
      );
      (refreshTokenService.detectTokenTheft as jest.Mock).mockResolvedValue(
        false,
      );
      (refreshTokenService.rotateToken as jest.Mock).mockResolvedValue(
        "new-refresh-token-456",
      );
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "new-jwt-token",
        tokenId: "new-token-id",
      });
      (getUserById as jest.Mock).mockResolvedValue({
        _id: "user123",
        is_admin: false,
      });
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait rejeter sans refresh token", async () => {
      req.cookies = {};

      await handleRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Refresh token manquant"),
        }),
      );
    });

    it("devrait rafraîchir les tokens avec succès", async () => {
      await handleRefreshToken(req as Request, res as Response);

      expect(refreshTokenService.validateRefreshToken).toHaveBeenCalledWith(
        "refresh-token-123",
      );
      expect(generateSecureToken).toHaveBeenCalledWith("user123", false, "web");
      expect(res.cookie).toHaveBeenCalledWith(
        "token",
        "new-jwt-token",
        expect.any(Object),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        "new-refresh-token-456",
        expect.any(Object),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer un refresh token invalide", async () => {
      (refreshTokenService.validateRefreshToken as jest.Mock).mockResolvedValue(
        null,
      );

      await handleRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("invalide ou expiré"),
        }),
      );
    });
  });

  describe("checkAuth", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        cookies: { token: "valid-jwt-token" },
      });
      res = mockResponse();

      // Source always includes {algorithms: ["HS256"]} as third parameter
      (jwt.verify as jest.Mock).mockReturnValue({
        id: "user123",
        isAdmin: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: "token-id-123",
      });
      (redisSessionService.isTokenBlacklisted as jest.Mock).mockResolvedValue(
        false,
      );
      (redisSessionService.validateSessionJti as jest.Mock).mockResolvedValue(
        true,
      );
    });

    it("devrait retourner les informations de l'utilisateur authentifié", async () => {
      await checkAuth(req as Request, res as Response);

      // Source returns {authenticated, userId, isAdmin} format (not {success, user})
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          authenticated: true,
          userId: "user123",
          isAdmin: false,
        }),
      );
    });

    it("devrait rejeter sans token", async () => {
      req.cookies = {};
      req.headers = {};

      await checkAuth(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        authenticated: false,
        reason: "no_token",
      });
    });
  });

  describe("completeLoginAfter2FA", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { tempToken: "temp-token-2fa" },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      // Source always includes {algorithms: ["HS256"]} as third parameter
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user123",
        type: "temp-2fa-web",
      });
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "jwt-token",
        tokenId: "token-id-123",
      });
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token-123",
      );
      (loadAndDecryptUserData as jest.Mock).mockResolvedValue(undefined);
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
      (generateDeviceFingerprint as jest.Mock).mockReturnValue(
        "device-fingerprint-123",
      );
    });

    it("devrait rejeter sans tempToken", async () => {
      req.body = {};

      await completeLoginAfter2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "tempToken requis",
      });
    });

    it("devrait compléter la connexion après 2FA", async () => {
      const mockUser = {
        _id: "user123",
        email: "user@test.com",
        is_admin: false,
      };
      const UserModel = require("../../../models/users").default;
      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      await completeLoginAfter2FA(req as Request, res as Response);

      // Source always includes {algorithms: ["HS256"]}
      expect(jwt.verify).toHaveBeenCalledWith(
        "temp-token-2fa",
        process.env.JWT_SECRET,
        { algorithms: ["HS256"] },
      );
      expect(generateSecureToken).toHaveBeenCalledWith(
        "user123",
        expect.any(Boolean),
        "web",
      );
      expect(loadAndDecryptUserData).toHaveBeenCalledWith("user123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          login: true,
          userId: "user123",
        }),
      );
    });

    it("devrait rejeter un tempToken invalide", async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await completeLoginAfter2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("invalide ou expiré"),
        }),
      );
    });

    it("devrait gérer les erreurs lors du chargement des données", async () => {
      const mockUser = {
        _id: "user123",
        email: "user@test.com",
        is_admin: false,
      };
      const UserModel = require("../../../models/users").default;
      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (loadAndDecryptUserData as jest.Mock).mockRejectedValue(
        new Error("Load error"),
      );

      await completeLoginAfter2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
