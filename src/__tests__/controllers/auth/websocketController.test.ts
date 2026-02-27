/**
 * Tests unitaires pour websocketController
 * Teste la génération de tokens WebSocket temporaires
 */

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

      // Mock crypto.randomBytes pour JTI
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("a1b2c3d4e5f6g7h8"),
      });

      // Mock jwt.sign
      (jwt.sign as jest.Mock).mockReturnValue("ws-token-mock-12345");
    });

    it("devrait générer un token WebSocket avec succès", () => {
      req.user = {
        id: "507f1f77bcf86cd799439011",
        isAdmin: false,
      };

      getWebSocketToken(req as Request, res as Response);

      expect(jwt.sign).toHaveBeenCalledWith(
        {
          id: "507f1f77bcf86cd799439011",
          type: "websocket",
          isAdmin: false,
          jti: "a1b2c3d4e5f6g7h8",
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        token: "ws-token-mock-12345",
        expiresIn: 300,
      });
    });

    it("devrait générer un token WebSocket pour un admin", () => {
      req.user = {
        id: "admin123",
        isAdmin: true,
      };

      getWebSocketToken(req as Request, res as Response);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "admin123",
          type: "websocket",
          isAdmin: true,
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
      expect(res.json).toHaveBeenCalledWith({
        error: "Non authentifié",
      });
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it("devrait rejeter une requête avec userId manquant", () => {
      req.user = { isAdmin: false };

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Non authentifié",
      });
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
      (jwt.sign as jest.Mock).mockImplementation(() => {
        throw new Error("JWT Error");
      });

      getWebSocketToken(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la génération du token",
      });
    });

    it("devrait générer un JTI unique pour chaque token", () => {
      req.user = { id: "user123" };

      (crypto.randomBytes as jest.Mock)
        .mockReturnValueOnce({
          toString: jest.fn().mockReturnValue("jti-1"),
        })
        .mockReturnValueOnce({
          toString: jest.fn().mockReturnValue("jti-2"),
        });

      getWebSocketToken(req as Request, res as Response);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ jti: "jti-1" }),
        expect.any(String),
        expect.any(Object),
      );

      jest.clearAllMocks();

      getWebSocketToken(req as Request, res as Response);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ jti: "jti-2" }),
        expect.any(String),
        expect.any(Object),
      );
    });

    it("devrait définir isAdmin à false par défaut", () => {
      req.user = { id: "user123" };

      getWebSocketToken(req as Request, res as Response);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ isAdmin: false }),
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});
