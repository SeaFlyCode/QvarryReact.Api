import express from "express";
import {
  handleCreatePoint,
  handleGetAllPointsByUserId,
  handleSearchPoints,
  handleGetPointById,
  handleDeletePoint,
  handleUpdatePoint,
} from "../controllers/pointsControllers";
import {
  uploadPointPhoto,
  getPointPhoto,
  deletePointPhoto,
  getUserStorageInfo,
  getUserPhotos,
} from "../controllers/pointsPhotosController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  upload,
  validateImageUpload,
  uploadRateLimit,
} from "../middlewares/imageUploadMiddleware";
import { checkStorageQuota } from "../middlewares/storageQuotaMiddleware";

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
router.get("/:id", authMiddleware, validateObjectId("id"), handleGetPointById);

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
router.delete(
  "/:id",
  authMiddleware,
  validateObjectId("id"),
  handleDeletePoint,
);

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
router.put("/:id", authMiddleware, validateObjectId("id"), handleUpdatePoint);

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES PHOTOS DE POINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /points/{pointId}/photo:
 *   post:
 *     summary: Upload ou remplace la photo d'un point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: pointId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Photo uploadée avec succès
 *       404:
 *         description: Point non trouvé
 *       507:
 *         description: Quota de stockage dépassé
 */
router.post(
  "/:pointId/photo",
  authMiddleware,
  uploadRateLimit,
  upload.single("photo"),
  validateImageUpload,
  checkStorageQuota,
  uploadPointPhoto,
);

/**
 * @swagger
 * /points/{pointId}/photo:
 *   get:
 *     summary: Récupère la photo d'un point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: pointId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     responses:
 *       200:
 *         description: Photo du point
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Photo non trouvée
 */
router.get("/:pointId/photo", authMiddleware, getPointPhoto);

/**
 * @swagger
 * /points/{pointId}/photo:
 *   delete:
 *     summary: Supprime la photo d'un point
 *     tags: [Points]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: pointId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID du point
 *     responses:
 *       200:
 *         description: Photo supprimée
 *       404:
 *         description: Photo non trouvée
 */
router.delete("/:pointId/photo", authMiddleware, deletePointPhoto);

// ═══════════════════════════════════════════════════════════════════════════
// INFORMATIONS DE STOCKAGE UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /user/storage:
 *   get:
 *     summary: Récupère les informations de stockage de l'utilisateur
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Informations de stockage
 */
router.get("/user/storage", authMiddleware, getUserStorageInfo);

/**
 * @swagger
 * /user/photos:
 *   get:
 *     summary: Récupère toutes les photos de tous les points de l'utilisateur
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste de toutes les photos avec métadonnées
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 photos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       pointId:
 *                         type: string
 *                       pointName:
 *                         type: string
 *                       photoPath:
 *                         type: string
 *                       photoUrl:
 *                         type: string
 *                       size:
 *                         type: number
 *                       uploadedAt:
 *                         type: string
 *                         format: date-time
 *                       hasPhoto:
 *                         type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *       401:
 *         description: Non authentifié
 */
router.get("/user/photos", authMiddleware, getUserPhotos);

export default router;
