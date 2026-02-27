/**
 * Tests unitaires pour communicationEncryptionUtils
 * Tests du chiffrement AES-256-GCM pour les communications
 */

import { encrypt, decrypt } from "../../utils/communicationEncryptionUtils";

describe("communicationEncryptionUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("encrypt", () => {
    it("should return a non-empty string", () => {
      const text = "Hello World";
      const encrypted = encrypt(text);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should return output in format iv:authTag:encrypted (3 parts)", () => {
      const text = "Test message";
      const encrypted = encrypt(text);

      const parts = encrypted.split(":");
      expect(parts).toHaveLength(3);

      // Verify each part is hex (non-empty)
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/);
        expect(part.length).toBeGreaterThan(0);
      });
    });

    it("should support round-trip encryption/decryption", () => {
      const originalText = "Secret message";
      const encrypted = encrypt(originalText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(originalText);
    });

    it("should produce different results for same text (random IV)", () => {
      const text = "Same message";
      const encrypted1 = encrypt(text);
      const encrypted2 = encrypt(text);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(text);
      expect(decrypt(encrypted2)).toBe(text);
    });
  });

  describe("decrypt", () => {
    it("should throw error with corrupted ciphertext", () => {
      const text = "Test message";
      const encrypted = encrypt(text);

      // Corrupt the ciphertext part (last part after second colon)
      const parts = encrypted.split(":");
      parts[2] = parts[2].substring(0, parts[2].length - 4) + "ffff";
      const corrupted = parts.join(":");

      expect(() => decrypt(corrupted)).toThrow("Déchiffrement échoué");
    });

    it("should throw error with invalid format (not 3 parts)", () => {
      expect(() => decrypt("invalid")).toThrow(
        "Format de données chiffrées invalide",
      );
      expect(() => decrypt("part1:part2")).toThrow(
        "Format de données chiffrées invalide",
      );
      expect(() => decrypt("part1:part2:part3:part4")).toThrow(
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

  describe("round-trip edge cases", () => {
    it("should handle empty string", () => {
      const text = "";
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    it("should handle unicode and special characters", () => {
      const text = "Hello 世界! 🌍 Émojis & spëcial çhars: @#$%^&*()";
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    it("should handle very long strings", () => {
      const text = "A".repeat(10000);
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(text);
      expect(decrypted.length).toBe(10000);
    });
  });
});
