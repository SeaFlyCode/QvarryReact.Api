import mongoose from "mongoose";
import PointModel, { IPoint } from "../models/points";

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
  try {
    const newPoint = new PointModel({
      userId: pointData.userId,
      name: pointData.name,
      description: pointData.description,
      location_encrypted: pointData.location_encrypted,
      ficheId: pointData.ficheId || null, // Associer à une fiche si spécifié
    });

    return await newPoint.save();
  } catch (error) {
    console.error("Erreur lors de la création du point :", error);
    throw error;
  }
};

// Récupération de tous les points d'un utilisateur
export async function getAllPointsByUserId(userId: string): Promise<any[]> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("L'ID utilisateur fourni n'est pas valide.");
  }
  return await PointModel.find({
    userId,
    is_active: true, // Ne récupère que les points actifs
  })
    .sort({ created_at: -1 })
    .lean()
    .maxTimeMS(5000); // Trie par date décroissante
}

// Récupération d'un point par ID
export async function getPointById(
  pointId: string,
  userId: string,
): Promise<any | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide.");
  }
  return await PointModel.findOne({
    _id: pointId,
    userId,
    is_active: true,
  })
    .lean()
    .maxTimeMS(5000);
}

export async function deletePoint(pointId: string): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide");
  }

  const deletedPoint = await PointModel.findByIdAndDelete(pointId);

  return deletedPoint;
}

// Mise à jour d'un point
export async function updatePoint(
  pointId: string,
  userId: string,
  updateData: Partial<Omit<IPoint, "_id" | "userId" | "created_at">>,
): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide.");
  }

  // Mise à jour de la date de modification
  const dataToUpdate = {
    ...updateData,
    updated_at: new Date(),
  };

  return await PointModel.findOneAndUpdate(
    { _id: pointId, userId, is_active: true },
    dataToUpdate,
    { new: true, runValidators: true },
  );
}

// Récupération des points liés à une fiche spécifique
export async function getPointsByFicheId(ficheId: string): Promise<any[]> {
  if (!mongoose.Types.ObjectId.isValid(ficheId)) {
    throw new Error("L'ID de la fiche n'est pas valide.");
  }
  return await PointModel.find({
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

  return await PointModel.findByIdAndUpdate(
    pointId,
    { ficheId },
    { new: true },
  );
}

// Dissocier un point d'une fiche
export async function unlinkPointFromFiche(
  pointId: string,
): Promise<IPoint | null> {
  if (!mongoose.Types.ObjectId.isValid(pointId)) {
    throw new Error("L'ID du point n'est pas valide.");
  }

  return await PointModel.findByIdAndUpdate(
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

  return await PointModel.find({
    _id: { $in: validIds },
    is_active: true,
  })
    .sort({ created_at: -1 })
    .lean()
    .maxTimeMS(5000);
}
