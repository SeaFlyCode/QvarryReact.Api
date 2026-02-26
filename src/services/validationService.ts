import { Request, Response, NextFunction } from "express";

// Fonction pour valider les données d'une fiche
export function validateFicheData(data: any) {
  const errors: string[] = [];

  // Champs obligatoires à vérifier
  const requiredFields = [
    "name",
    "ville",
    "type",
    "etat",
    // 'userId', // NE PAS exiger userId côté front
    "difficulte_acces",
    "risque_oxygene",
    "acces_souterrain",
    "praticite_souterrain",
    "etat_general",
    // 'points_ids' n'est plus obligatoire
  ];

  requiredFields.forEach((field) => {
    if (
      data[field] === undefined ||
      data[field] === null ||
      (typeof data[field] === "string" && !data[field].trim()) ||
      (Array.isArray(data[field]) && data[field].length === 0)
    ) {
      errors.push(`Le champ ${field} est obligatoire`);
    }
  });

  // Validation de la longueur du nom
  if (data.name && data.name.length > 100) {
    errors.push("Le nom de la fiche ne peut pas dépasser 100 caractères");
  }
  // Validation de la longueur de la ville
  if (data.ville && data.ville.length > 50) {
    errors.push("Le nom de la ville ne peut pas dépasser 50 caractères");
  }
  // Validation de la longueur de l'accessibilité
  if (data.accessibilite && data.accessibilite.length > 2000) {
    errors.push(
      "La description d'accessibilité ne peut pas dépasser 2000 caractères",
    );
  }

  // Validation des IDs de points
  if (data.points_ids) {
    if (!Array.isArray(data.points_ids)) {
      errors.push("La liste des points doit être un tableau");
    } else {
      for (let i = 0; i < data.points_ids.length; i++) {
        const pointId = data.points_ids[i];
        if (typeof pointId !== "string" && typeof pointId !== "object") {
          errors.push(`L'ID du point à l'index ${i} n'est pas valide`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Middleware pour valider les données de fiche - peut être utilisé en update
export function validateFiche(req: Request, res: Response, next: NextFunction) {
  const validation = validateFicheData(req.body);

  if (!validation.isValid) {
    return res.status(400).json({
      message: "Validation échouée",
      errors: validation.errors,
    });
  }

  next();
}
