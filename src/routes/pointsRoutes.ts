import express from "express";
import {
  handleCreatePoint,
  handleGetAllPointsByUserId,
  handleSearchPoints,
  handleGetPointById,
  handleDeletePoint,
  handleUpdatePoint,
} from "../controllers/pointsControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Point:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         userId:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         latitude:
 *           type: number
 *         longitude:
 *           type: number
 *         type:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /points:
 *   post:
 *     summary: Créer un nouveau point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - latitude
 *               - longitude
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               type:
 *                 type: string
 *     responses:
 *       201:
 *         description: Point créé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Point'
 *       401:
 *         description: Non authentifié
 */
router.post("/", authMiddleware, handleCreatePoint);

/**
 * @swagger
 * /points/search:
 *   get:
 *     summary: Rechercher des points
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Terme de recherche
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filtrer par type
 *     responses:
 *       200:
 *         description: Liste des points correspondants
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Point'
 *       401:
 *         description: Non authentifié
 */
router.get("/search", authMiddleware, handleSearchPoints);

/**
 * @swagger
 * /points:
 *   get:
 *     summary: Récupérer tous les points de l'utilisateur
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des points
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Point'
 *       401:
 *         description: Non authentifié
 */
router.get("/", authMiddleware, handleGetAllPointsByUserId);

/**
 * @swagger
 * /points/{id}:
 *   get:
 *     summary: Récupérer un point par son ID
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     responses:
 *       200:
 *         description: Détails du point
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Point'
 *       404:
 *         description: Point non trouvé
 *       401:
 *         description: Non authentifié
 */
router.get("/:id", authMiddleware, handleGetPointById);

/**
 * @swagger
 * /points/{id}:
 *   delete:
 *     summary: Supprimer un point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     responses:
 *       200:
 *         description: Point supprimé
 *       404:
 *         description: Point non trouvé
 *       401:
 *         description: Non authentifié
 */
router.delete("/:id", authMiddleware, handleDeletePoint);

/**
 * @swagger
 * /points/{id}:
 *   put:
 *     summary: Mettre à jour un point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               type:
 *                 type: string
 *     responses:
 *       200:
 *         description: Point mis à jour
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Point'
 *       404:
 *         description: Point non trouvé
 *       401:
 *         description: Non authentifié
 */
router.put("/:id", authMiddleware, handleUpdatePoint);

export default router;
