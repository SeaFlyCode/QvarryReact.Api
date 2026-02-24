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
