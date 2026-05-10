import { getErrorMessage } from "../utils/errorUtils";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { memoryStorage } from "../services/memoryStorageService";
import { syncService } from "../services/syncService";
import FicheModel from "../models/fiches";
import PointModel from "../models/points";
import { logger } from "../services/loggerService";
import { safeJsonParse } from "../utils/secureJsonParser";
import { webSocketService } from "../services/webSocketService";

const pointsLogger = logger.child({ service: "points" });

/**
 * Helper : récupère le deviceId origin depuis le header `x-device-id`
 * pour éviter qu'un device se notifie lui-même via sync_update.
 */
function getOriginDeviceId(req: Request): string | undefined {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 128) {
    return raw;
  }
  return undefined;
}

// typescript
export async function handleCreatePoint(req: Request, res: Response) {
  try {
    // Validation défensive - req.user devrait toujours exister grâce au middleware
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        message: "Authentification requise",
        code: "UNAUTHORIZED",
      });
    }

    const {
      name,
      description,
      longitude,
      latitude,
      ficheId,
      listIds,
      accessType,
    } = req.body;
    const userId = req.user.id;

    if (!name || longitude === undefined || latitude === undefined) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "ID utilisateur invalide" });
    }

    if (
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return res.status(400).json({ message: "Coordonnées invalides" });
    }

    const parseFicheIds = (
      input: any,
    ): mongoose.Types.ObjectId | mongoose.Types.ObjectId[] | null => {
      if (
        input === undefined ||
        input === null ||
        (typeof input === "string" && input.trim() === "")
      )
        return null;

      if (Array.isArray(input)) {
        // Limite de sécurité : maximum 100 IDs
        const limitedInput = input.slice(0, 100);
        const ids = limitedInput
          .map((i) => String(i).trim())
          .filter(Boolean)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
        if (ids.length === 0) return null;
        return ids.length === 1 ? ids[0] : ids;
      }

      if (typeof input === "string") {
        // Limite de taille pour prévenir les DoS via JSON bombs
        const MAX_JSON_SIZE = 10000; // 10KB max
        if (input.length > MAX_JSON_SIZE) {
          pointsLogger.warn("JSON input trop volumineux, rejeté");
          return null;
        }

        try {
          const parsed = safeJsonParse(input, {
            context: "parse-field-value",
            maxDepth: 5,
          });

          // Validation de structure : doit être un tableau ou une chaîne simple
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
          ) {
            // Objet simple, vérifier s'il a un _id
            if (
              parsed._id &&
              mongoose.Types.ObjectId.isValid(String(parsed._id))
            ) {
              return new mongoose.Types.ObjectId(String(parsed._id));
            }
            return null;
          }

          return parseFicheIds(parsed);
        } catch {
          const parts = input
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
          if (parts.length === 0) return null;
          // Limite de sécurité : maximum 100 IDs
          const limitedParts = parts.slice(0, 100);
          const valid = limitedParts
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
          if (valid.length === 0) return null;
          return valid.length === 1 ? valid[0] : valid;
        }
      }

      if (typeof input === "object") {
        if (input._id && mongoose.Types.ObjectId.isValid(String(input._id))) {
          return new mongoose.Types.ObjectId(String(input._id));
        }
      }

      return null;
    };

    const parsedFiche = parseFicheIds(ficheId);

    // Parser les listIds de la même manière
    const parsedListIds = parseFicheIds(listIds);

    const newPointId = new mongoose.Types.ObjectId();

    // Validation stricte des coordonnées
    let location = undefined;
    if (longitude !== undefined && latitude !== undefined) {
      const lng = parseFloat(longitude);
      const lat = parseFloat(latitude);
      if (!isNaN(lng) && !isNaN(lat)) {
        location = {
          type: "Point",
          coordinates: [
            Math.round(lng * 1e6) / 1e6,
            Math.round(lat * 1e6) / 1e6,
          ],
        };
      } else {
        return res.status(400).json({
          message:
            "Coordonnées invalides : longitude ou latitude non numérique.",
        });
      }
    } else {
      return res.status(400).json({
        message:
          "Coordonnées manquantes : longitude et latitude sont requises.",
      });
    }

    // Ajout du champ accessType au point
    const pointMemory: any = {
      _id: newPointId,
      userId,
      name,
      description: description || "",
      location,
      createdAt: new Date(),
      updatedAt: new Date(),
      ficheId: parsedFiche,
      accessType: accessType || "", // Ajout du type d'accès, valeur par défaut vide
    };

    // Ajouter listIds au point si présent
    if (parsedListIds) {
      pointMemory.listIds = Array.isArray(parsedListIds)
        ? parsedListIds.map((id) => id.toString())
        : [parsedListIds.toString()];
    }

    // Stocker le point en mémoire (cf. fix.md backend #1 — étendu de Phase 1 #20).
    const stored = memoryStorage.storePoint(userId, pointMemory as any);
    if (!stored) {
      pointsLogger.error("Échec du stockage en mémoire du point", {
        userId,
        pointId: newPointId.toString(),
      });
      return res.status(503).json({
        success: false,
        message: "Impossible de stocker le point, veuillez réessayer.",
        persisted: false,
      });
    }

    // Si une ou plusieurs fiches sont fournies, ajouter le point dans chaque fiche en mémoire
    let assocSuccess = true;
    if (parsedFiche) {
      try {
        const ficheIds = Array.isArray(parsedFiche)
          ? parsedFiche
          : [parsedFiche];

        for (const fidObj of ficheIds) {
          const fidStr = fidObj.toString();

          // Vérifier si la fiche existe en mémoire
          const ficheInMemory = memoryStorage.getFicheById(userId, fidStr);

          // Si la fiche n'est pas en mémoire, essayer de la recharger depuis la base
          if (!ficheInMemory) {
            const ficheFromDB = await FicheModel.findOne({
              _id: fidStr,
              userId: userId,
            });

            if (ficheFromDB) {
              // Stocker la fiche en mémoire (elle sera déchiffrée plus tard lors du sync)
              const ficheData = {
                _id: ficheFromDB._id,
                name: ficheFromDB.name,
                ville: ficheFromDB.ville,
                type: ficheFromDB.type,
                etat: ficheFromDB.etat,
                userId: ficheFromDB.userId,
                difficulte_acces: ficheFromDB.difficulte_acces,
                risque_oxygene: ficheFromDB.risque_oxygene,
                acces_souterrain: ficheFromDB.acces_souterrain,
                praticite_souterrain: ficheFromDB.praticite_souterrain,
                etat_general: ficheFromDB.etat_general,
                points_ids: ficheFromDB.points_ids || [],
                date_creation: ficheFromDB.date_creation,
                date_modification: ficheFromDB.date_modification,
              };

              memoryStorage.storeFiche(userId, ficheData as any);
            }
          }

          // Maintenant, essayer d'ajouter le point à la fiche
          const added = memoryStorage.addPointToFiche(
            userId,
            fidStr,
            newPointId.toString(),
          );
          if (!added) {
            assocSuccess = false;
          }
        }
      } catch (err) {
        assocSuccess = false;
        pointsLogger.error("Erreur lors de l'association point -> fiche", {
          error: getErrorMessage(err),
        });
      }
    }

    // Si une ou plusieurs listes sont fournies, ajouter le point dans chaque liste en mémoire
    if (parsedListIds) {
      try {
        const listIdsArray = Array.isArray(parsedListIds)
          ? parsedListIds
          : [parsedListIds];
        for (const listIdObj of listIdsArray) {
          const listIdStr = listIdObj.toString();
          const added = memoryStorage.addPointToList(
            userId,
            listIdStr,
            newPointId.toString(),
          );
          if (!added) {
            assocSuccess = false;
          }
        }
      } catch (err) {
        assocSuccess = false;
        pointsLogger.error("Erreur lors de l'association point -> liste", {
          error: getErrorMessage(err),
        });
      }
    }

    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : retirer le point de la mémoire pour éviter un état zombie
      // (cf. fix.md backend #1 — étendu de Phase 1 #20).
      memoryStorage.deletePoint(userId, newPointId.toString());
      pointsLogger.error("Sync Mongo échouée, rollback du point en mémoire", {
        userId,
        pointId: newPointId.toString(),
        error: syncResult.error,
      });
      return res.status(503).json({
        success: false,
        message:
          "Le point n'a pas pu être enregistré durablement. Veuillez réessayer.",
        error: syncResult.error,
        persisted: false,
      });
    }

    // Round-trip de vérification : confirmer que le point est bien en Mongo.
    const pointInDb = await PointModel.findById(newPointId).select("_id").lean();
    if (!pointInDb) {
      memoryStorage.deletePoint(userId, newPointId.toString());
      pointsLogger.error(
        "Sync OK mais point absent de Mongo après round-trip, rollback",
        { userId, pointId: newPointId.toString() },
      );
      return res.status(503).json({
        success: false,
        message:
          "La persistance du point n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    pointsLogger.info("Point créé avec succès", {
      userId,
      pointId: newPointId.toString(),
      action: "create_point",
      hasFiche: !!parsedFiche,
      hasLists: !!parsedListIds,
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "point",
      "created",
      newPointId.toString(),
      { _id: newPointId, name, longitude, latitude },
      getOriginDeviceId(req),
    );

    res.status(201).json({
      success: true,
      message: "Point créé avec succès",
      pointId: newPointId,
      syncSuccess: true,
      assocSuccess,
      persisted: true,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur création point", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue",
    });
  }
}

export async function handleGetAllPointsByUserId(req: Request, res: Response) {
  try {
    // Validation défensive - req.user devrait toujours exister grâce au middleware
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        message: "Authentification requise",
        code: "UNAUTHORIZED",
      });
    }

    // Pour GET, utiliser uniquement req.user.id (pas req.body)
    const userId = req.user.id;

    // Check if userId exists
    if (!userId) {
      return res.status(400).json({ message: "ID utilisateur manquant" });
    }

    // Validation de l'ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Format de l'ID utilisateur invalide",
        receivedId: userId,
      });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 500),
      1000,
    ); // Max 1000
    const offset = (page - 1) * limit;

    // Récupérer les points depuis la mémoire
    const allPoints = memoryStorage.getAllPoints(userId);
    const total = allPoints ? allPoints.length : 0;

    // Retourner un tableau vide si aucun point trouvé (pas une erreur 404)
    if (!allPoints || allPoints.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // Appliquer la pagination
    const paginatedPoints = allPoints.slice(offset, offset + limit);

    // Ajouter le flag hasImage à chaque point
    const points = paginatedPoints.map((point) => ({
      ...point,
      hasImage: !!point.photo,
    }));

    pointsLogger.debug("Points récupérés avec succès", {
      userId,
      count: points.length,
      total,
      action: "read_points",
    });

    res.status(200).json({
      data: points,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur récupération points", {
      error: getErrorMessage(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return res.status(500).json({
      message: "Erreur lors de la récupération des points",
      error: "Une erreur interne est survenue",
    });
  }
}

export async function handleSearchPoints(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non identifié" });
    }

    // Validation de l'ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: "Format de l'ID utilisateur invalide",
        receivedId: userId,
      });
    }

    // Récupérer les paramètres de recherche depuis query params
    const { q, query, ficheId, listId } = req.query;

    // Utiliser 'q' ou 'query' pour la recherche textuelle
    const searchQuery = (q || query) as string | undefined;

    // Construire les filtres
    const filters: any = {};
    if (searchQuery) filters.query = searchQuery;
    if (ficheId) filters.ficheId = ficheId as string;
    if (listId) filters.listId = listId as string;

    // Effectuer la recherche
    const results = memoryStorage.searchPoints(userId, filters);

    // Ajouter le flag hasImage à chaque point
    const points = results.map((point) => ({
      ...point,
      hasImage: !!point.photo,
    }));

    pointsLogger.info("Recherche de points effectuée", {
      userId,
      filters,
      resultCount: points.length,
      action: "search_points",
    });

    res.status(200).json({
      success: true,
      count: points.length,
      points,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur recherche points", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la recherche de points",
      error: "Une erreur interne est survenue",
    });
  }
}

export async function handleGetPointById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "ID utilisateur manquant" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Format de l'ID invalide" });
    }

    const point = memoryStorage.getPointById(userId, id);

    if (!point) {
      return res.status(404).json({ message: "Point non trouvé" });
    }

    // Ajouter le flag hasImage au point
    const pointWithFlag = {
      ...point,
      hasImage: !!point.photo,
    };

    res.status(200).json(pointWithFlag);
  } catch (_error: unknown) {
    return res.status(400).json({ message: "Une erreur interne est survenue" });
  }
}

export async function handleDeletePoint(req: Request, res: Response) {
  try {
    const pointId = req.params.id;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non identifié" });
    }

    if (!pointId) {
      return res.status(400).json({ message: "ID du point manquant" });
    }

    if (!mongoose.Types.ObjectId.isValid(pointId)) {
      return res.status(400).json({ message: "Format de l'ID invalide" });
    }

    // Récupérer le point pour vérifier s'il est lié à une fiche
    const point = memoryStorage.getPointById(userId, pointId);

    if (!point) {
      return res.status(404).json({ message: "Point non trouvé" });
    }

    // Si le point est associé à une fiche, le retirer de cette fiche
    if ((point as any).ficheId) {
      const ficheId = (point as any).ficheId.toString();

      // Supprimer la référence dans la fiche
      memoryStorage.removePointFromFiche(userId, ficheId, pointId);
    }

    // Sauvegarde du snapshot pour rollback éventuel (cf. fix.md backend #1).
    const pointSnapshot = point;

    // Supprimer le point de la mémoire
    const deleted = memoryStorage.deletePoint(userId, pointId);

    if (!deleted) {
      return res.status(404).json({ message: "Point non trouvé en mémoire" });
    }

    // Synchroniser la modification avec la base de données
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : restaurer le point en mémoire (et son lien fiche s'il existait)
      // pour ne pas laisser un état "supprimé localement, présent en DB" zombie.
      memoryStorage.storePoint(userId, pointSnapshot as any);
      if ((pointSnapshot as any).ficheId) {
        memoryStorage.addPointToFiche(
          userId,
          (pointSnapshot as any).ficheId.toString(),
          pointId,
        );
      }
      pointsLogger.error("Sync Mongo échouée, rollback de la suppression du point", {
        userId,
        pointId,
        error: syncResult.error,
      });
      return res.status(503).json({
        success: false,
        message:
          "La suppression n'a pas pu être confirmée. Veuillez réessayer.",
        error: syncResult.error,
        persisted: false,
      });
    }

    // Round-trip : vérifier que le point a bien été retiré de Mongo.
    const stillInDb = await PointModel.findById(pointId).select("_id").lean();
    if (stillInDb) {
      memoryStorage.storePoint(userId, pointSnapshot as any);
      if ((pointSnapshot as any).ficheId) {
        memoryStorage.addPointToFiche(
          userId,
          (pointSnapshot as any).ficheId.toString(),
          pointId,
        );
      }
      pointsLogger.error(
        "Sync OK mais point toujours présent en Mongo, rollback",
        { userId, pointId },
      );
      return res.status(503).json({
        success: false,
        message:
          "La suppression du point n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    pointsLogger.info("Point supprimé avec succès", {
      userId,
      pointId,
      action: "delete_point",
      hasFiche: !!(point as any).ficheId,
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "point",
      "deleted",
      pointId,
      { _id: pointId },
      getOriginDeviceId(req),
    );

    res.status(200).json({
      success: true,
      message: "Point supprimé avec succès",
      pointId,
      syncSuccess: true,
      persisted: true,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur suppression point", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du point",
      error: "Une erreur interne est survenue",
    });
  }
}

export async function handleUpdatePoint(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const {
      name,
      description,
      longitude,
      latitude,
      listIds,
      ficheId,
      accessType,
    } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non identifié" });
    }

    // Récupérer le point depuis la mémoire
    const point = memoryStorage.getPointById(userId, id);

    if (!point) {
      return res.status(404).json({ message: "Point non trouvé" });
    }

    // §P2 §4.2.2 — Optimistic concurrency control
    // Si le client envoie sa version, vérifier qu'elle correspond au serveur.
    if (typeof req.body.version === "number") {
      const serverVersion = (point as any).version || 0;
      if (req.body.version < serverVersion) {
        return res.status(409).json({
          message:
            "Ce point a été modifié entre-temps. Veuillez recharger.",
          code: "VERSION_CONFLICT",
          clientVersion: req.body.version,
          serverVersion,
        });
      }
    }

    // Snapshot deep-copy AVANT toute mutation pour rollback éventuel
    // (cf. fix.md backend #1).
    const pointSnapshot = JSON.parse(JSON.stringify(point));

    // Mettre à jour les champs
    if (name !== undefined) point.name = name;
    if (description !== undefined) point.description = description;

    if (longitude !== undefined && latitude !== undefined) {
      // Assertion de type pour éviter l'erreur TypeScript
      (point as any).location = {
        type: "Point",
        coordinates: [
          Math.round(parseFloat(longitude) * 1e6) / 1e6,
          Math.round(parseFloat(latitude) * 1e6) / 1e6,
        ],
      };
    }

    // Mettre à jour listIds si fourni
    if (listIds !== undefined) {
      const oldListIds = (point as any).listIds;

      // Si listIds est null ou array vide, supprimer l'association
      if (
        listIds === null ||
        (Array.isArray(listIds) && listIds.length === 0)
      ) {
        // Retirer le point de l'ancienne liste si elle existait
        if (oldListIds && Array.isArray(oldListIds) && oldListIds.length > 0) {
          const oldListId = oldListIds[0];
          memoryStorage.removePointFromList(userId, oldListId, id);
        }
        (point as any).listIds = undefined;
      } else if (Array.isArray(listIds) && listIds.length > 0) {
        const newListId = listIds[0]; // On ne prend que la première liste (sélection unique)

        // Retirer le point de l'ancienne liste si elle est différente de la nouvelle
        if (oldListIds && Array.isArray(oldListIds) && oldListIds.length > 0) {
          const oldListId = oldListIds[0];
          if (oldListId !== newListId) {
            memoryStorage.removePointFromList(userId, oldListId, id);
          }
        }

        // Ajouter le point à la nouvelle liste
        (point as any).listIds = [newListId];
        memoryStorage.addPointToList(userId, newListId, id);
      }
    }

    // Mettre à jour ficheId si fourni
    if (ficheId !== undefined) {
      // Si ficheId est null ou array vide, supprimer l'association
      if (
        ficheId === null ||
        (Array.isArray(ficheId) && ficheId.length === 0)
      ) {
        (point as any).ficheId = undefined;
      } else {
        // Stocker ficheId (peut être string ou array)
        (point as any).ficheId = ficheId;

        // Ajouter le point dans les fiches en mémoire
        const ficheIds = Array.isArray(ficheId) ? ficheId : [ficheId];
        for (const fid of ficheIds) {
          const addResult = memoryStorage.addPointToFiche(userId, fid, id);
          if (!addResult) {
            pointsLogger.warn("Impossible d'ajouter le point à la fiche", {
              pointId: id,
              ficheId: fid,
            });
          }
        }
      }
    }

    // Mettre à jour le champ accessType si fourni
    if (accessType !== undefined) {
      point.accessType = accessType || ""; // Assurez-vous que la valeur par défaut est une chaîne vide
    }

    // Mettre à jour le timestamp de modification
    point.updatedAt = new Date();

    // §P2 §4.2.2 — Incrément version pour optimistic concurrency
    (point as any).version = ((point as any).version || 0) + 1;

    // Stocker les modifications en mémoire
    memoryStorage.storePoint(userId, point);

    // Synchroniser avec la base de données et attendre le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : restaurer le snapshot d'avant mutation (cf. fix.md backend #1).
      memoryStorage.storePoint(userId, pointSnapshot);
      pointsLogger.error("Sync Mongo échouée, rollback de la mise à jour du point", {
        userId,
        pointId: id,
        error: syncResult.error,
      });
      return res.status(503).json({
        success: false,
        message:
          "La mise à jour du point n'a pas pu être confirmée. Veuillez réessayer.",
        error: syncResult.error,
        persisted: false,
      });
    }

    pointsLogger.info("Point mis à jour avec succès", {
      userId,
      pointId: id,
      action: "update_point",
      fieldsUpdated: Object.keys(req.body).filter((k) =>
        [
          "name",
          "description",
          "longitude",
          "latitude",
          "listIds",
          "ficheId",
          "accessType",
        ].includes(k),
      ),
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "point",
      "updated",
      id,
      point,
      getOriginDeviceId(req),
    );

    res.status(200).json({
      success: true,
      message: "Point mis à jour avec succès",
      point,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur mise à jour point", {
      error: getErrorMessage(error),
    });
    return res.status(400).json({
      success: false,
      message: "Une erreur interne est survenue",
    });
  }
}

export async function handleLinkPointToFiche(req: Request, res: Response) {
  try {
    const { pointId, ficheId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    if (!pointId || !ficheId) {
      return res
        .status(400)
        .json({ message: "IDs de point et de fiche requis" });
    }

    const result = memoryStorage.addPointToFiche(userId, ficheId, pointId);

    if (!result) {
      return res.status(404).json({ message: "Point ou fiche non trouvé" });
    }

    // Synchroniser avec la base de données
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        success: false,
        message:
          "Le point a été lié à la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
        error: syncResult.error,
        pointId,
        ficheId,
        syncFailed: true,
      });
    }

    pointsLogger.info("Point lié à la fiche avec succès", {
      userId,
      pointId,
      ficheId,
      action: "link_point_fiche",
    });

    res.status(200).json({
      success: true,
      message: "Point associé à la fiche avec succès",
      pointId,
      ficheId,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur association point-fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue",
    });
  }
}

export async function handleUnlinkPointFromFiche(req: Request, res: Response) {
  try {
    const { pointId, ficheId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    if (!pointId || !ficheId) {
      return res
        .status(400)
        .json({ message: "IDs de point et de fiche requis" });
    }

    const result = memoryStorage.removePointFromFiche(userId, ficheId, pointId);

    if (!result) {
      return res.status(404).json({ message: "Point ou fiche non trouvé" });
    }

    // Synchroniser avec la base de données
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        success: false,
        message:
          "Le point a été délié de la fiche en mémoire mais n'a pas pu être synchronisé avec la base de données",
        error: syncResult.error,
        pointId,
        ficheId,
        syncFailed: true,
      });
    }

    pointsLogger.info("Point délié de la fiche avec succès", {
      userId,
      pointId,
      ficheId,
      action: "unlink_point_fiche",
    });

    res.status(200).json({
      success: true,
      message: "Point dissocié de la fiche avec succès",
      pointId,
      ficheId,
      syncSuccess: true,
    });
  } catch (error: unknown) {
    pointsLogger.error("Erreur dissociation point-fiche", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      success: false,
      message: "Une erreur interne est survenue",
    });
  }
}
