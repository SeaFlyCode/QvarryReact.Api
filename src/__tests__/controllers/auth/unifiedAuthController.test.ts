/**
 * Tests unitaires pour unifiedAuthController (P1 — login/2FA unifiés).
 * Vérifie :
 *   - Le handler login retourne JSON body sans poser de cookies
 *   - Le shape 403 est unifié { error: "FORBIDDEN", code, message }
 *   - Le handler 2FA accepte les anciens et nouveaux tempTokens
 *   - La détection web/mobile fonctionne
 */

jest.mock("../../../services/userService");
jest.mock("../../../services/refreshTokenService", () => ({
  refreshTokenService: {
    createRefreshToken: jest.fn(),
    validateRefreshToken: jest.fn(),
    detectTokenTheft: jest.fn(),
    rotateToken: jest.fn(),
  },
}));
jest.mock("../../../services/redisSessionService", () => ({
  redisSessionService: {
    isTokenBlacklisted: jest.fn(),
    validateSessionJti: jest.fn(),
    blacklistToken: jest.fn(),
    createSession: jest.fn(),
    storeSessionJti: jest.fn(),
    checkTwoFactorAttempts: jest.fn(),
    recordTwoFactorFailure: jest.fn(),
    resetTwoFactorAttempts: jest.fn(),
  },
}));
jest.mock("../../../services/auditService", () => ({
  auditService: { log: jest.fn() },
}));
jest.mock("../../../services/emailService");
jest.mock("../../../services/totpMigrationService", () => ({
  verifyTOTPCode: jest.fn().mockResolvedValue({ isValid: true, migrated: false }),
}));
jest.mock("../../../models/maintenance");
jest.mock("../../../models/users");
jest.mock("../../../controllers/auth/authHelpers");
jest.mock("../../../middlewares/rateLimitMiddleware");
jest.mock("../../../middlewares/correlationMiddleware", () => ({
  setRequestContext: jest.fn(),
}));
jest.mock("../../../utils/deviceFingerprint");
jest.mock("../../../utils/masterEncryptionUtils");
jest.mock("../../../utils/userSerializer", () => ({
  serializeUserForApi: jest.fn((u: any) => ({ _id: String(u?._id ?? ""), name: u?.name ?? "" })),
  serializeUsersForApi: jest.fn((arr: any) => arr.map((u: any) => ({ _id: String(u?._id ?? ""), name: u?.name ?? "" }))),
}));
jest.mock("bcrypt");
jest.mock("jsonwebtoken");

import { Request, Response } from "express";
import {
  handleUnifiedLogin,
  handleUnifiedComplete2FA,
} from "../../../controllers/auth/unifiedAuthController";
import { mockRequest, mockResponse, mockUser, mockUser2FA } from "../../mocks";
import { getUserByEmail } from "../../../services/userService";
import { refreshTokenService } from "../../../services/refreshTokenService";
import { redisSessionService } from "../../../services/redisSessionService";
import { auditService } from "../../../services/auditService";
import MaintenanceModel from "../../../models/maintenance";
import UserModel from "../../../models/users";
import {
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
  loadAndDecryptUserData,
} from "../../../controllers/auth/authHelpers";
import { resetRateLimit } from "../../../middlewares/rateLimitMiddleware";
import { generateDeviceFingerprint } from "../../../utils/deviceFingerprint";
import { decrypt } from "../../../utils/masterEncryptionUtils";
import { serializeUserForApi } from "../../../utils/userSerializer";
import { verifyTOTPCode } from "../../../services/totpMigrationService";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

describe("unifiedAuthController", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-key-min-32-chars-for-unit-tests";
    process.env.JWT_EXPIRES_IN = "15m";
    process.env.REFRESH_TOKEN_EXPIRES_IN = "48";
    (decrypt as jest.Mock).mockImplementation((v: string) =>
      typeof v === "string" ? v.replace("encrypted-", "") : v,
    );
    (generateDeviceFingerprint as jest.Mock).mockReturnValue("device-fp");

    // jest config a `resetMocks: true` → les mock factories sont réinitialisés
    // entre tests, on ré-applique donc les implémentations par défaut ici.
    (serializeUserForApi as jest.Mock).mockImplementation((u: any) => ({
      _id: String(u?._id ?? ""),
      name: u?.name ?? "",
    }));
    (verifyTOTPCode as jest.Mock).mockResolvedValue({
      isValid: true,
      migrated: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // handleUnifiedLogin
  // ═══════════════════════════════════════════════════════════════════
  describe("handleUnifiedLogin", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { email: "user@test.com", password: "Password123!" },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      (checkLoginAttempts as jest.Mock).mockResolvedValue({ allowed: true });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (MaintenanceModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "access-token-abc",
        tokenId: "jti-1",
        keyVersion: "v1",
      });
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token-xyz",
      );
      (loadAndDecryptUserData as jest.Mock).mockResolvedValue(undefined);
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(undefined);
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(undefined);
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
      (resetLoginAttempts as jest.Mock).mockResolvedValue(undefined);
      (resetRateLimit as jest.Mock).mockReturnValue(undefined);
    });

    it("rejette une requête sans email/password (400)", async () => {
      req.body = {};
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "MISSING_CREDENTIALS" }),
      );
    });

    it("rejette un format email invalide (400)", async () => {
      req.body = { email: "not-an-email", password: "x" };
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_EMAIL_FORMAT" }),
      );
    });

    it("retourne 429 en cas de trop de tentatives", async () => {
      (checkLoginAttempts as jest.Mock).mockResolvedValue({
        allowed: false,
        message: "Trop de tentatives",
        waitTime: 5,
      });
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "TOO_MANY_ATTEMPTS" }),
      );
    });

    it("retourne 401 sur identifiants incorrects", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_CREDENTIALS" }),
      );
      expect(recordFailedLogin).toHaveBeenCalledWith(
        "user@test.com",
        expect.anything(),
      );
    });

    it("retourne 403 BLOCKED si compte bloqué (shape unifié)", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser({ is_blocked: true }),
      );
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "BLOCKED",
          message: expect.any(String),
        }),
      );
    });

    it("retourne 403 UNVERIFIED si email non vérifié", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser({ is_verified: false }),
      );
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "UNVERIFIED",
        }),
      );
    });

    it("retourne 403 PENDING_VALIDATION si compte en attente", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser({ is_verified: true, is_admin_validated: false }),
      );
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "PENDING_VALIDATION",
        }),
      );
    });

    it("retourne 403 PENDING_VALIDATION (rejected) si compte refusé", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser({
          is_verified: true,
          is_admin_validated: false,
          admin_validation_rejected: true,
          admin_rejection_reason: "Spam",
        }),
      );
      await handleUnifiedLogin(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "FORBIDDEN",
          code: "PENDING_VALIDATION",
          details: expect.objectContaining({
            rejected: true,
            rejectionReason: "Spam",
          }),
        }),
      );
    });

    it("retourne requires2FA + tempToken si 2FA activé", async () => {
      (getUserByEmail as jest.Mock).mockResolvedValue(
        mockUser2FA({ is_verified: true, is_admin_validated: true }),
      );
      (jwt.sign as jest.Mock).mockReturnValue("temp-token-2fa");

      await handleUnifiedLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requires2FA: true,
          tempToken: "temp-token-2fa",
        }),
      );
      expect(resetLoginAttempts).toHaveBeenCalledWith("user@test.com");
    });

    it("connecte un utilisateur valide avec accessToken/refreshToken/user en JSON (web)", async () => {
      const user = mockUser({
        _id: "user-1",
        is_verified: true,
        is_admin_validated: true,
      });
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleUnifiedLogin(req as Request, res as Response);

      expect(generateSecureToken).toHaveBeenCalledWith(
        "user-1",
        false,
        "web",
        undefined,
        undefined,
      );
      expect(loadAndDecryptUserData).toHaveBeenCalledWith("user-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "access-token-abc",
          refreshToken: "refresh-token-xyz",
          user: expect.any(Object),
          tokenExpiresIn: 900,
          refreshTokenExpiresIn: 48 * 3600,
        }),
      );
      // P1 — pas de cookies posés serveur sur le handler unifié
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it("rejette login mobile sans device-id (400 DEVICE_ID_MISSING)", async () => {
      const user = mockUser({
        _id: "user-1",
        is_verified: true,
        is_admin_validated: true,
      });
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (req as any).clientType = "mobile"; // Marqueur mobile
      // Pas de header x-device-id

      await handleUnifiedLogin(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "DEVICE_ID_MISSING" }),
      );
    });

    it("connecte un utilisateur mobile avec device-id et n'appelle pas loadAndDecryptUserData", async () => {
      const user = mockUser({
        _id: "user-1",
        is_verified: true,
        is_admin_validated: true,
        authorized_devices: [],
      });
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue(undefined);
      (UserModel.findById as jest.Mock).mockResolvedValue(user);

      // Marqueur explicite mobile (la route alias /mobile/auth/login utilise markAsMobile)
      const reqMobile: any = { ...req };
      reqMobile.clientType = "mobile";
      reqMobile.headers = { ...(req.headers || {}), "x-device-id": "device-123" };

      await handleUnifiedLogin(reqMobile as Request, res as Response);

      expect(generateSecureToken).toHaveBeenCalledWith(
        "user-1",
        false,
        "mobile",
        undefined,
        "device-123",
      );
      // En mobile, pas de chargement de session memoryStorage
      expect(loadAndDecryptUserData).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // handleUnifiedComplete2FA
  // ═══════════════════════════════════════════════════════════════════
  describe("handleUnifiedComplete2FA", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: { tempToken: "temp-token", code: "123456" },
        ip: "127.0.0.1",
      });
      res = mockResponse();

      (redisSessionService.checkTwoFactorAttempts as jest.Mock).mockResolvedValue({
        allowed: true,
      });
      (redisSessionService.recordTwoFactorFailure as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.resetTwoFactorAttempts as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.createSession as jest.Mock).mockResolvedValue(undefined);
      (redisSessionService.storeSessionJti as jest.Mock).mockResolvedValue(undefined);
      (generateSecureToken as jest.Mock).mockReturnValue({
        token: "access-token-2fa",
        tokenId: "jti-2",
        keyVersion: "v1",
      });
      (refreshTokenService.createRefreshToken as jest.Mock).mockResolvedValue(
        "refresh-token-2fa",
      );
      (loadAndDecryptUserData as jest.Mock).mockResolvedValue(undefined);
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
    });

    it("rejette si tempToken manquant (400)", async () => {
      req.body = { code: "123456" };
      await handleUnifiedComplete2FA(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "MISSING_TEMP_TOKEN" }),
      );
    });

    it("rejette si code manquant (400)", async () => {
      req.body = { tempToken: "x" };
      await handleUnifiedComplete2FA(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "MISSING_CODE" }),
      );
    });

    it("rejette un tempToken invalide (401)", async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("invalid");
      });
      await handleUnifiedComplete2FA(req as Request, res as Response);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_TEMP_TOKEN" }),
      );
    });

    it("accepte le format legacy web (type: 'temp-2fa-web')", async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user-123",
        type: "temp-2fa-web",
      });
      const userMock = {
        _id: "user-123",
        email: "encrypted-user@test.com",
        is_admin: false,
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        two_factor_recovery_codes: [],
        two_factor_algorithm: "sha512",
        save: jest.fn().mockResolvedValue(undefined),
      };
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(userMock),
      });

      await handleUnifiedComplete2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: "access-token-2fa",
          refreshToken: "refresh-token-2fa",
          user: expect.any(Object),
        }),
      );
    });

    it("accepte le format unifié (purpose: '2fa_verification')", async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user-456",
        purpose: "2fa_verification",
        client: "mobile",
        deviceId: "device-aaa",
      });
      const userMock = {
        _id: "user-456",
        email: "encrypted-user2@test.com",
        is_admin: false,
        two_factor_enabled: true,
        two_factor_secret: "encrypted-secret",
        two_factor_recovery_codes: [],
        two_factor_algorithm: "sha512",
        save: jest.fn().mockResolvedValue(undefined),
      };
      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(userMock),
      });

      req.headers = { ...(req.headers || {}), "x-device-id": "device-aaa" };

      await handleUnifiedComplete2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      // En mobile, loadAndDecryptUserData ne doit PAS être appelé
      expect(loadAndDecryptUserData).not.toHaveBeenCalled();
    });

    it("retourne 429 si trop de tentatives 2FA", async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: "user-1",
        purpose: "2fa_verification",
      });
      (redisSessionService.checkTwoFactorAttempts as jest.Mock).mockResolvedValue({
        allowed: false,
        waitTime: 10,
      });

      await handleUnifiedComplete2FA(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "TOO_MANY_ATTEMPTS" }),
      );
    });
  });
});
