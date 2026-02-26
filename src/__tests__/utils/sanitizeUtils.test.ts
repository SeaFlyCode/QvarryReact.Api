/**
 * Tests unitaires pour sanitizeUtils
 * Protection contre l'injection NoSQL via opérateurs MongoDB
 */

import { sanitizeMixed } from "../../utils/sanitizeUtils";

describe("sanitizeUtils", () => {
  describe("sanitizeMixed", () => {
    it("should return null as-is", () => {
      const result = sanitizeMixed(null);
      expect(result).toBeNull();
    });

    it("should return undefined as-is", () => {
      const result = sanitizeMixed(undefined);
      expect(result).toBeUndefined();
    });

    it("should remove keys starting with $ (MongoDB operator injection)", () => {
      const data = {
        name: "John",
        $where: "malicious code",
        age: 30,
        $gt: 100,
      };

      const result = sanitizeMixed(data);

      expect(result).toEqual({
        name: "John",
        age: 30,
      });
      expect(result.$where).toBeUndefined();
      expect(result.$gt).toBeUndefined();
    });

    it("should throw on data exceeding maxSize", () => {
      const largeData = {
        content: "a".repeat(10000),
      };

      expect(() => {
        sanitizeMixed(largeData, 100);
      }).toThrow("Data too large");
    });

    it("should handle nested objects with $ keys", () => {
      const data = {
        user: {
          name: "Alice",
          $where: "injection",
          profile: {
            age: 25,
            $ne: "attack",
          },
        },
        $or: [{ a: 1 }, { b: 2 }],
      };

      const result = sanitizeMixed(data);

      expect(result).toEqual({
        user: {
          name: "Alice",
          profile: {
            age: 25,
          },
        },
      });
      expect(result.$or).toBeUndefined();
      expect(result.user.$where).toBeUndefined();
      expect(result.user.profile.$ne).toBeUndefined();
    });

    it("should handle arrays correctly", () => {
      const data = {
        items: [
          { name: "Item1", $set: "bad" },
          { name: "Item2", value: 100 },
        ],
        $push: "injection",
      };

      const result = sanitizeMixed(data);

      expect(result).toEqual({
        items: [{ name: "Item1" }, { name: "Item2", value: 100 }],
      });
      expect(result.$push).toBeUndefined();
      expect(result.items[0].$set).toBeUndefined();
    });

    it("should work with normal data (no $ keys)", () => {
      const data = {
        name: "Bob",
        email: "bob@example.com",
        age: 35,
        active: true,
        metadata: {
          created: "2024-01-01",
          updated: "2024-02-01",
        },
      };

      const result = sanitizeMixed(data);

      expect(result).toEqual(data);
    });

    it("should handle empty objects", () => {
      const result = sanitizeMixed({});
      expect(result).toEqual({});
    });

    it("should handle primitive values", () => {
      expect(sanitizeMixed("string")).toBe("string");
      expect(sanitizeMixed(123)).toBe(123);
      expect(sanitizeMixed(true)).toBe(true);
    });

    it("should use default maxSize of 10000", () => {
      const data = { content: "a".repeat(9000) };
      const result = sanitizeMixed(data);
      expect(result).toEqual(data);
    });
  });
});
