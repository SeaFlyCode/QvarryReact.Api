import express from "express";
import {
  handleCreateList,
  handleGetAllLists,
  handleGetListById,
  handleDeleteList,
  handleUpdateList,
  handleGetListByUserId,
  handleAddPointToList,
  handleRemovePointFromList,
  handleGetPointsByListId,
  handleGetListsByPointId,
  handleBulkAddPointsToList,
  handleBulkRemovePointsFromList,
  handleSyncListData,
} from "../controllers/listsControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = express.Router();

// Routes protégées par authentification
router.use(authMiddleware);

// CRUD de base pour les listes
router.post("/", handleCreateList);
router.get("/", handleGetAllLists);
router.get("/:id", validateObjectId("id"), handleGetListById);
router.delete("/:id", validateObjectId("id"), handleDeleteList);
router.put("/:id", validateObjectId("id"), handleUpdateList);

// Récupérer les listes d'un utilisateur
router.get("/user/:userId", validateObjectId("userId"), handleGetListByUserId);

// ⚡ OPTIMISÉ: Opérations sur les points (sans sync immédiate)
router.post(
  "/:listId/points/:pointId",
  validateObjectId("listId", "pointId"),
  handleAddPointToList,
);
router.delete(
  "/:listId/points/:pointId",
  validateObjectId("listId", "pointId"),
  handleRemovePointFromList,
);

// ⚡ NOUVEAU: Opérations batch
router.post(
  "/:listId/points/bulk/add",
  validateObjectId("listId"),
  handleBulkAddPointsToList,
);
router.post(
  "/:listId/points/bulk/remove",
  validateObjectId("listId"),
  handleBulkRemovePointsFromList,
);

// Récupération de points et listes
router.get(
  "/:listId/points",
  validateObjectId("listId"),
  handleGetPointsByListId,
);
router.get(
  "/points/:pointId/lists",
  validateObjectId("pointId"),
  handleGetListsByPointId,
);

// ⚡ NOUVEAU: Synchronisation manuelle
router.post("/sync", handleSyncListData);

export default router;
