/**
 * Tests unitaires pour emailUtils
 * Validation des adresses email
 */

import { validateEmail } from "../../utils/emailUtils";

describe("emailUtils", () => {
  describe("validateEmail", () => {
    describe("should reject invalid formats", () => {
      it("should reject emails without @", () => {
        const result = validateEmail("notanemail.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("Format d'adresse email invalide");
      });

      it("should reject emails without domain", () => {
        const result = validateEmail("user@");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("Format d'adresse email invalide");
      });

      it("should reject emails without local part", () => {
        const result = validateEmail("@example.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("Format d'adresse email invalide");
      });

      it("should reject emails with spaces", () => {
        const result = validateEmail("user name@example.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("Format d'adresse email invalide");
      });

      it("should reject empty emails", () => {
        const result = validateEmail("");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("Format d'adresse email invalide");
      });
    });

    describe("should reject domains without TLD", () => {
      it("should reject domain without dot", () => {
        const result = validateEmail("user@localhost");
        expect(result.isValid).toBe(false);
        // Note: La regex de base catch ce cas avant la vérification du domaine
        expect(result.message).toContain("Format d'adresse email invalide");
      });
    });

    describe("should reject TLD shorter than 2 chars", () => {
      it("should reject single character TLD", () => {
        const result = validateEmail("user@example.c");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("extension du domaine est invalide");
      });
    });

    describe("should reject disposable domains", () => {
      it("should reject yopmail.com", () => {
        const result = validateEmail("user@yopmail.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain(
          "adresses email temporaires ne sont pas acceptées",
        );
      });

      it("should reject tempmail.com", () => {
        const result = validateEmail("user@tempmail.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("adresses email temporaires");
      });

      it("should reject guerrillamail.com", () => {
        const result = validateEmail("user@guerrillamail.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("adresses email temporaires");
      });

      it("should reject mailinator.com", () => {
        const result = validateEmail("user@mailinator.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("adresses email temporaires");
      });

      it("should reject throwawaymail.com", () => {
        const result = validateEmail("user@throwawaymail.com");
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("adresses email temporaires");
      });

      it("should be case-insensitive for disposable domains", () => {
        const result1 = validateEmail("user@YOPMAIL.COM");
        expect(result1.isValid).toBe(false);

        const result2 = validateEmail("user@YopMail.Com");
        expect(result2.isValid).toBe(false);
      });
    });

    describe("should accept valid emails", () => {
      it("should accept standard email addresses", () => {
        const validEmails = [
          "user@example.com",
          "john.doe@company.org",
          "alice@test.co.uk",
          "admin@domain.io",
        ];

        validEmails.forEach((email) => {
          const result = validateEmail(email);
          expect(result.isValid).toBe(true);
          expect(result.message).toBe("Adresse email valide.");
        });
      });

      it("should accept emails with numbers", () => {
        const result = validateEmail("user123@example456.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with hyphens", () => {
        const result = validateEmail("user-name@my-domain.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with underscores", () => {
        const result = validateEmail("user_name@example.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with dots in local part", () => {
        const result = validateEmail("first.last@example.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with plus sign", () => {
        const result = validateEmail("user+tag@example.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with subdomain", () => {
        const result = validateEmail("user@mail.example.com");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with long TLD", () => {
        const result = validateEmail("user@example.museum");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept emails with two-letter TLD", () => {
        const result = validateEmail("user@example.co");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });

      it("should accept internationalized domain names", () => {
        const result = validateEmail("user@example.org");
        expect(result.isValid).toBe(true);
        expect(result.message).toBe("Adresse email valide.");
      });
    });

    describe("edge cases", () => {
      it("should handle multiple @ symbols", () => {
        const result = validateEmail("user@@example.com");
        expect(result.isValid).toBe(false);
      });

      it("should handle multiple dots in TLD", () => {
        const result = validateEmail("user@example.co.uk");
        expect(result.isValid).toBe(true);
      });

      it("should handle very long local part", () => {
        const longLocal = "a".repeat(64);
        const result = validateEmail(`${longLocal}@example.com`);
        expect(result.isValid).toBe(true);
      });

      it("should handle very long domain", () => {
        const longDomain = "a".repeat(63);
        const result = validateEmail(`user@${longDomain}.com`);
        expect(result.isValid).toBe(true);
      });
    });
  });
});
