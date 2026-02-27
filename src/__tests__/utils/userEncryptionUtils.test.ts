/**
 * Tests unitaires pour userEncryptionUtils
 * Tests du chiffrement AES-256-GCM avec clés utilisateur
 */

// Mock dependencies before imports
jest.mock("../../models/keys");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../services/loggerService");

// Use fake timers to avoid setInterval hanging
jest.useFakeTimers();

import crypto from "crypto";
import {
  encryptWithKey,
  decryptWithKey,
  encryptUserKeys,
  decryptUserKeys,
  clearUserKeyCache,
} from "../../utils/userEncryptionUtils";
import KeysModel from "../../models/keys";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

describe("userEncryptionUtils", () => {
  // Generate a test encryption key (32 bytes = 64 hex chars)
  const testKey = crypto.randomBytes(32).toString("hex");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("encryptWithKey", () => {
    it("should return non-empty string in iv:authTag:encrypted format", () => {
      const text = "User secret data";
      const encrypted = encryptWithKey(text, testKey);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");

      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);

      // All parts should be hex
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/);
        expect(part.length).toBeGreaterThan(0);
      });
    });

    it("should support round-trip with decryptWithKey", () => {
      const originalText = "Sensitive user information";
      const encrypted = encryptWithKey(originalText, testKey);
      const decrypted = decryptWithKey(encrypted, testKey);

      expect(decrypted).toBe(originalText);
    });

    it("should produce different results for same text (random IV)", () => {
      const text = "Same user data";
      const encrypted1 = encryptWithKey(text, testKey);
      const encrypted2 = encryptWithKey(text, testKey);

      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt correctly
      expect(decryptWithKey(encrypted1, testKey)).toBe(text);
      expect(decryptWithKey(encrypted2, testKey)).toBe(text);
    });
  });

  describe("decryptWithKey", () => {
    it("should throw error when using wrong key", () => {
      const text = "Secret message";
      const encrypted = encryptWithKey(text, testKey);

      // Try to decrypt with different key
      const wrongKey = crypto.randomBytes(32).toString("hex");

      expect(() => decryptWithKey(encrypted, wrongKey)).toThrow(
        "Déchiffrement échoué",
      );
    });

    it("should throw error with invalid format", () => {
      expect(() => decryptWithKey("invalid", testKey)).toThrow(
        "Format de données chiffrées invalide",
      );

      expect(() => decryptWithKey("part1:part2", testKey)).toThrow(
        "Format de données chiffrées invalide",
      );

      expect(() => decryptWithKey("part1:part2:part3:part4", testKey)).toThrow(
        "Format de données chiffrées invalide",
      );
    });
  });

  describe("round-trip edge cases", () => {
    it("should handle unicode characters", () => {
      const text = "Unicode: 你好 🎉 Ñoño";
      const encrypted = encryptWithKey(text, testKey);
      const decrypted = decryptWithKey(encrypted, testKey);

      expect(decrypted).toBe(text);
    });

    it("should handle empty string", () => {
      const text = "";
      const encrypted = encryptWithKey(text, testKey);
      const decrypted = decryptWithKey(encrypted, testKey);

      expect(decrypted).toBe(text);
    });
  });

  describe("encryptUserKeys", () => {
    it("should fetch key from DB and encrypt", async () => {
      const userId = "user123";
      const text = "User data to encrypt";
      const encryptedDbKey = "fake:encrypted:user:key";

      // Mock DB response
      (KeysModel.findOne as jest.Mock).mockResolvedValue({
        userId,
        type: "user",
        key: encryptedDbKey,
      });

      // Mock masterEncryptionUtils.decrypt to return our test key
      (masterEncryptionUtils.decrypt as jest.Mock).mockReturnValue(testKey);

      const result = await encryptUserKeys(userId as any, text);

      expect(KeysModel.findOne).toHaveBeenCalledWith({
        userId,
        type: "user",
      });
      expect(masterEncryptionUtils.decrypt).toHaveBeenCalledWith(
        encryptedDbKey,
      );
      expect(result).toBeTruthy();

      // Result should be in correct format
      const parts = result.split(":");
      expect(parts).toHaveLength(3);
    });
  });

  describe("decryptUserKeys", () => {
    it("should fetch key from DB and decrypt", async () => {
      const userId = "user456";
      const text = "Data to encrypt";
      const encryptedDbKey = "fake:encrypted:user:key";

      // Mock DB response
      (KeysModel.findOne as jest.Mock).mockResolvedValue({
        userId,
        type: "user",
        key: encryptedDbKey,
      });

      // Mock masterEncryptionUtils.decrypt to return our test key
      (masterEncryptionUtils.decrypt as jest.Mock).mockReturnValue(testKey);

      // First encrypt some data
      const encrypted = encryptWithKey(text, testKey);

      // Now decrypt it
      const result = await decryptUserKeys(userId as any, encrypted);

      expect(KeysModel.findOne).toHaveBeenCalledWith({
        userId,
        type: "user",
      });
      expect(masterEncryptionUtils.decrypt).toHaveBeenCalledWith(
        encryptedDbKey,
      );
      expect(result).toBe(text);
    });
  });

  describe("clearUserKeyCache", () => {
    it("should work without error", () => {
      expect(() => clearUserKeyCache("user123")).not.toThrow();
    });
  });

  describe("cache behavior", () => {
    it("should cache user key and not query DB on second call", async () => {
      const userId = "user789";
      const text1 = "First message";
      const text2 = "Second message";
      const encryptedDbKey = "fake:encrypted:user:key";

      // Mock DB response
      (KeysModel.findOne as jest.Mock).mockResolvedValue({
        userId,
        type: "user",
        key: encryptedDbKey,
      });

      // Mock masterEncryptionUtils.decrypt
      (masterEncryptionUtils.decrypt as jest.Mock).mockReturnValue(testKey);

      // First call - should hit DB
      await encryptUserKeys(userId as any, text1);
      expect(KeysModel.findOne).toHaveBeenCalledTimes(1);

      // Second call - should use cache (no additional DB query)
      await encryptUserKeys(userId as any, text2);
      expect(KeysModel.findOne).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });
});
