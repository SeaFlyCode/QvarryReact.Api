// src/services/categoryStyleService.ts
// Logique métier de la personnalisation visuelle par type de cavité.

import mongoose from "mongoose";
import CategoryStyleModel, { ICategoryStyle } from "../models/categoryStyle";
import { FICHE_TYPES } from "../constants/fichesEnums";
import { createServiceLogger } from "../utils/contextLogger";

const log = createServiceLogger("CategoryStyleService");

type CategoryType = (typeof FICHE_TYPES)[number];

export interface CategoryStyleDTO {
  type: CategoryType;
  color: string;
  icon: string;
}

/**
 * Sérialise un document en DTO conforme au contrat API.
 */
export function toDTO(doc: ICategoryStyle): CategoryStyleDTO {
  return {
    type: doc.type,
    color: doc.color,
    icon: doc.icon,
  };
}

/**
 * Récupère tous les styles personnalisés d'un utilisateur.
 */
export async function listStyles(userId: string): Promise<CategoryStyleDTO[]> {
  const docs = await CategoryStyleModel.find({
    userId: new mongoose.Types.ObjectId(userId),
  }).lean<ICategoryStyle[]>();

  return docs.map(toDTO);
}

/**
 * Crée ou met à jour (upsert) le style d'un type de cavité.
 */
export async function upsertStyle(
  userId: string,
  type: CategoryType,
  data: { color: string; icon: string },
): Promise<ICategoryStyle> {
  const doc = await CategoryStyleModel.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId), type },
    { $set: { color: data.color, icon: data.icon }, $inc: { version: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  log.info("Style de catégorie upserté", { userId, type });
  return doc;
}

/**
 * Supprime entièrement le style d'un type (reset de la perso).
 * @returns le document supprimé, ou null.
 */
export async function deleteStyle(
  userId: string,
  type: CategoryType,
): Promise<ICategoryStyle | null> {
  const doc = await CategoryStyleModel.findOneAndDelete({
    userId: new mongoose.Types.ObjectId(userId),
    type,
  });

  if (doc) {
    log.info("Style de catégorie supprimé", { userId, type });
  }
  return doc;
}
