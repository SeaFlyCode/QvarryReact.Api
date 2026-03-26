import mongoose from "mongoose";
import FicheModel, { IFiche } from "../models/fiches";
import { createServiceLogger } from "../utils/contextLogger";
import { logPerformance } from "../utils/performanceLogger";

const log = createServiceLogger("FicheService");

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
  log.info("Création d'une nouvelle fiche", {
    userId: ficheData.userId?.toString(),
    type: ficheData.type,
  });

  try {
    // Création de la fiche avec mesure de performance
    const { result: newFiche, duration } = await logPerformance(
      "Fiche.create",
      async () => await FicheModel.create(ficheData),
      { slowThreshold: 500 },
    );

    log.info("Fiche créée avec succès", {
      ficheId: newFiche._id.toString(),
      userId: ficheData.userId?.toString(),
      duration,
    });

    return newFiche;
  } catch (error) {
    log.error("Erreur lors de la création de la fiche", {
      userId: ficheData.userId?.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Récupère toutes les fiches
 * Limite le nombre de résultats et ajoute un timeout pour la performance
 */
export async function getAllFiches(): Promise<any[]> {
  log.debug("Récupération de toutes les fiches");

  try {
    const { result: fiches, duration } = await logPerformance(
      "Fiche.findAll",
      async () =>
        await FicheModel.find()
          .sort({ date_creation: -1 })
          .limit(1000)
          .maxTimeMS(10000)
          .lean(),
      { slowThreshold: 1000 },
    );

    log.info("Fiches récupérées", {
      count: fiches.length,
      duration,
    });

    return fiches;
  } catch (error) {
    log.error("Erreur lors de la récupération des fiches", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Récupère une fiche par son ID
 */
export async function getFicheById(ficheId: string): Promise<any | null> {
  validateObjectId(ficheId, "ID de fiche");

  log.debug("Récupération d'une fiche par ID", { ficheId });

  try {
    const fiche = await FicheModel.findById(ficheId).lean();

    if (!fiche) {
      log.warn("Fiche non trouvée", { ficheId });
    }

    return fiche;
  } catch (error) {
    log.error("Erreur lors de la récupération de la fiche", {
      ficheId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Récupère les fiches par utilisateur
 */
export async function getFichesByUserId(userId: string): Promise<any[]> {
  validateObjectId(userId, "ID utilisateur");
  return FicheModel.find({ userId: userId }).sort({ date_creation: -1 }).lean();
}

/**
 * Met à jour une fiche par son ID
 */
export async function updateFicheById(
  ficheId: string,
  updateData: Partial<IFiche>,
): Promise<IFiche | null> {
  validateObjectId(ficheId, "ID de fiche");

  log.info("Mise à jour d'une fiche", {
    ficheId,
    fields: Object.keys(updateData),
  });

  try {
    // Mise à jour de la date de modification
    updateData.date_modification = new Date();

    const updatedFiche = await FicheModel.findByIdAndUpdate(
      ficheId,
      updateData,
      { new: true },
    );

    if (!updatedFiche) {
      log.warn("Fiche à mettre à jour non trouvée", { ficheId });
    } else {
      log.info("Fiche mise à jour avec succès", { ficheId });
    }

    return updatedFiche;
  } catch (error) {
    log.error("Erreur lors de la mise à jour de la fiche", {
      ficheId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Supprime une fiche par son ID
 */
export async function deleteFicheById(ficheId: string): Promise<boolean> {
  validateObjectId(ficheId, "ID de fiche");

  log.warn("Suppression d'une fiche", { ficheId });

  try {
    const result = await FicheModel.findByIdAndDelete(ficheId);

    if (result) {
      log.info("Fiche supprimée avec succès", { ficheId });
    } else {
      log.warn("Fiche à supprimer non trouvée", { ficheId });
    }

    return result !== null;
  } catch (error) {
    log.error("Erreur lors de la suppression de la fiche", {
      ficheId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Recherche des fiches par critères
 * Utilise sanitizeSearchCriteria pour prévenir les injections NoSQL
 */
export async function searchFiches(
  criteria: Record<string, any>,
): Promise<any[]> {
  log.info("Recherche de fiches", {
    criteria: Object.keys(criteria),
  });

  try {
    // Nettoyage et validation des critères
    const query = sanitizeSearchCriteria(criteria);

    log.debug("Critères sanitizés", { query });

    const { result: fiches, duration } = await logPerformance(
      "Fiche.search",
      async () =>
        await FicheModel.find(query)
          .sort({ date_creation: -1 })
          .limit(100)
          .maxTimeMS(5000)
          .lean(),
      { slowThreshold: 1000 },
    );

    log.info("Fiches trouvées", {
      count: fiches.length,
      duration,
    });

    return fiches;
  } catch (error) {
    log.error("Erreur lors de la recherche de fiches", {
      criteria,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
    log.warn("Distance maximale invalide", { maxDistance });
    throw new Error("La distance maximale doit être entre 1m et 50km.");
  }

  log.info("Recherche de fiches à proximité", {
    longitude,
    latitude,
    maxDistance,
  });

  try {
    const { result: fiches, duration } = await logPerformance(
      "Fiche.nearLocation",
      async () =>
        await FicheModel.find({
          "center_cavite.coordinates": {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [longitude, latitude],
              },
              $maxDistance: maxDistance,
            },
          },
        })
          .limit(100)
          .maxTimeMS(10000)
          .lean(),
      { slowThreshold: 2000 },
    );

    log.info("Fiches à proximité trouvées", {
      count: fiches.length,
      duration,
    });

    return fiches;
  } catch (error) {
    log.error("Erreur lors de la recherche de fiches à proximité", {
      longitude,
      latitude,
      maxDistance,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Ajouter un point à une fiche
 */
export async function addPointToFiche(ficheId: string, pointId: string) {
  validateObjectId(ficheId, "ID de fiche");
  validateObjectId(pointId, "ID de point");

  log.info("Ajout d'un point à une fiche", { ficheId, pointId });

  try {
    const updatedFiche = await FicheModel.findByIdAndUpdate(
      ficheId,
      { $addToSet: { points_ids: pointId } },
      { new: true },
    );

    if (!updatedFiche) {
      log.warn("Fiche non trouvée pour ajout de point", { ficheId, pointId });
    } else {
      log.info("Point ajouté à la fiche avec succès", { ficheId, pointId });
    }

    return updatedFiche;
  } catch (error) {
    log.error("Erreur lors de l'ajout du point à la fiche", {
      ficheId,
      pointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Retirer un point d'une fiche
 */
export async function removePointFromFiche(ficheId: string, pointId: string) {
  validateObjectId(ficheId, "ID de fiche");
  validateObjectId(pointId, "ID de point");

  log.info("Retrait d'un point d'une fiche", { ficheId, pointId });

  try {
    const updatedFiche = await FicheModel.findByIdAndUpdate(
      ficheId,
      { $pull: { points_ids: pointId } },
      { new: true },
    );

    if (!updatedFiche) {
      log.warn("Fiche non trouvée pour retrait de point", { ficheId, pointId });
    } else {
      log.info("Point retiré de la fiche avec succès", { ficheId, pointId });
    }

    return updatedFiche;
  } catch (error) {
    log.error("Erreur lors du retrait du point de la fiche", {
      ficheId,
      pointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
