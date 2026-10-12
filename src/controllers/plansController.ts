// src/controllers/plansController.ts
// Plans privés (images calées sur la carte), fichiers chiffrés côté serveur.

import { Request, Response } from "express";
import mongoose from "mongoose";
import sharp from "sharp";
import { logger } from "../services/loggerService";
import PlanModel, { IPlan } from "../models/plan";
import planStorageService from "../services/planStorageService";
import storageQuotaService, {
  QuotaExceededError,
} from "../services/storageQuotaService";
import {
  PLANS_CONFIG,
  STORAGE_ERROR_MESSAGES,
  detectPlanMimeType,
} from "../config/storageConfig";
import {
  encryptBufferWithKey,
  decryptBufferWithKey,
  encryptWithKey,
  decryptWithKey,
  getUserEncryptionKey,
} from "../utils/userEncryptionUtils";
import {
  planNameSchema,
  planPlacementSchema,
  planUpdateSchema,
  PlanPlacement,
} from "../schemas/planSchemas";
import { getErrorMessage } from "../utils/errorUtils";

export interface PlanDTO {
  id: string;
  name: string;
  mime: string;
  size: number;
  placement: PlanPlacement | null;
  createdAt: Date;
  updatedAt: Date;
}

function zodMessage(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((i) =>
      i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message,
    )
    .join("; ");
}

function toDTO(doc: IPlan, key: string): PlanDTO {
  let name = "(illisible)";
  let placement: PlanPlacement | null = null;
  try {
    name = decryptWithKey(doc.nameEncrypted, key);
    if (doc.placementEncrypted) {
      const parsed = planPlacementSchema.safeParse(
        JSON.parse(decryptWithKey(doc.placementEncrypted, key)),
      );
      placement = parsed.success ? parsed.data : null;
    }
  } catch (error) {
    logger.error("Plan: déchiffrement des métadonnées impossible", {
      planId: String(doc._id),
      error: getErrorMessage(error),
    });
  }
  return {
    id: String(doc._id),
    name,
    mime: doc.mime,
    size: doc.size,
    placement,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Recherche un plan appartenant à l'utilisateur ; 404 sinon (jamais 403). */
async function findOwnedPlan(
  req: Request,
  res: Response,
): Promise<{ plan: IPlan; userId: string } | null> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Non authentifié" });
    return null;
  }
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ error: "Plan non trouvé" });
    return null;
  }
  const plan = await PlanModel.findOne({
    _id: new mongoose.Types.ObjectId(id),
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!plan) {
    res.status(404).json({ error: "Plan non trouvé" });
    return null;
  }
  return { plan, userId };
}

/**
 * Sémaphore minimal : borne le nombre de décodages sharp simultanés
 * (chaque décodage peut allouer plusieurs centaines de Mo).
 */
let activeImageJobs = 0;
const imageJobWaiters: Array<() => void> = [];
async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeImageJobs >= PLANS_CONFIG.MAX_CONCURRENT_IMAGE_JOBS) {
    await new Promise<void>((resolve) => imageJobWaiters.push(resolve));
  } else {
    activeImageJobs++;
  }
  try {
    return await fn();
  } finally {
    const next = imageJobWaiters.shift();
    if (next) next(); // le slot est transmis au suivant
    else activeImageJobs--;
  }
}

/**
 * Valide l'image (décodage réel) et la redimensionne si le côté long dépasse
 * MAX_DIMENSION_PX. Sans redimensionnement, le fichier d'origine est conservé
 * tel quel (aucune recompression).
 */
async function prepareImage(
  buffer: Buffer,
  mime: string,
): Promise<{ buffer: Buffer }> {
  const meta = await sharp(buffer, {
    limitInputPixels: PLANS_CONFIG.MAX_INPUT_PIXELS,
    sequentialRead: true,
  }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Image invalide");
  }
  if (Math.max(meta.width, meta.height) <= PLANS_CONFIG.MAX_DIMENSION_PX) {
    return { buffer };
  }

  let pipeline = sharp(buffer, {
    limitInputPixels: PLANS_CONFIG.MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate() // applique l'orientation EXIF avant que les métadonnées soient perdues
    .resize({
      width: PLANS_CONFIG.MAX_DIMENSION_PX,
      height: PLANS_CONFIG.MAX_DIMENSION_PX,
      fit: "inside",
      withoutEnlargement: true,
    });
  if (mime === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
  else if (mime === "image/webp") pipeline = pipeline.webp({ quality: 95 });
  else pipeline = pipeline.jpeg({ quality: 95 });

  return { buffer: await pipeline.toBuffer() };
}

/**
 * GET /plans
 */
export const listPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Non authentifié" });
      return;
    }
    const docs = await PlanModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    }).sort({ createdAt: -1 });
    const key = await getUserEncryptionKey(userId);
    res.status(200).json({ plans: docs.map((d) => toDTO(d, key)) });
  } catch (error) {
    logger.error("Erreur lors de la liste des plans", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Erreur lors de la récupération des plans" });
  }
};

/**
 * POST /plans (multipart : file, name?, placement?)
 */
export const createPlan = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Aucun fichier fourni" });
    return;
  }

  const planId = new mongoose.Types.ObjectId();
  let blobWritten = false;
  let quotaIncremented = false;
  let docCreated = false;
  let size = 0;

  // Rollback idempotent : document, blob, quota (chaque étape loguée sans bloquer)
  const rollbackCreate = async (): Promise<void> => {
    if (docCreated) {
      docCreated = false;
      try {
        await PlanModel.deleteOne({ _id: planId, userId: new mongoose.Types.ObjectId(userId) });
      } catch (cleanupError) {
        logger.error("Plan: rollback du document impossible", {
          userId,
          planId: String(planId),
          error: getErrorMessage(cleanupError),
        });
      }
    }
    if (blobWritten) {
      blobWritten = false;
      try {
        await planStorageService.deletePlanBlob(userId, String(planId));
      } catch (cleanupError) {
        logger.error("Plan: nettoyage du blob impossible", {
          userId,
          planId: String(planId),
          error: getErrorMessage(cleanupError),
        });
      }
    }
    if (quotaIncremented) {
      quotaIncremented = false;
      try {
        await storageQuotaService.decrementStorageUsed(userId, size);
      } catch (cleanupError) {
        logger.error("Plan: rollback quota impossible", {
          userId,
          error: getErrorMessage(cleanupError),
        });
      }
    }
  };

  try {
    const file = req.file;
    const allowed = PLANS_CONFIG.ALLOWED_MIME_TYPES as readonly string[];

    // 1. Type réel via magic bytes (le MIME déclaré n'est pas fiable)
    const detectedMime = detectPlanMimeType(file.buffer);
    if (
      !detectedMime ||
      !allowed.includes(detectedMime) ||
      (allowed.includes(file.mimetype) && file.mimetype !== detectedMime)
    ) {
      res.status(400).json({ error: STORAGE_ERROR_MESSAGES.INVALID_MIME_TYPE });
      return;
    }

    // 2. Champs texte
    const rawName =
      typeof req.body?.name === "string" && req.body.name.trim()
        ? req.body.name
        : file.originalname.replace(/\.[^./\\]+$/, "").slice(
            0,
            PLANS_CONFIG.MAX_NAME_LENGTH,
          ) || "Plan";
    const nameParsed = planNameSchema.safeParse(rawName);
    if (!nameParsed.success) {
      res.status(400).json({ error: zodMessage(nameParsed.error) });
      return;
    }

    let placement: PlanPlacement | null = null;
    const rawPlacement = req.body?.placement;
    if (rawPlacement !== undefined && rawPlacement !== null && rawPlacement !== "") {
      if (
        typeof rawPlacement !== "string" ||
        rawPlacement.length > PLANS_CONFIG.MAX_PLACEMENT_JSON_LENGTH
      ) {
        res.status(400).json({ error: "placement: JSON invalide" });
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(rawPlacement);
      } catch {
        res.status(400).json({ error: "placement: JSON invalide" });
        return;
      }
      const placementParsed = planPlacementSchema.safeParse(json);
      if (!placementParsed.success) {
        res.status(400).json({ error: zodMessage(placementParsed.error) });
        return;
      }
      placement = placementParsed.data;
    }

    // 3. Limite du nombre de plans
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const count = await PlanModel.countDocuments({ userId: userObjectId });
    if (count >= PLANS_CONFIG.MAX_FILES_PER_USER) {
      res.status(409).json({
        error: `Limite de ${PLANS_CONFIG.MAX_FILES_PER_USER} plans atteinte`,
        code: "PLAN_LIMIT_REACHED",
        max: PLANS_CONFIG.MAX_FILES_PER_USER,
      });
      return;
    }

    // 4. Clé utilisateur (échec rapide si elle n'existe pas, avant tout travail lourd)
    const key = await getUserEncryptionKey(userId);

    // 4b. Décodage réel + redimensionnement éventuel
    let prepared: { buffer: Buffer };
    try {
      prepared = await withImageSlot(() => prepareImage(file.buffer, detectedMime));
    } catch (error) {
      logger.warn("Plan: image illisible", {
        userId,
        error: getErrorMessage(error),
      });
      res.status(400).json({ error: "Image invalide ou corrompue" });
      return;
    }
    size = prepared.buffer.length;

    // 5. Quota : vérification avant écriture
    if (!(await storageQuotaService.checkQuotaAvailable(userId, size))) {
      const storage = await storageQuotaService.getUserStorageInfo(userId);
      res.status(507).json({
        error: STORAGE_ERROR_MESSAGES.QUOTA_EXCEEDED,
        required: size,
        available: storage.available,
        quota: storage.quota,
        used: storage.used,
      });
      return;
    }

    // 6. Chiffrement + écriture du blob
    const encrypted = encryptBufferWithKey(prepared.buffer, key);
    const filePath = await planStorageService.savePlanBlob(
      userId,
      String(planId),
      encrypted,
    );
    blobWritten = true;

    // 7. Quota atomique (peut lever QuotaExceededError si upload concurrent)
    await storageQuotaService.incrementStorageUsed(userId, size);
    quotaIncremented = true;

    // 8. Document
    const doc = await PlanModel.create({
      _id: planId,
      userId: userObjectId,
      nameEncrypted: encryptWithKey(nameParsed.data, key),
      mime: detectedMime,
      size,
      filePath,
      placementEncrypted: placement
        ? encryptWithKey(JSON.stringify(placement), key)
        : null,
    });
    docCreated = true;

    // 9. Limite de plans sans race : le pré-check ci-dessus peut être dépassé par
    // des uploads concurrents. On recompte les plans créés AVANT le nôtre (ordre
    // d'_id) : si on est au-delà du maximum, c'est nous qui reculons.
    const rank = await PlanModel.countDocuments({
      userId: userObjectId,
      _id: { $lte: planId },
    });
    if (rank > PLANS_CONFIG.MAX_FILES_PER_USER) {
      await rollbackCreate();
      res.status(409).json({
        error: `Limite de ${PLANS_CONFIG.MAX_FILES_PER_USER} plans atteinte`,
        code: "PLAN_LIMIT_REACHED",
        max: PLANS_CONFIG.MAX_FILES_PER_USER,
      });
      return;
    }

    logger.info("Plan créé", { userId, planId: String(planId), size });
    res.status(201).json({ plan: toDTO(doc, key) });
  } catch (error) {
    await rollbackCreate();

    if (error instanceof QuotaExceededError) {
      res.status(507).json({ error: STORAGE_ERROR_MESSAGES.QUOTA_EXCEEDED });
      return;
    }
    logger.error("Erreur lors de la création du plan", {
      error: getErrorMessage(error),
      userId,
    });
    res.status(500).json({ error: "Erreur lors de la création du plan" });
  }
};

/**
 * GET /plans/:id/file — binaire déchiffré à la volée
 */
export const getPlanFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const owned = await findOwnedPlan(req, res);
    if (!owned) return;
    const { plan, userId } = owned;

    // Le fichier d'un plan est immuable (supprimer puis recréer pour le changer) :
    // l'ETag suffit à répondre 304 sans lire le disque ni déchiffrer.
    const etag = `"plan-${String(plan._id)}-${plan.size}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.status(304).end();
      return;
    }

    const blob = await planStorageService.readPlanBlob(userId, String(plan._id));
    if (!blob) {
      logger.error("Plan: fichier manquant", { userId, planId: String(plan._id) });
      res.status(404).json({ error: "Fichier du plan introuvable" });
      return;
    }

    const key = await getUserEncryptionKey(userId);
    const clear = decryptBufferWithKey(blob, key);

    res.setHeader("Content-Type", plan.mime);
    res.setHeader("Content-Length", String(clear.length));
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.status(200).end(clear);
  } catch (error) {
    logger.error("Erreur lors de la lecture du fichier de plan", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Erreur lors de la lecture du plan" });
  }
};

/**
 * PATCH /plans/:id — { name?, placement? }
 */
export const updatePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const owned = await findOwnedPlan(req, res);
    if (!owned) return;
    const { plan, userId } = owned;

    const parsed = planUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: zodMessage(parsed.error) });
      return;
    }

    const key = await getUserEncryptionKey(userId);
    if (parsed.data.name !== undefined) {
      plan.nameEncrypted = encryptWithKey(parsed.data.name, key);
    }
    if (parsed.data.placement !== undefined) {
      plan.placementEncrypted = parsed.data.placement
        ? encryptWithKey(JSON.stringify(parsed.data.placement), key)
        : null;
    }
    await plan.save();

    res.status(200).json({ plan: toDTO(plan, key) });
  } catch (error) {
    logger.error("Erreur lors de la mise à jour du plan", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Erreur lors de la mise à jour du plan" });
  }
};

/**
 * DELETE /plans/:id
 */
export const deletePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const owned = await findOwnedPlan(req, res);
    if (!owned) return;
    const { plan, userId } = owned;

    const size = plan.size;
    // Suppression atomique : seul l'appel qui supprime réellement le document
    // libère le quota (deux DELETE concurrents ne décrémentent pas deux fois).
    const deleted = await PlanModel.deleteOne({ _id: plan._id, userId: plan.userId });
    if (!deleted || deleted.deletedCount !== 1) {
      res.status(404).json({ error: "Plan non trouvé" });
      return;
    }

    try {
      await planStorageService.deletePlanBlob(userId, String(plan._id));
    } catch (error) {
      logger.error("Plan: suppression du blob échouée (orphelin)", {
        userId,
        planId: String(plan._id),
        error: getErrorMessage(error),
      });
    }
    try {
      await storageQuotaService.decrementStorageUsed(userId, size);
    } catch (error) {
      // Le plan est bien supprimé : on ne renvoie pas d'erreur, un recalcul admin corrigera.
      logger.error("Plan: libération du quota échouée", {
        userId,
        planId: String(plan._id),
        error: getErrorMessage(error),
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Erreur lors de la suppression du plan", {
      error: getErrorMessage(error),
      userId: req.user?.id,
    });
    res.status(500).json({ error: "Erreur lors de la suppression du plan" });
  }
};
