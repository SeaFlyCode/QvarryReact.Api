import {
  ficheCreateSchema,
  ficheUpdateSchema,
} from "../../schemas/ficheSchemas";

describe("ficheSchemas", () => {
  describe("ficheCreateSchema", () => {
    it("accepte un type canonique ('Carrière')", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Carrière des Capucins",
        type: "Carrière",
      });
      expect(result.success).toBe(true);
    });

    it("rejette un type non canonique ('FooBar')", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        type: "FooBar",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain("type");
      }
    });

    it("rejette un type en majuscules ('CARRIERE')", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        type: "CARRIERE",
      });
      expect(result.success).toBe(false);
    });

    it("accepte les champs enum optionnels manquants", () => {
      const result = ficheCreateSchema.safeParse({ name: "Fiche minimale" });
      expect(result.success).toBe(true);
    });

    it("accepte un name avec uniquement le minimum requis", () => {
      const result = ficheCreateSchema.safeParse({ name: "X" });
      expect(result.success).toBe(true);
    });

    it("rejette un name vide", () => {
      const result = ficheCreateSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepte un tableau surface valide", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        surface: ["< 500 m²", "> 20 ha"],
      });
      expect(result.success).toBe(true);
    });

    it("rejette un tableau surface contenant une valeur invalide", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        surface: ["invalid"],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe("surface");
      }
    });

    it("accepte un tableau equipement_conseille valide (incluant 'Autre (à préciser)')", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        equipement_conseille: ["Casque", "Corde", "Autre (à préciser)"],
      });
      expect(result.success).toBe(true);
    });

    it("rejette equipement_conseille non canonique", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        equipement_conseille: ["casque"],
      });
      expect(result.success).toBe(false);
    });

    it("accepte un tableau type_galeries valide", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        type_galeries: ["Galeries hautes (> 2m)", "Boyaux"],
      });
      expect(result.success).toBe(true);
    });

    it("accepte difficulte_acces='3' (string numérique canonique)", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        difficulte_acces: "3",
      });
      expect(result.success).toBe(true);
    });

    it("rejette difficulte_acces='facile' (legacy non canonique)", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        difficulte_acces: "facile",
      });
      expect(result.success).toBe(false);
    });

    it("accepte accessibilite='' (rétrocompat default backend)", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        accessibilite: "",
      });
      expect(result.success).toBe(true);
    });

    it("accepte un center_cavite GeoJSON Point valide", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        center_cavite: { type: "Point", coordinates: [2.35, 48.85] },
      });
      expect(result.success).toBe(true);
    });

    it("rejette un center_cavite avec type incorrect", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        center_cavite: { type: "Polygon", coordinates: [2.35, 48.85] },
      });
      expect(result.success).toBe(false);
    });

    it("accepte des points_ids ObjectId valides", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        points_ids: ["507f1f77bcf86cd799439011"],
      });
      expect(result.success).toBe(true);
    });

    it("rejette des points_ids non-ObjectId", () => {
      const result = ficheCreateSchema.safeParse({
        name: "Test",
        points_ids: ["not-an-objectid"],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ficheUpdateSchema", () => {
    it("accepte une mise à jour partielle (name uniquement)", () => {
      const result = ficheUpdateSchema.safeParse({ name: "Nouveau nom" });
      expect(result.success).toBe(true);
    });

    it("accepte un body vide (aucun champ à mettre à jour)", () => {
      const result = ficheUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejette une mise à jour avec etat non canonique", () => {
      const result = ficheUpdateSchema.safeParse({ etat: "ouvert" });
      expect(result.success).toBe(false);
    });

    it("accepte une mise à jour avec etat canonique", () => {
      const result = ficheUpdateSchema.safeParse({ etat: "Ouvert" });
      expect(result.success).toBe(true);
    });
  });
});
