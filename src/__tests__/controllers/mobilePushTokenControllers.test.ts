/**
 * Tests unitaires pour mobilePushTokenControllers
 * Teste les fonctions de gestion des tokens push notifications
 */

jest.mock("../../services/pushTokenService");
jest.mock("../../services/loggerService");

import { Request, Response } from "express";
import {
  handleRegisterPushToken,
  handleDeletePushToken,
} from "../../controllers/mobilePushTokenControllers";
import { mockRequest, mockResponse } from "../mocks";
import * as pushTokenService from "../../services/pushTokenService";

describe("mobilePushTokenControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // HANDLE REGISTER PUSH TOKEN
  // ═══════════════════════════════════════════════════════════════════

  describe("handleRegisterPushToken", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
          platform: "ios",
          deviceId: "device-abc-123",
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("should register a push token successfully", async () => {
      const mockPushToken = {
        _id: "pushtoken-123",
        userId: "user-123",
        token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "ios",
        deviceId: "device-abc-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (pushTokenService.registerToken as jest.Mock).mockResolvedValue(
        mockPushToken,
      );

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
      });
      expect(pushTokenService.registerToken).toHaveBeenCalledWith(
        "user-123",
        "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        "ios",
        "device-abc-123",
      );
    });

    it("should reject if not authenticated", async () => {
      (req as any).user = undefined;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    });

    it("should reject if token is missing", async () => {
      req.body.token = undefined;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Tous les champs sont requis: token, platform, deviceId.",
        code: "MISSING_FIELDS",
      });
    });

    it("should reject if platform is missing", async () => {
      req.body.platform = undefined;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Tous les champs sont requis: token, platform, deviceId.",
        code: "MISSING_FIELDS",
      });
    });

    it("should reject if deviceId is missing", async () => {
      req.body.deviceId = undefined;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Tous les champs sont requis: token, platform, deviceId.",
        code: "MISSING_FIELDS",
      });
    });

    it("should reject if platform is invalid", async () => {
      req.body.platform = "windows";

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La plateforme doit être 'ios' ou 'android'.",
        code: "INVALID_PLATFORM",
      });
    });

    it("should reject if token is not a string", async () => {
      req.body.token = 12345;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le token doit être une chaîne de caractères non vide.",
        code: "INVALID_TOKEN",
      });
    });

    it("should reject if token is empty string", async () => {
      req.body.token = "   ";

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le token doit être une chaîne de caractères non vide.",
        code: "INVALID_TOKEN",
      });
    });

    it("should reject if deviceId is not a string", async () => {
      req.body.deviceId = 12345;

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le deviceId doit être une chaîne de caractères non vide.",
        code: "INVALID_DEVICE_ID",
      });
    });

    it("should reject if deviceId is empty string", async () => {
      req.body.deviceId = "   ";

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le deviceId doit être une chaîne de caractères non vide.",
        code: "INVALID_DEVICE_ID",
      });
    });

    it("should handle android platform", async () => {
      req.body.platform = "android";

      const mockPushToken = {
        _id: "pushtoken-123",
        userId: "user-123",
        token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "android",
        deviceId: "device-abc-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (pushTokenService.registerToken as jest.Mock).mockResolvedValue(
        mockPushToken,
      );

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
      });
    });

    it("should handle internal server error", async () => {
      (pushTokenService.registerToken as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleRegisterPushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de l'enregistrement du token.",
        code: "INTERNAL_ERROR",
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // HANDLE DELETE PUSH TOKEN
  // ═══════════════════════════════════════════════════════════════════

  describe("handleDeletePushToken", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          deviceId: "device-abc-123",
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("should delete a push token successfully", async () => {
      (pushTokenService.removeToken as jest.Mock).mockResolvedValue(true);

      await handleDeletePushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
      });
      expect(pushTokenService.removeToken).toHaveBeenCalledWith(
        "user-123",
        "device-abc-123",
      );
    });

    it("should reject if not authenticated", async () => {
      (req as any).user = undefined;

      await handleDeletePushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    });

    it("should reject if deviceId is missing", async () => {
      req.body.deviceId = undefined;

      await handleDeletePushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le deviceId est requis.",
        code: "MISSING_DEVICE_ID",
      });
    });

    it("should succeed even if token not found", async () => {
      (pushTokenService.removeToken as jest.Mock).mockResolvedValue(false);

      await handleDeletePushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
      });
    });

    it("should handle internal server error", async () => {
      (pushTokenService.removeToken as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleDeletePushToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la suppression du token.",
        code: "INTERNAL_ERROR",
      });
    });
  });
});
