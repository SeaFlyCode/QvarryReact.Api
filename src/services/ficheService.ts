import mongoose from "mongoose";
import FicheModel, { IFiche } from "../models/fiches";

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS DE SÉCURITÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Échappe les caractères spéciaux des expressions régulières
 * Prévient les injections via regex MongoDB
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Valide et nettoie les critères de recherche
 * Protection contre les injections NoSQL et validations strictes
 */
function sanitizeSearchCriteria(
  criteria: Record<string, any>,
): Record<string, any> {
  const sanitized: Record<string, any> = {};

  // Liste blanche des champs autorisés
  const allowedFields = ["type", "ville", "name", "etat"];
  const regexFields = ["ville", "name"]; // Champs avec recherche partielle

  for (const [key, value] of Object.entries(criteria)) {
    if (!allowedFields.includes(key)) continue;
    if (typeof value !== "string") continue;

    // Limiter la longueur pour éviter les attaques DoS
    const sanitizedValue = value.substring(0, 100);

    if (regexFields.includes(key)) {
      // Échapper pour utilisation en regex
      sanitized[key] = {
        $regex: escapeRegex(sanitizedValue),
        $options: "i",
      };
    } else {
      // Correspondance exacte
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}

/**
 * Valide un ObjectId MongoDB
 * Prévient les injections via des IDs malformés
 */
function validateObjectId(id: string, fieldName: string = "ID"): void {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${fieldName} fourni n'est pas valide.`);
  }
}

/**
 * Valide les coordonnées géographiques
 * Prévient les valeurs invalides dans les requêtes géospatiales
 */
function validateCoordinates(longitude: number, latitude: number): void {
  if (typeof longitude !== "number" || typeof latitude !== "number") {
    throw new Error("Les coordonnées doivent être des nombres.");
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error("La longitude doit être entre -180 et 180.");
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error("La latitude doit être entre -90 et 90.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICES FICHES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crée une nouvelle fiche
 */
export async function createFiche(ficheData: Partial<IFiche>): Promise<IFiche> {
  // Logique métier spécifique si nécessaire

  // Création de la fiche
  const newFiche = await FicheModel.create(ficheData);
  return newFiche;
}

/**
 * Récupère toutes les fiches
 * Limite le nombre de résultats et ajoute un timeout pour la performance
 */
export async function getAllFiches(): Promise<any[]> {
  return await FicheModel.find()
    .sort({ date_creation: -1 })
    .limit(1000) // Limite pour éviter les surcharges
    .maxTimeMS(10000) // Timeout de 10 secondes
    .lean();
}

/**
 * Récupère une fiche par son ID
 */
export async function getFicheById(ficheId: string): Promise<any | null> {
  validateObjectId(ficheId, "ID de fiche");
  return await FicheModel.findById(ficheId).lean();
}

/**
 * Récupère les fiches par utilisateur
 */
export async function getFichesByUserId(userId: string): Promise<any[]> {
  validateObjectId(userId, "ID utilisateur");
  return await FicheModel.find({ userId: userId })
    .sort({ date_creation: -1 })
    .lean();
}

/**
 * Met à jour une fiche par son ID
 */
export async function updateFicheById(
  ficheId: string,
  updateData: Partial<IFiche>,
): Promise<IFiche | null> {
  validateObjectId(ficheId, "ID de fiche");

  // Mise à jour de la date de modification
  updateData.date_modification = new Date();

  return await FicheModel.findByIdAndUpdate(
    ficheId,
    updateData,
    { new: true }, // Retourne le document mis à jour
  );
}

/**
 * Supprime une fiche par son ID
 */
export async function deleteFicheById(ficheId: string): Promise<boolean> {
  validateObjectId(ficheId, "ID de fiche");

  const result = await FicheModel.findByIdAndDelete(ficheId);
  return result !== null;
}

/**
 * Recherche des fiches par critères
 * Utilise sanitizeSearchCriteria pour prévenir les injections NoSQL
 */
export async function searchFiches(
  criteria: Record<string, any>,
): Promise<any[]> {
  // Nettoyage et validation des critères
  const query = sanitizeSearchCriteria(criteria);

  return await FicheModel.find(query)
    .sort({ date_creation: -1 })
    .limit(100) // Limiter le nombre de résultats
    .maxTimeMS(5000) // Timeout de 5 secondes pour éviter les requêtes longues
    .lean();
}

/**
 * Trouve les fiches à proximité d'un point
 * Valide les coordonnées et limite les résultats
 */
export async function findFichesNearLocation(
  longitude: number,
  latitude: number,
  maxDistance: number = 5000,
): Promise<any[]> {
  // Validation des coordonnées
  validateCoordinates(longitude, latitude);

  // Validation de la distance maximale (entre 1m et 50km)
  if (maxDistance < 1 || maxDistance > 50000) {
    throw new Error("La distance maximale doit être entre 1m et 50km.");
  }

  return await FicheModel.find({
    "center_cavite.coordinates": {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        $maxDistance: maxDistance, // en mètres
      },
    },
  })
    .limit(100) // Limiter le nombre de résultats
    .maxTimeMS(10000) // Timeout de 10 secondes
    .lean();
}

/**
 * Ajouter un point à une fiche
 */
export async function addPointToFiche(ficheId: string, pointId: string) {
  validateObjectId(ficheId, "ID de fiche");
  validateObjectId(pointId, "ID de point");

  return await FicheModel.findByIdAndUpdate(
    ficheId,
    { $addToSet: { points_ids: pointId } }, // utilise $addToSet pour éviter les doublons
    { new: true },
  );
}

/**
 * Retirer un point d'une fiche
 */
export async function removePointFromFiche(ficheId: string, pointId: string) {
  validateObjectId(ficheId, "ID de fiche");
  validateObjectId(pointId, "ID de point");

  return await FicheModel.findByIdAndUpdate(
    ficheId,
    { $pull: { points_ids: pointId } },
    { new: true },
  );
}
