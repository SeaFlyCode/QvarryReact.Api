/**
 * Tests unitaires pour authHelpers
 * Teste les fonctions d'aide à l'authentification
 */

// Mock des services AVANT les imports
jest.mock("../../../services/redisSessionService");
jest.mock("../../../services/memoryStorageService");
jest.mock("../../../models/points");
jest.mock("../../../models/fiches");
jest.mock("../../../models/lists");
jest.mock("../../../models/keys");
jest.mock("../../../utils/masterEncryptionUtils");
jest.mock("../../../utils/jwtKeyManager");
jest.mock("jsonwebtoken");
jest.mock("crypto");

import {
  isTokenBlacklisted,
  blacklistToken,
  checkLoginAttempts,
  recordFailedLogin,
  resetLoginAttempts,
  generateSecureToken,
  loadAndDecryptUserData,
  BlacklistedToken,
} from "../../../controllers/auth/authHelpers";
import { redisSessionService } from "../../../services/redisSessionService";
import { memoryStorage } from "../../../services/memoryStorageService";
import PointModel from "../../../models/points";
import FicheModel from "../../../models/fiches";
import ListModel from "../../../models/lists";
import KeysModel from "../../../models/keys";
import { decrypt, encrypt } from "../../../utils/masterEncryptionUtils";
import { jwtKeyManager } from "../../../utils/jwtKeyManager";
import jwt from "jsonwebtoken";
import crypto from "crypto";

describe("authHelpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BLACKLIST TOKENS
  // ═══════════════════════════════════════════════════════════════════════

  describe("isTokenBlacklisted", () => {
    it("devrait vérifier si un token est blacklisté", async () => {
      (redisSessionService.isTokenBlacklisted as jest.Mock).mockResolvedValue(
        true,
      );

      const result = await isTokenBlacklisted("test-token");

      expect(result).toBe(true);
      expect(redisSessionService.isTokenBlacklisted).toHaveBeenCalledWith(
        "test-token",
      );
    });

    it("devrait retourner false pour un token non blacklisté", async () => {
      (redisSessionService.isTokenBlacklisted as jest.Mock).mockResolvedValue(
        false,
      );

      const result = await isTokenBlacklisted("valid-token");

      expect(result).toBe(false);
    });
  });

  describe("blacklistToken", () => {
    it("devrait blacklister un token avec les détails", async () => {
      const details: BlacklistedToken = {
        token: "test-token",
        expiresAt: new Date(Date.now() + 3600000), // +1h
        blacklistedAt: new Date(),
        reason: "logout",
        userId: "user123",
      };

      (redisSessionService.blacklistToken as jest.Mock).mockResolvedValue(
        undefined,
      );

      await blacklistToken("test-token", details);

      expect(redisSessionService.blacklistToken).toHaveBeenCalledWith(
        "test-token",
        details,
        expect.any(Number),
      );
    });

    it("devrait calculer correctement le TTL en secondes", async () => {
      const futureTime = Date.now() + 7200000; // +2h
      const details: BlacklistedToken = {
        token: "test-token",
        expiresAt: new Date(futureTime),
        blacklistedAt: new Date(),
        reason: "security",
        userId: "user123",
      };

      await blacklistToken("test-token", details);

      const callArgs = (redisSessionService.blacklistToken as jest.Mock).mock
        .calls[0];
      const expiresInSeconds = callArgs[2];

      // Le TTL devrait être environ 7200 secondes (avec une marge d'erreur)
      expect(expiresInSeconds).toBeGreaterThan(7000);
      expect(expiresInSeconds).toBeLessThanOrEqual(7200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LOGIN ATTEMPTS
  // ═══════════════════════════════════════════════════════════════════════

  describe("checkLoginAttempts", () => {
    it("devrait autoriser la connexion sans tentative précédente", async () => {
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await checkLoginAttempts("user@test.com");

      expect(result).toEqual({ allowed: true });
    });

    it("devrait bloquer si l'utilisateur est encore bloqué", async () => {
      const futureTime = new Date(Date.now() + 600000); // +10 minutes
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue({
        email: "user@test.com",
        attempts: 5,
        lastAttempt: new Date(),
        blockedUntil: futureTime,
      });

      const result = await checkLoginAttempts("user@test.com");

      expect(result.allowed).toBe(false);
      expect(result.message).toContain("Trop de tentatives échouées");
      expect(result.waitTime).toBeGreaterThan(0);
    });

    it("devrait autoriser si le blocage est expiré", async () => {
      const pastTime = new Date(Date.now() - 1000); // -1 seconde
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue({
        email: "user@test.com",
        attempts: 3,
        lastAttempt: new Date(Date.now() - 20 * 60 * 1000), // -20 minutes
        blockedUntil: pastTime,
      });

      const result = await checkLoginAttempts("user@test.com");

      expect(result.allowed).toBe(true);
    });

    it("devrait bloquer après 5 tentatives dans les 15 dernières minutes", async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000); // -5 minutes
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue({
        email: "user@test.com",
        attempts: 5,
        lastAttempt: recentTime,
        blockedUntil: null,
      });

      (redisSessionService.recordLoginAttempt as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await checkLoginAttempts("user@test.com");

      expect(result.allowed).toBe(false);
      expect(result.message).toContain("bloqué pour 30 minutes");
      expect(redisSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        "user@test.com",
        true,
        30,
      );
    });

    it("devrait autoriser si moins de 5 tentatives", async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000); // -5 minutes
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue({
        email: "user@test.com",
        attempts: 3,
        lastAttempt: recentTime,
        blockedUntil: null,
      });

      const result = await checkLoginAttempts("user@test.com");

      expect(result.allowed).toBe(true);
    });
  });

  describe("recordFailedLogin", () => {
    it("devrait enregistrer une tentative échouée", async () => {
      (redisSessionService.recordLoginAttempt as jest.Mock).mockResolvedValue(
        undefined,
      );
      (redisSessionService.getLoginAttempts as jest.Mock).mockResolvedValue({
        email: "user@test.com",
        attempts: 1,
        lastAttempt: new Date(),
      });

      await recordFailedLogin("user@test.com");

      expect(redisSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        "user@test.com",
        false,
      );
    });
  });

  describe("resetLoginAttempts", () => {
    it("devrait réinitialiser les tentatives", async () => {
      (redisSessionService.resetLoginAttempts as jest.Mock).mockResolvedValue(
        undefined,
      );

      await resetLoginAttempts("user@test.com");

      expect(redisSessionService.resetLoginAttempts).toHaveBeenCalledWith(
        "user@test.com",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // JWT TOKEN GENERATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("generateSecureToken", () => {
    beforeEach(() => {
      process.env.JWT_EXPIRES_IN = "15m";
      (jwtKeyManager.getCurrentKey as jest.Mock).mockReturnValue({
        secret: "a".repeat(64),
        version: "v1",
      });
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("random-token-id"),
      });
      (jwt.sign as jest.Mock).mockReturnValue("generated-jwt-token");
    });

    it("devrait générer un token JWT valide", () => {
      const result = generateSecureToken("user123");

      expect(result.token).toBe("generated-jwt-token");
      expect(result.tokenId).toBe("random-token-id");
      expect(result.keyVersion).toBe("v1");
      expect(jwt.sign).toHaveBeenCalled();
    });

    it("devrait inclure les claims de sécurité", () => {
      generateSecureToken("user123", true, "mobile");

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "user123",
          isAdmin: true,
          platform: "mobile",
          kv: "v1",
          jti: "random-token-id",
          iat: expect.any(Number),
        }),
        expect.any(String),
        expect.objectContaining({
          expiresIn: "15m",
          algorithm: "HS256",
          issuer: "qvarry-api",
          // V7r6: audience différenciée par platform Vague 1 (qvarry-mobile pour mobile).
          audience: "qvarry-mobile",
        }),
      );
    });

    it("devrait utiliser le tokenId fourni", () => {
      const result = generateSecureToken(
        "user123",
        false,
        "web",
        "custom-token-id",
      );

      expect(result.tokenId).toBe("custom-token-id");
    });

    it("devrait lever une erreur si JWT_SECRET est trop court", () => {
      (jwtKeyManager.getCurrentKey as jest.Mock).mockReturnValue({
        secret: "too-short",
        version: "v1",
      });

      expect(() => generateSecureToken("user123")).toThrow(
        "JWT_SECRET doit contenir au moins 32 caractères",
      );
    });

    it("devrait utiliser la valeur par défaut pour expiresIn", () => {
      delete process.env.JWT_EXPIRES_IN;

      generateSecureToken("user123");

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({
          expiresIn: "15m",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LOAD AND DECRYPT USER DATA
  // ═══════════════════════════════════════════════════════════════════════

  describe("loadAndDecryptUserData", () => {
    const mockUserId = "507f1f77bcf86cd799439011"; // Valid MongoDB ObjectId format
    const mockUserKey = "decrypted-user-key";

    beforeEach(() => {
      (KeysModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          userId: mockUserId,
          key: "encrypted-key",
          type: "user",
        }),
      });
      (decrypt as jest.Mock).mockReturnValue(mockUserKey);
      (memoryStorage.initSession as jest.Mock).mockReturnValue(undefined);
      (PointModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "point1",
            userId: mockUserId,
            title: "encrypted-title",
            message: "encrypted-message",
          },
        ]),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { _id: "fiche1", userId: mockUserId, title: "encrypted-title" },
          ]),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { _id: "list1", userId: mockUserId, name: "encrypted-name" },
          ]),
      });
      (memoryStorage.storePoint as jest.Mock).mockReturnValue(undefined);
      (memoryStorage.storeFiche as jest.Mock).mockReturnValue(undefined);
      (memoryStorage.storeList as jest.Mock).mockReturnValue(undefined);
    });

    it("devrait charger et déchiffrer les données utilisateur", async () => {
      await loadAndDecryptUserData(mockUserId);

      expect(KeysModel.findOne).toHaveBeenCalledWith({
        userId: mockUserId,
        type: "user",
      });
      expect(decrypt).toHaveBeenCalledWith("encrypted-key");
      expect(memoryStorage.initSession).toHaveBeenCalledWith(
        mockUserId,
        mockUserKey,
      );
    });

    it("devrait créer une clé utilisateur si elle n'existe pas", async () => {
      (KeysModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("new-random-key"),
      });
      (encrypt as jest.Mock).mockReturnValue("encrypted-new-key");
      (KeysModel.create as jest.Mock).mockResolvedValue({
        userId: mockUserId,
        key: "encrypted-new-key",
        type: "user",
      });

      await loadAndDecryptUserData(mockUserId);

      expect(crypto.randomBytes).toHaveBeenCalledWith(32);
      expect(encrypt).toHaveBeenCalledWith("new-random-key");
      expect(KeysModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "encrypted-new-key",
          type: "user",
        }),
      );
    });

    it("devrait charger les données en parallèle", async () => {
      await loadAndDecryptUserData(mockUserId);

      expect(PointModel.find).toHaveBeenCalledWith({
        userId: mockUserId,
        deletedAt: null,
      });
      expect(FicheModel.find).toHaveBeenCalledWith({
        userId: mockUserId,
        deletedAt: null,
      });
      expect(ListModel.find).toHaveBeenCalledWith({
        userId: mockUserId,
        deletedAt: null,
      });
    });

    it("devrait lever une erreur si la clé RSA est récupérée au lieu d'AES", async () => {
      (KeysModel.findOne as jest.Mock).mockResolvedValue({
        userId: mockUserId,
        key: "-----BEGIN RSA PRIVATE KEY-----",
        type: "user",
      });

      await expect(loadAndDecryptUserData(mockUserId)).rejects.toThrow(
        "Erreur : La clé récupérée est une clé RSA",
      );
    });

    it("devrait lever une erreur si la clé n'existe pas après création", async () => {
      (KeysModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("new-random-key"),
      });
      (encrypt as jest.Mock).mockReturnValue("encrypted-new-key");
      (KeysModel.create as jest.Mock).mockResolvedValue(null);

      await expect(loadAndDecryptUserData(mockUserId)).rejects.toThrow(
        "Impossible de récupérer la clé AES utilisateur",
      );
    });

    it("devrait gérer les erreurs de chargement des données", async () => {
      (PointModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("Database error")),
      });

      await expect(loadAndDecryptUserData(mockUserId)).rejects.toThrow(
        "Database error",
      );
    });
  });
});
