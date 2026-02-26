/**
 * Tests unitaires pour passwordUtils
 * Validation de force de mot de passe et historique
 */

import {
  validatePasswordStrength,
  isPasswordInHistory,
  addToPasswordHistory,
} from "../../utils/passwordUtils";
import bcrypt from "bcrypt";

// Mock bcrypt
jest.mock("bcrypt");

describe("passwordUtils", () => {
  describe("validatePasswordStrength", () => {
    it("should reject passwords shorter than 12 chars", () => {
      const result = validatePasswordStrength("Short1!");
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("au moins 12 caractères");
    });

    it("should reject password without uppercase", () => {
      const result = validatePasswordStrength("lowercase123!");
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("lettre majuscule");
    });

    it("should reject password without lowercase", () => {
      const result = validatePasswordStrength("UPPERCASE123!");
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("lettre minuscule");
    });

    it("should reject password without digit", () => {
      const result = validatePasswordStrength("NoDigitsHere!");
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("au moins un chiffre");
    });

    it("should reject password without special char", () => {
      const result = validatePasswordStrength("NoSpecial123");
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("caractère spécial");
    });

    it("should accept valid passwords", () => {
      const validPasswords = [
        "MyStr0ng!Pass",
        "ValidP@ssw0rd123",
        "C0mpl3x#Passw0rd",
        "Secur3$Password!",
      ];

      validPasswords.forEach((password) => {
        const result = validatePasswordStrength(password);
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Mot de passe valide.");
      });
    });

    it("should accept common special characters", () => {
      // Test des caractères spéciaux reconnus par la regex
      // Tous les mots de passe doivent avoir au moins 12 caractères
      const passwords = [
        "Valid1Pass!!",
        "Valid1Pass@@",
        "Valid1Pass##",
        "Valid1Pass$$",
        "Valid1Pass%%",
        "Valid1Pass^^",
        "Valid1Pass&&",
        "Valid1Pass**",
        "Valid1Pass__",
        "Valid1Pass--",
      ];

      passwords.forEach((password) => {
        const result = validatePasswordStrength(password);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe("isPasswordInHistory", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return false for empty history", async () => {
      const result = await isPasswordInHistory("NewPassword123!", []);
      expect(result).toBe(false);
    });

    it("should return false for undefined history", async () => {
      const result = await isPasswordInHistory(
        "NewPassword123!",
        undefined as any,
      );
      expect(result).toBe(false);
    });

    it("should return true if password matches one in history", async () => {
      const passwordHistory = ["hash1", "hash2", "hash3"];
      const newPassword = "OldPassword123!";

      // Mock bcrypt.compare to return true for the second hash
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(false) // hash1 - no match
        .mockResolvedValueOnce(true); // hash2 - match!

      const result = await isPasswordInHistory(newPassword, passwordHistory);

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith(newPassword, "hash1");
      expect(bcrypt.compare).toHaveBeenCalledWith(newPassword, "hash2");
    });

    it("should return false if password does not match any in history", async () => {
      const passwordHistory = ["hash1", "hash2", "hash3"];
      const newPassword = "BrandNewPass123!";

      // Mock bcrypt.compare to return false for all hashes
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await isPasswordInHistory(newPassword, passwordHistory);

      expect(result).toBe(false);
      expect(bcrypt.compare).toHaveBeenCalledTimes(3);
      expect(bcrypt.compare).toHaveBeenCalledWith(newPassword, "hash1");
      expect(bcrypt.compare).toHaveBeenCalledWith(newPassword, "hash2");
      expect(bcrypt.compare).toHaveBeenCalledWith(newPassword, "hash3");
    });

    it("should check all passwords in history", async () => {
      const passwordHistory = ["hash1", "hash2", "hash3", "hash4", "hash5"];
      const newPassword = "TestPassword123!";

      // Mock all comparisons to return false
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await isPasswordInHistory(newPassword, passwordHistory);

      expect(result).toBe(false);
      expect(bcrypt.compare).toHaveBeenCalledTimes(5);
    });
  });

  describe("addToPasswordHistory", () => {
    it("should add password hash to front of history", () => {
      const currentHash = "newHash";
      const existingHistory = ["hash1", "hash2"];

      const result = addToPasswordHistory(currentHash, existingHistory);

      expect(result).toEqual(["newHash", "hash1", "hash2"]);
      expect(result[0]).toBe(currentHash);
    });

    it("should limit history to 5 entries", () => {
      const currentHash = "newHash";
      const existingHistory = ["hash1", "hash2", "hash3", "hash4", "hash5"];

      const result = addToPasswordHistory(currentHash, existingHistory);

      expect(result).toHaveLength(5);
      expect(result).toEqual(["newHash", "hash1", "hash2", "hash3", "hash4"]);
      expect(result).not.toContain("hash5");
    });

    it("should work with empty history", () => {
      const currentHash = "firstHash";

      const result = addToPasswordHistory(currentHash, []);

      expect(result).toEqual(["firstHash"]);
      expect(result).toHaveLength(1);
    });

    it("should work with undefined history (default parameter)", () => {
      const currentHash = "firstHash";

      const result = addToPasswordHistory(currentHash);

      expect(result).toEqual(["firstHash"]);
      expect(result).toHaveLength(1);
    });

    it("should maintain order correctly", () => {
      let history: string[] = [];

      history = addToPasswordHistory("hash1", history);
      expect(history).toEqual(["hash1"]);

      history = addToPasswordHistory("hash2", history);
      expect(history).toEqual(["hash2", "hash1"]);

      history = addToPasswordHistory("hash3", history);
      expect(history).toEqual(["hash3", "hash2", "hash1"]);
    });

    it("should not mutate original history array", () => {
      const originalHistory = ["hash1", "hash2"];
      const originalCopy = [...originalHistory];

      addToPasswordHistory("newHash", originalHistory);

      expect(originalHistory).toEqual(originalCopy);
    });
  });
});
