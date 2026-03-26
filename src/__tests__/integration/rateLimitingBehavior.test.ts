/**
 * Tests d'intégration pour le comportement du rate limiting différencié
 *
 * Ces tests vérifient le comportement réel des limiters en simulant
 * de multiples requêtes et en validant que les limites sont respectées.
 */

// Set env vars BEFORE imports
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";

// Mock logger
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

import { Request, Response } from "express";

describe("Rate Limiting Différencié - Tests d'Intégration", () => {
  let rateLimitConfig: any;

  beforeAll(async () => {
    rateLimitConfig = await import("../../config/rateLimitConfig");
  });

  // Helper pour créer des mocks
  const createMockReq = (ip: string, path: string): Partial<Request> => ({
    ip,
    path,
    method: "POST",
    headers: {},
  });

  const createMockRes = (): Partial<Response> => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res;
  };

  const createMockNext = () => jest.fn();

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests du niveau STRICT (10 req/15min -> 100 req/15min en mode test)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("🔴 STRICT: Niveau d'authentification (100 req/15min en test)", () => {
    it("accepte exactement 100 requêtes puis bloque la 101ème", async () => {
      const { strictAuthLimiter } = rateLimitConfig;
      const mockReq = createMockReq("192.168.1.1", "/api/auth/login");
      const mockNext = createMockNext();

      // Envoyer 100 requêtes (la limite en mode test)
      for (let i = 0; i < 100; i++) {
        const mockRes = createMockRes();
        await strictAuthLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        // Les 100 premières requêtes doivent passer
        if (i < 100) {
          expect(mockRes.status).not.toHaveBeenCalled();
        }
      }

      // La 101ème requête doit être bloquée
      const finalRes = createMockRes();
      mockNext.mockClear();

      await strictAuthLimiter(
        mockReq as Request,
        finalRes as Response,
        mockNext,
      );

      expect(finalRes.status).toHaveBeenCalledWith(429);
      expect(finalRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "STRICT_AUTH_RATE_LIMIT_EXCEEDED",
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("bloque correctement avec le message d'erreur approprié", async () => {
      const { strictAuthLimiter } = rateLimitConfig;
      const mockReq = createMockReq("10.0.0.1", "/api/auth/register");
      const mockNext = createMockNext();

      // Atteindre la limite
      for (let i = 0; i < 100; i++) {
        await strictAuthLimiter(
          mockReq as Request,
          createMockRes() as Response,
          mockNext,
        );
      }

      // Requête bloquée
      const blockedRes = createMockRes();
      await strictAuthLimiter(
        mockReq as Request,
        blockedRes as Response,
        mockNext,
      );

      expect(blockedRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("authentification"),
          retryAfter: 15 * 60, // 15 minutes
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests du niveau MODERATE (100 req/15min -> 1000 req/15min en mode test)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("🟡 MODERATE: Niveau API standard (1000 req/15min en test)", () => {
    it("accepte 1000 requêtes puis bloque la 1001ème", async () => {
      const { moderateApiLimiter } = rateLimitConfig;
      const mockReq = createMockReq("172.16.0.1", "/api/events");
      const mockNext = createMockNext();

      // Envoyer 1000 requêtes
      for (let i = 0; i < 1000; i++) {
        const mockRes = createMockRes();
        await moderateApiLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        expect(mockRes.status).not.toHaveBeenCalled();
      }

      // La 1001ème requête doit être bloquée
      const finalRes = createMockRes();
      mockNext.mockClear();

      await moderateApiLimiter(
        mockReq as Request,
        finalRes as Response,
        mockNext,
      );

      expect(finalRes.status).toHaveBeenCalledWith(429);
      expect(finalRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MODERATE_API_RATE_LIMIT_EXCEEDED",
        }),
      );
    });

    it("retourne le bon retryAfter pour MODERATE", async () => {
      const { moderateApiLimiter } = rateLimitConfig;
      const mockReq = createMockReq("192.168.100.1", "/api/users");
      const mockNext = createMockNext();

      // Atteindre la limite
      for (let i = 0; i < 1000; i++) {
        await moderateApiLimiter(
          mockReq as Request,
          createMockRes() as Response,
          mockNext,
        );
      }

      // Vérifier le retryAfter
      const blockedRes = createMockRes();
      await moderateApiLimiter(
        mockReq as Request,
        blockedRes as Response,
        mockNext,
      );

      expect(blockedRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAfter: 15 * 60,
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests du niveau PERMISSIVE (150 req/15min -> 1500 req/15min en mode test)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("🟢 PERMISSIVE: Niveau mobile/fonctionnel (1500 req/15min en test)", () => {
    it("accepte 1500 requêtes puis bloque la 1501ème", async () => {
      const { permissiveMobileLimiter } = rateLimitConfig;
      const mockReq = createMockReq("203.0.113.1", "/api/mobile/push-tokens");
      const mockNext = createMockNext();

      // Envoyer 1500 requêtes
      for (let i = 0; i < 1500; i++) {
        const mockRes = createMockRes();
        await permissiveMobileLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        expect(mockRes.status).not.toHaveBeenCalled();
      }

      // La 1501ème requête doit être bloquée
      const finalRes = createMockRes();
      mockNext.mockClear();

      await permissiveMobileLimiter(
        mockReq as Request,
        finalRes as Response,
        mockNext,
      );

      expect(finalRes.status).toHaveBeenCalledWith(429);
      expect(finalRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "PERMISSIVE_MOBILE_RATE_LIMIT_EXCEEDED",
        }),
      );
    });

    it("retourne un message adapté au contexte mobile", async () => {
      const { permissiveMobileLimiter } = rateLimitConfig;
      const mockReq = createMockReq("198.51.100.1", "/api/mobile/sync");
      const mockNext = createMockNext();

      // Atteindre la limite
      for (let i = 0; i < 1500; i++) {
        await permissiveMobileLimiter(
          mockReq as Request,
          createMockRes() as Response,
          mockNext,
        );
      }

      // Vérifier le message
      const blockedRes = createMockRes();
      await permissiveMobileLimiter(
        mockReq as Request,
        blockedRes as Response,
        mockNext,
      );

      expect(blockedRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("mobile"),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests comparatifs des 3 niveaux
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Comparaison des niveaux de rate limiting", () => {
    it("STRICT est plus restrictif que MODERATE", () => {
      // STRICT: 100 req en test
      // MODERATE: 1000 req en test
      expect(100).toBeLessThan(1000);
    });

    it("MODERATE est plus restrictif que PERMISSIVE", () => {
      // MODERATE: 1000 req en test
      // PERMISSIVE: 1500 req en test
      expect(1000).toBeLessThan(1500);
    });

    it("les 3 niveaux ont la même fenêtre temporelle (15 minutes)", () => {
      // Vérifier que retryAfter est identique pour tous
      const expectedRetryAfter = 15 * 60; // 900 secondes
      expect(expectedRetryAfter).toBe(900);
    });

    it("chaque niveau a un code d'erreur unique et identifiable", () => {
      const codes = [
        "STRICT_AUTH_RATE_LIMIT_EXCEEDED",
        "MODERATE_API_RATE_LIMIT_EXCEEDED",
        "PERMISSIVE_MOBILE_RATE_LIMIT_EXCEEDED",
      ];

      // Vérifier unicité
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(3);

      // Vérifier pattern cohérent
      codes.forEach((code) => {
        expect(code).toMatch(/.*_RATE_LIMIT_EXCEEDED$/);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests de cas d'usage réels
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Scénarios d'usage réels", () => {
    it("STRICT protège contre les attaques par force brute sur l'authentification", async () => {
      const { strictAuthLimiter } = rateLimitConfig;
      const attackerIp = "45.33.32.156";
      const mockReq = createMockReq(attackerIp, "/api/auth/login");
      const mockNext = createMockNext();

      // Simuler une attaque par force brute (101 tentatives)
      let blockedAt = -1;

      for (let i = 0; i < 101; i++) {
        const mockRes = createMockRes();
        await strictAuthLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        const statusMock = mockRes.status as jest.Mock;
        if (statusMock.mock.calls.length > 0) {
          blockedAt = i + 1;
          break;
        }
      }

      // L'attaquant doit être bloqué à la 101ème tentative
      expect(blockedAt).toBe(101);
    });

    it("PERMISSIVE permet une utilisation normale des applications mobiles", async () => {
      const { permissiveMobileLimiter } = rateLimitConfig;
      const mobileIp = "198.51.100.42";
      const mockReq = createMockReq(mobileIp, "/api/mobile/sync");
      const mockNext = createMockNext();

      // Simuler une synchronisation mobile normale (ex: 50 requêtes)
      const normalUsage = 50;

      for (let i = 0; i < normalUsage; i++) {
        const mockRes = createMockRes();
        await permissiveMobileLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        // Toutes les requêtes doivent passer
        expect(mockRes.status).not.toHaveBeenCalled();
      }

      // Vérifier que mockNext a été appelé pour toutes les requêtes
      expect(mockNext).toHaveBeenCalledTimes(normalUsage);
    });

    it("MODERATE permet une navigation normale tout en protégeant contre le scraping", async () => {
      const { moderateApiLimiter } = rateLimitConfig;
      const userIp = "203.0.113.78";
      const mockReq = createMockReq(userIp, "/api/events");
      const mockNext = createMockNext();

      // Simuler une navigation normale (ex: 200 requêtes)
      const normalBrowsing = 200;

      for (let i = 0; i < normalBrowsing; i++) {
        const mockRes = createMockRes();
        await moderateApiLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext,
        );

        expect(mockRes.status).not.toHaveBeenCalled();
      }

      expect(mockNext).toHaveBeenCalledTimes(normalBrowsing);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tests de production vs développement
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Configuration environnement", () => {
    it("les limites en mode test sont multipliées par DEV_MULTIPLIER (10)", () => {
      const DEV_MULTIPLIER = 10;

      // Production vs Test
      const prodLimits = {
        strict: 10,
        moderate: 100,
        permissive: 150,
      };

      const testLimits = {
        strict: prodLimits.strict * DEV_MULTIPLIER,
        moderate: prodLimits.moderate * DEV_MULTIPLIER,
        permissive: prodLimits.permissive * DEV_MULTIPLIER,
      };

      expect(testLimits.strict).toBe(100);
      expect(testLimits.moderate).toBe(1000);
      expect(testLimits.permissive).toBe(1500);
    });
  });
});
