/**
 * Tests unitaires pour rsaEncryptionUtils
 * Tests du chiffrement RSA-4096 et des signatures numériques
 */

// Mock logger before imports
jest.mock("../../services/loggerService");

import crypto from "crypto";
import {
  generateRSAKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  createDataHash,
  signData,
  verifySignature,
  isValidPublicKey,
  isValidPrivateKey,
} from "../../utils/rsaEncryptionUtils";
import * as masterEncryptionUtils from "../../utils/masterEncryptionUtils";

// Increase timeout for RSA generation
jest.setTimeout(30000);

describe("rsaEncryptionUtils", () => {
  // Generate ONE key pair for all tests (RSA 4096 is slow)
  let testKeyPair: { publicKey: string; privateKey: string };

  beforeAll(() => {
    testKeyPair = generateRSAKeyPair();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateRSAKeyPair", () => {
    it("should return publicKey and privateKey in PEM format", () => {
      const keyPair = generateRSAKeyPair();

      expect(keyPair).toHaveProperty("publicKey");
      expect(keyPair).toHaveProperty("privateKey");
      expect(typeof keyPair.publicKey).toBe("string");
      expect(typeof keyPair.privateKey).toBe("string");
    });

    it("should generate keys with correct PEM headers", () => {
      const keyPair = generateRSAKeyPair();

      expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
      expect(keyPair.publicKey).toContain("-----END PUBLIC KEY-----");
      expect(keyPair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
      expect(keyPair.privateKey).toContain("-----END PRIVATE KEY-----");
    });
  });

  describe("encryptPrivateKey", () => {
    it("should call masterEncryptionUtils.encrypt", () => {
      const encryptSpy = jest.spyOn(masterEncryptionUtils, "encrypt");
      const privateKey = testKeyPair.privateKey;

      encryptPrivateKey(privateKey);

      expect(encryptSpy).toHaveBeenCalledWith(privateKey);
      expect(encryptSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("decryptPrivateKey", () => {
    it("should call masterEncryptionUtils.decrypt", () => {
      const decryptSpy = jest.spyOn(masterEncryptionUtils, "decrypt");
      const encryptedKey = "fake:encrypted:key";

      try {
        decryptPrivateKey(encryptedKey);
      } catch {
        // Expected to fail with fake data
      }

      expect(decryptSpy).toHaveBeenCalledWith(encryptedKey);
      expect(decryptSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("encryptWithPublicKey", () => {
    it("should return 4-part format: encryptedAESKey:iv:authTag:encryptedData", () => {
      const data = "Sensitive information";
      const encrypted = encryptWithPublicKey(data, testKeyPair.publicKey);

      const parts = encrypted.split(":");
      expect(parts).toHaveLength(4);

      // All parts should be hex strings
      parts.forEach((part) => {
        expect(part).toMatch(/^[0-9a-f]+$/);
        expect(part.length).toBeGreaterThan(0);
      });
    });

    it("should correctly decrypt with decryptWithPrivateKey (round-trip)", () => {
      const originalData = "Secret message with RSA hybrid encryption";
      const encrypted = encryptWithPublicKey(
        originalData,
        testKeyPair.publicKey,
      );
      const decrypted = decryptWithPrivateKey(
        encrypted,
        testKeyPair.privateKey,
      );

      expect(decrypted).toBe(originalData);
    });
  });

  describe("decryptWithPrivateKey", () => {
    it("should throw on invalid format (not 4 parts)", () => {
      expect(() =>
        decryptWithPrivateKey("invalid:format", testKeyPair.privateKey),
      ).toThrow("Format de données chiffrées invalide");

      expect(() =>
        decryptWithPrivateKey(
          "part1:part2:part3:part4:part5",
          testKeyPair.privateKey,
        ),
      ).toThrow("Format de données chiffrées invalide");
    });

    it("should throw on corrupted data", () => {
      const data = "Test data";
      const encrypted = encryptWithPublicKey(data, testKeyPair.publicKey);

      // Corrupt the encrypted data (last part)
      const parts = encrypted.split(":");
      parts[3] = parts[3].substring(0, parts[3].length - 4) + "ffff";
      const corrupted = parts.join(":");

      expect(() =>
        decryptWithPrivateKey(corrupted, testKeyPair.privateKey),
      ).toThrow("Déchiffrement échoué");
    });
  });

  describe("createDataHash", () => {
    it("should return a deterministic hex string", () => {
      const data = "Data to hash";
      const hash = createDataHash(data);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]+$/);
      expect(hash.length).toBe(64); // SHA-256 = 64 hex chars
    });

    it("should return different hashes for different data", () => {
      const data1 = "First data";
      const data2 = "Second data";
      const hash1 = createDataHash(data1);
      const hash2 = createDataHash(data2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("signData", () => {
    it("should return signature:timestamp format", () => {
      const data = "Data to sign";
      const signed = signData(data, testKeyPair.privateKey);

      const parts = signed.split(":");
      expect(parts).toHaveLength(2);

      // First part is signature (hex), second is timestamp (numeric string)
      expect(parts[0]).toMatch(/^[0-9a-f]+$/);
      expect(parts[1]).toMatch(/^\d+$/);

      // Timestamp should be reasonable (recent)
      const timestamp = parseInt(parts[1], 10);
      const now = Date.now();
      expect(timestamp).toBeGreaterThan(now - 1000); // Within last second
      expect(timestamp).toBeLessThanOrEqual(now);
    });
  });

  describe("verifySignature", () => {
    it("should return true for valid signature", () => {
      const data = "Important data";
      const signature = signData(data, testKeyPair.privateKey);
      const isValid = verifySignature(data, signature, testKeyPair.publicKey);

      expect(isValid).toBe(true);
    });

    it("should return false for expired signature", () => {
      const data = "Time-sensitive data";

      // Mock Date.now for signing (5 minutes and 1 second ago)
      const oldTimestamp = Date.now() - 5 * 60 * 1000 - 1000;
      jest.spyOn(Date, "now").mockReturnValueOnce(oldTimestamp);

      const signature = signData(data, testKeyPair.privateKey);

      // Restore Date.now for verification
      jest.spyOn(Date, "now").mockRestore();

      const isValid = verifySignature(data, signature, testKeyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it("should return false for invalid format", () => {
      const data = "Some data";
      const isValid = verifySignature(
        data,
        "invalid-format",
        testKeyPair.publicKey,
      );
      expect(isValid).toBe(false);
    });

    it("should return false for tampered data", () => {
      const data = "Original data";
      const signature = signData(data, testKeyPair.privateKey);

      // Verify with different data
      const tamperedData = "Tampered data";
      const isValid = verifySignature(
        tamperedData,
        signature,
        testKeyPair.publicKey,
      );

      expect(isValid).toBe(false);
    });
  });

  describe("isValidPublicKey", () => {
    it("should return true for valid 4096-bit RSA public key", () => {
      const isValid = isValidPublicKey(testKeyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("should return false for invalid key", () => {
      const invalidKey = "not-a-valid-key";
      const isValid = isValidPublicKey(invalidKey);
      expect(isValid).toBe(false);
    });
  });

  describe("isValidPrivateKey", () => {
    it("should return true for valid 4096-bit RSA private key", () => {
      const isValid = isValidPrivateKey(testKeyPair.privateKey);
      expect(isValid).toBe(true);
    });

    it("should return false for invalid key", () => {
      const invalidKey = "not-a-valid-private-key";
      const isValid = isValidPrivateKey(invalidKey);
      expect(isValid).toBe(false);
    });
  });
});
