/**
 * Tests unitaires pour jwtKeyManager
 * Tests de la gestion des clés JWT avec versioning
 */

// Mock logger before imports
jest.mock("../../services/loggerService");

describe("jwtKeyManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("with default JWT_SECRET only", () => {
    let jwtKeyManager: any;

    beforeAll(() => {
      // Ensure only JWT_SECRET is set
      delete process.env.JWT_SECRET_V2;
      delete process.env.JWT_SECRET_V3;

      // Reset modules and import fresh
      jest.resetModules();
      const module = require("../../utils/jwtKeyManager");
      jwtKeyManager = module.jwtKeyManager;
    });

    it("should be defined", () => {
      expect(jwtKeyManager).toBeDefined();
    });

    it("should return secret and version from getCurrentKey", () => {
      const currentKey = jwtKeyManager.getCurrentKey();

      expect(currentKey).toHaveProperty("secret");
      expect(currentKey).toHaveProperty("version");
      expect(typeof currentKey.secret).toBe("string");
      expect(currentKey.secret.length).toBeGreaterThan(0);
      expect(currentKey.version).toBe("1");
    });

    it("should return version 1 from getCurrentVersion", () => {
      const version = jwtKeyManager.getCurrentVersion();
      expect(version).toBe("1");
    });

    it("should return secret for version 1 with getKeyByVersion", () => {
      const secret = jwtKeyManager.getKeyByVersion("1");
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe("string");
    });

    it("should return null for non-existent version with getKeyByVersion", () => {
      const secret = jwtKeyManager.getKeyByVersion("999");
      expect(secret).toBeNull();
    });

    it("should return true for hasVersion with version 1", () => {
      const hasV1 = jwtKeyManager.hasVersion("1");
      expect(hasV1).toBe(true);
    });

    it("should return false for hasVersion with non-existent version", () => {
      const hasV999 = jwtKeyManager.hasVersion("999");
      expect(hasV999).toBe(false);
    });

    it("should include version 1 in getAllVersions", () => {
      const versions = jwtKeyManager.getAllVersions();
      expect(versions).toContain("1");
      expect(Array.isArray(versions)).toBe(true);
    });

    it("should return correct structure from getStats", () => {
      const stats = jwtKeyManager.getStats();

      expect(stats).toHaveProperty("totalKeys");
      expect(stats).toHaveProperty("currentVersion");
      expect(stats).toHaveProperty("versions");
      expect(typeof stats.totalKeys).toBe("number");
      expect(stats.currentVersion).toBe("1");
      expect(Array.isArray(stats.versions)).toBe(true);
    });

    it("should generate new key with generateNewKey", () => {
      const result = jwtKeyManager.generateNewKey();

      expect(result).toHaveProperty("key");
      expect(result).toHaveProperty("version");
      expect(typeof result.key).toBe("string");
      expect(result.key.length).toBeGreaterThan(0);
      expect(typeof result.version).toBe("number");
      expect(result.version).toBeGreaterThan(1);
    });
  });

  describe("with JWT_SECRET_V2 set", () => {
    let jwtKeyManager: any;

    beforeAll(() => {
      // Set V2
      process.env.JWT_SECRET_V2 = "test-jwt-secret-v2-for-rotation";
      delete process.env.JWT_SECRET_V3;

      // Reset modules and import fresh
      jest.resetModules();
      const module = require("../../utils/jwtKeyManager");
      jwtKeyManager = module.jwtKeyManager;
    });

    afterAll(() => {
      delete process.env.JWT_SECRET_V2;
    });

    it("should use version 2 as current version", () => {
      const version = jwtKeyManager.getCurrentVersion();
      expect(version).toBe("2");
    });

    it("should return version 2 secret from getCurrentKey", () => {
      const currentKey = jwtKeyManager.getCurrentKey();
      expect(currentKey.version).toBe("2");
      expect(currentKey.secret).toBe(process.env.JWT_SECRET_V2);
    });
  });

  describe("with JWT_SECRET_V2 and V3 set", () => {
    let jwtKeyManager: any;

    beforeAll(() => {
      // Set V2 and V3
      process.env.JWT_SECRET_V2 = "test-jwt-secret-v2-for-rotation";
      process.env.JWT_SECRET_V3 = "test-jwt-secret-v3-for-rotation";

      // Reset modules and import fresh
      jest.resetModules();
      const module = require("../../utils/jwtKeyManager");
      jwtKeyManager = module.jwtKeyManager;
    });

    afterAll(() => {
      delete process.env.JWT_SECRET_V2;
      delete process.env.JWT_SECRET_V3;
    });

    it("should use version 3 as current version", () => {
      const version = jwtKeyManager.getCurrentVersion();
      expect(version).toBe("3");
    });

    it("should return version 3 secret from getCurrentKey", () => {
      const currentKey = jwtKeyManager.getCurrentKey();
      expect(currentKey.version).toBe("3");
      expect(currentKey.secret).toBe(process.env.JWT_SECRET_V3);
    });

    it("should still be able to access version 1 and 2", () => {
      const v1Secret = jwtKeyManager.getKeyByVersion("1");
      const v2Secret = jwtKeyManager.getKeyByVersion("2");

      expect(v1Secret).toBeTruthy();
      expect(v2Secret).toBeTruthy();
      expect(v2Secret).toBe(process.env.JWT_SECRET_V2);
    });

    it("should report correct stats with multiple versions", () => {
      const stats = jwtKeyManager.getStats();

      expect(stats.totalKeys).toBeGreaterThanOrEqual(3);
      expect(stats.currentVersion).toBe("3");
      expect(stats.versions).toContain("1");
      expect(stats.versions).toContain("2");
      expect(stats.versions).toContain("3");
    });
  });
});
