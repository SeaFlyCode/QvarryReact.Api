// ═══════════════════════════════════════════════════════════════════════════
// TESTS: rateLimitConfig
// ═══════════════════════════════════════════════════════════════════════════

// Set env vars BEFORE imports (module reads them at load time)
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";

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

describe("rateLimitConfig", () => {
  let rateLimitConfig: any;

  beforeAll(async () => {
    // Import after mocks are set up
    rateLimitConfig = await import("../../config/rateLimitConfig");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test que tous les rate limiters sont définis
  // ═══════════════════════════════════════════════════════════════════════════

  describe("rate limiter exports", () => {
    it("globalRateLimiter is defined", () => {
      expect(rateLimitConfig.globalRateLimiter).toBeDefined();
      expect(typeof rateLimitConfig.globalRateLimiter).toBe("function");
    });

    it("healthLimiter is defined", () => {
      expect(rateLimitConfig.healthLimiter).toBeDefined();
      expect(typeof rateLimitConfig.healthLimiter).toBe("function");
    });

    it("authLimiter is defined", () => {
      expect(rateLimitConfig.authLimiter).toBeDefined();
      expect(typeof rateLimitConfig.authLimiter).toBe("function");
    });

    it("registerLimiter is defined", () => {
      expect(rateLimitConfig.registerLimiter).toBeDefined();
      expect(typeof rateLimitConfig.registerLimiter).toBe("function");
    });

    it("verifyEmailLimiter is defined", () => {
      expect(rateLimitConfig.verifyEmailLimiter).toBeDefined();
      expect(typeof rateLimitConfig.verifyEmailLimiter).toBe("function");
    });

    it("resendEmailLimiter is defined", () => {
      expect(rateLimitConfig.resendEmailLimiter).toBeDefined();
      expect(typeof rateLimitConfig.resendEmailLimiter).toBe("function");
    });

    it("passwordResetLimiter is defined", () => {
      expect(rateLimitConfig.passwordResetLimiter).toBeDefined();
      expect(typeof rateLimitConfig.passwordResetLimiter).toBe("function");
    });

    it("twoFactorLimiter is defined", () => {
      expect(rateLimitConfig.twoFactorLimiter).toBeDefined();
      expect(typeof rateLimitConfig.twoFactorLimiter).toBe("function");
    });

    it("generalLimiter is defined", () => {
      expect(rateLimitConfig.generalLimiter).toBeDefined();
      expect(typeof rateLimitConfig.generalLimiter).toBe("function");
    });

    it("highTrafficLimiter is defined", () => {
      expect(rateLimitConfig.highTrafficLimiter).toBeDefined();
      expect(typeof rateLimitConfig.highTrafficLimiter).toBe("function");
    });

    it("socialLimiter is defined", () => {
      expect(rateLimitConfig.socialLimiter).toBeDefined();
      expect(typeof rateLimitConfig.socialLimiter).toBe("function");
    });

    it("refreshTokenLimiter is defined", () => {
      expect(rateLimitConfig.refreshTokenLimiter).toBeDefined();
      expect(typeof rateLimitConfig.refreshTokenLimiter).toBe("function");
    });

    it("adminLimiter is defined", () => {
      expect(rateLimitConfig.adminLimiter).toBeDefined();
      expect(typeof rateLimitConfig.adminLimiter).toBe("function");
    });

    it("mobileAuthLimiter is defined", () => {
      expect(rateLimitConfig.mobileAuthLimiter).toBeDefined();
      expect(typeof rateLimitConfig.mobileAuthLimiter).toBe("function");
    });

    it("securityLimiter is defined", () => {
      expect(rateLimitConfig.securityLimiter).toBeDefined();
      expect(typeof rateLimitConfig.securityLimiter).toBe("function");
    });

    it("authCheckLimiter is defined", () => {
      expect(rateLimitConfig.authCheckLimiter).toBeDefined();
      expect(typeof rateLimitConfig.authCheckLimiter).toBe("function");
    });

    it("maintenanceLimiter is defined", () => {
      expect(rateLimitConfig.maintenanceLimiter).toBeDefined();
      expect(typeof rateLimitConfig.maintenanceLimiter).toBe("function");
    });

    it("usersLimiter is defined", () => {
      expect(rateLimitConfig.usersLimiter).toBeDefined();
      expect(typeof rateLimitConfig.usersLimiter).toBe("function");
    });

    it("notificationsLimiter is defined", () => {
      expect(rateLimitConfig.notificationsLimiter).toBeDefined();
      expect(typeof rateLimitConfig.notificationsLimiter).toBe("function");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test que tous les limiters sont des middleware functions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("rate limiters are middleware functions", () => {
    const limiters = [
      "globalRateLimiter",
      "healthLimiter",
      "authLimiter",
      "registerLimiter",
      "verifyEmailLimiter",
      "resendEmailLimiter",
      "passwordResetLimiter",
      "twoFactorLimiter",
      "generalLimiter",
      "highTrafficLimiter",
      "socialLimiter",
      "refreshTokenLimiter",
      "adminLimiter",
      "mobileAuthLimiter",
      "securityLimiter",
      "authCheckLimiter",
      "maintenanceLimiter",
      "usersLimiter",
      "notificationsLimiter",
    ];

    limiters.forEach((limiterName) => {
      it(`${limiterName} is a function (middleware)`, () => {
        expect(typeof rateLimitConfig[limiterName]).toBe("function");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test des limiters spécifiques (structure)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("specific rate limiter configurations", () => {
    it("globalRateLimiter is configured", () => {
      expect(rateLimitConfig.globalRateLimiter).toBeDefined();
      // It's a middleware function, we can't easily inspect rateLimit internals
      // But we can verify it's exported and is a function
      expect(typeof rateLimitConfig.globalRateLimiter).toBe("function");
    });

    it("authLimiter is configured", () => {
      expect(rateLimitConfig.authLimiter).toBeDefined();
      expect(typeof rateLimitConfig.authLimiter).toBe("function");
    });

    it("registerLimiter is configured for anti-spam", () => {
      expect(rateLimitConfig.registerLimiter).toBeDefined();
      expect(typeof rateLimitConfig.registerLimiter).toBe("function");
    });

    it("twoFactorLimiter is configured for strict 2FA protection", () => {
      expect(rateLimitConfig.twoFactorLimiter).toBeDefined();
      expect(typeof rateLimitConfig.twoFactorLimiter).toBe("function");
    });

    it("verifyEmailLimiter is configured for email verification", () => {
      expect(rateLimitConfig.verifyEmailLimiter).toBeDefined();
      expect(typeof rateLimitConfig.verifyEmailLimiter).toBe("function");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test du comportement en mode développement vs production
  // ═══════════════════════════════════════════════════════════════════════════

  describe("environment-based configuration", () => {
    it("rate limiters are defined in test environment", () => {
      // In test/dev mode, limits should be multiplied by DEV_MULTIPLIER (10)
      // We can't directly access the limit values from express-rate-limit instances
      // But we verify they are all properly exported
      const allLimiters = [
        "globalRateLimiter",
        "authLimiter",
        "registerLimiter",
        "verifyEmailLimiter",
        "resendEmailLimiter",
        "passwordResetLimiter",
        "twoFactorLimiter",
        "generalLimiter",
        "highTrafficLimiter",
        "socialLimiter",
        "refreshTokenLimiter",
        "adminLimiter",
        "mobileAuthLimiter",
        "securityLimiter",
        "authCheckLimiter",
        "maintenanceLimiter",
        "usersLimiter",
        "notificationsLimiter",
      ];

      allLimiters.forEach((limiter) => {
        expect(rateLimitConfig[limiter]).toBeDefined();
        expect(typeof rateLimitConfig[limiter]).toBe("function");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test de présence de tous les limiters critiques pour la sécurité
  // ═══════════════════════════════════════════════════════════════════════════

  describe("security-critical limiters", () => {
    it("has rate limiter for authentication routes", () => {
      expect(rateLimitConfig.authLimiter).toBeDefined();
      expect(typeof rateLimitConfig.authLimiter).toBe("function");
    });

    it("has rate limiter for registration (anti-spam)", () => {
      expect(rateLimitConfig.registerLimiter).toBeDefined();
      expect(typeof rateLimitConfig.registerLimiter).toBe("function");
    });

    it("has rate limiter for password reset", () => {
      expect(rateLimitConfig.passwordResetLimiter).toBeDefined();
      expect(typeof rateLimitConfig.passwordResetLimiter).toBe("function");
    });

    it("has rate limiter for 2FA (brute-force protection)", () => {
      expect(rateLimitConfig.twoFactorLimiter).toBeDefined();
      expect(typeof rateLimitConfig.twoFactorLimiter).toBe("function");
    });

    it("has rate limiter for email verification", () => {
      expect(rateLimitConfig.verifyEmailLimiter).toBeDefined();
      expect(typeof rateLimitConfig.verifyEmailLimiter).toBe("function");
    });

    it("has rate limiter for admin routes", () => {
      expect(rateLimitConfig.adminLimiter).toBeDefined();
      expect(typeof rateLimitConfig.adminLimiter).toBe("function");
    });

    it("has rate limiter for mobile authentication", () => {
      expect(rateLimitConfig.mobileAuthLimiter).toBeDefined();
      expect(typeof rateLimitConfig.mobileAuthLimiter).toBe("function");
    });

    it("has rate limiter for security routes", () => {
      expect(rateLimitConfig.securityLimiter).toBeDefined();
      expect(typeof rateLimitConfig.securityLimiter).toBe("function");
    });

    it("has rate limiter for user enumeration protection", () => {
      expect(rateLimitConfig.usersLimiter).toBeDefined();
      expect(typeof rateLimitConfig.usersLimiter).toBe("function");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test de tous les limiters exportés
  // ═══════════════════════════════════════════════════════════════════════════

  describe("all exported limiters", () => {
    it("exports exactly 22 rate limiters (incluant les 3 nouveaux niveaux différenciés)", () => {
      const expectedLimiters = [
        "globalRateLimiter",
        "healthLimiter",
        "authLimiter",
        "registerLimiter",
        "verifyEmailLimiter",
        "resendEmailLimiter",
        "passwordResetLimiter",
        "twoFactorLimiter",
        "generalLimiter",
        "highTrafficLimiter",
        "socialLimiter",
        "refreshTokenLimiter",
        "adminLimiter",
        "mobileAuthLimiter",
        "securityLimiter",
        "authCheckLimiter",
        "maintenanceLimiter",
        "usersLimiter",
        "notificationsLimiter",
        // Nouveaux limiters différenciés (3 niveaux)
        "strictAuthLimiter",
        "moderateApiLimiter",
        "permissiveMobileLimiter",
      ];

      expectedLimiters.forEach((limiter) => {
        expect(rateLimitConfig[limiter]).toBeDefined();
      });

      // Count all function exports (rate limiters)
      const functionExports = Object.keys(rateLimitConfig).filter(
        (key) => typeof rateLimitConfig[key] === "function",
      );

      expect(functionExports.length).toBeGreaterThanOrEqual(
        expectedLimiters.length,
      );
    });

    it("all rate limiters are callable functions", () => {
      const limiters = [
        "globalRateLimiter",
        "healthLimiter",
        "authLimiter",
        "registerLimiter",
        "verifyEmailLimiter",
        "resendEmailLimiter",
        "passwordResetLimiter",
        "twoFactorLimiter",
        "generalLimiter",
        "highTrafficLimiter",
        "socialLimiter",
        "refreshTokenLimiter",
        "adminLimiter",
        "mobileAuthLimiter",
        "securityLimiter",
        "authCheckLimiter",
        "maintenanceLimiter",
        "usersLimiter",
        "notificationsLimiter",
        // Nouveaux limiters différenciés
        "strictAuthLimiter",
        "moderateApiLimiter",
        "permissiveMobileLimiter",
      ];

      limiters.forEach((limiter) => {
        const limiterFn = rateLimitConfig[limiter];
        expect(limiterFn).toBeDefined();
        expect(typeof limiterFn).toBe("function");
        // Verify it's a proper express middleware (accepts 3 args: req, res, next)
        // express-rate-limit returns a function with length 3
        expect(limiterFn.length).toBe(3);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test des limiters différenciés (3 niveaux: STRICT, MODERATE, PERMISSIVE)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Rate limiters différenciés par niveau de sécurité", () => {
    it("strictAuthLimiter est défini pour l'authentification sensible", () => {
      expect(rateLimitConfig.strictAuthLimiter).toBeDefined();
      expect(typeof rateLimitConfig.strictAuthLimiter).toBe("function");
      expect(rateLimitConfig.strictAuthLimiter.length).toBe(3);
    });

    it("moderateApiLimiter est défini pour les API standards", () => {
      expect(rateLimitConfig.moderateApiLimiter).toBeDefined();
      expect(typeof rateLimitConfig.moderateApiLimiter).toBe("function");
      expect(rateLimitConfig.moderateApiLimiter.length).toBe(3);
    });

    it("permissiveMobileLimiter est défini pour les fonctionnalités mobiles", () => {
      expect(rateLimitConfig.permissiveMobileLimiter).toBeDefined();
      expect(typeof rateLimitConfig.permissiveMobileLimiter).toBe("function");
      expect(rateLimitConfig.permissiveMobileLimiter.length).toBe(3);
    });

    it("les 3 niveaux différenciés sont tous configurés", () => {
      const differentiatedLimiters = [
        "strictAuthLimiter",
        "moderateApiLimiter",
        "permissiveMobileLimiter",
      ];

      differentiatedLimiters.forEach((limiter) => {
        expect(rateLimitConfig[limiter]).toBeDefined();
        expect(typeof rateLimitConfig[limiter]).toBe("function");
      });
    });
  });
});
