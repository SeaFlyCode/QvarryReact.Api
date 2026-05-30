// ═══════════════════════════════════════════════════════════════════════════
// ROUTES — INDICATEUR DE RISQUE HYDRO
// ═══════════════════════════════════════════════════════════════════════════
// Monté sur "/api/v1" (server.ts) pour couvrir les deux chemins du contrat :
//   GET /api/v1/points/:id/hydro-risk
//   GET /api/v1/hydro-risk/batch?pointIds=a,b,c
//
// Auth JWT obligatoire (authMiddleware). Rate-limit : highTrafficLimiter,
// cohérent avec les autres routes de lecture liées aux points (server.ts
// applique déjà highTrafficLimiter sur /api/v1/points ; on l'ajoute ici aussi
// pour le préfixe /api/v1/hydro-risk).
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import {
  handleGetPointHydroRisk,
  handleGetHydroRiskBatch,
} from "../controllers/hydroRiskControllers";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";

const router = express.Router();

/**
 * @swagger
 * /points/{id}/hydro-risk:
 *   get:
 *     summary: Indicateur de conditions hydro pour un point (cavité)
 *     description: >
 *       INDICATEUR (pas une prédiction) de conditions favorisant l'instabilité,
 *       basé sur la pluie antécédente (Open-Meteo) et, en France, les niveaux de
 *       cours d'eau et de nappe (Hub'Eau). Voir le champ `disclaimer`.
 *     tags: [HydroRisk]
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
 *         description: Indicateur calculé
 *       401:
 *         description: Non authentifié
 *       404:
 *         description: Point introuvable ou coordonnées indisponibles
 */
router.get(
  "/points/:id/hydro-risk",
  authMiddleware,
  validateObjectId("id"),
  handleGetPointHydroRisk,
);

/**
 * @swagger
 * /hydro-risk/batch:
 *   get:
 *     summary: Indicateurs hydro pour plusieurs points (max 50)
 *     tags: [HydroRisk]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: pointIds
 *         required: true
 *         schema:
 *           type: string
 *         description: IDs de points séparés par des virgules (max 50)
 *     responses:
 *       200:
 *         description: Résultats + erreurs partielles par point
 *       400:
 *         description: Paramètre manquant ou trop d'identifiants
 *       401:
 *         description: Non authentifié
 */
router.get("/hydro-risk/batch", authMiddleware, handleGetHydroRiskBatch);

export default router;
