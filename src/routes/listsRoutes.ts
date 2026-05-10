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

/**
 * @swagger
 * /lists:
 *   get:
 *     summary: Liste toutes les listes de l'utilisateur connecté
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Liste paginée }
 *       401: { description: Non authentifié }
 *   post:
 *     summary: Crée une nouvelle liste
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-device-id
 *         schema: { type: string }
 *         description: deviceId origine (filtré dans broadcasts sync_update)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, maxLength: 200 }
 *               description: { type: string, maxLength: 1000 }
 *               color: { type: string }
 *               icon: { type: string }
 *               points: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Liste créée }
 *       400: { description: Validation échouée }
 *       401: { description: Non authentifié }
 *
 * /lists/{id}:
 *   get:
 *     summary: Récupère une liste par ID
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste }
 *       404: { description: Liste non trouvée }
 *   put:
 *     summary: Met à jour une liste
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: x-device-id
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               version: { type: integer, description: §V9 Optimistic concurrency }
 *     responses:
 *       200: { description: Liste mise à jour }
 *       404: { description: Liste non trouvée }
 *       409: { description: VERSION_CONFLICT }
 *   delete:
 *     summary: Supprime une liste (soft-delete)
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste supprimée }
 *       404: { description: Liste non trouvée }
 *
 * /lists/{listId}/points/{pointId}:
 *   post:
 *     summary: Ajoute un point à une liste
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: pointId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Point ajouté }
 *       404: { description: Liste ou point non trouvé }
 *   delete:
 *     summary: Retire un point d'une liste
 *     tags: [Lists]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: pointId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Point retiré }
 */
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
