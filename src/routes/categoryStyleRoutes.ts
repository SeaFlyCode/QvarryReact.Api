import express from "express";
import {
  listCategoryStyles,
  upsertCategoryStyle,
  deleteCategoryStyle,
} from "../controllers/categoryStyleControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

// Toutes les routes sont protégées par authentification.
router.use(authMiddleware);

/**
 * @swagger
 * /category-styles:
 *   get:
 *     summary: Liste les personnalisations visuelles par type de cavité
 *     tags: [CategoryStyles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des styles personnalisés
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   type: { type: string }
 *                   color: { type: string }
 *                   icon: { type: string }
 *       401: { description: Non authentifié }
 */
router.get("/", listCategoryStyles);

/**
 * @swagger
 * /category-styles/{type}:
 *   put:
 *     summary: Crée ou met à jour la couleur/icône d'un type de cavité
 *     tags: [CategoryStyles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [color, icon]
 *             properties:
 *               color: { type: string }
 *               icon: { type: string }
 *     responses:
 *       200: { description: Style enregistré }
 *       400: { description: Validation échouée }
 *       401: { description: Non authentifié }
 *   delete:
 *     summary: Réinitialise la personnalisation d'un type (couleur, icône)
 *     tags: [CategoryStyles]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Personnalisation supprimée }
 *       401: { description: Non authentifié }
 */
router.put("/:type", upsertCategoryStyle);
router.delete("/:type", deleteCategoryStyle);

export default router;
