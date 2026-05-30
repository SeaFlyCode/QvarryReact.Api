import { z } from "zod";
import { FICHE_TYPES } from "../constants/fichesEnums";

/**
 * Schémas de validation Zod pour la feature CategoryStyle.
 */

// Type de cavité borné à l'enum FICHE_TYPES (source de vérité partagée mobile/backend).
export const categoryTypeSchema = z.enum(FICHE_TYPES);

// Couleur hexadécimale (#RGB, #RRGGBB ou #RRGGBBAA).
const hexColorSchema = z
  .string()
  .trim()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    "Couleur hexadécimale invalide (ex: #22c55e)",
  );

// Corps de PUT /category-styles/:type
export const categoryStyleUpsertSchema = z
  .object({
    color: hexColorSchema,
    icon: z
      .string()
      .trim()
      .min(1, "L'icône est obligatoire")
      .max(100, "L'icône ne doit pas dépasser 100 caractères"),
  })
  .strict();

export type CategoryStyleUpsertInput = z.infer<typeof categoryStyleUpsertSchema>;
