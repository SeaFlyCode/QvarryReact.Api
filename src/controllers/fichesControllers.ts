import { getErrorMessage } from "../utils/errorUtils";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { memoryStorage } from "../services/memoryStorageService";
import { validateFicheData } from "../services/validationService";
import { syncService } from "../services/syncService";
import { loadAndDecryptUserData } from "./auth/authHelpers";
import { logger } from "../services/loggerService";
import FicheModel from "../models/fiches";
import {
  ficheCreateSchema,
  ficheUpdateSchema,
} from "../schemas/ficheSchemas";
import { webSocketService } from "../services/webSocketService";

/**
 * Helper : récupère le deviceId depuis le header `x-device-id`.
 * Optionnel — si absent, le sync_update est broadcast à TOUS les devices
 * (le client filtrera côté front s'il connaît son propre deviceId via WS).
 */
function getOriginDeviceId(req: Request): string | undefined {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 128) {
    return raw;
  }
  return undefined;
}

const fichesLogger = logger.child({ service: "fiches" });

function ficheZodErrorResponse(res: Response, error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue?.path?.join(".") || "body";
  return res.status(400).json({
    error: `Champ invalide: ${path} — ${issue?.message ?? "valeur incorrecte"}`,
    code: "INVALID_PAYLOAD",
    details: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}

/**
 * Gère la création d'une nouvelle fiche
 */
export async function handleCreateFiche(req: Request, res: Response) {
  try {
    const {
      name,
      ville,
      type,
      etat,
      accessibilite,
      difficulte_acces,
      risque_oxygene,
      acces_souterrain,
      praticite_souterrain,
      etat_general,
      points_ids,
      equipement_conseille,
      surface,
      type_galeries,
      interets,
      commentaire,
      center_cavite,
    } = req.body;

    // Validation des données
    const validation = validateFicheData(req.body);
    if (!validation.isValid) {
      fichesLogger.warn("Validation échouée lors de la création d'une fiche", {
        userId: req.user?.id,
        errors: validation.errors,
      });
      return res.status(400).json({
        message: "Validation échouée",
        errors: validation.errors,
      });
    }

    if (!req.user?.id) {
      fichesLogger.warn(
        "Tentative d'accès non authentifié à la création de fiche",
      );
      return res.status(401).json({
        message: "Utilisateur non authentifié",
      });
    }

    // Validation stricte des enums (alignée mobile)
    const parsed = ficheCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      fichesLogger.warn("Payload Fiche refusé par Zod (create)", {
        userId: req.user.id,
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      });
      return ficheZodErrorResponse(res, parsed.error);
    }

    const userId = req.user.id;

    // Filtrer les IDs de points valides
    let validPointsIds = [];
    if (points_ids && Array.isArray(points_ids)) {
      validPointsIds = points_ids.filter((id) =>
        mongoose.Types.ObjectId.isValid(id),
      );
    }

    // Générer un nouvel ID pour la fiche
    const newFicheId = new mongoose.Types.ObjectId();

    // Construire la fiche déchiffrée pour la mémoire
    const ficheMemory = {
      _id: newFicheId,
      name,
      ville,
      type,
      etat,
      accessibilite: accessibilite || "",
      difficulte_acces,
      risque_oxygene,
      acces_souterrain,
      praticite_souterrain,
      etat_general,
      commentaire: commentaire || "",
      points_ids: validPointsIds,
      userId,
      date_creation: new Date(),
      date_modification: new Date(),
      equipement_conseille: Array.isArray(equipement_conseille)
        ? equipement_conseille
        : [],
      surface: Array.isArray(surface) ? surface : [],
      type_galeries: Array.isArray(type_galeries) ? type_galeries : [],
      interets: interets || "",
      center_cavite: center_cavite || undefined,
    };

    // Stocker la fiche en mémoire
    const stored = memoryStorage.storeFiche(userId, ficheMemory as any);
    if (!stored) {
      fichesLogger.error("Échec du stockage en mémoire de la fiche", {
        userId,
        ficheId: newFicheId.toString(),
      });
      return res.status(503).json({
        message: "Impossible de stocker la fiche, veuillez réessayer.",
        persisted: false,
      });
    }

    // Forcer la synchronisation immédiate et vérifier le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : retirer la fiche de la mémoire pour éviter un état zombie
      memoryStorage.deleteFiche(userId, newFicheId.toString());
      fichesLogger.error("Sync Mongo échouée, rollback de la fiche en mémoire", {
        userId,
        ficheId: newFicheId.toString(),
        error: syncResult.error,
      });
      return res.status(503).json({
        message:
          "La fiche n'a pas pu être enregistrée durablement. Veuillez réessayer.",
        error: syncResult.error,
        persisted: false,
      });
    }

    // Round-trip de vérification : confirmer que la fiche est bien en Mongo
    const ficheInDb = await FicheModel.findById(newFicheId).select("_id").lean();
    if (!ficheInDb) {
      memoryStorage.deleteFiche(userId, newFicheId.toString());
      fichesLogger.error(
        "Sync OK mais fiche absente de Mongo après round-trip, rollback",
        { userId, ficheId: newFicheId.toString() },
      );
      return res.status(503).json({
        message:
          "La persistance de la fiche n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    fichesLogger.info("Fiche créée avec succès", {
      userId,
      ficheId: newFicheId.toString(),
      action: "create_fiche",
      hasPoints: validPointsIds.length > 0,
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "fiche",
      "created",
      newFicheId.toString(),
      ficheMemory,
      getOriginDeviceId(req),
    );

    res.status(201).json({
      message: "Fiche créée avec succès",
      ficheId: newFicheId,
      syncSuccess: true,
      persisted: true,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la création de la fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la création de la fiche.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Gère la mise à jour d'une fiche
 */
export async function handleUpdateFiche(req: Request, res: Response) {
  try {
    const ficheId = req.params.id;
    const userId = req.user?.id;
    const updateData = req.body;

    if (!userId) {
      fichesLogger.warn(
        "Tentative d'accès non authentifié à la mise à jour de fiche",
      );
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // Récupérer la fiche depuis la mémoire
    const fiche = memoryStorage.getFicheById(userId, ficheId);

    if (!fiche) {
      return res.status(404).json({ message: "Fiche non trouvée." });
    }

    // §P2 §4.2.2 — Optimistic concurrency control
    // Si le client envoie sa version, vérifier qu'elle correspond au serveur.
    // Évite l'écrasement silencieux lorsque deux devices modifient la même
    // fiche en simultané (cf. mobileSyncService.applyChange qui fait pareil).
    if (typeof updateData.version === "number") {
      const serverVersion = (fiche as any).version || 0;
      if (updateData.version < serverVersion) {
        return res.status(409).json({
          message:
            "Cette fiche a été modifiée entre-temps. Veuillez recharger.",
          code: "VERSION_CONFLICT",
          clientVersion: updateData.version,
          serverVersion,
        });
      }
    }

    // Validation stricte des enums sur les champs envoyés (alignée mobile)
    const parsedUpdate = ficheUpdateSchema.safeParse(updateData);
    if (!parsedUpdate.success) {
      fichesLogger.warn("Payload Fiche refusé par Zod (update)", {
        userId,
        ficheId,
        issues: parsedUpdate.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      });
      return ficheZodErrorResponse(res, parsedUpdate.error);
    }

    // SEC: Allowlist des champs modifiables pour éviter l'injection de champs arbitraires
    const ALLOWED_UPDATE_FIELDS = [
      "name",
      "ville",
      "type",
      "etat",
      "accessibilite",
      "difficulte_acces",
      "risque_oxygene",
      "acces_souterrain",
      "praticite_souterrain",
      "etat_general",
      "commentaire",
      "points_ids",
      "equipement_conseille",
      "surface",
      "type_galeries",
      "interets",
      "center_cavite",
    ];
    Object.keys(updateData).forEach((key) => {
      if (ALLOWED_UPDATE_FIELDS.includes(key)) {
        (fiche as any)[key] = updateData[key];
      }
    });

    // Mettre à jour la date de modification
    fiche.date_modification = new Date();

    // §P2 §4.2.2 — Incrément version pour le prochain check optimistic concurrency
    // (le sync DB incrémentera aussi en authHelpers:1155, mais l'écho WS qui
    // suit doit déjà refléter la nouvelle version).
    (fiche as any).version = ((fiche as any).version || 0) + 1;

    // Stocker les modifications en mémoire
    memoryStorage.storeFiche(userId, fiche);

    // Forcer la synchronisation immédiate et vérifier le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        message:
          "La fiche a été mise à jour en mémoire mais n'a pas pu être synchronisée avec la base de données",
        error: syncResult.error,
        ficheId,
        syncFailed: true,
      });
    }

    fichesLogger.info("Fiche mise à jour avec succès", {
      userId,
      ficheId,
      action: "update_fiche",
      fieldsUpdated: Object.keys(updateData).filter((k) =>
        ALLOWED_UPDATE_FIELDS.includes(k),
      ),
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "fiche",
      "updated",
      ficheId,
      fiche,
      getOriginDeviceId(req),
    );

    res.status(200).json({
      message: "Fiche mise à jour avec succès",
      fiche,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la mise à jour de la fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la mise à jour de la fiche.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Gère la suppression d'une fiche
 */
export async function handleDeleteFiche(req: Request, res: Response) {
  try {
    const ficheId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // Récupérer la fiche pour obtenir les points associés
    const fiche = memoryStorage.getFicheById(userId, ficheId);

    if (!fiche) {
      return res.status(404).json({ message: "Fiche non trouvée." });
    }

    // Pour chaque point associé à la fiche, supprimer le lien ficheId
    if (fiche.points_ids && fiche.points_ids.length > 0) {
      for (const pointIdObj of fiche.points_ids) {
        const pointId = pointIdObj.toString();
        const point = memoryStorage.getPointById(userId, pointId);

        if (point && (point as any).ficheId) {
          // Supprimer la référence à la fiche dans le point
          (point as any).ficheId = undefined;
          memoryStorage.storePoint(userId, point);
        }
      }
    }

    // Supprimer la fiche de la mémoire
    const deleted = memoryStorage.deleteFiche(userId, ficheId);

    if (!deleted) {
      return res.status(404).json({ message: "Fiche non trouvée." });
    }

    // Forcer une synchronisation immédiate après suppression et vérifier le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        message:
          "La fiche a été supprimée en mémoire mais n'a pas pu être synchronisée avec la base de données",
        error: syncResult.error,
        ficheId,
        syncFailed: true,
      });
    }

    fichesLogger.info("Fiche supprimée avec succès", {
      userId,
      ficheId,
      action: "delete_fiche",
      pointsCount: fiche.points_ids?.length || 0,
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "fiche",
      "deleted",
      ficheId,
      { _id: ficheId },
      getOriginDeviceId(req),
    );

    res.status(200).json({
      message: "Fiche supprimée avec succès",
      syncSuccess: true,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la suppression de la fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la suppression de la fiche.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Gère la récupération de toutes les fiches
 */
export async function handleGetAllFiches(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 100),
      500,
    ); // Max 500
    const offset = (page - 1) * limit;

    // Récupérer les fiches depuis la mémoire
    const allFiches = memoryStorage.getAllFiches(userId);
    const total = allFiches.length;

    // Appliquer la pagination
    const fiches = allFiches.slice(offset, offset + limit);

    // Préparer la réponse enrichie sans typage IFiche
    const fichesObj = fiches.map((fiche) => {
      const obj = (fiche as any).toObject
        ? (fiche as any).toObject()
        : { ...fiche };
      return {
        ...obj,
        equipement_conseille: Array.isArray(obj.equipement_conseille)
          ? obj.equipement_conseille
          : [],
        surface: Array.isArray(obj.surface) ? obj.surface : [],
        type_galeries: Array.isArray(obj.type_galeries)
          ? obj.type_galeries
          : [],
        interets: typeof obj.interets === "string" ? obj.interets : "",
        commentaire: typeof obj.commentaire === "string" ? obj.commentaire : "",
      };
    });

    fichesLogger.debug("Fiches récupérées avec succès", {
      userId,
      count: fichesObj.length,
      total,
      action: "read_fiches",
    });

    res.status(200).json({
      data: fichesObj,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la récupération des fiches", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la récupération des fiches.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Gère la récupération d'une fiche par son ID
 */
export async function handleGetFicheById(req: Request, res: Response) {
  try {
    const ficheId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }
    // Récupérer la fiche depuis la mémoire
    const fiche = memoryStorage.getFicheById(userId, ficheId);
    if (!fiche) {
      return res.status(404).json({ message: "Fiche non trouvée." });
    }
    // Préparer la réponse enrichie sans typage IFiche
    const ficheObj = (fiche as any).toObject
      ? (fiche as any).toObject()
      : { ...fiche };
    res.status(200).json({
      ...ficheObj,
      equipement_conseille: Array.isArray(ficheObj.equipement_conseille)
        ? ficheObj.equipement_conseille
        : [],
      surface: Array.isArray(ficheObj.surface) ? ficheObj.surface : [],
      type_galeries: Array.isArray(ficheObj.type_galeries)
        ? ficheObj.type_galeries
        : [],
      interets: typeof ficheObj.interets === "string" ? ficheObj.interets : "",
      commentaire:
        typeof ficheObj.commentaire === "string" ? ficheObj.commentaire : "",
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la récupération de la fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la récupération de la fiche.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Gère la récupération des fiches d'un utilisateur
 */
export async function handleGetUserFiches(req: Request, res: Response) {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ message: "Authentification requise." });
    }

    // Si l'utilisateur demande les fiches d'un autre utilisateur
    if (targetUserId && targetUserId !== currentUserId && !req.user?.isAdmin) {
      return res.status(403).json({
        message:
          "Vous n'êtes pas autorisé à voir les fiches de cet utilisateur.",
      });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    // Utiliser l'ID de l'utilisateur courant
    const allFiches = memoryStorage.getAllFiches(currentUserId);
    const total = allFiches.length;

    // Appliquer la pagination
    const fiches = allFiches.slice(offset, offset + limit);

    res.status(200).json({
      data: fiches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    fichesLogger.error(
      "Erreur lors de la récupération des fiches de l'utilisateur",
      {
        error: getErrorMessage(error),
      },
    );
    return res.status(500).json({
      message: "Erreur lors de la récupération des fiches de l'utilisateur.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Ajoute un point à une fiche
 */
export async function handleAddPointToFiche(req: Request, res: Response) {
  try {
    const { ficheId, pointId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    if (!ficheId || !pointId) {
      return res
        .status(400)
        .json({ message: "ID de la fiche et ID du point requis" });
    }

    // Ajouter le point à la fiche en mémoire
    const result = memoryStorage.addPointToFiche(userId, ficheId, pointId);

    if (!result) {
      return res.status(404).json({ message: "Fiche ou point non trouvé" });
    }

    // Synchronisation immédiate et vérification du résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        message:
          "Le point a été ajouté à la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
        error: syncResult.error,
        ficheId,
        pointId,
        syncFailed: true,
      });
    }

    fichesLogger.info("Point ajouté à la fiche avec succès", {
      userId,
      ficheId,
      pointId,
      action: "add_point_to_fiche",
    });

    res.status(200).json({
      message: "Point ajouté à la fiche avec succès",
      ficheId,
      pointId,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de l'ajout du point à la fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de l'ajout du point à la fiche.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Supprime un point d'une fiche
 */
export async function handleRemovePointFromFiche(req: Request, res: Response) {
  try {
    const { ficheId, pointId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    if (!ficheId || !pointId) {
      return res
        .status(400)
        .json({ message: "ID de la fiche et ID du point requis" });
    }

    // Vérifier que le point et la fiche existent
    const point = memoryStorage.getPointById(userId, pointId);
    const fiche = memoryStorage.getFicheById(userId, ficheId);

    if (!point || !fiche) {
      return res.status(404).json({
        message: !point ? "Point non trouvé" : "Fiche non trouvée",
      });
    }

    // Vérifier si le point est réellement associé à cette fiche
    const isAssociated = fiche.points_ids.some(
      (id) => id.toString() === pointId,
    );
    if (!isAssociated) {
      return res.status(400).json({
        message: "Le point n'est pas associé à cette fiche",
      });
    }

    // Supprimer le point de la fiche en mémoire
    const result = memoryStorage.removePointFromFiche(userId, ficheId, pointId);

    if (!result) {
      return res.status(404).json({
        message: "Erreur lors de la dissociation du point de la fiche",
      });
    }

    // Synchronisation immédiate pour garantir la mise à jour dans la BDD
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        success: false,
        message:
          "La dissociation a été effectuée en mémoire mais n'a pas pu être synchronisée avec la base de données",
        error: syncResult.error,
        ficheId,
        pointId,
        syncFailed: true,
      });
    }

    fichesLogger.info("Point retiré de la fiche avec succès", {
      userId,
      ficheId,
      pointId,
      action: "remove_point_from_fiche",
    });

    res.status(200).json({
      success: true,
      message: "Point dissocié de la fiche avec succès",
      ficheId,
      pointId,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la dissociation point-fiche", {
      error: error instanceof Error ? error.message : error,
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la dissociation du point de la fiche",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère tous les points associés à une fiche
 */
export async function handleGetPointsByFicheId(req: Request, res: Response) {
  try {
    const { ficheId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    if (!ficheId) {
      return res.status(400).json({ message: "ID de fiche manquant" });
    }

    // Récupérer les points depuis la mémoire
    const points = memoryStorage.getPointsByFicheId(userId, ficheId);

    res.status(200).json({
      success: true,
      points,
      count: points.length,
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur recuperation des points de la fiche", {
      error: error instanceof Error ? error.message : error,
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère la fiche associée à un point spécifique
 */
export async function handleGetFicheByPointId(req: Request, res: Response) {
  try {
    const pointId = req.params.pointId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    if (!pointId) {
      return res.status(400).json({ message: "ID du point requis" });
    }

    // Vérifier d'abord si le point existe
    const point = memoryStorage.getPointById(userId, pointId);

    if (!point) {
      return res.status(404).json({ message: "Point non trouvé" });
    }

    // Tentative d'obtenir la ficheId directement du point
    if ((point as any).ficheId) {
      const ficheIdStr = (point as any).ficheId.toString();
      const fiche = memoryStorage.getFicheById(userId, ficheIdStr);

      if (fiche) {
        return res.status(200).json(fiche);
      }
    }

    // Méthode alternative - parcourir toutes les fiches
    const fiches = memoryStorage.getAllFiches(userId);
    const associatedFiche = fiches.find((fiche) =>
      fiche.points_ids.some((id) => id.toString() === pointId),
    );

    if (associatedFiche) {
      // Mise à jour du point avec l'ID de la fiche comme ObjectID
      try {
        const objectIdFicheId = new mongoose.Types.ObjectId(
          String((associatedFiche as any)._id),
        );
        Object.assign(point, { ficheId: objectIdFicheId });
        memoryStorage.storePoint(userId, point);
      } catch (_error) {
        // Fallback en cas d'erreur
        Object.assign(point, { ficheId: String((associatedFiche as any)._id) });
        memoryStorage.storePoint(userId, point);
      }

      return res.status(200).json(associatedFiche);
    }

    // Si aucune fiche n'est trouvée
    return res
      .status(404)
      .json({ message: "Aucune fiche associée à ce point n'a été trouvée" });
  } catch (error: unknown) {
    fichesLogger.error(
      "Erreur lors de la recuperation de la fiche associee au point",
      {
        error: error instanceof Error ? error.message : error,
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    return res.status(500).json({
      message: "Erreur lors de la récupération de la fiche associée au point",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Recherche avancée de fiches avec filtres et rayon géographique
 * GET /api/fiches/search?searchText=...&ville=...&type=...&etat=...&rayonVille=...&rayonDistance=...
 */
export async function handleSearchFiches(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    // Récupérer tous les fiches de l'utilisateur
    let fiches = memoryStorage.getAllFiches(userId);

    // Si aucune fiche en mémoire (session expirée), recharger et déchiffrer depuis MongoDB
    if (!fiches || fiches.length === 0) {
      await loadAndDecryptUserData(userId);
      fiches = memoryStorage.getAllFiches(userId);
    }

    // Filtres textuels
    const {
      searchText,
      ville,
      type,
      etat,
      difficulte_acces,
      risque_oxygene,
      etat_general,
      rayonVille,
      rayonDistance,
    } = req.query;

    if (searchText && typeof searchText === "string" && searchText.trim()) {
      const searchLower = searchText.toLowerCase();
      fiches = fiches.filter(
        (fiche) =>
          fiche.name.toLowerCase().includes(searchLower) ||
          fiche.ville.toLowerCase().includes(searchLower) ||
          fiche.type.toLowerCase().includes(searchLower) ||
          fiche.etat.toLowerCase().includes(searchLower),
      );
    }

    if (ville && typeof ville === "string" && ville.trim()) {
      const villeLower = ville.toLowerCase();
      fiches = fiches.filter(
        (fiche) =>
          fiche.ville && fiche.ville.toLowerCase().includes(villeLower),
      );
    }

    if (type && typeof type === "string" && type.trim()) {
      const typeNorm = normalizeString(type);
      fiches = fiches.filter((fiche) => {
        if (!fiche.type) return false;
        const ficheTypeNorm = normalizeString(fiche.type);
        return ficheTypeNorm === typeNorm;
      });
    }

    if (etat && typeof etat === "string" && etat.trim()) {
      const etatNorm = normalizeString(etat);
      fiches = fiches.filter(
        (fiche) => fiche.etat && normalizeString(fiche.etat) === etatNorm,
      );
    }

    if (
      difficulte_acces &&
      typeof difficulte_acces === "string" &&
      difficulte_acces.trim()
    ) {
      const diffNorm = normalizeString(difficulte_acces);
      fiches = fiches.filter(
        (fiche) =>
          fiche.difficulte_acces &&
          normalizeString(fiche.difficulte_acces) === diffNorm,
      );
    }

    if (
      risque_oxygene &&
      typeof risque_oxygene === "string" &&
      risque_oxygene.trim()
    ) {
      const risqueNorm = normalizeString(risque_oxygene);
      fiches = fiches.filter(
        (fiche) =>
          fiche.risque_oxygene &&
          normalizeString(fiche.risque_oxygene) === risqueNorm,
      );
    }

    if (
      etat_general &&
      typeof etat_general === "string" &&
      etat_general.trim()
    ) {
      const etatGenNorm = normalizeString(etat_general);
      fiches = fiches.filter(
        (fiche) =>
          fiche.etat_general &&
          normalizeString(fiche.etat_general) === etatGenNorm,
      );
    }

    // Filtre géographique par rayon autour d'une ville
    if (
      rayonVille &&
      typeof rayonVille === "string" &&
      rayonDistance &&
      !isNaN(Number(rayonDistance))
    ) {
      const rayonLat = Number(req.query.rayonVilleLat);
      const rayonLng = Number(req.query.rayonVilleLng);
      const rayonKm = Number(rayonDistance);

      if (!isNaN(rayonLat) && !isNaN(rayonLng)) {
        fiches = fiches.filter((fiche) => {
          // Méthode 1: Vérifier les points associés
          if (fiche.points_ids && fiche.points_ids.length > 0) {
            const points = memoryStorage.getPointsByIds(
              userId,
              fiche.points_ids.map((id) => id.toString()),
            );
            for (const point of points) {
              const pointAny = point as any;
              let lat = null;
              let lng = null;
              if (
                pointAny.location &&
                Array.isArray(pointAny.location.coordinates)
              ) {
                // GeoJSON: [lng, lat]
                lng = pointAny.location.coordinates[0];
                lat = pointAny.location.coordinates[1];
              }
              if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                const dist = haversineDistanceKm(
                  [lat, lng],
                  [rayonLat, rayonLng],
                );
                if (dist <= rayonKm) {
                  return true;
                }
              }
            }
          }

          // Méthode 2: Comparer la ville de la fiche avec la ville du rayon
          if (fiche.ville) {
            const ficheVilleLower = fiche.ville.toLowerCase().trim();
            const rayonVilleLower = rayonVille.toLowerCase().trim();

            if (
              ficheVilleLower === rayonVilleLower ||
              ficheVilleLower.includes(rayonVilleLower) ||
              rayonVilleLower.includes(ficheVilleLower)
            ) {
              return true;
            }
          }

          return false;
        });
      }
    }

    // Calculer le total après filtrage
    const total = fiches.length;

    // Appliquer la pagination
    const paginatedFiches = fiches.slice(offset, offset + limit);

    res.status(200).json({
      data: paginatedFiches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    fichesLogger.error("Erreur lors de la recherche avancee de fiches", {
      error: error instanceof Error ? error.message : error,
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      message: "Erreur lors de la recherche avancée de fiches.",
      error: "Une erreur interne est survenue",
    });
  }
}

// Fonction utilitaire pour calculer la distance Haversine entre deux [lat, lng] en km
function haversineDistanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // Rayon de la Terre en km
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const aVal =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

// Fonction utilitaire pour supprimer les accents et mettre en minuscule
function normalizeString(str: string) {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
