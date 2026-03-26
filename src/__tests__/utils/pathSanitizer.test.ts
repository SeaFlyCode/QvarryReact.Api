// src/__tests__/utils/pathSanitizer.test.ts
// Tests unitaires pour pathSanitizer (protection Path Traversal)

import {
  sanitizePathId,
  validatePathWithinBase,
  buildSecurePath,
  PathSanitizationError,
} from "../../utils/pathSanitizer";
import mongoose from "mongoose";
import path from "path";

describe("🛡️ pathSanitizer - Protection Path Traversal", () => {
  describe("sanitizePathId()", () => {
    describe("✅ Cas valides", () => {
      it("doit accepter un ObjectId MongoDB valide", () => {
        const validId = new mongoose.Types.ObjectId().toString();
        expect(() => sanitizePathId(validId)).not.toThrow();
        expect(sanitizePathId(validId)).toBe(validId);
      });

      it("doit accepter un ObjectId en minuscules", () => {
        const validId = "507f1f77bcf86cd799439011";
        expect(sanitizePathId(validId)).toBe(validId);
      });

      it("doit accepter un ObjectId en majuscules", () => {
        const validId = "507F1F77BCF86CD799439011";
        expect(() => sanitizePathId(validId)).not.toThrow();
      });

      it("doit trim les espaces", () => {
        const validId = "  507f1f77bcf86cd799439011  ";
        expect(sanitizePathId(validId)).toBe("507f1f77bcf86cd799439011");
      });
    });

    describe("❌ Path Traversal Attacks", () => {
      it('doit rejeter ".."', () => {
        expect(() => sanitizePathId("../etc/passwd")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter "../../"', () => {
        expect(() => sanitizePathId("../../etc/passwd")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter des slashes "/"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7/9439011")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter des backslashes "\\"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7\\9439011")).toThrow(
          PathSanitizationError,
        );
      });
    });

    describe("❌ Null Byte Injection", () => {
      it("doit rejeter les null bytes \\0", () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7\x009439011")).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter les null bytes \\x00", () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7\x009439011")).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter URL encoding %00", () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7%009439011")).toThrow(
          PathSanitizationError,
        );
      });
    });

    describe("❌ Command Injection", () => {
      it('doit rejeter les pipes "|"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7|9439011")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les semicolons ";"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7;rm -rf /")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les backticks "`"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7`whoami`")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les ampersands "&"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7&9439011")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les dollar signs "$"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7$HOME")).toThrow(
          PathSanitizationError,
        );
      });
    });

    describe("❌ Format invalides", () => {
      it("doit rejeter une chaîne vide", () => {
        expect(() => sanitizePathId("")).toThrow(PathSanitizationError);
      });

      it("doit rejeter null", () => {
        expect(() => sanitizePathId(null as any)).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter undefined", () => {
        expect(() => sanitizePathId(undefined as any)).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter un ID trop court", () => {
        expect(() => sanitizePathId("507f1f77")).toThrow(PathSanitizationError);
      });

      it("doit rejeter un ID trop long", () => {
        expect(() => sanitizePathId("507f1f77bcf86cd799439011abc")).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter des caractères non-hexadécimaux", () => {
        expect(() => sanitizePathId("507f1f77bcf86cd79943ZZZZ")).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter un ObjectId avec des espaces au milieu", () => {
        expect(() => sanitizePathId("507f1f77 bcf86cd799439011")).toThrow(
          PathSanitizationError,
        );
      });
    });

    describe("❌ Autres caractères dangereux", () => {
      it('doit rejeter le tilde "~"', () => {
        expect(() => sanitizePathId("~/.ssh/id_rsa")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les newlines "\\n"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7\n9439011")).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter les carriage returns "\\r"', () => {
        expect(() => sanitizePathId("507f1f77bcf86cd7\r9439011")).toThrow(
          PathSanitizationError,
        );
      });
    });
  });

  describe("validatePathWithinBase()", () => {
    const basePath = "/var/qvarry-storage";

    describe("✅ Chemins valides", () => {
      it("doit accepter un chemin dans le basePath", () => {
        const validPath = path.join(basePath, "507f1f77bcf86cd799439011");
        expect(() => validatePathWithinBase(validPath, basePath)).not.toThrow();
      });

      it("doit accepter un chemin profond", () => {
        const validPath = path.join(
          basePath,
          "507f1f77bcf86cd799439011",
          "507f191e810c19729de860ea.jpg",
        );
        expect(() => validatePathWithinBase(validPath, basePath)).not.toThrow();
      });

      it("doit accepter le basePath lui-même", () => {
        expect(() => validatePathWithinBase(basePath, basePath)).not.toThrow();
      });
    });

    describe("❌ Path Traversal", () => {
      it('doit rejeter un chemin avec ".."', () => {
        const attackPath = path.join(basePath, "..", "etc", "passwd");
        expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
          PathSanitizationError,
        );
      });

      it('doit rejeter un chemin avec "../../"', () => {
        const attackPath = path.join(basePath, "..", "..", "etc", "passwd");
        expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter un chemin complètement en dehors", () => {
        const attackPath = "/etc/passwd";
        expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter un chemin avec préfixe similaire", () => {
        // /var/qvarry-storage-malicious ne doit PAS être accepté
        const attackPath = "/var/qvarry-storage-malicious/file.txt";
        expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
          PathSanitizationError,
        );
      });
    });
  });

  describe("buildSecurePath()", () => {
    const basePath = "/var/qvarry-storage";

    describe("✅ Construction valide", () => {
      it("doit construire un chemin valide avec 1 segment", () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const result = buildSecurePath(basePath, userId);
        expect(result).toContain(basePath);
        expect(result).toContain(userId);
      });

      it("doit construire un chemin valide avec 2 segments", () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const pointId = new mongoose.Types.ObjectId().toString();
        const result = buildSecurePath(basePath, userId, pointId);
        expect(result).toContain(basePath);
        expect(result).toContain(userId);
        expect(result).toContain(pointId);
      });
    });

    describe("❌ Segments malicieux", () => {
      it("doit rejeter un segment avec path traversal", () => {
        expect(() => buildSecurePath(basePath, "../../etc", "passwd")).toThrow(
          PathSanitizationError,
        );
      });

      it("doit rejeter le premier segment malicieux", () => {
        const validId = new mongoose.Types.ObjectId().toString();
        expect(() =>
          buildSecurePath(basePath, "../etc/passwd", validId),
        ).toThrow(PathSanitizationError);
      });

      it("doit rejeter le deuxième segment malicieux", () => {
        const validId = new mongoose.Types.ObjectId().toString();
        expect(() =>
          buildSecurePath(basePath, validId, "../../shadow"),
        ).toThrow(PathSanitizationError);
      });
    });
  });

  describe("🔥 Tests d'exploitation réelle", () => {
    it("EXPLOIT #1 : Lecture /etc/passwd via path traversal", () => {
      expect(() => sanitizePathId("../../etc/passwd")).toThrow(
        PathSanitizationError,
      );
    });

    it("EXPLOIT #2 : Null byte injection pour bypass extension", () => {
      expect(() => sanitizePathId("malicious.php%00.jpg")).toThrow(
        PathSanitizationError,
      );
    });

    it("EXPLOIT #3 : Command injection via backticks", () => {
      expect(() => sanitizePathId("`whoami`")).toThrow(PathSanitizationError);
    });

    it("EXPLOIT #4 : Symlink sortant du sandbox", () => {
      const basePath = "/var/qvarry-storage";
      const attackPath = "/tmp/symlink-to-etc";
      expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
        PathSanitizationError,
      );
    });

    it("EXPLOIT #5 : Path traversal avec normalisation", () => {
      const basePath = "/var/qvarry-storage";
      const attackPath = "/var/qvarry-storage/../../../etc/passwd";
      expect(() => validatePathWithinBase(attackPath, basePath)).toThrow(
        PathSanitizationError,
      );
    });
  });
});
