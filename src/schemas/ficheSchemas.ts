import { z } from "zod";
import {
  FICHE_TYPES,
  FICHE_ETATS,
  FICHE_ACCESSIBILITES,
  FICHE_ACCES_SOUTERRAIN,
  FICHE_DIFFICULTE_ACCES,
  FICHE_RISQUE_OXYGENE,
  FICHE_ETAT_GENERAL,
  FICHE_PRATICITE_SOUTERRAIN,
  FICHE_EQUIPEMENT_CONSEILLE,
  FICHE_SURFACE,
  FICHE_TYPE_GALERIES,
} from "../constants/fichesEnums";

const ficheTypeSchema = z.enum(FICHE_TYPES);
const ficheEtatSchema = z.enum(FICHE_ETATS);
const ficheAccessibiliteSchema = z.enum(FICHE_ACCESSIBILITES);
const ficheAccesSouterrainSchema = z.enum(FICHE_ACCES_SOUTERRAIN);
const ficheDifficulteAccesSchema = z.enum(FICHE_DIFFICULTE_ACCES);
const ficheRisqueOxygeneSchema = z.enum(FICHE_RISQUE_OXYGENE);
const ficheEtatGeneralSchema = z.enum(FICHE_ETAT_GENERAL);
const fichePraticiteSchema = z.enum(FICHE_PRATICITE_SOUTERRAIN);
const ficheEquipementSchema = z.enum(FICHE_EQUIPEMENT_CONSEILLE);
const ficheSurfaceSchema = z.enum(FICHE_SURFACE);
const ficheTypeGaleriesSchema = z.enum(FICHE_TYPE_GALERIES);

const objectIdString = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "ObjectId invalide");

const centerCaviteSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: z.array(z.number()).length(2),
  })
  .strict();

export const ficheCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(1000),
    ville: z.string().trim().max(100).optional(),
    type: ficheTypeSchema.optional(),
    etat: ficheEtatSchema.optional(),
    accessibilite: ficheAccessibiliteSchema.or(z.literal("")).optional(),
    acces_souterrain: ficheAccesSouterrainSchema.optional(),
    difficulte_acces: ficheDifficulteAccesSchema.optional(),
    risque_oxygene: ficheRisqueOxygeneSchema.optional(),
    etat_general: ficheEtatGeneralSchema.optional(),
    praticite_souterrain: z
      .union([fichePraticiteSchema, z.array(fichePraticiteSchema)])
      .optional(),
    equipement_conseille: z.array(ficheEquipementSchema).optional(),
    surface: z.array(ficheSurfaceSchema).optional(),
    type_galeries: z.array(ficheTypeGaleriesSchema).optional(),
    interets: z.string().max(5000).optional(),
    commentaire: z.string().max(5000).optional(),
    points_ids: z.array(objectIdString).optional(),
    center_cavite: centerCaviteSchema.optional(),
  })
  .passthrough();

export const ficheUpdateSchema = ficheCreateSchema.partial();

export type FicheCreateInput = z.infer<typeof ficheCreateSchema>;
export type FicheUpdateInput = z.infer<typeof ficheUpdateSchema>;
