// MED-08 FIX: Routes de maintenance refactorisées avec controller dédié
import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { getMaintenanceStatus } from "../middlewares/maintenanceMiddleware";
import {
  activateMaintenance,
  deactivateMaintenance,
  updateMaintenanceMessage,
} from "../controllers/maintenanceController";

const router = Router();

/**
 * @swagger
 * /maintenance/status:
 *   get:
 *     summary: Statut maintenance (public)
 *     description: |
 *       Endpoint public consulté par tous les clients au boot pour afficher
 *       une bannière maintenance ou bloquer l'usage de l'app.
 *     tags: [Maintenance]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isActive: { type: boolean }
 *                 message: { type: string }
 *                 estimatedEndTime: { type: string, format: date-time, nullable: true }
 *
 * /maintenance/activate:
 *   post:
 *     summary: Active le mode maintenance (admin)
 *     description: |
 *       Affiche la bannière maintenance sur web + mobile. Les requêtes sont
 *       bloquées par maintenanceMiddleware sauf /maintenance/* et /admin/*.
 *     tags: [Maintenance, Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message: { type: string }
 *               estimatedEndTime: { type: string, format: date-time }
 *     responses: { 200: { description: Activé } }
 *
 * /maintenance/deactivate:
 *   post:
 *     summary: Désactive le mode maintenance (admin)
 *     tags: [Maintenance, Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Désactivé } }
 *
 * /maintenance/message:
 *   put:
 *     summary: Update message maintenance (admin)
 *     tags: [Maintenance, Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *               estimatedEndTime: { type: string, format: date-time }
 *     responses: { 200: { description: Message mis à jour } }
 */
// ═══════════════════════════════════════════════════════════════════════════
// ROUTE PUBLIQUE - Statut de maintenance
// ═══════════════════════════════════════════════════════════════════════════
router.get("/status", getMaintenanceStatus);

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES ADMIN - Gestion de la maintenance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Activer le mode maintenance
 * POST /api/maintenance/activate
 * Body: { message?: string, estimatedEndTime?: Date }
 */
router.post("/activate", authMiddleware, adminMiddleware, activateMaintenance);

/**
 * Désactiver le mode maintenance
 * POST /api/maintenance/deactivate
 */
router.post(
  "/deactivate",
  authMiddleware,
  adminMiddleware,
  deactivateMaintenance,
);

/**
 * Mettre à jour le message de maintenance
 * PUT /api/maintenance/message
 * Body: { message: string, estimatedEndTime?: Date }
 */
router.put(
  "/message",
  authMiddleware,
  adminMiddleware,
  updateMaintenanceMessage,
);

export default router;
