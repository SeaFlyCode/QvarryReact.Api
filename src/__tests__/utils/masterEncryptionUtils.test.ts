/**
 * Tests unitaires pour masterEncryptionUtils
 * Tests du chiffrement AES-256-GCM master et du hachage HMAC des emails
 */

import { encrypt, decrypt, hashEmail } from "../../utils/masterEncryptionUtils";

describe("masterEncryptionUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("encrypt", () => {
    it("should return a non-empty string in iv:authTag:encrypted format", () => {
      const text = "Secret data";
      const encrypted = encrypt(text);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");

      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);

      // Verify each part is hex
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/);
        expect(part.length).toBeGreaterThan(0);
      });
    });

    it("should support round-trip encryption/decryption", () => {
      const originalText = "Master secret";
      const encrypted = encrypt(originalText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(originalText);
    });

    it("should produce different results for same text (random IV)", () => {
      const text = "Same secret";
      const encrypted1 = encrypt(text);
      const encrypted2 = encrypt(text);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(text);
      expect(decrypt(encrypted2)).toBe(text);
    });
  });

  describe("decrypt", () => {
    it("should throw error with corrupted data", () => {
      const text = "Test data";
      const encrypted = encrypt(text);

      // Corrupt the ciphertext
      const parts = encrypted.split(":");
      parts[2] = parts[2].substring(0, parts[2].length - 4) + "aaaa";
      const corrupted = parts.join(":");

      expect(() => decrypt(corrupted)).toThrow("Déchiffrement échoué");
    });

    it("should throw error with invalid format (not 3 parts)", () => {
      expect(() => decrypt("invalid:format")).toThrow(
        "Format de données chiffrées invalide",
      );
      expect(() => decrypt("single")).toThrow(
        "Format de données chiffrées invalide",
      );
      expect(() => decrypt("too:many:parts:here")).toThrow(
        "Format de données chiffrées invalide",
      );
    });

    it("should throw error with null input", () => {
      expect(() => decrypt(null as any)).toThrow("Impossible de déchiffrer");
    });

    it("should throw error with undefined input", () => {
      expect(() => decrypt(undefined as any)).toThrow(
        "Impossible de déchiffrer",
      );
    });
  });

  describe("round-trip with special data", () => {
    it("should handle unicode characters", () => {
      const text = "Unicode: 你好世界 🚀 Ñoño";
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(text);
    });
  });

  describe("hashEmail", () => {
    it("should return a deterministic hex string", () => {
      const email = "test@example.com";
      const hash = hashEmail(email);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]+$/);
      expect(hash.length).toBe(64); // SHA-256 produces 32 bytes = 64 hex chars
    });

    it("should return the same hash for the same email", () => {
      const email = "user@example.com";
      const hash1 = hashEmail(email);
      const hash2 = hashEmail(email);

      expect(hash1).toBe(hash2);
    });

    it("should return different hashes for different emails", () => {
      const email1 = "user1@example.com";
      const email2 = "user2@example.com";
      const hash1 = hashEmail(email1);
      const hash2 = hashEmail(email2);

      expect(hash1).not.toBe(hash2);
    });

    it("should be case-insensitive (lowercase email before hashing)", () => {
      const email1 = "User@Example.COM";
      const email2 = "user@example.com";
      const hash1 = hashEmail(email1);
      const hash2 = hashEmail(email2);

      expect(hash1).toBe(hash2);
    });

    it("should trim whitespace from email", () => {
      const email1 = "  user@example.com  ";
      const email2 = "user@example.com";
      const hash1 = hashEmail(email1);
      const hash2 = hashEmail(email2);

      expect(hash1).toBe(hash2);
    });

    it("should throw error if EMAIL_HMAC_KEY is missing", () => {
      // Save original value
      const originalKey = process.env.EMAIL_HMAC_KEY;

      // Clear the key
      delete process.env.EMAIL_HMAC_KEY;

      // Re-import the module in isolation
      jest.resetModules();
      const {
        hashEmail: hashEmailIsolated,
      } = require("../../utils/masterEncryptionUtils");

      // Call hashEmail should throw
      expect(() => hashEmailIsolated("test@example.com")).toThrow(
        "EMAIL_HMAC_KEY manquante",
      );

      // Restore
      process.env.EMAIL_HMAC_KEY = originalKey;
      jest.resetModules();
    });
  });
});
