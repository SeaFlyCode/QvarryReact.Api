// ═══════════════════════════════════════════════════════════════════════════
// TESTS: cookieConfig
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

describe("cookieConfig", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Test en mode développement
  // ═══════════════════════════════════════════════════════════════════════════

  describe("development mode", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "development";
      delete process.env.COOKIE_SECURE;
      delete process.env.COOKIE_SAMESITE;
    });

    it("JWT_COOKIE_NAME should be 'token' in development", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.JWT_COOKIE_NAME).toBe("token");
    });

    it("REFRESH_TOKEN_COOKIE_NAME should be 'refreshToken' in development", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.REFRESH_TOKEN_COOKIE_NAME).toBe("refreshToken");
    });

    it("baseCookieOptions has httpOnly: true", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.httpOnly).toBe(true);
    });

    it("baseCookieOptions has secure: false by default in development", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.secure).toBe(false);
    });

    it("baseCookieOptions has sameSite: lax by default in development", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.sameSite).toBe("lax");
    });

    it("baseCookieOptions has path: /", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.path).toBe("/");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test en mode production
  // ═══════════════════════════════════════════════════════════════════════════

  describe("production mode", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "production";
      process.env.COOKIE_SECURE = "true"; // Production always has COOKIE_SECURE=true
      delete process.env.COOKIE_SAMESITE;
    });

    afterEach(() => {
      process.env.NODE_ENV = "test";
    });

    it("JWT_COOKIE_NAME should be '__Host-token' in production", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.JWT_COOKIE_NAME).toBe("__Host-token");
    });

    it("REFRESH_TOKEN_COOKIE_NAME should be '__Host-refreshToken' in production", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.REFRESH_TOKEN_COOKIE_NAME).toBe(
        "__Host-refreshToken",
      );
    });

    it("baseCookieOptions has secure: true in production", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.secure).toBe(true);
    });

    it("baseCookieOptions has sameSite: strict by default in production", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.sameSite).toBe("strict");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test avec variables d'environnement personnalisées
  // ═══════════════════════════════════════════════════════════════════════════

  describe("custom environment variables", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "development";
    });

    it("respects COOKIE_SECURE=true in development", async () => {
      process.env.COOKIE_SECURE = "true";
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.secure).toBe(true);
    });

    it("respects COOKIE_SAMESITE=none", async () => {
      process.env.COOKIE_SAMESITE = "none";
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.sameSite).toBe("none");
    });

    it("respects COOKIE_SAMESITE=strict", async () => {
      process.env.COOKIE_SAMESITE = "strict";
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.baseCookieOptions.sameSite).toBe("strict");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test des fonctions getJwtCookieOptions et getRefreshTokenCookieOptions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cookie options functions", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "test";
      delete process.env.JWT_EXPIRES_IN;
      delete process.env.REFRESH_TOKEN_EXPIRES_IN;
    });

    it("getJwtCookieOptions() returns maxAge based on JWT_EXPIRES_IN", async () => {
      process.env.JWT_EXPIRES_IN = "15m";
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getJwtCookieOptions();

      expect(options.maxAge).toBe(15 * 60 * 1000); // 15 minutes in ms
      expect(options.httpOnly).toBe(true);
    });

    it("getJwtCookieOptions() uses default 15 minutes when JWT_EXPIRES_IN is not set", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getJwtCookieOptions();

      expect(options.maxAge).toBe(15 * 60 * 1000);
    });

    it("getJwtCookieOptions() extracts numbers from JWT_EXPIRES_IN correctly", async () => {
      process.env.JWT_EXPIRES_IN = "30m";
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getJwtCookieOptions();

      expect(options.maxAge).toBe(30 * 60 * 1000);
    });

    it("getRefreshTokenCookieOptions() returns maxAge based on REFRESH_TOKEN_EXPIRES_IN", async () => {
      process.env.REFRESH_TOKEN_EXPIRES_IN = "48";
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getRefreshTokenCookieOptions();

      expect(options.maxAge).toBe(48 * 60 * 60 * 1000); // 48 hours in ms
      expect(options.httpOnly).toBe(true);
    });

    it("getRefreshTokenCookieOptions() uses default 48 hours when not set", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getRefreshTokenCookieOptions();

      expect(options.maxAge).toBe(48 * 60 * 60 * 1000);
    });

    it("getRefreshTokenCookieOptions() with custom hours", async () => {
      process.env.REFRESH_TOKEN_EXPIRES_IN = "72";
      const cookieConfig = await import("../../config/cookieConfig");
      const options = cookieConfig.getRefreshTokenCookieOptions();

      expect(options.maxAge).toBe(72 * 60 * 60 * 1000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test de clearCookieOptions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("clearCookieOptions", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "test";
    });

    it("has maxAge: 0 for clearing cookies", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.clearCookieOptions.maxAge).toBe(0);
    });

    it("has httpOnly: true", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.clearCookieOptions.httpOnly).toBe(true);
    });

    it("has path: /", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      expect(cookieConfig.clearCookieOptions.path).toBe("/");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test de getCookieConfig()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getCookieConfig()", () => {
    beforeEach(() => {
      jest.resetModules();
      process.env.NODE_ENV = "development";
      process.env.JWT_EXPIRES_IN = "20m";
      process.env.REFRESH_TOKEN_EXPIRES_IN = "24";
    });

    it("returns expected structure with all config values", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      const config = cookieConfig.getCookieConfig();

      expect(config).toHaveProperty("secure");
      expect(config).toHaveProperty("sameSite");
      expect(config).toHaveProperty("isProduction");
      expect(config).toHaveProperty("jwtMaxAgeMinutes");
      expect(config).toHaveProperty("refreshMaxAgeHours");
    });

    it("returns correct values for development mode", async () => {
      const cookieConfig = await import("../../config/cookieConfig");
      const config = cookieConfig.getCookieConfig();

      expect(config.isProduction).toBe(false);
      expect(config.jwtMaxAgeMinutes).toBe(20);
      expect(config.refreshMaxAgeHours).toBe(24);
    });

    it("returns correct values for production mode", async () => {
      jest.resetModules();
      process.env.NODE_ENV = "production";
      process.env.JWT_EXPIRES_IN = "15m";
      process.env.REFRESH_TOKEN_EXPIRES_IN = "48";

      const cookieConfig = await import("../../config/cookieConfig");
      const config = cookieConfig.getCookieConfig();

      expect(config.isProduction).toBe(true);
      expect(config.secure).toBe(true);
      expect(config.sameSite).toBe("strict");
      expect(config.jwtMaxAgeMinutes).toBe(15);
      expect(config.refreshMaxAgeHours).toBe(48);
    });
  });
});
