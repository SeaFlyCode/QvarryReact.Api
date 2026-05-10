import { Request, Response } from "express";
import ListModel from "../models/lists";
import { memoryStorage } from "../services/memoryStorageService";
import { syncService } from "../services/syncService";
import UserModel from "../models/users";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";
import { webSocketService } from "../services/webSocketService";

const listsLogger = logger.child({ service: "lists" });

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

export async function handleCreateList(req: Request, res: Response) {
  try {
    const { name, description, points, color, icon } = req.body;

    const userId = req.user?.id; // Récupération de l'ID utilisateur depuis le middleware d'authentification

    // Vérification des champs requis
    if (!userId || !name) {
      return res
        .status(400)
        .json({ error: "L'identifiant utilisateur et le nom sont requis" });
    }

    const listMemory = new ListModel({
      userId,
      name,
      description: description || "",
      points: points || [],
      color: color || "#000000", // Couleur par défaut
      icon: icon || "default-icon", // Icône par défaut
    });

    // Stocker la liste en mémoire (cf. fix.md backend #1).
    const stored = memoryStorage.storeList(userId, listMemory as any);
    if (!stored) {
      listsLogger.error("Échec du stockage en mémoire de la liste", {
        userId,
        listId: listMemory._id.toString(),
      });
      return res.status(503).json({
        error: "Impossible de stocker la liste, veuillez réessayer.",
        persisted: false,
      });
    }

    // Forcer la synchronisation de la mémoire vers la BDD et attendre le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : retirer la liste de la mémoire pour éviter un état zombie.
      memoryStorage.deleteList(userId, listMemory._id.toString());
      listsLogger.error("Sync Mongo échouée, rollback de la liste en mémoire", {
        userId,
        listId: listMemory._id.toString(),
        error: syncResult.error,
      });
      return res.status(503).json({
        error: "La liste n'a pas pu être enregistrée durablement. Veuillez réessayer.",
        persisted: false,
      });
    }

    // Round-trip : confirmer que la liste est bien en Mongo.
    const listInDb = await ListModel.findById(listMemory._id).select("_id").lean();
    if (!listInDb) {
      memoryStorage.deleteList(userId, listMemory._id.toString());
      listsLogger.error(
        "Sync OK mais liste absente de Mongo après round-trip, rollback",
        { userId, listId: listMemory._id.toString() },
      );
      return res.status(503).json({
        error: "La persistance de la liste n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    listsLogger.info("Liste créée avec succès", {
      userId,
      listId: listMemory._id.toString(),
      action: "create_list",
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "list",
      "created",
      listMemory._id.toString(),
      listMemory,
      getOriginDeviceId(req),
    );

    res.status(201).json({
      message: "Liste créée avec succès",
      listId: listMemory._id,
      persisted: true,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur création liste", {
      error: getErrorMessage(error),
    });
    res
      .status(500)
      .json({ success: false, error: "Une erreur interne est survenue" });
  }
}

export async function handleGetAllLists(req: Request, res: Response) {
  try {
    const userId = req.user?.id; // Récupération de l'ID utilisateur depuis le middleware d'authentification

    if (!userId) {
      return res
        .status(400)
        .json({ error: "L'identifiant utilisateur est requis" });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    const allLists = memoryStorage.getAllLists(userId);
    const total = allLists ? allLists.length : 0;

    // Retourner un tableau vide si aucune liste trouvée (pas une erreur 404)
    if (!allLists || allLists.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // Appliquer la pagination
    const lists = allLists.slice(offset, offset + limit);

    listsLogger.debug("Listes récupérées avec succès", {
      userId,
      count: lists.length,
      total,
      action: "read_lists",
    });

    res.status(200).json({
      data: lists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération listes", {
      error: getErrorMessage(error),
    });
    res
      .status(500)
      .json({ success: false, error: "Une erreur interne est survenue" });
  }
}

export async function handleGetListById(req: Request, res: Response) {
  try {
    const userId = req.user?.id; // Récupération de l'ID utilisateur depuis le middleware d'authentification
    const listId = req.params.id;

    if (!userId || !listId) {
      return res.status(400).json({
        error:
          "L'identifiant utilisateur et l'identifiant de la liste sont requis",
      });
    }

    const list = memoryStorage.getListById(userId, listId);

    if (!list) {
      return res.status(404).json({ message: "Liste non trouvée" });
    }

    res.status(200).json(list);
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération liste", {
      error: getErrorMessage(error),
    });
    res
      .status(500)
      .json({ success: false, error: "Une erreur interne est survenue" });
  }
}

export async function handleDeleteList(req: Request, res: Response) {
  try {
    const userId = req.user?.id; // Récupération de l'ID utilisateur depuis le middleware d'authentification
    const listId = req.params.id;

    if (!userId || !listId) {
      return res.status(400).json({
        error:
          "L'identifiant utilisateur et l'identifiant de la liste sont requis",
      });
    }

    // Snapshot avant suppression pour rollback éventuel (cf. fix.md backend #1).
    const listSnapshot = memoryStorage.getListById(userId, listId);

    const deleted = memoryStorage.deleteList(userId, listId);

    if (!deleted) {
      return res.status(404).json({ message: "Liste non trouvée" });
    }

    // Forcer la synchronisation de la mémoire vers la BDD et attendre le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : remettre la liste en mémoire pour éviter un état zombie.
      if (listSnapshot) {
        memoryStorage.storeList(userId, listSnapshot as any);
      }
      listsLogger.error("Sync Mongo échouée, rollback de la suppression de liste", {
        userId,
        listId,
        error: syncResult.error,
      });
      return res.status(503).json({
        error: "La suppression de la liste n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    // Round-trip : vérifier que la liste a bien été retirée de Mongo.
    const stillInDb = await ListModel.findById(listId).select("_id").lean();
    if (stillInDb) {
      if (listSnapshot) {
        memoryStorage.storeList(userId, listSnapshot as any);
      }
      listsLogger.error(
        "Sync OK mais liste toujours présente en Mongo, rollback",
        { userId, listId },
      );
      return res.status(503).json({
        error: "La suppression de la liste n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    listsLogger.info("Liste supprimée avec succès", {
      userId,
      listId,
      action: "delete_list",
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "list",
      "deleted",
      listId,
      { _id: listId },
      getOriginDeviceId(req),
    );

    res.status(200).json({ message: "Liste supprimée avec succès", persisted: true });
  } catch (error: unknown) {
    listsLogger.error("Erreur suppression liste", {
      error: getErrorMessage(error),
    });
    res
      .status(500)
      .json({ success: false, error: "Une erreur interne est survenue" });
  }
}

export async function handleUpdateList(req: Request, res: Response) {
  try {
    const userId = req.user?.id; // Récupération de l'ID utilisateur depuis le middleware d'authentification
    const listId = req.params.id;
    const { name, description, points, color, icon } = req.body;

    if (!userId || !listId) {
      return res.status(400).json({
        error:
          "L'identifiant utilisateur et l'identifiant de la liste sont requis",
      });
    }

    // Snapshot avant mutation pour rollback éventuel (cf. fix.md backend #1).
    const listSnapshot = memoryStorage.getListById(userId, listId);

    // §P2 §4.2.2 — Optimistic concurrency control
    if (typeof req.body.version === "number" && listSnapshot) {
      const serverVersion = (listSnapshot as any).version || 0;
      if (req.body.version < serverVersion) {
        return res.status(409).json({
          message:
            "Cette liste a été modifiée entre-temps. Veuillez recharger.",
          code: "VERSION_CONFLICT",
          clientVersion: req.body.version,
          serverVersion,
        });
      }
    }

    const updatedList = memoryStorage.updateList(userId, listId, {
      name,
      description,
      points,
      color,
      icon,
      // §P2 §4.2.2 — Incrément version pour le prochain check optimistic concurrency
      version: ((listSnapshot as any)?.version || 0) + 1,
    } as any);

    if (!updatedList) {
      return res.status(404).json({ message: "Liste non trouvée" });
    }

    // Forcer la synchronisation de la mémoire vers la BDD et attendre le résultat
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      // Rollback : restaurer le snapshot d'avant mutation.
      if (listSnapshot) {
        memoryStorage.storeList(userId, listSnapshot as any);
      }
      listsLogger.error("Sync Mongo échouée, rollback de la mise à jour de liste", {
        userId,
        listId,
        error: syncResult.error,
      });
      return res.status(503).json({
        error: "La mise à jour de la liste n'a pas pu être confirmée. Veuillez réessayer.",
        persisted: false,
      });
    }

    listsLogger.info("Liste mise à jour avec succès", {
      userId,
      listId,
      action: "update_list",
      fieldsUpdated: Object.keys(req.body).filter((k) =>
        ["name", "description", "points", "color", "icon"].includes(k),
      ),
    });

    // 2026-05-04 §4.2: sync_update multi-device
    webSocketService.broadcastSyncUpdate(
      userId,
      "list",
      "updated",
      listId,
      updatedList,
      getOriginDeviceId(req),
    );

    res
      .status(200)
      .json({ message: "Liste mise à jour avec succès", updatedList });
  } catch (error: unknown) {
    listsLogger.error("Erreur mise à jour liste", {
      error: getErrorMessage(error),
    });
    res
      .status(500)
      .json({ success: false, error: "Une erreur interne est survenue" });
  }
}

export async function handleGetListByUserId(req: Request, res: Response) {
  try {
    const currentUserId = req.user?.id; // Utilisateur actuel
    const targetUserId = req.params.userId; // Utilisateur cible

    if (!currentUserId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant utilisateur est requis",
      });
    }

    // Seul un administrateur ou l'utilisateur lui-même peut voir ses listes
    if (currentUserId !== targetUserId) {
      const user = await UserModel.findOne({
        _id: currentUserId,
        is_admin: true,
      });
      if (!user) {
        return res.status(403).json({
          success: false,
          message:
            "Accès refusé. Vous ne pouvez consulter que vos propres listes.",
        });
      }
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    const allLists = memoryStorage.getAllLists(targetUserId);
    const total = allLists.length;

    // Appliquer la pagination
    const lists = allLists.slice(offset, offset + limit);

    res.status(200).json({
      success: true,
      message: `${lists.length} listes récupérées sur ${total}`,
      data: lists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération listes utilisateur", {
      userId: req.params.userId,
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des listes",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Ajoute un point à une liste (VERSION OPTIMISÉE - pas de sync immédiate)
 */
export async function handleAddPointToList(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { listId, pointId } = req.params;

    if (!userId || !listId || !pointId) {
      return res.status(400).json({
        success: false,
        message: "Les identifiants de liste et de point sont requis",
      });
    }

    // Vérifier que le point existe
    const point = memoryStorage.getPointById(userId, pointId);
    if (!point) {
      return res.status(404).json({
        success: false,
        message: "Le point spécifié n'existe pas",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    // Ajouter le point à la liste
    const result = memoryStorage.addPointToList(userId, listId, pointId);

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Le point est déjà dans la liste ou l'ajout a échoué",
      });
    }

    // ⚡ OPTIMISATION: Pas de synchronisation immédiate
    // Les données seront synchronisées lors du logout ou périodiquement

    listsLogger.info("Point ajouté à la liste avec succès", {
      userId,
      listId,
      pointId,
      action: "add_point_to_list",
    });

    res.status(200).json({
      success: true,
      message: "Point ajouté à la liste avec succès",
      listId,
      pointId,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur ajout point liste", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'ajout du point à la liste",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Retire un point d'une liste (VERSION OPTIMISÉE - pas de sync immédiate)
 */
export async function handleRemovePointFromList(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { listId, pointId } = req.params;

    if (!userId || !listId || !pointId) {
      return res.status(400).json({
        success: false,
        message: "Les identifiants de liste et de point sont requis",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    // Retirer le point de la liste
    const result = memoryStorage.removePointFromList(userId, listId, pointId);

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Le point n'est pas dans la liste ou la suppression a échoué",
      });
    }

    // ⚡ OPTIMISATION: Pas de synchronisation immédiate
    // Les données seront synchronisées lors du logout ou périodiquement

    listsLogger.info("Point retiré de la liste avec succès", {
      userId,
      listId,
      pointId,
      action: "remove_point_from_list",
    });

    res.status(200).json({
      success: true,
      message: "Point retiré de la liste avec succès",
      listId,
      pointId,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur retrait point liste", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors du retrait du point de la liste",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère tous les points d'une liste
 */
export async function handleGetPointsByListId(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { listId } = req.params;

    if (!userId || !listId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de la liste est requis",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    // Récupérer tous les points de la liste
    const allPoints = memoryStorage.getPointsByListId(userId, listId);
    const total = allPoints.length;

    // Appliquer la pagination
    const points = allPoints.slice(offset, offset + limit);

    res.status(200).json({
      success: true,
      message: `${points.length} points récupérés sur ${total}`,
      data: points,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération points liste", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des points de la liste",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère toutes les listes contenant un point spécifique
 */
export async function handleGetListsByPointId(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { pointId } = req.params;

    if (!userId || !pointId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant du point est requis",
      });
    }

    // Vérifier que le point existe
    const point = memoryStorage.getPointById(userId, pointId);
    if (!point) {
      return res.status(404).json({
        success: false,
        message: "Le point spécifié n'existe pas",
      });
    }

    // SÉCURITÉ: Pagination avec limite max pour protection DoS
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    ); // Max 200
    const offset = (page - 1) * limit;

    // Récupérer toutes les listes contenant ce point
    const allLists = memoryStorage.getListsByPointId(userId, pointId);
    const total = allLists.length;

    // Appliquer la pagination
    const lists = allLists.slice(offset, offset + limit);

    res.status(200).json({
      success: true,
      message: `${lists.length} listes contiennent ce point sur ${total}`,
      data: lists,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération listes par point", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des listes contenant le point",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Met à jour l'ordre des points dans une liste
 */
export async function handleUpdateListPointsOrder(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { listId } = req.params;
    const { pointIds } = req.body;

    if (!userId || !listId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de la liste est requis",
      });
    }

    if (!Array.isArray(pointIds)) {
      return res.status(400).json({
        success: false,
        message: "La liste des identifiants de points doit être un tableau",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    // Mettre à jour l'ordre des points
    const result = memoryStorage.updateListPointsOrder(
      userId,
      listId,
      pointIds,
    );

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "La mise à jour de l'ordre des points a échoué",
      });
    }

    // Synchroniser avec la BDD
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        success: false,
        message:
          "L'ordre des points a été mis à jour en mémoire mais n'a pas pu être synchronisé avec la base de données",
        error: syncResult.error,
        syncFailed: true,
      });
    }

    listsLogger.info("Ordre des points mis à jour avec succès", {
      userId,
      listId,
      pointsCount: pointIds.length,
      action: "update_list_points_order",
    });

    res.status(200).json({
      success: true,
      message: "Ordre des points mis à jour avec succès",
      listId,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur mise à jour ordre points", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour de l'ordre des points",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère toutes les listes (administration)
 */
export async function handleGetAllListsAdmin(req: Request, res: Response) {
  try {
    // La vérification des droits admin est déjà faite dans le middleware

    // Récupération des utilisateurs avec leurs données
    const users = await UserModel.find({}, "_id username email");

    const allUsersLists = [];

    for (const user of users) {
      try {
        // Vérifier si l'utilisateur a une session active
        if (memoryStorage.hasSession(user.id.toString())) {
          const lists = memoryStorage.getAllLists(user.id.toString());

          if (lists && lists.length > 0) {
            allUsersLists.push({
              user: {
                _id: user._id,
                username: user.name,
                email: user.email,
              },
              lists: lists,
            });
          }
        } else {
          // Si l'utilisateur n'a pas de session active, on récupère ses listes directement depuis la BDD
          const lists = await ListModel.find({ userId: user._id });

          // Note: ces listes sont chiffrées et ne peuvent pas être déchiffrées sans la clé de l'utilisateur
          if (lists && lists.length > 0) {
            allUsersLists.push({
              user: {
                _id: user._id,
                username: user.name,
                email: user.email,
              },
              lists: lists.map((list) => ({
                ...list.toObject(),
                encrypted: true,
                name: "Liste chiffrée (déchiffrement impossible)",
                description: "Contenu chiffré",
              })),
            });
          }
        }
      } catch (userError) {
        listsLogger.error("Erreur récupération listes utilisateur", {
          userId: user._id,
          error: userError,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Listes récupérées pour ${allUsersLists.length} utilisateurs`,
      usersWithLists: allUsersLists,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur récupération listes admin", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des listes",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * ⚡ NOUVELLE FONCTION: Ajoute plusieurs points à une liste en une seule opération (BATCH)
 */
export async function handleBulkAddPointsToList(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { listId } = req.params;
    const { pointIds } = req.body;

    if (!userId || !listId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de la liste est requis",
      });
    }

    if (!Array.isArray(pointIds) || pointIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "La liste des identifiants de points doit être un tableau non vide",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    const results = {
      added: [] as string[],
      alreadyInList: [] as string[],
      notFound: [] as string[],
    };

    // Ajouter tous les points en une seule opération
    for (const pointId of pointIds) {
      // Vérifier que le point existe
      const point = memoryStorage.getPointById(userId, pointId);
      if (!point) {
        results.notFound.push(pointId);
        continue;
      }

      // Ajouter le point
      const added = memoryStorage.addPointToList(userId, listId, pointId);
      if (added) {
        results.added.push(pointId);
      } else {
        results.alreadyInList.push(pointId);
      }
    }

    res.status(200).json({
      success: true,
      message: `${results.added.length} points ajoutés, ${results.alreadyInList.length} déjà présents, ${results.notFound.length} non trouvés`,
      results,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur ajout batch points", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'ajout en batch de points",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * ⚡ NOUVELLE FONCTION: Retire plusieurs points d'une liste en une seule opération (BATCH)
 */
export async function handleBulkRemovePointsFromList(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.id;
    const { listId } = req.params;
    const { pointIds } = req.body;

    if (!userId || !listId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de la liste est requis",
      });
    }

    if (!Array.isArray(pointIds) || pointIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "La liste des identifiants de points doit être un tableau non vide",
      });
    }

    // Vérifier que la liste existe
    const list = memoryStorage.getListById(userId, listId);
    if (!list) {
      return res.status(404).json({
        success: false,
        message: "La liste spécifiée n'existe pas",
      });
    }

    const results = {
      removed: [] as string[],
      notInList: [] as string[],
    };

    // Retirer tous les points en une seule opération
    for (const pointId of pointIds) {
      const removed = memoryStorage.removePointFromList(
        userId,
        listId,
        pointId,
      );
      if (removed) {
        results.removed.push(pointId);
      } else {
        results.notInList.push(pointId);
      }
    }

    res.status(200).json({
      success: true,
      message: `${results.removed.length} points retirés, ${results.notInList.length} n'étaient pas dans la liste`,
      results,
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur retrait batch points", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors du retrait en batch de points",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * ⚡ NOUVELLE FONCTION: Force la synchronisation manuelle
 */
export async function handleSyncListData(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant utilisateur est requis",
      });
    }

    // Forcer la synchronisation
    const syncResult = await syncService.syncNow(userId);

    if (!syncResult.success) {
      return res.status(500).json({
        success: false,
        message: "Échec de la synchronisation",
        error: syncResult.error,
      });
    }

    res.status(200).json({
      success: true,
      message: "Données synchronisées avec succès",
    });
  } catch (error: unknown) {
    listsLogger.error("Erreur synchronisation manuelle", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la synchronisation",
      error: "Une erreur interne est survenue",
    });
  }
}
