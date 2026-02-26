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

// Routes protégées (avec authentification ET validation)
router.get("/", authMiddleware, handleGetAllFiches);
router.get(
  "/user/:userId",
  authMiddleware,
  validateObjectId("userId"),
  handleGetUserFiches,
);
router.post("/", authMiddleware, validateFiche, handleCreateFiche);

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
