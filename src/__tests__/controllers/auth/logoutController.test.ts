/**
 * Tests unitaires pour logoutController
 * Teste les fonctions de déconnexion utilisateur
 */

jest.mock("../../../services/memoryStorageService");
jest.mock("../../../services/refreshTokenService");
jest.mock("../../../services/redisSessionService");
jest.mock("../../../services/syncService");
jest.mock("../../../models/users");
jest.mock("../../../utils/userEncryptionUtils", () => ({
  clearUserKeyCache: jest.fn(),
}));
jest.mock("jsonwebtoken");

import { Request, Response } from "express";
import { handleLogoutUser } from "../../../controllers/auth/logoutController";
import { mockRequest, mockResponse } from "../../mocks";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../../../services/memoryStorageService";
import { refreshTokenService } from "../../../services/refreshTokenService";
import { redisSessionService } from "../../../services/redisSessionService";
import { syncService } from "../../../services/syncService";
import UserModel from "../../../models/users";
import { clearUserKeyCache } from "../../../utils/userEncryptionUtils";

describe("logoutController", () => {
  describe("handleLogoutUser", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();

      // Mock JWT verify
      (jwt.verify as jest.Mock).mockReturnValue({
        id: "507f1f77bcf86cd799439011",
        jti: "token-id-123",
        exp: Math.floor(Date.now() / 1000) + 3600,
        platform: "web",
      });

      // Mock services
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(false);
      (memoryStorage.isDirty as jest.Mock).mockReturnValue(false);
      (memoryStorage.endSession as jest.Mock).mockReturnValue(undefined);
      (refreshTokenService.revokeToken as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.deleteSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.deleteSessionJti as jest.Mock).mockResolvedValue(
        undefined,
      );
      (UserModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });
    });

    it("devrait rejeter une requête sans token", async () => {
      req.cookies = {};
      req.headers = {};

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Token manquant.",
      });
    });

    it("devrait déconnecter avec succès (token dans cookies)", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);

      await handleLogoutUser(req as Request, res as Response);

      expect(jwt.verify).toHaveBeenCalledWith(
        "valid-jwt-token",
        process.env.JWT_SECRET,
        { algorithms: ["HS256"] },
      );

      expect(res.clearCookie).toHaveBeenCalledWith("token", expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith(
        "refreshToken",
        expect.any(Object),
      );

      expect(refreshTokenService.revokeToken).toHaveBeenCalledWith(
        "token-id-123",
        "logout",
      );

      expect(redisSessionService.deleteSession).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "token-id-123",
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Déconnexion réussie et données synchronisées.",
        logout: true,
        syncSuccess: true,
      });
    });

    it("devrait déconnecter avec succès (token dans headers)", async () => {
      req.cookies = {};
      req.headers = { authorization: "Bearer valid-jwt-token" };

      await handleLogoutUser(req as Request, res as Response);

      expect(jwt.verify).toHaveBeenCalledWith(
        "valid-jwt-token",
        process.env.JWT_SECRET,
        { algorithms: ["HS256"] },
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait nettoyer la session Redis et le JTI", async () => {
      req.cookies = { token: "valid-jwt-token" };

      await handleLogoutUser(req as Request, res as Response);

      expect(redisSessionService.deleteSession).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "token-id-123",
      );

      expect(redisSessionService.deleteSessionJti).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "web",
      );
    });

    it("devrait invalider le token de reset de mot de passe", async () => {
      req.cookies = { token: "valid-jwt-token" };

      await handleLogoutUser(req as Request, res as Response);

      expect(UserModel.updateOne).toHaveBeenCalledWith(
        { _id: "507f1f77bcf86cd799439011" },
        {
          $set: {
            reset_password_token: "",
            reset_password_expires: new Date(0),
          },
        },
      );
    });

    it("devrait nettoyer le cache des clés utilisateur", async () => {
      req.cookies = { token: "valid-jwt-token" };

      await handleLogoutUser(req as Request, res as Response);

      expect(clearUserKeyCache).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );
    });

    it("devrait gérer un token JWT invalide", async () => {
      req.cookies = { token: "invalid-token" };
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Déconnexion effectuée (token invalide ou expiré).",
      });
    });

    it("devrait synchroniser les données si la session est dirty", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (memoryStorage.isDirty as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({ success: true });

      await handleLogoutUser(req as Request, res as Response);

      expect(syncService.syncNow).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );
      expect(memoryStorage.endSession).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Déconnexion réussie et données synchronisées.",
        logout: true,
        syncSuccess: true,
      });
    });

    it("devrait gérer l'échec de la synchronisation", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (memoryStorage.isDirty as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockResolvedValue({
        success: false,
        error: "Sync failed",
      });

      await handleLogoutUser(req as Request, res as Response);

      expect(memoryStorage.endSession).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "Déconnexion effectuée mais échec de la synchronisation des données.",
        error: "Sync failed",
        logout: true,
        syncFailed: true,
      });
    });

    it("devrait gérer une exception lors de la synchronisation", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(true);
      (memoryStorage.isDirty as jest.Mock).mockReturnValue(true);
      (syncService.syncNow as jest.Mock).mockRejectedValue(
        new Error("Sync exception"),
      );

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "Déconnexion effectuée mais erreur lors de la synchronisation.",
        error: "Sync exception",
        logout: true,
        syncFailed: true,
      });
    });

    it("devrait retourner succès si pas de session active", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (memoryStorage.hasSession as jest.Mock).mockReturnValue(false);

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Déconnexion réussie (pas de session active).",
      });

      expect(syncService.syncNow).not.toHaveBeenCalled();
    });

    it("devrait gérer l'absence de JTI dans le token", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (jwt.verify as jest.Mock).mockReturnValue({
        id: "507f1f77bcf86cd799439011",
        exp: Math.floor(Date.now() / 1000) + 3600,
        platform: "web",
      });

      await handleLogoutUser(req as Request, res as Response);

      expect(refreshTokenService.revokeToken).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait gérer l'absence de JWT_SECRET", async () => {
      req.cookies = { token: "valid-jwt-token" };
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Déconnexion effectuée (token invalide ou expiré).",
      });

      process.env.JWT_SECRET = originalSecret;
    });

    it("devrait gérer les erreurs générales", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      // Force une erreur après le catch du JWT
      (res.clearCookie as jest.Mock).mockImplementation(() => {
        throw new Error("Clear cookie error");
      });

      await handleLogoutUser(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Erreur lors de la déconnexion de l'utilisateur.",
          logout: false,
        }),
      );
    });

    it("devrait gérer platform mobile dans le token", async () => {
      req.cookies = { token: "valid-jwt-token" };
      (jwt.verify as jest.Mock).mockReturnValue({
        id: "userId",
        jti: "jti",
        exp: Math.floor(Date.now() / 1000) + 3600,
        platform: "mobile",
      });

      await handleLogoutUser(req as Request, res as Response);

      expect(redisSessionService.deleteSessionJti).toHaveBeenCalledWith(
        "userId",
        "mobile",
      );
    });
  });
});
