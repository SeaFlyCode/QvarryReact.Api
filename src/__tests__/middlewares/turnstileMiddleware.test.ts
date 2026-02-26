/**
 * Tests unitaires pour turnstileMiddleware
 */

process.env.NODE_ENV = "test";
process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";

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

// Mock anonymizeIp
jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip) => ip),
}));

// Mock global fetch
global.fetch = jest.fn();

import { Request, Response, NextFunction } from "express";
import {
  verifyTurnstile,
  verifyTurnstileOptional,
} from "../../middlewares/turnstileMiddleware";

// ════════════════════════════════════════════════════════
// 🛠️ Mock Helpers
// ════════════════════════════════════════════════════════

const mockReq = (overrides: any = {}) => ({
  body: {},
  headers: {},
  ip: "127.0.0.1",
  connection: { remoteAddress: "127.0.0.1" },
  path: "/api/test",
  method: "POST",
  ...overrides,
});

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

// ════════════════════════════════════════════════════════
// ✅ Test Suite
// ════════════════════════════════════════════════════════

describe("verifyTurnstile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
    (global.fetch as jest.Mock).mockReset();
  });

  describe("Configuration validation", () => {
    it("should bypass in development when secret key is not configured", async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.NODE_ENV = "development";

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
      process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
    });

    it("should return 500 in production when secret key is not configured", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.NODE_ENV = "production";

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Configuration du serveur incomplète",
        code: "CAPTCHA_CONFIG_ERROR",
      });
      expect(next).not.toHaveBeenCalled();

      process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
      process.env.NODE_ENV = "test";
    });
  });

  describe("Token validation", () => {
    it("should return 400 if no token is provided", async () => {
      const req = mockReq({ body: {} }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Veuillez compléter la vérification anti-robot",
        code: "CAPTCHA_MISSING",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should accept token from cf-turnstile-response field", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { "cf-turnstile-response": "valid-token-123" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(global.fetch).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should accept token from turnstileToken field", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token-123" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(global.fetch).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should accept token from captchaToken field", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { captchaToken: "valid-token-123" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(global.fetch).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("Cloudflare API verification", () => {
    it("should verify token with Cloudflare API", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: true,
          challenge_ts: "2024-01-01T00:00:00Z",
          hostname: "localhost",
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token" },
        ip: "192.168.1.1",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }),
      );
      expect(next).toHaveBeenCalled();
    });

    it("should include client IP in verification request", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token" },
        ip: "10.0.0.1",
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = fetchCall[1].body;
      expect(body).toContain("remoteip=10.0.0.1");
    });

    it("should use connection.remoteAddress if ip is not available", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token" },
        ip: undefined,
        connection: { remoteAddress: "172.16.0.1" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = fetchCall[1].body;
      expect(body).toContain("remoteip=172.16.0.1");
    });

    it("should include secret and response in request body", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "test-token-123" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = fetchCall[1].body;
      expect(body).toContain("secret=test-turnstile-secret");
      expect(body).toContain("response=test-token-123");
    });
  });

  describe("Successful verification", () => {
    it("should call next() on successful verification", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("Failed verification", () => {
    it("should return 400 on failed verification", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "invalid-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La vérification a échoué, veuillez réessayer",
        code: "CAPTCHA_FAILED",
        details: undefined,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should include error details in development mode", async () => {
      process.env.NODE_ENV = "development";
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "expired-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: "La vérification a expiré, veuillez réessayer",
        code: "CAPTCHA_FAILED",
        details: ["timeout-or-duplicate"],
      });

      process.env.NODE_ENV = "test";
    });

    it("should map error codes to user-friendly messages", async () => {
      const errorMappings = [
        {
          code: "missing-input-secret",
          message: "Erreur de configuration du serveur",
        },
        {
          code: "invalid-input-secret",
          message: "Erreur de configuration du serveur",
        },
        {
          code: "missing-input-response",
          message: "Veuillez compléter la vérification anti-robot",
        },
        {
          code: "invalid-input-response",
          message: "La vérification a échoué, veuillez réessayer",
        },
        { code: "bad-request", message: "Requête invalide" },
        {
          code: "timeout-or-duplicate",
          message: "La vérification a expiré, veuillez réessayer",
        },
        {
          code: "internal-error",
          message: "Erreur du service de vérification",
        },
      ];

      for (const { code, message } of errorMappings) {
        jest.clearAllMocks();
        (global.fetch as jest.Mock).mockResolvedValue({
          json: async () => ({
            success: false,
            "error-codes": [code],
          }),
        });

        const req = mockReq({
          body: { turnstileToken: "test-token" },
        }) as unknown as Request;
        const res = mockRes() as unknown as Response;
        const next = mockNext as NextFunction;

        await verifyTurnstile(req, res, next);

        expect(res.json).toHaveBeenCalledWith({
          error: message,
          code: "CAPTCHA_FAILED",
          details: undefined,
        });
      }
    });

    it("should use default message for unknown error codes", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["unknown-error-code"],
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: "La vérification anti-robot a échoué",
        code: "CAPTCHA_FAILED",
        details: undefined,
      });
    });

    it("should handle empty error codes array", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": [],
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: "La vérification anti-robot a échoué",
        code: "CAPTCHA_FAILED",
        details: undefined,
      });
    });
  });

  describe("Error handling", () => {
    it("should return 503 on network error", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: "Service de vérification temporairement indisponible",
        code: "CAPTCHA_SERVICE_ERROR",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 503 on API timeout", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error("Request timeout"),
      );

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle JSON parse errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstile(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});

describe("verifyTurnstileOptional", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
    (global.fetch as jest.Mock).mockReset();
  });

  describe("Bypass scenarios", () => {
    it("should bypass in development when secret key is not configured", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.NODE_ENV = "development";

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
      process.env.NODE_ENV = "test";
    });

    it("should not bypass in production even without secret key", async () => {
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.NODE_ENV = "production";

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      // Should not bypass, but behavior depends on verifyTurnstile
      // In this case, it should not call next() without proper config
      expect(res.status).toHaveBeenCalled();

      process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
      process.env.NODE_ENV = "test";
    });

    it("should bypass when BYPASS_CAPTCHA is true in non-production", async () => {
      process.env.BYPASS_CAPTCHA = "true";
      process.env.NODE_ENV = "development";

      const req = mockReq() as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();

      delete process.env.BYPASS_CAPTCHA;
      process.env.NODE_ENV = "test";
    });

    it("should not bypass when BYPASS_CAPTCHA is true in production", async () => {
      process.env.BYPASS_CAPTCHA = "true";
      process.env.NODE_ENV = "production";

      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "test-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      expect(global.fetch).toHaveBeenCalled();

      delete process.env.BYPASS_CAPTCHA;
      process.env.NODE_ENV = "test";
    });
  });

  describe("Normal verification", () => {
    it("should verify token normally when configured", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({ success: true }),
      });

      const req = mockReq({
        body: { turnstileToken: "valid-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      expect(global.fetch).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid tokens", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      });

      const req = mockReq({
        body: { turnstileToken: "invalid-token" },
      }) as unknown as Request;
      const res = mockRes() as unknown as Response;
      const next = mockNext as NextFunction;

      await verifyTurnstileOptional(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
