// server/src/routes/maintenanceRoutes.ts
import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { adminMiddleware } from "../middlewares/adminMiddleware";
import { getMaintenanceStatus } from "../middlewares/maintenanceMiddleware";
import MaintenanceModel from "../models/maintenance";
import { Request, Response } from "express";
import { Types } from "mongoose";

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
router.post("/activate", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
        let userId: string | undefined;
        if (req.user && typeof req.user === 'object' && 'id' in req.user) {
            userId = (req.user as any).id;
        }

        const { message, estimatedEndTime } = req.body;

        // Récupérer ou créer l'entrée de maintenance
        let maintenance = await MaintenanceModel.findOne();

        if (!maintenance) {
            maintenance = new MaintenanceModel({
                isActive: true,
                message: message || "Le site est actuellement en maintenance. Nous serons bientôt de retour.",
                activatedBy: userId ? new Types.ObjectId(userId) : undefined,
                activatedAt: new Date(),
                estimatedEndTime: estimatedEndTime ? new Date(estimatedEndTime) : undefined
            });
        } else {
            maintenance.isActive = true;
            maintenance.message = message || maintenance.message;
            maintenance.activatedBy = userId ? new Types.ObjectId(userId) : maintenance.activatedBy;
            maintenance.activatedAt = new Date();
            maintenance.estimatedEndTime = estimatedEndTime ? new Date(estimatedEndTime) : maintenance.estimatedEndTime;
        }

        await maintenance.save();

        console.log(`🔧 [MAINTENANCE] Mode maintenance ACTIVÉ par admin ${userId}`);

        res.json({
            success: true,
            message: "Mode maintenance activé",
            maintenance: {
                isActive: maintenance.isActive,
                message: maintenance.message,
                estimatedEndTime: maintenance.estimatedEndTime
            }
        });
    } catch (error) {
        console.error('[MAINTENANCE] Erreur activation:', error);
        res.status(500).json({ error: "Erreur lors de l'activation du mode maintenance" });
    }
});

/**
 * Désactiver le mode maintenance
 * POST /api/maintenance/deactivate
 */
router.post("/deactivate", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
        let userId: string | undefined;
        if (req.user && typeof req.user === 'object' && 'id' in req.user) {
            userId = (req.user as any).id;
        }

        const maintenance = await MaintenanceModel.findOne();

        if (maintenance) {
            maintenance.isActive = false;
            maintenance.deactivatedAt = new Date();
            await maintenance.save();
        }

        console.log(`✅ [MAINTENANCE] Mode maintenance DÉSACTIVÉ par admin ${userId}`);

        res.json({
            success: true,
            message: "Mode maintenance désactivé"
        });
    } catch (error) {
        console.error('[MAINTENANCE] Erreur désactivation:', error);
        res.status(500).json({ error: "Erreur lors de la désactivation du mode maintenance" });
    }
});

/**
 * Mettre à jour le message de maintenance
 * PUT /api/maintenance/message
 * Body: { message: string, estimatedEndTime?: Date }
 */
router.put("/message", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
        const { message, estimatedEndTime } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message requis" });
        }

        let maintenance = await MaintenanceModel.findOne();

        if (!maintenance) {
            maintenance = new MaintenanceModel({
                isActive: false,
                message,
                estimatedEndTime: estimatedEndTime ? new Date(estimatedEndTime) : undefined
            });
        } else {
            maintenance.message = message;
            if (estimatedEndTime !== undefined) {
                maintenance.estimatedEndTime = estimatedEndTime ? new Date(estimatedEndTime) : undefined;
            }
        }

        await maintenance.save();

        res.json({
            success: true,
            message: "Message de maintenance mis à jour"
        });
    } catch (error) {
        console.error('[MAINTENANCE] Erreur mise à jour message:', error);
        res.status(500).json({ error: "Erreur lors de la mise à jour du message" });
    }
});

export default router;
