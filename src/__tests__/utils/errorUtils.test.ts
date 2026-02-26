/**
 * Tests unitaires pour errorUtils
 * Gestion type-safe des erreurs
 */

import { getErrorMessage, isErrorWithName } from "../../utils/errorUtils";

// Mock du logger service
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

describe("errorUtils", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe("getErrorMessage", () => {
    describe("in development mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "development";
      });

      it("should return error.message for Error instances", () => {
        const error = new Error("Test error message");
        const result = getErrorMessage(error);
        expect(result).toBe("Test error message");
      });

      it("should return string errors directly", () => {
        const error = "String error message";
        const result = getErrorMessage(error);
        expect(result).toBe("String error message");
      });

      it("should return message from objects with message property", () => {
        const error = { message: "Object error message" };
        const result = getErrorMessage(error);
        expect(result).toBe("Object error message");
      });

      it("should return default message for unknown types", () => {
        const error = 123;
        const result = getErrorMessage(error, "Default message");
        expect(result).toBe("Default message");
      });

      it("should return default message for null", () => {
        const result = getErrorMessage(null, "Null error");
        expect(result).toBe("Null error");
      });

      it("should return default message for undefined", () => {
        const result = getErrorMessage(undefined, "Undefined error");
        expect(result).toBe("Undefined error");
      });

      it("should use default default message when not provided", () => {
        const error = {};
        const result = getErrorMessage(error);
        expect(result).toBe("Une erreur est survenue");
      });
    });

    describe("in production mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "production";
      });

      it("should return generic message for Error instances", () => {
        const error = new Error("Sensitive internal error");
        const result = getErrorMessage(error);
        expect(result).toBe("Une erreur interne est survenue");
      });

      it("should return generic message for string errors", () => {
        const error = "Internal string error";
        const result = getErrorMessage(error);
        expect(result).toBe("Une erreur interne est survenue");
      });

      it("should return generic message for objects with message", () => {
        const error = { message: "Internal object error" };
        const result = getErrorMessage(error);
        expect(result).toBe("Une erreur interne est survenue");
      });

      it("should return generic message for unknown types", () => {
        const error = 123;
        const result = getErrorMessage(error, "Default");
        expect(result).toBe("Une erreur interne est survenue");
      });

      it("should not expose default message in production", () => {
        const error = null;
        const result = getErrorMessage(error, "Custom default");
        expect(result).toBe("Une erreur interne est survenue");
        expect(result).not.toBe("Custom default");
      });
    });

    describe("in test mode", () => {
      beforeEach(() => {
        process.env.NODE_ENV = "test";
      });

      it("should expose error details in test mode", () => {
        const error = new Error("Test mode error");
        const result = getErrorMessage(error);
        expect(result).toBe("Test mode error");
      });
    });
  });

  describe("isErrorWithName", () => {
    it("should return true when error name matches", () => {
      const error = new Error("Test error");
      error.name = "TokenExpiredError";

      const result = isErrorWithName(error, "TokenExpiredError");
      expect(result).toBe(true);
    });

    it("should return false when error name does not match", () => {
      const error = new Error("Test error");
      error.name = "TokenExpiredError";

      const result = isErrorWithName(error, "ValidationError");
      expect(result).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      const error = { name: "TokenExpiredError" };

      const result = isErrorWithName(error, "TokenExpiredError");
      expect(result).toBe(false);
    });

    it("should return false for string errors", () => {
      const error = "TokenExpiredError";

      const result = isErrorWithName(error, "TokenExpiredError");
      expect(result).toBe(false);
    });

    it("should return false for null", () => {
      const result = isErrorWithName(null, "SomeError");
      expect(result).toBe(false);
    });

    it("should return false for undefined", () => {
      const result = isErrorWithName(undefined, "SomeError");
      expect(result).toBe(false);
    });

    it("should handle custom Error subclasses", () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      const error = new CustomError("Custom error");
      expect(isErrorWithName(error, "CustomError")).toBe(true);
      expect(isErrorWithName(error, "Error")).toBe(false);
    });

    it("should be case-sensitive", () => {
      const error = new Error("Test");
      error.name = "TokenExpiredError";

      expect(isErrorWithName(error, "TokenExpiredError")).toBe(true);
      expect(isErrorWithName(error, "tokenexpirederror")).toBe(false);
      expect(isErrorWithName(error, "TOKENEXPIREDERROR")).toBe(false);
    });
  });
});
