/**
 * Tests unitaires pour securityControllers
 * Teste les fonctions de gestion de la sécurité (sessions, événements)
 */

jest.mock("../../services/refreshTokenService");
jest.mock("../../services/auditService");

import { Request, Response } from "express";
import {
  getUserSessions,
  revokeSession,
  getSecurityEvents,
} from "../../controllers/securityControllers";
import { refreshTokenService } from "../../services/refreshTokenService";
import { auditService } from "../../services/auditService";
import { mockRequest, mockResponse } from "../mocks";

describe("securityControllers", () => {
  describe("getUserSessions", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait retourner les sessions de l'utilisateur avec la session actuelle en premier", async () => {
      req.user = { id: "userId123", tokenId: "token1", isAdmin: false };

      const mockSessions = [
        {
          tokenId: "token2",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          createdAt: new Date("2025-01-01"),
          lastUsedAt: new Date("2025-01-03"),
          expiresAt: new Date("2025-02-01"),
        },
        {
          tokenId: "token1",
          ipAddress: "127.0.0.1",
          userAgent: "Chrome",
          createdAt: new Date("2025-01-02"),
          lastUsedAt: new Date("2025-01-02"),
          expiresAt: new Date("2025-02-02"),
        },
        {
          tokenId: "token3",
          ipAddress: "10.0.0.1",
          userAgent: "Firefox",
          createdAt: new Date("2025-01-01"),
          lastUsedAt: new Date("2025-01-01"),
          expiresAt: new Date("2025-02-01"),
        },
      ];

      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockResolvedValue(mockSessions);

      await getUserSessions(req as Request, res as Response);

      expect(refreshTokenService.getUserActiveSessions).toHaveBeenCalledWith(
        "userId123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();

      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.sessions).toHaveLength(3);
      expect(response.count).toBe(3);
      // La session actuelle doit être en premier
      expect(response.sessions[0].tokenId).toBe("token1");
      expect(response.sessions[0].isCurrent).toBe(true);
      // Les autres sessions sont triées par lastUsedAt décroissant
      expect(response.sessions[1].isCurrent).toBe(false);
      expect(response.sessions[2].isCurrent).toBe(false);
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await getUserSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
    });

    it("devrait gérer les erreurs du service", async () => {
      req.user = { id: "userId123", tokenId: "token1", isAdmin: false };

      (
        refreshTokenService.getUserActiveSessions as jest.Mock
      ).mockRejectedValue(new Error("Service Error"));

      await getUserSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des sessions",
      });
    });
  });

  describe("revokeSession", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      req.params = {};
      req.ip = "127.0.0.1";
      req.get = jest.fn().mockReturnValue("test-user-agent");
    });

    it("devrait révoquer une session avec succès", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.params = { tokenId: "tokenToRevoke" };

      (refreshTokenService.revokeToken as jest.Mock).mockResolvedValue(true);
      (auditService.log as jest.Mock).mockResolvedValue(true);

      await revokeSession(req as Request, res as Response);

      expect(refreshTokenService.revokeToken).toHaveBeenCalledWith(
        "tokenToRevoke",
        "user_revoked",
      );
      expect(auditService.log).toHaveBeenCalledWith({
        userId: "userId123",
        action: "SESSION_REVOKED_BY_USER",
        level: "info",
        ipAddress: "127.0.0.1",
        userAgent: "test-user-agent",
        details: { revokedTokenId: "tokenToRevoke" },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Session révoquée avec succès",
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;
      req.params = { tokenId: "tokenToRevoke" };

      await revokeSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
    });

    it("devrait rejeter si tokenId est manquant", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.params = {};

      await revokeSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "ID de session manquant",
      });
    });

    it("devrait rejeter si on tente de révoquer la session actuelle", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.params = { tokenId: "currentToken" };

      await revokeSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Utilisez la déconnexion pour terminer votre session actuelle",
      });
    });

    it("devrait gérer les erreurs du service", async () => {
      req.user = { id: "userId123", tokenId: "currentToken", isAdmin: false };
      req.params = { tokenId: "tokenToRevoke" };

      (refreshTokenService.revokeToken as jest.Mock).mockRejectedValue(
        new Error("Service Error"),
      );

      await revokeSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la révocation de la session",
      });
    });
  });

  describe("getSecurityEvents", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait retourner les événements de sécurité filtrés", async () => {
      req.user = { id: "userId123", tokenId: "token1", isAdmin: false };

      const mockEvents = [
        {
          userId: "userId123",
          action: "LOGIN_SUCCESS",
          level: "info",
          timestamp: new Date(),
        },
        {
          userId: "userId123",
          action: "PASSWORD_CHANGED",
          level: "warning",
          timestamp: new Date(),
        },
        {
          userId: "userId123",
          action: "SOME_OTHER_ACTION",
          level: "info",
          timestamp: new Date(),
        },
        {
          userId: "userId123",
          action: "LOGOUT",
          level: "info",
          timestamp: new Date(),
        },
      ];

      (auditService.getUserLogs as jest.Mock).mockResolvedValue(mockEvents);

      await getSecurityEvents(req as Request, res as Response);

      expect(auditService.getUserLogs).toHaveBeenCalledWith("userId123", 50);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();

      const response = (res.json as jest.Mock).mock.calls[0][0];
      // Devrait filtrer uniquement les actions de sécurité
      expect(response.events).toHaveLength(3);
      expect(response.count).toBe(3);
      expect(
        response.events.every((e: any) =>
          [
            "LOGIN_SUCCESS",
            "LOGIN_FAILED",
            "LOGOUT",
            "PASSWORD_CHANGED",
            "REFRESH_TOKEN_CREATED",
            "REFRESH_TOKEN_REVOKED",
            "ALL_TOKENS_REVOKED",
            "TOKEN_THEFT_DETECTED",
            "EMAIL_VERIFIED",
            "PROFILE_UPDATED",
            "SESSION_REVOKED_BY_USER",
            "ALL_OTHER_SESSIONS_REVOKED",
          ].includes(e.action),
        ),
      ).toBe(true);
    });

    it("devrait rejeter si l'utilisateur n'est pas authentifié", async () => {
      req.user = undefined;

      await getSecurityEvents(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
    });

    it("devrait retourner un tableau vide si aucun événement de sécurité", async () => {
      req.user = { id: "userId123", tokenId: "token1", isAdmin: false };

      const mockEvents = [
        {
          userId: "userId123",
          action: "UNRELATED_ACTION_1",
          level: "info",
          timestamp: new Date(),
        },
        {
          userId: "userId123",
          action: "UNRELATED_ACTION_2",
          level: "info",
          timestamp: new Date(),
        },
      ];

      (auditService.getUserLogs as jest.Mock).mockResolvedValue(mockEvents);

      await getSecurityEvents(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.events).toHaveLength(0);
      expect(response.count).toBe(0);
    });

    it("devrait gérer les erreurs du service", async () => {
      req.user = { id: "userId123", tokenId: "token1", isAdmin: false };

      (auditService.getUserLogs as jest.Mock).mockRejectedValue(
        new Error("Service Error"),
      );

      await getSecurityEvents(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la récupération des événements",
      });
    });
  });
});
