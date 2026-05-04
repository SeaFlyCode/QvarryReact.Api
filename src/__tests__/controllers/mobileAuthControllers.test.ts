/**
 * Tests unitaires pour mobileAuthControllers
 * Teste les fonctions d'authentification mobile
 */

jest.mock("../../services/userService");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/redisSessionService");
jest.mock("../../services/auditService");
jest.mock("../../services/emailService");
jest.mock("../../services/loggerService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/passwordUtils");
jest.mock("../../utils/emailUtils");
jest.mock("../../utils/deviceFingerprint");
jest.mock("../../utils/logUtils");
jest.mock("../../utils/jwtKeyManager");
jest.mock("../../middlewares/mobileSecurityMiddleware");
jest.mock("../../controllers/auth/authHelpers");
jest.mock("../../controllers/mobileTwoFactorControllers");
jest.mock("../../models/users");
jest.mock("../../models/maintenance");
jest.mock("bcrypt");
jest.mock("crypto");

import { Request, Response } from "express";
import {
  handleMobileLogin,
  handleMobileRegister,
  handleMobileForgotPassword,
  handleMobileRefreshToken,
} from "../../controllers/mobileAuthControllers";
import { mockRequest, mockResponse, mockUser } from "../mocks";
import { getUserByEmail, createUser } from "../../services/userService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { auditService } from "../../services/auditService";
import { encrypt, decrypt, hashEmail } from "../../utils/masterEncryptionUtils";
import { validatePasswordStrength } from "../../utils/passwordUtils";
import { validateEmail } from "../../utils/emailUtils";
import { generateDeviceFingerprint } from "../../utils/deviceFingerprint";
import { jwtKeyManager } from "../../utils/jwtKeyManager";
import { associateDeviceWithUser } from "../../middlewares/mobileSecurityMiddleware";
import {
  sendWelcomeEmail,
  generateVerificationCode,
  sendPasswordResetEmail,
} from "../../services/emailService";
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
} from "../../controllers/auth/authHelpers";
import { generateTwoFactorTempToken } from "../../controllers/mobileTwoFactorControllers";
import UserModel from "../../models/users";
import MaintenanceModel from "../../models/maintenance";
import bcrypt from "bcrypt";
import crypto from "crypto";

describe("mobileAuthControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (encrypt as jest.Mock).mockImplementation((val) => `encrypted-${val}`);
    (decrypt as jest.Mock).mockImplementation((val) =>
      val.replace("encrypted-", ""),
    );
    (hashEmail as jest.Mock).mockReturnValue("hashed-email");
    (generateDeviceFingerprint as jest.Mock).mockReturnValue(
      "device-fingerprint-123",
    );
    (associateDeviceWithUser as jest.Mock).mockReturnValue(undefined);
    (auditService.log as jest.Mock).mockResolvedValue(undefined);
    (jwtKeyManager.getCurrentKey as jest.Mock).mockReturnValue({
      secret: "test-jwt-secret-key-minimum-32-chars",
      version: "v1",
    });
    (generateTwoFactorTempToken as jest.Mock).mockReturnValue("temp-token-123");
  });

  describe("handleMobileLogin", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      // Set environment variable
      process.env.JWT_EXPIRES_IN = "15m";

      req = mockRequest({
        body: {
          email: "test@example.com",
          password: "Password123!",
        },
        ip: "192.168.1.1",
        headers: { "user-agent": "MobileApp/1.0" },
      });

      // Add mobileContext to request
      (req as any).mobileContext = {
        deviceId: "device-123",
        platform: "ios",
        trustScore: 0.9,
      };

      res = mockResponse();

      (checkLoginAttempts as jest.Mock).mockResolvedValue({ allowed: true });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "jwt-token-123",
        tokenId: "token-id-123",
        keyVersion: "v1",
      });
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token-123",
      );
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (resetLoginAttempts as jest.Mock).mockResolvedValue(undefined);
      (MaintenanceModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
    });

    it("devrait connecter un utilisateur avec succès", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        password: "hashed-password",
        is_admin: false,
        is_blocked: false,
        is_verified: true,
        is_admin_validated: true,
        two_factor_enabled: false,
      };

      (getUserByEmail as jest.Mock).mockResolvedValue(mockUser);

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          userId: "user-123",
          accessToken: "jwt-token-123",
          refreshToken: "refresh-token-123",
        }),
      );
    });

    it("devrait rejeter si email ou mot de passe manquant", async () => {
      req.body = {};

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email et mot de passe requis.",
        code: "MISSING_CREDENTIALS",
      });
    });

    it("devrait rejeter si format email invalide", async () => {
      req.body.email = "invalid-email";

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Format d'email invalide.",
        code: "INVALID_EMAIL_FORMAT",
      });
    });

    it("devrait rejeter si trop de tentatives de connexion", async () => {
      (checkLoginAttempts as jest.Mock).mockResolvedValue({
        allowed: false,
        message: "Trop de tentatives",
        waitTime: 15,
      });

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "TOO_MANY_ATTEMPTS",
        }),
      );
    });

    it("devrait rejeter si utilisateur inexistant ou mot de passe incorrect", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(null);

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email ou mot de passe incorrect.",
        code: "INVALID_CREDENTIALS",
      });
      expect(recordFailedLogin).toHaveBeenCalledWith(
        "test@example.com",
        expect.anything(),
      );
    });

    it("devrait rejeter si compte bloqué", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        password: "hashed-password",
        is_blocked: true,
        is_verified: true,
        is_admin_validated: true,
      };

      (getUserByEmail as jest.Mock).mockResolvedValue(mockUser);

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Votre compte a été suspendu.",
        code: "ACCOUNT_BLOCKED",
      });
    });

    it("devrait demander 2FA si activé", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        password: "hashed-password",
        is_admin: false,
        is_blocked: false,
        is_verified: true,
        is_admin_validated: true,
        two_factor_enabled: true,
      };

      (getUserByEmail as jest.Mock).mockResolvedValue(mockUser);

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requiresTwoFactor: true,
          code: "TWO_FACTOR_REQUIRED",
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (getUserByEmail as jest.Mock).mockRejectedValue(new Error("DB Error"));

      await handleMobileLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la connexion.",
        code: "INTERNAL_ERROR",
      });
    });
  });

  describe("handleMobileRegister", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          name: "John",
          surname: "Doe",
          email: "john.doe@example.com",
          password: "SecurePass123!",
        },
        ip: "192.168.1.1",
        headers: { "user-agent": "MobileApp/1.0" },
      });
      res = mockResponse();

      (validateEmail as jest.Mock).mockReturnValue({ isValid: true });
      (validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: true,
      });
      (getUserByEmail as jest.Mock).mockResolvedValue(null);
      (UserModel.findOne as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-password");
      (generateVerificationCode as jest.Mock).mockReturnValue("123456");
      (sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined);
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        readUInt32BE: jest.fn().mockReturnValue(500000),
        toString: jest.fn().mockReturnValue("verification-token"),
      });
      (createUser as jest.Mock).mockResolvedValue({
        _id: "new-user-id",
        ...req.body,
      });
    });

    it("devrait créer un nouvel utilisateur avec succès", async () => {
      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Compte créé ! Vérifiez votre email.",
          userId: "new-user-id",
          requiresEmailVerification: true,
        }),
      );
      expect(createUser).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "MOBILE_REGISTER_SUCCESS",
        }),
      );
    });

    it("devrait rejeter si champs manquants", async () => {
      req.body = { name: "John" };

      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Tous les champs sont requis.",
        code: "MISSING_FIELDS",
      });
    });

    it("devrait rejeter si email invalide", async () => {
      (validateEmail as jest.Mock).mockReturnValue({
        isValid: false,
        message: "Email invalide",
      });

      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email invalide",
        code: "INVALID_EMAIL",
      });
    });

    it("devrait rejeter si mot de passe faible", async () => {
      (validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: false,
        message: "Mot de passe trop faible",
      });

      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe trop faible",
        code: "WEAK_PASSWORD",
      });
    });

    it("devrait retourner un message générique si email déjà utilisé", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue({ _id: "existing-user" });

      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("email de vérification"),
          requiresEmailVerification: true,
        }),
      );
    });

    it("devrait gérer les erreurs serveur", async () => {
      (createUser as jest.Mock).mockRejectedValue(new Error("DB Error"));

      await handleMobileRegister(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la création du compte.",
        code: "INTERNAL_ERROR",
      });
    });
  });

  describe("handleMobileForgotPassword", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { email: "test@example.com" },
        ip: "192.168.1.1",
        headers: { "user-agent": "MobileApp/1.0" },
      });
      res = mockResponse();

      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("reset-token-hex"),
      });
      (crypto.createHash as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("reset-token-hash"),
      });
      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue(undefined);
      (sendPasswordResetEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it("devrait envoyer un email de réinitialisation si utilisateur existe", async () => {
      const mockUser = {
        _id: "user-123",
        name: "encrypted-John",
        email: "encrypted-test@example.com",
      };

      (getUserByEmail as jest.Mock).mockResolvedValue(mockUser);

      await handleMobileForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("lien de réinitialisation"),
        }),
      );
      expect(sendPasswordResetEmail).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "MOBILE_PASSWORD_RESET_REQUESTED",
        }),
      );
    });

    it("devrait rejeter si email manquant", async () => {
      req.body = {};

      await handleMobileForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Email requis.",
        code: "MISSING_EMAIL",
      });
    });

    it("devrait retourner succès même si utilisateur inexistant", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(null);

      await handleMobileForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("lien de réinitialisation"),
        }),
      );
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("devrait retourner succès même en cas d'erreur interne", async () => {
      (getUserByEmail as jest.Mock).mockRejectedValue(new Error("DB Error"));

      await handleMobileForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("lien de réinitialisation"),
        }),
      );
    });
  });

  describe("handleMobileRefreshToken", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { refreshToken: "valid-refresh-token" },
        ip: "192.168.1.1",
        headers: { "user-agent": "MobileApp/1.0" },
      });
      res = mockResponse();

      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "new-access-token",
        tokenId: "new-token-id",
      });
      (refreshTokenService.rotateToken as jest.Mock).mockResolvedValue(
        "new-refresh-token",
      );
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (refreshTokenService.detectTokenTheft as jest.Mock).mockResolvedValue(
        false,
      );
    });

    it("devrait rafraîchir les tokens avec succès", async () => {
      const mockStoredToken = {
        userId: "user-123",
        tokenId: "old-token-id",
        tokenFamily: "token-family-123",
      };

      (refreshTokenService.validateRefreshToken as jest.Mock).mockResolvedValue(
        mockStoredToken,
      );

      await handleMobileRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
        }),
      );
      expect(refreshTokenService.rotateToken).toHaveBeenCalled();
    });

    it("devrait rejeter si refresh token manquant", async () => {
      req.body = {};

      await handleMobileRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Refresh token manquant.",
        code: "NO_REFRESH_TOKEN",
      });
    });

    it("devrait rejeter si refresh token invalide", async () => {
      (refreshTokenService.validateRefreshToken as jest.Mock).mockResolvedValue(
        null,
      );

      await handleMobileRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Refresh token invalide ou expiré.",
        code: "INVALID_REFRESH_TOKEN",
      });
    });

    it("devrait détecter le vol de token", async () => {
      const mockStoredToken = {
        userId: "user-123",
        tokenId: "old-token-id",
        tokenFamily: "token-family-123",
      };

      (refreshTokenService.validateRefreshToken as jest.Mock).mockResolvedValue(
        mockStoredToken,
      );
      (refreshTokenService.detectTokenTheft as jest.Mock).mockResolvedValue(
        true,
      );

      await handleMobileRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Activité suspecte détectée. Reconnectez-vous.",
        code: "TOKEN_THEFT_DETECTED",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (refreshTokenService.validateRefreshToken as jest.Mock).mockRejectedValue(
        new Error("Redis Error"),
      );

      await handleMobileRefreshToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors du rafraîchissement.",
        code: "INTERNAL_ERROR",
      });
    });
  });
});
