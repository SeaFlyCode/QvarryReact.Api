/**
 * Tests unitaires pour sessionControllers
 * Teste la fonction de révocation des sessions
 */

jest.mock("../../models/users");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/auditService");

import { Request, Response } from "express";
import { revokeAllOtherSessions } from "../../controllers/sessionControllers";
import { UserModel } from "../../models/users";
import { refreshTokenService } from "../../services/refreshTokenService";
import { auditService } from "../../services/auditService";
import { mockRequest, mockResponse } from "../mocks";
import bcrypt from "bcrypt";

// Mock bcrypt
jest.mock("bcrypt");

describe("sessionControllers", () => {
  describe("revokeAllOtherSessions", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait révoquer toutes les autres sessions avec succès", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "validPassword123" };
      req.ip = "127.0.0.1";
      req.get = jest.fn().mockReturnValue("test-user-agent");

      const mockUser = {
        _id: "userId123",
        password: "$2b$10$hashedPassword",
      };

      const mockSessions = [
        { tokenId: "currentToken", ipAddress: "127.0.0.1" },
        { tokenId: "token1", ipAddress: "192.168.1.1" },
        { tokenId: "token2", ipAddress: "192.168.1.2" },
      ];

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockResolvedValue(mockSessions);
      (refreshTokenService.revokeToken as jest.Mock).mockResolvedValue(true);
      (auditService.log as jest.Mock).mockResolvedValue(true);

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(UserModel.findById).toHaveBeenCalledWith("userId123");
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "validPassword123",
        "$2b$10$hashedPassword",
      );
      expect(refreshTokenService.revokeToken).toHaveBeenCalledTimes(2);
      expect(refreshTokenService.revokeToken).toHaveBeenCalledWith(
        "token1",
        "user_revoked_all",
      );
      expect(refreshTokenService.revokeToken).toHaveBeenCalledWith(
        "token2",
        "user_revoked_all",
      );
      expect(auditService.log).toHaveBeenCalledWith({
        userId: "userId123",
        action: "ALL_OTHER_SESSIONS_REVOKED",
        level: "warning",
        ipAddress: "127.0.0.1",
        userAgent: "test-user-agent",
        details: { revokedCount: 2, keptTokenId: "currentToken" },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "2 session(s) révoquée(s)",
        revokedCount: 2,
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
    });

    it("devrait rejeter si le mot de passe est manquant", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = {};

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Le mot de passe est requis pour cette opération",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas trouvé", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "password123" };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisateur non trouvé",
      });
    });

    it("devrait rejeter si le mot de passe est incorrect", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "wrongPassword" };

      const mockUser = {
        _id: "userId123",
        password: "$2b$10$hashedPassword",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Mot de passe incorrect",
      });
    });

    it("devrait gérer le cas où il n'y a qu'une seule session (actuelle)", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "validPassword123" };
      req.ip = "127.0.0.1";
      req.get = jest.fn().mockReturnValue("test-user-agent");

      const mockUser = {
        _id: "userId123",
        password: "$2b$10$hashedPassword",
      };

      const mockSessions = [
        { tokenId: "currentToken", ipAddress: "127.0.0.1" },
      ];

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockResolvedValue(mockSessions);
      (refreshTokenService.revokeToken as jest.Mock).mockResolvedValue(true);
      (auditService.log as jest.Mock).mockResolvedValue(true);

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(refreshTokenService.revokeToken).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "0 session(s) révoquée(s)",
        revokedCount: 0,
      });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "password123" };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockRejectedValue(new Error("DB Error")),
      });

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la révocation des sessions",
      });
    });

    it("devrait gérer les erreurs du service de refresh token", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.body = { password: "validPassword123" };

      const mockUser = {
        _id: "userId123",
        password: "$2b$10$hashedPassword",
      };

      (UserModel.findById as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockRejectedValue(new Error("Service Error"));

      await revokeAllOtherSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la révocation des sessions",
      });
    });
  });
});
