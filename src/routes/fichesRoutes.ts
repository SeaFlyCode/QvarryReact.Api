import express from "express";
import {
  handleCreateFiche,
  handleGetAllFiches,
  handleGetFicheById,
  handleDeleteFiche,
  handleUpdateFiche,
  handleGetFicheByPointId,
  handleGetUserFiches,
  handleAddPointToFiche,
  handleRemovePointFromFiche,
  handleGetPointsByFicheId,
  handleSearchFiches,
} from "../controllers/fichesControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import { validateFiche } from "../services/validationService"; // Importe le middleware de validation

const router = express.Router();

// IMPORTANT: Les routes spécifiques doivent être AVANT les routes avec paramètres dynamiques (:id)
// Sinon Express interprète "search" comme un ID de fiche

// Recherche avancée de fiches (avec filtres et rayon) - DOIT ÊTRE AVANT /:id
router.get("/search", authMiddleware, handleSearchFiches);

// Routes pour la gestion des points dans les fiches - AVANT /:id
router.post("/add", authMiddleware, handleAddPointToFiche);
router.post("/remove", authMiddleware, handleRemovePointFromFiche);
router.get(
  "/fiche/:ficheId",
  authMiddleware,
  validateObjectId("ficheId"),
  handleGetPointsByFicheId,
);
router.get(
  "/by-point/:pointId",
  authMiddleware,
  validateObjectId("pointId"),
  handleGetFicheByPointId,
);

/**
 * @swagger
 * /fiches:
 *   get:
 *     summary: Liste toutes les fiches de l'utilisateur connecté
 *     tags: [Fiches]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des fiches (déchiffrées + paginées)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Fiche'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *       401:
 *         description: Non authentifié
 */
// Routes protégées (avec authentification ET validation)
router.get("/", authMiddleware, handleGetAllFiches);
router.get(
  "/user/:userId",
  authMiddleware,
  validateObjectId("userId"),
  handleGetUserFiches,
);
/**
 * @swagger
 * /fiches:
 *   post:
 *     summary: Crée une nouvelle fiche
 *     tags: [Fiches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-device-id
 *         schema: { type: string }
 *         description: deviceId origine (filtré dans broadcasts sync_update WS)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, etat, difficulte_acces, risque_oxygene, acces_souterrain, praticite_souterrain, etat_general]
 *             properties:
 *               name: { type: string, maxLength: 1000 }
 *               ville: { type: string, maxLength: 100 }
 *               type: { type: string, enum: [Grotte, Mine, Aven, Doline, Carrière, Tunnel, Autre] }
 *               etat: { type: string, enum: [Ouvert, Fermé, Restreint] }
 *               difficulte_acces: { type: string }
 *               risque_oxygene: { type: string }
 *               acces_souterrain: { type: string }
 *               praticite_souterrain:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items: { type: string }
 *                 description: Union single | array (V9 fix syncService accepte les 2 formats)
 *               etat_general: { type: string }
 *               equipement_conseille: { type: array, items: { type: string } }
 *               surface: { type: array, items: { type: string } }
 *               type_galeries: { type: array, items: { type: string } }
 *               points_ids: { type: array, items: { type: string } }
 *               center_cavite:
 *                 type: object
 *                 properties:
 *                   type: { type: string, enum: [Point] }
 *                   coordinates: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
 *     responses:
 *       201:
 *         description: Fiche créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 ficheId: { type: string }
 *                 persisted: { type: boolean }
 *       400: { description: Validation échouée }
 *       401: { description: Non authentifié }
 *       503: { description: Sync DB échouée (rollback mémoire) }
 */
router.post("/", authMiddleware, validateFiche, handleCreateFiche);

/**
 * @swagger
 * /fiches/{id}:
 *   get:
 *     summary: Récupère une fiche par ID
 *     tags: [Fiches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Fiche }
 *       404: { description: Fiche non trouvée }
 *   put:
 *     summary: Met à jour une fiche
 *     tags: [Fiches]
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
 *               version:
 *                 type: integer
 *                 description: §V9 Optimistic concurrency. Si < serverVersion → 409 VERSION_CONFLICT.
 *     responses:
 *       200: { description: Fiche mise à jour }
 *       404: { description: Fiche non trouvée }
 *       409:
 *         description: Conflit de version (modif concurrente détectée)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string, example: VERSION_CONFLICT }
 *                 clientVersion: { type: integer }
 *                 serverVersion: { type: integer }
 *   delete:
 *     summary: Supprime une fiche (soft-delete)
 *     tags: [Fiches]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Fiche supprimée }
 *       404: { description: Fiche non trouvée }
 */
// Routes avec :id - DOIVENT ÊTRE EN DERNIER pour éviter les conflits
router.get("/:id", authMiddleware, validateObjectId("id"), handleGetFicheById);
router.put(
  "/:id",
  authMiddleware,
  validateObjectId("id"),
  validateFiche,
  handleUpdateFiche,
);
router.delete(
  "/:id",
  authMiddleware,
  validateObjectId("id"),
  handleDeleteFiche,
);

export default router;
