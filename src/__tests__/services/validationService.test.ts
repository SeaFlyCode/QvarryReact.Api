// ═══════════════════════════════════════════════════════════════════════════
// TESTS: validationService
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import {
  validateFicheData,
  validateFiche,
} from "../../services/validationService";

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

describe("validationService", () => {
  describe("validateFicheData", () => {
    // ═════════════════════════════════════════════════════════════════════════
    // Test des champs obligatoires
    // ═════════════════════════════════════════════════════════════════════════

    it("returns isValid=false with empty object (missing required fields)", () => {
      const result = validateFicheData({});

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(9); // 9 champs obligatoires
      expect(result.errors).toContain("Le champ name est obligatoire");
      expect(result.errors).toContain("Le champ ville est obligatoire");
      expect(result.errors).toContain("Le champ type est obligatoire");
      expect(result.errors).toContain("Le champ etat est obligatoire");
      expect(result.errors).toContain(
        "Le champ difficulte_acces est obligatoire",
      );
      expect(result.errors).toContain(
        "Le champ risque_oxygene est obligatoire",
      );
      expect(result.errors).toContain(
        "Le champ acces_souterrain est obligatoire",
      );
      expect(result.errors).toContain(
        "Le champ praticite_souterrain est obligatoire",
      );
      expect(result.errors).toContain("Le champ etat_general est obligatoire");
    });

    it("validates all required fields: name, ville, type, etat, difficulte_acces, risque_oxygene, acces_souterrain, praticite_souterrain, etat_general", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error if required field is null", () => {
      const data = {
        name: null,
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Le champ name est obligatoire");
    });

    it("returns error if required field is undefined", () => {
      const data = {
        name: undefined,
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Le champ name est obligatoire");
    });

    it("returns error if required field is empty string", () => {
      const data = {
        name: "   ", // Whitespace only
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Le champ name est obligatoire");
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Test des validations de longueur
    // ═════════════════════════════════════════════════════════════════════════

    it("returns error if name exceeds 100 chars", () => {
      const data = {
        name: "a".repeat(101),
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le nom de la fiche ne peut pas dépasser 100 caractères",
      );
    });

    it("accepts name with exactly 100 chars", () => {
      const data = {
        name: "a".repeat(100),
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error if ville exceeds 50 chars", () => {
      const data = {
        name: "Test Fiche",
        ville: "a".repeat(51),
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Le nom de la ville ne peut pas dépasser 50 caractères",
      );
    });

    it("accepts ville with exactly 50 chars", () => {
      const data = {
        name: "Test Fiche",
        ville: "a".repeat(50),
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error if accessibilite exceeds 2000 chars", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        accessibilite: "a".repeat(2001),
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "La description d'accessibilité ne peut pas dépasser 2000 caractères",
      );
    });

    it("accepts accessibilite with exactly 2000 chars", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        accessibilite: "a".repeat(2000),
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Test de la validation des points_ids
    // ═════════════════════════════════════════════════════════════════════════

    it("returns error if points_ids is not an array", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: "not-an-array",
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "La liste des points doit être un tableau",
      );
    });

    it("accepts points_ids as an array of strings", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts points_ids as an array of objects", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: [{ id: "123" }, { id: "456" }],
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error if points_ids contains invalid types", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: ["valid-id", 123, true],
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "L'ID du point à l'index 1 n'est pas valide",
      );
      expect(result.errors).toContain(
        "L'ID du point à l'index 2 n'est pas valide",
      );
    });

    it("accepts empty points_ids array (not required)", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: [],
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Test avec toutes les données valides
    // ═════════════════════════════════════════════════════════════════════════

    it("returns isValid=true with all valid data", () => {
      const data = {
        name: "Carrière de Test",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        accessibilite: "Accès facile par la route principale",
        points_ids: ["507f1f77bcf86cd799439011"],
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Test des cas limites avec null/undefined
    // ═════════════════════════════════════════════════════════════════════════

    it("handles null/undefined/empty string fields correctly", () => {
      const testCases = [
        { field: "name", value: null },
        { field: "name", value: undefined },
        { field: "name", value: "" },
        { field: "name", value: "   " },
        { field: "ville", value: null },
        { field: "ville", value: undefined },
        { field: "ville", value: "" },
      ];

      testCases.forEach(({ field, value }) => {
        const data = {
          name: "Test Fiche",
          ville: "Paris",
          type: "carriere",
          etat: "accessible",
          difficulte_acces: "facile",
          risque_oxygene: "faible",
          acces_souterrain: "ouvert",
          praticite_souterrain: "bonne",
          etat_general: "bon",
          [field]: value,
        };

        const result = validateFicheData(data);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(`Le champ ${field} est obligatoire`);
      });
    });

    it("does not require points_ids field", () => {
      const data = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        // points_ids is omitted
      };

      const result = validateFicheData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test du middleware validateFiche
  // ═══════════════════════════════════════════════════════════════════════════

  describe("validateFiche middleware", () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
      mockRequest = {
        body: {},
      };
      mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      mockNext = jest.fn();
    });

    it("returns 400 with invalid data", () => {
      mockRequest.body = {}; // Missing all required fields

      validateFiche(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: "Validation échouée",
        errors: expect.arrayContaining([
          "Le champ name est obligatoire",
          "Le champ ville est obligatoire",
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("calls next() with valid data", () => {
      mockRequest.body = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      validateFiche(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockResponse.json).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when name exceeds 100 chars", () => {
      mockRequest.body = {
        name: "a".repeat(101),
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
      };

      validateFiche(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: "Validation échouée",
        errors: expect.arrayContaining([
          "Le nom de la fiche ne peut pas dépasser 100 caractères",
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("returns 400 when points_ids is not an array", () => {
      mockRequest.body = {
        name: "Test Fiche",
        ville: "Paris",
        type: "carriere",
        etat: "accessible",
        difficulte_acces: "facile",
        risque_oxygene: "faible",
        acces_souterrain: "ouvert",
        praticite_souterrain: "bonne",
        etat_general: "bon",
        points_ids: "not-an-array",
      };

      validateFiche(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: "Validation échouée",
        errors: expect.arrayContaining([
          "La liste des points doit être un tableau",
        ]),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
