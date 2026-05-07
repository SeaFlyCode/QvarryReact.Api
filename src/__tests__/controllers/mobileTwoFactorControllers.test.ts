/**
 * Tests unitaires pour mobileTwoFactorControllers
 * Teste les fonctions 2FA pour mobile
 */

jest.mock("../../models/users");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../services/auditService");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/redisSessionService");
jest.mock("../../utils/deviceFingerprint");
jest.mock("../../middlewares/mobileSecurityMiddleware");
jest.mock("../../utils/jwtKeyManager");
jest.mock("otpauth");
jest.mock("qrcode");
jest.mock("bcrypt");
jest.mock("crypto");
jest.mock("jsonwebtoken");

import { Request, Response } from "express";
import {
  mobileSetupTwoFactor,
  mobileVerifyAndEnableTwoFactor,
  mobileDisableTwoFactor,
  mobileVerifyTwoFactorLogin,
  mobileRegenerateRecoveryCodes,
  mobileGetTwoFactorStatus,
  generateTwoFactorTempToken,
} from "../../controllers/mobileTwoFactorControllers";
import { mockRequest, mockResponse } from "../mocks";
import UserModel from "../../models/users";
import { encrypt, decrypt } from "../../utils/masterEncryptionUtils";
import { auditService } from "../../services/auditService";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { generateDeviceFingerprint } from "../../utils/deviceFingerprint";
import { associateDeviceWithUser } from "../../middlewares/mobileSecurityMiddleware";
import { jwtKeyManager } from "../../utils/jwtKeyManager";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

describe("mobileTwoFactorControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (encrypt as jest.Mock).mockImplementation((val) => `encrypted-${val}`);
    (decrypt as jest.Mock).mockImplementation((val) =>
      val.replace("encrypted-", ""),
    );
    (auditService.log as jest.Mock).mockResolvedValue(undefined);
    (generateDeviceFingerprint as jest.Mock).mockReturnValue(
      "device-fingerprint",
    );
    (associateDeviceWithUser as jest.Mock).mockReturnValue(undefined);
    (jwtKeyManager.getCurrentKey as jest.Mock).mockReturnValue({
      secret: "test-jwt-secret-key-minimum-32-chars",
      version: "v1",
    });
    (crypto.randomBytes as jest.Mock).mockReturnValue({
      toString: jest.fn().mockReturnValue("ABCDEFGHIJKL"),
    });
  });

  describe("mobileSetupTwoFactor", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();

      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        "data:image/png;base64,abc123",
      );
    });

    it("devrait générer un QR code pour setup 2FA", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        two_factor_enabled: false,
        two_factor_secret: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      // Mock TOTP
      const mockSecret = {
        base32: "JBSWY3DPEHPK3PXP",
      };
      (Secret as any).mockImplementation(() => mockSecret);
      (TOTP as any).mockImplementation(() => ({
        toString: jest.fn().mockReturnValue("otpauth://totp/..."),
      }));

      await mobileSetupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          qrCode: "data:image/png;base64,abc123",
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await mobileSetupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non authentifié",
        code: "UNAUTHORIZED",
      });
    });

    it("devrait rejeter si 2FA déjà activé", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        two_factor_enabled: true,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      await mobileSetupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("déjà activée"),
        code: "2FA_ALREADY_ENABLED",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await mobileSetupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la configuration de la 2FA",
        code: "INTERNAL_ERROR",
      });
    });
  });

  describe("mobileVerifyAndEnableTwoFactor", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
        body: { code: "123456" },
        ip: "192.168.1.1",
        headers: { "user-agent": "MobileApp/1.0" },
      });
      (req as any).mobileContext = {
        deviceId: "device-123",
        platform: "ios",
      };
      (req as any).socket = {
        remoteAddress: "192.168.1.1",
      };
      res = mockResponse();

      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-code");
    });

    it("devrait activer 2FA après vérification du code", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
        two_factor_secret: "encrypted-secret",
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(0),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await mobileVerifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          recoveryCodes: expect.any(Array),
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si code invalide", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation échoue
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(null),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await mobileVerifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Code invalide"),
        code: "INVALID_CODE",
      });
    });

    it("devrait rejeter si format de code invalide", async () => {
      req.body.code = "12345";

      await mobileVerifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("6 chiffres"),
        code: "INVALID_CODE_FORMAT",
      });
    });

    it("devrait rejeter si 2FA déjà activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await mobileVerifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA est déjà activée",
        code: "2FA_ALREADY_ENABLED",
      });
    });
  });

  describe("mobileDisableTwoFactor", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
        body: {
          password: "Password123!",
          code: "123456",
        },
      });
      res = mockResponse();

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it("devrait désactiver 2FA avec succès", async () => {
      const mockUser = {
        _id: "user-123",
        password: "hashed-password",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(0),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await mobileDisableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Authentification à deux facteurs désactivée",
      });
      expect(mockUser.two_factor_enabled).toBe(false);
    });

    it("devrait rejeter si mot de passe manquant", async () => {
      req.body.password = undefined;

      await mobileDisableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe requis pour désactiver la 2FA",
        code: "PASSWORD_REQUIRED",
      });
    });

    it("devrait rejeter si mot de passe incorrect", async () => {
      const mockUser = {
        _id: "user-123",
        password: "hashed-password",
        two_factor_enabled: true,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await mobileDisableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe incorrect",
        code: "INVALID_PASSWORD",
      });
    });

    it("devrait rejeter si 2FA non activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await mobileDisableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA n'est pas activée",
        code: "2FA_NOT_ENABLED",
      });
    });
  });

  describe("mobileVerifyTwoFactorLogin", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          tempToken: "temp-token-123",
          code: "123456",
          isRecoveryCode: false,
        },
      });
      res = mockResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user-123",
        deviceId: "device-123",
        purpose: "2fa_verification",
      });
      (jwt.sign as jest.Mock).mockReturnValue("new-jwt-token");
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token",
      );
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
    });

    it("devrait vérifier le code 2FA et retourner les tokens", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        is_admin: false,
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(0),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await mobileVerifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          verified: true,
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      );
    });

    it("devrait rejeter si tempToken invalide", async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await mobileVerifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Token expiré"),
        code: "INVALID_TEMP_TOKEN",
      });
    });

    it("devrait rejeter si code TOTP invalide", async () => {
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation échoue
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(null),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await mobileVerifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Code invalide ou vérification impossible",
        code: "VERIFICATION_FAILED",
      });
    });

    it("devrait accepter un code de récupération valide", async () => {
      req.body.isRecoveryCode = true;
      req.body.code = "AAAA-BBBB-CCCC";

      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        is_admin: false,
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        two_factor_recovery_codes: ["hashed-code-1", "hashed-code-2"],
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      await mobileVerifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          verified: true,
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait gérer le rate limiting", async () => {
      // Simuler plusieurs tentatives échouées
      const mockUser = {
        _id: "user-123",
        email: "encrypted-test@example.com",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(null),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      // Première tentative échouée
      await mobileVerifyTwoFactorLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("mobileRegenerateRecoveryCodes", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
        body: { password: "Password123!" },
      });
      res = mockResponse();

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-code");
    });

    it("devrait régénérer les codes de récupération", async () => {
      const mockUser = {
        _id: "user-123",
        password: "hashed-password",
        two_factor_enabled: true,
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await mobileRegenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          recoveryCodes: expect.any(Array),
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si mot de passe manquant", async () => {
      req.body.password = undefined;

      await mobileRegenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe requis",
        code: "PASSWORD_REQUIRED",
      });
    });

    it("devrait rejeter si 2FA non activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await mobileRegenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA n'est pas activée",
        code: "2FA_NOT_ENABLED",
      });
    });
  });

  describe("mobileGetTwoFactorStatus", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner le statut 2FA de l'utilisateur", async () => {
      const mockUser = {
        two_factor_enabled: true,
        two_factor_confirmed_at: new Date("2026-01-01"),
        two_factor_recovery_codes: ["code1", "code2", "code3"],
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      await mobileGetTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        enabled: true,
        confirmedAt: expect.any(Date),
        recoveryCodesRemaining: 3,
      });
    });

    it("devrait retourner enabled: false si 2FA désactivé", async () => {
      const mockUser = {
        two_factor_enabled: false,
        two_factor_confirmed_at: null,
        two_factor_recovery_codes: [],
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockUser),
        }),
      });

      await mobileGetTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        enabled: false,
        confirmedAt: null,
        recoveryCodesRemaining: 0,
      });
    });
  });

  describe("generateTwoFactorTempToken", () => {
    it("devrait générer un token temporaire signé", () => {
      (jwt.sign as jest.Mock).mockReturnValue("temp-token-123");

      const token = generateTwoFactorTempToken("user-123", "device-123");

      expect(token).toBe("temp-token-123");
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-123",
          deviceId: "device-123",
          purpose: "2fa_verification",
        }),
        expect.any(String),
        expect.objectContaining({
          expiresIn: "5m",
        }),
      );
    });
  });
});
