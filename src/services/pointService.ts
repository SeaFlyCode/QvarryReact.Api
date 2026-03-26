import mongoose from "mongoose";
import PointModel, { IPoint } from "../models/points";
import { logger } from "./loggerService";
import { createServiceLogger } from "../utils/contextLogger";
import { logPerformance } from "../utils/performanceLogger";

const pointLogger = logger.child({ service: "point" });
const log = createServiceLogger("PointService");

// Types pour les paramètres
interface CreatePointData {
  userId: string;
  name: string;
  description?: string;
  location_encrypted: string;
  ficheId?: string; // Ajout de l'ID de fiche optionnel
}

// Création d'un point
export const createPoint = async (pointData: CreatePointData) => {
  log.info("Création d'un nouveau point", {
    userId: pointData.userId,
    name: pointData.name,
    ficheId: pointData.ficheId,
  });

  try {
    const { result: newPoint, duration } = await logPerformance(
      "Point.create",
      async () => {
        const point = new PointModel({
          userId: pointData.userId,
          name: pointData.name,
          description: pointData.description,
          location_encrypted: pointData.location_encrypted,
          ficheId: pointData.ficheId || null,
        });
        return await point.save();
      },
      { slowThreshold: 500 },
    );

    log.info("Point créé avec succès", {
      pointId: newPoint._id.toString(),
      userId: pointData.userId,
      duration,
    });

    return newPoint;
  } catch (error) {
    log.error("Erreur lors de la création du point", {
      userId: pointData.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

// Récupération de tous les points d'un utilisateur
export async function getAllPointsByUserId(userId: string): Promise<any[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    log.warn("ID utilisateur invalide", { userId });
    throw new Error("L'ID utilisateur fourni n'est pas valide.");
  }

  log.debug("Récupération des points d'un utilisateur", { userId });

  try {
    const { result: points, duration } = await logPerformance(
      "Point.findByUserId",
      async () =>
        await PointModel.find({
          userId,
          is_active: true,
        })
          .sort({ created_at: -1 })
          .lean()
          .maxTimeMS(5000),
      { slowThreshold: 1000 },
    );

    log.info("Points utilisateur récupérés", {
      userId,
      count: points.length,
      duration,
    });

    return points;
  } catch (error) {
    log.error("Erreur lors de la récupération des points", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Récupération d'un point par ID
export async function getPointById(
  pointId: string,
  userId: string,
): Promise<any | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide.");
  }
  return PointModel.findOne({
    _id: pointId,
    userId,
    is_active: true,
  })
    .lean()
    .maxTimeMS(5000);
}

export async function deletePoint(pointId: string): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    log.warn("ID de point invalide pour suppression", { pointId });
    throw new Error("L'ID du point n'est pas valide");
  }

  log.warn("Suppression d'un point", { pointId });

  try {
    const deletedPoint = await PointModel.findByIdAndDelete(pointId);

    if (deletedPoint) {
      log.info("Point supprimé avec succès", {
        pointId,
        userId: deletedPoint.userId.toString(),
      });
    } else {
      log.warn("Point à supprimer non trouvé", { pointId });
    }

    return deletedPoint;
  } catch (error) {
    log.error("Erreur lors de la suppression du point", {
      pointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Mise à jour d'un point
export async function updatePoint(
  pointId: string,
  userId: string,
  updateData: Partial<Omit<IPoint, "_id" | "userId" | "created_at">>,
): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    log.warn("ID de point invalide pour mise à jour", { pointId });
    throw new Error("L'ID du point n'est pas valide.");
  }

  log.info("Mise à jour d'un point", {
    pointId,
    userId,
    fields: Object.keys(updateData),
  });

  try {
    // Mise à jour de la date de modification
    const dataToUpdate = {
      ...updateData,
      updated_at: new Date(),
    };

    const updatedPoint = await PointModel.findOneAndUpdate(
      { _id: pointId, userId, is_active: true },
      dataToUpdate,
      { new: true, runValidators: true },
    );

    if (updatedPoint) {
      log.info("Point mis à jour avec succès", { pointId, userId });
    } else {
      log.warn("Point à mettre à jour non trouvé", { pointId, userId });
    }

    return updatedPoint;
  } catch (error) {
    log.error("Erreur lors de la mise à jour du point", {
      pointId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Récupération des points liés à une fiche spécifique
export async function getPointsByFicheId(ficheId: string): Promise<any[]> {
  if (!mongoose.Types.ObjectId.isValid(ficheId)) {
    throw new Error("L'ID de la fiche n'est pas valide.");
  }
  return PointModel.find({
    ficheId,
    is_active: true,
  })
    .sort({ created_at: -1 })
    .lean()
    .maxTimeMS(5000);
}

// Associer un point existant à une fiche
export async function linkPointToFiche(
  pointId: string,
  ficheId: string,
): Promise<IPoint | null> {
  if (
    !mongoose.Types.ObjectId.isValid(pointId) ||
    !mongoose.Types.ObjectId.isValid(ficheId)
  ) {
    throw new Error("L'ID du point ou de la fiche n'est pas valide.");
  }

  return PointModel.findByIdAndUpdate(pointId, { ficheId }, { new: true });
}

// Dissocier un point d'une fiche
export async function unlinkPointFromFiche(
  pointId: string,
): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide.");
  }

  return PointModel.findByIdAndUpdate(
    pointId,
    { ficheId: null },
    { new: true },
  );
}

/**
 * Récupère des points par leur IDs
 */
export async function getPointsByIds(pointIds: string[]): Promise<any[]> {
  if (!pointIds || pointIds.length === 0) {
    return [];
  }

  // Filtrer les IDs valides
  const validIds = pointIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (validIds.length === 0) {
    return [];
  }

  return PointModel.find({
    _id: { $in: validIds },
    is_active: true,
  })
    .sort({ created_at: -1 })
    .lean()
    .maxTimeMS(5000);
}
