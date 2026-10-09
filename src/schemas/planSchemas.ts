import { z } from "zod";
import { PLANS_CONFIG } from "../config/storageConfig";

/**
 * Schémas de validation Zod pour la feature Plans.
 */

export const planNameSchema = z
  .string()
  .trim()
  .min(1, "Le nom est obligatoire")
  .max(
    PLANS_CONFIG.MAX_NAME_LENGTH,
    `Le nom ne doit pas dépasser ${PLANS_CONFIG.MAX_NAME_LENGTH} caractères`,
  );

export const planPlacementSchema = z
  .object({
    centerLat: z.number().finite().min(-90).max(90),
    centerLng: z.number().finite().min(-180).max(180),
    widthMeters: z.number().finite().gt(0).max(100000),
    aspectRatio: z.number().finite().gt(0).max(1000),
    rotationDeg: z.number().finite().min(-360).max(360),
    opacity: z.number().finite().min(0).max(1),
    visible: z.boolean(),
  })
  .strict();

export type PlanPlacement = z.infer<typeof planPlacementSchema>;

// Corps de PATCH /plans/:id (au moins un champ ; placement null = retirer le calage)
export const planUpdateSchema = z
  .object({
    name: planNameSchema.optional(),
    placement: planPlacementSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.placement !== undefined, {
    message: "Au moins un champ (name, placement) est requis",
  });

export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
