// ═══════════════════════════════════════════════════════════════════════════
// ROUTES — DONNÉES SPÉLÉO PAR BBOX
// ═══════════════════════════════════════════════════════════════════════════
// Monté sur "/api/v1" (server.ts) :
//   GET /api/v1/speleo?bbox=...&zoom=...&layers=...
//
// Auth JWT obligatoire (authMiddleware). Rate-limit : highTrafficLimiter,
// cohérent avec les autres routes de lecture carte (server.ts applique déjà
// highTrafficLimiter sur le préfixe /api/v1/speleo).
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { handleGetSpeleo } from "../controllers/speleoControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

/**
 * @swagger
 * /speleo:
 *   get:
 *     summary: Données spéléo (cavités + zonages) pour la bbox visible
 *     description: >
 *       Proxy + cache des API publiques Géorisques (cavités BD Cavités / BRGM) et
 *       WFS IGN Géoplateforme (zonages réglementaires SIC/ZPS/APB/ZNIEFF1). Permet
 *       l'affichage national sans embarquer les données. Si zoom < 8, renvoie
 *       `zoomTooLow: true` et des couches vides (évite de charger la France entière).
 *     tags: [Speleo]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: bbox
 *         required: true
 *         schema:
 *           type: string
 *         description: "minLon,minLat,maxLon,maxLat (EPSG:4326, ordre lon,lat)"
 *       - in: query
 *         name: zoom
 *         required: true
 *         schema:
 *           type: integer
 *         description: Niveau de zoom Leaflet
 *       - in: query
 *         name: layers
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           Liste CSV, sous-ensemble de cavites,sic,zps,apb,znieff1
 *           (défaut : toutes les couches)
 *     responses:
 *       200:
 *         description: FeatureCollections cavités + zonages (ou couches vides si zoomTooLow)
 *       400:
 *         description: Paramètre bbox / zoom / layers invalide
 *       401:
 *         description: Non authentifié
 */
router.get("/speleo", authMiddleware, handleGetSpeleo);

export default router;
