/**
 * Tests unitaires pour twoFactorControllers
 * Teste les fonctions 2FA pour Web/PC
 */

jest.mock("../../models/users");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../services/auditService");
jest.mock("otpauth");
jest.mock("qrcode");
jest.mock("bcrypt");
jest.mock("crypto");
jest.mock("jsonwebtoken");

import { Request, Response } from "express";
import {
  setupTwoFactor,
  verifyAndEnableTwoFactor,
  disableTwoFactor,
  verifyTwoFactorLogin,
  regenerateRecoveryCodes,
  getTwoFactorStatus,
} from "../../controllers/twoFactorControllers";
import { mockRequest, mockResponse } from "../mocks";
import UserModel from "../../models/users";
import { encrypt, decrypt } from "../../utils/masterEncryptionUtils";
import { auditService } from "../../services/auditService";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

describe("twoFactorControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (encrypt as jest.Mock).mockImplementation((val) => `encrypted-${val}`);
    (decrypt as jest.Mock).mockImplementation((val) =>
      val.replace("encrypted-", ""),
    );
    (auditService.log as jest.Mock).mockResolvedValue(undefined);
    // Ensure bcrypt.hash always returns a resolved promise for each call
    (bcrypt.hash as jest.Mock).mockImplementation(
      (code: string, rounds: number) => Promise.resolve(`hashed-${code}`),
    );
    // Mock crypto.randomBytes to generate deterministic recovery codes
    (crypto.randomBytes as jest.Mock).mockImplementation((size: number) => {
      return Buffer.from("A".repeat(size * 2), "hex");
    });
  });

  describe("setupTwoFactor", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();

      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        "data:image/png;base64,qrcode",
      );
    });

    it("devrait générer un QR code pour la configuration 2FA", async () => {
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
        toString: jest
          .fn()
          .mockReturnValue("otpauth://totp/Qvarry:test@example.com"),
      }));

      await setupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          qrCode: "data:image/png;base64,qrcode",
          message: expect.stringContaining("Scannez"),
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await setupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non authentifié",
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

      await setupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("déjà activée"),
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockRejectedValue(new Error("Database error")),
      });

      await setupTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la configuration de la 2FA",
      });
    });
  });

  describe("verifyAndEnableTwoFactor", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
        body: { code: "123456" },
      });
      res = mockResponse();
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

      await verifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("activée"),
          recoveryCodes: expect.any(Array),
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
      expect(mockUser.two_factor_enabled).toBe(true);
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

      await verifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("Code invalide"),
      });
    });

    it("devrait rejeter si format de code invalide", async () => {
      req.body.code = "12345";

      await verifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.stringContaining("6 chiffres"),
      });
    });

    it("devrait rejeter si 2FA déjà activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await verifyAndEnableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA est déjà activée",
      });
    });
  });

  describe("disableTwoFactor", () => {
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

      await disableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Authentification à deux facteurs désactivée",
      });
      expect(mockUser.two_factor_enabled).toBe(false);
    });

    it("devrait rejeter si mot de passe manquant", async () => {
      req.body.password = undefined;

      await disableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe requis pour désactiver la 2FA",
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

      await disableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe incorrect",
      });
    });

    it("devrait rejeter si 2FA non activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await disableTwoFactor(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA n'est pas activée",
      });
    });
  });

  describe("verifyTwoFactorLogin", () => {
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
        type: "temp-2fa-web",
      });
    });

    it("devrait vérifier le code TOTP avec succès", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(0),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        verified: true,
      });
    });

    it("devrait rejeter si tempToken invalide", async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token temporaire invalide ou expiré",
      });
    });

    it("devrait rejeter si type de token incorrect", async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user-123",
        type: "invalid-type",
      });

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Token temporaire invalide",
      });
    });

    it("devrait rejeter si code TOTP invalide", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      // Mock TOTP validation échoue
      (TOTP as any).mockImplementation(() => ({
        validate: jest.fn().mockReturnValue(null),
      }));
      (Secret.fromBase32 as jest.Mock).mockReturnValue({});

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Code invalide",
      });
    });

    it("devrait accepter un code de récupération valide", async () => {
      req.body.isRecoveryCode = true;
      req.body.code = "AAAA-BBBB-CCCC";

      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        two_factor_recovery_codes: ["hashed-code-1", "hashed-code-2"],
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        verified: true,
      });
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si code de récupération invalide", async () => {
      req.body.isRecoveryCode = true;
      req.body.code = "AAAA-BBBB-CCCC";

      const mockUser = {
        _id: "user-123",
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        two_factor_recovery_codes: ["hashed-code-1", "hashed-code-2"],
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await verifyTwoFactorLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Code de récupération invalide",
      });
    });
  });

  describe("regenerateRecoveryCodes", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
        body: { password: "Password123!" },
      });
      res = mockResponse();

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it("devrait régénérer les codes de récupération", async () => {
      const mockUser = {
        _id: "user-123",
        password: "hashed-password",
        two_factor_enabled: true,
        save: jest.fn().mockResolvedValue(true),
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await regenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          recoveryCodes: expect.any(Array),
          message: expect.stringContaining("Nouveaux codes"),
        }),
      );
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("devrait rejeter si mot de passe manquant", async () => {
      req.body.password = undefined;

      await regenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe requis",
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

      await regenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe incorrect",
      });
    });

    it("devrait rejeter si 2FA non activé", async () => {
      const mockUser = {
        _id: "user-123",
        two_factor_enabled: false,
      };

      (UserModel.findById as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue(mockUser) });

      await regenerateRecoveryCodes(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La 2FA n'est pas activée",
      });
    });
  });

  describe("getTwoFactorStatus", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner le statut 2FA avec 2FA activé", async () => {
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

      await getTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        enabled: true,
        confirmedAt: expect.any(Date),
        recoveryCodesRemaining: 3,
      });
    });

    it("devrait retourner le statut 2FA avec 2FA désactivé", async () => {
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

      await getTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        enabled: false,
        confirmedAt: null,
        recoveryCodesRemaining: 0,
      });
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      req.user = undefined;

      await getTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non authentifié",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockRejectedValue(new Error("Database error")),
        }),
      });

      await getTwoFactorStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération du statut 2FA",
      });
    });
  });
});
