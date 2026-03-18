jest.mock("jsonwebtoken");
jest.mock("crypto");

import { Request, Response } from "express";
import { getWebSocketToken } from "../../../controllers/auth/websocketController";
import { mockRequest, mockResponse } from "../../mocks";
import jwt from "jsonwebtoken";
import crypto from "crypto";

describe("websocketController", () => {
  describe("getWebSocketToken", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();

      // Mock crypto.randomBytes — appelé 2 fois par requête (un JTI par token)
      (crypto.randomBytes as jest.Mock)
        .mockReturnValueOnce({
          toString: jest.fn().mockReturnValue("notifications-jti-1"),
        })
        .mockReturnValueOnce({
          toString: jest.fn().mockReturnValue("messages-jti-1"),
        });

      // Mock jwt.sign — appelé 2 fois par requête
      (jwt.sign as jest.Mock)
        .mockReturnValueOnce("ws-notifications-token-mock")
        .mockReturnValueOnce("ws-messages-token-mock");
    });

    it("devrait générer deux tokens WebSocket avec succès", () => {
      req.user = {
        id: "507f1f77bcf86cd799439011",
        isAdmin: false,
      };

      getWebSocketToken(req as Request, res as Response);

      // Vérifier que jwt.sign a été appelé 2 fois
      expect(jwt.sign).toHaveBeenCalledTimes(2);

      // Token notifications
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        {
          id: "507f1f77bcf86cd799439011",
          type: "websocket",
          isAdmin: false,
          jti: "notifications-jti-1",
          wsType: "notifications",
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      // Token messages
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        {
          id: "507f1f77bcf86cd799439011",
          type: "websocket",
          isAdmin: false,
          jti: "messages-jti-1",
          wsType: "messages",
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        notificationsToken: "ws-notifications-token-mock",
        messagesToken: "ws-messages-token-mock",
        expiresIn: 300,
      });
    });

    it("devrait générer des tokens pour un admin", () => {
      req.user = {
        id: "admin123",
        isAdmin: true,
      };

      getWebSocketToken(req as Request, res as Response);

      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: "admin123",
          type: "websocket",
          isAdmin: true,
          wsType: "notifications",
        }),
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: "admin123",
          type: "websocket",
          isAdmin: true,
          wsType: "messages",
        }),
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter une requête sans utilisateur authentifié", () => {
      req.user = undefined;

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it("devrait rejeter une requête avec userId manquant", () => {
      req.user = { isAdmin: false };

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Non authentifié" });
    });

    it("devrait gérer l'absence de JWT_SECRET", () => {
      req.user = { id: "user123" };
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la génération du token",
      });

      process.env.JWT_SECRET = originalSecret;
    });

    it("devrait gérer les erreurs de jwt.sign", () => {
      req.user = { id: "user123" };
      // Réinitialiser pour écraser les mockReturnValueOnce du beforeEach
      (jwt.sign as jest.Mock).mockReset();
      (jwt.sign as jest.Mock).mockImplementation(() => {
        throw new Error("JWT Error");
      });

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la génération du token",
      });
    });

    it("devrait générer des JTI uniques pour chaque paire de tokens", () => {
      req.user = { id: "user123" };

      getWebSocketToken(req as Request, res as Response);

      // crypto.randomBytes appelé 2 fois (un par token)
      expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
    });

    it("devrait définir isAdmin à false par défaut", () => {
      req.user = { id: "user123" };

      getWebSocketToken(req as Request, res as Response);

      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isAdmin: false }),
        expect.any(String),
        expect.any(Object),
      );
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ isAdmin: false }),
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});
