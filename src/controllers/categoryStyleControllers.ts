// src/controllers/categoryStyleControllers.ts
// Contrôleurs de la personnalisation visuelle par type de cavité (CategoryStyle).

import { Request, Response } from "express";
import { logger } from "../services/loggerService";
import {
  categoryStyleUpsertSchema,
  categoryTypeSchema,
} from "../schemas/categoryStyleSchemas";
import * as categoryStyleService from "../services/categoryStyleService";
import { getErrorMessage } from "../utils/errorUtils";
import { FICHE_TYPES } from "../constants/fichesEnums";

type CategoryType = (typeof FICHE_TYPES)[number];

/**
 * Valide et renvoie le `:type` d'URL, ou répond 400 et renvoie null.
 */
function parseType(req: Request, res: Response): CategoryType | null {
  const parsed = categoryTypeSchema.safeParse(req.params.type);
  if (!parsed.success) {
    res.status(400).json({ error: "Type de cavité invalide" });
    return null;
  }
  return parsed.data;
}

/**
 * GET /api/v1/category-styles
 * Renvoie tous les styles personnalisés de l'utilisateur.
 */
export const listCategoryStyles = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    const styles = await categoryStyleService.listStyles(userId);
    res.status(200).json(styles);
  } catch (error) {
    logger.error("Erreur lors de la récupération des category-styles", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des personnalisations",
    });
  }
};

/**
 * PUT /api/v1/category-styles/:type
 * Upsert de la couleur + icône d'un type.
 */
export const upsertCategoryStyle = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    const type = parseType(req, res);
    if (!type) return;

    const parsed = categoryStyleUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation échouée",
        details: parsed.error.flatten(),
      });
      return;
    }

    const doc = await categoryStyleService.upsertStyle(
      userId,
      type,
      parsed.data,
    );

    res.status(200).json(categoryStyleService.toDTO(doc));
  } catch (error) {
    logger.error("Erreur lors de l'upsert d'un category-style", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      error: "Erreur lors de la sauvegarde de la personnalisation",
    });
  }
};

/**
 * DELETE /api/v1/category-styles/:type
 * Reset complet de la perso (couleur, icône).
 */
export const deleteCategoryStyle = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }

    const type = parseType(req, res);
    if (!type) return;

    await categoryStyleService.deleteStyle(userId, type);

    res.status(204).end();
  } catch (error) {
    logger.error("Erreur lors de la suppression du category-style", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({
      error: "Erreur lors de la suppression de la personnalisation",
    });
  }
};
