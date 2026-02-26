// MED-08 FIX: Controller dédié pour la maintenance (extrait de maintenanceRoutes.ts)
import { Request, Response } from "express";
import MaintenanceModel from "../models/maintenance";
import { Types } from "mongoose";
import { logger } from "../services/loggerService";

const maintenanceCtrlLogger = logger.child({
  service: "maintenance-controller",
});

/**
 * Activer le mode maintenance
 * POST /api/maintenance/activate
 */
export async function activateMaintenance(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }

    const { message, estimatedEndTime } = req.body;

    // Validation des entrées
    if (message && typeof message !== "string") {
      return res.status(400).json({ error: "Message invalide" });
    }
    if (message && message.length > 1000) {
      return res
        .status(400)
        .json({ error: "Message trop long (max 1000 caractères)" });
    }

    let maintenance = await MaintenanceModel.findOne();

    if (!maintenance) {
      maintenance = new MaintenanceModel({
        isActive: true,
        message:
          message ||
          "Le site est actuellement en maintenance. Nous serons bientôt de retour.",
        activatedBy: userId ? new Types.ObjectId(userId) : undefined,
        activatedAt: new Date(),
        estimatedEndTime: estimatedEndTime
          ? new Date(estimatedEndTime)
          : undefined,
      });
    } else {
      maintenance.isActive = true;
      maintenance.message = message || maintenance.message;
      maintenance.activatedBy = userId
        ? new Types.ObjectId(userId)
        : maintenance.activatedBy;
      maintenance.activatedAt = new Date();
      maintenance.estimatedEndTime = estimatedEndTime
        ? new Date(estimatedEndTime)
        : maintenance.estimatedEndTime;
    }

    await maintenance.save();

    maintenanceCtrlLogger.info("Maintenance mode activated", {
      userId,
      estimatedEndTime: maintenance.estimatedEndTime,
    });

    res.json({
      success: true,
      message: "Mode maintenance activé",
      maintenance: {
        isActive: maintenance.isActive,
        message: maintenance.message,
        estimatedEndTime: maintenance.estimatedEndTime,
      },
    });
  } catch (error) {
    maintenanceCtrlLogger.error("Maintenance activation error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de l'activation du mode maintenance" });
  }
}

/**
 * Désactiver le mode maintenance
 * POST /api/maintenance/deactivate
 */
export async function deactivateMaintenance(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    }

    const maintenance = await MaintenanceModel.findOne();

    if (maintenance) {
      maintenance.isActive = false;
      maintenance.deactivatedAt = new Date();
      await maintenance.save();
    }

    maintenanceCtrlLogger.info("Maintenance mode deactivated", { userId });

    res.json({
      success: true,
      message: "Mode maintenance désactivé",
    });
  } catch (error) {
    maintenanceCtrlLogger.error("Maintenance deactivation error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: "Erreur lors de la désactivation du mode maintenance",
    });
  }
}

/**
 * Mettre à jour le message de maintenance
 * PUT /api/maintenance/message
 */
export async function updateMaintenanceMessage(req: Request, res: Response) {
  try {
    const { message, estimatedEndTime } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message requis" });
    }

    // Validation des entrées
    if (typeof message !== "string") {
      return res.status(400).json({ error: "Message invalide" });
    }
    if (message.length > 1000) {
      return res
        .status(400)
        .json({ error: "Message trop long (max 1000 caractères)" });
    }

    let maintenance = await MaintenanceModel.findOne();

    if (!maintenance) {
      maintenance = new MaintenanceModel({
        isActive: false,
        message,
        estimatedEndTime: estimatedEndTime
          ? new Date(estimatedEndTime)
          : undefined,
      });
    } else {
      maintenance.message = message;
      if (estimatedEndTime !== undefined) {
        maintenance.estimatedEndTime = estimatedEndTime
          ? new Date(estimatedEndTime)
          : undefined;
      }
    }

    await maintenance.save();

    res.json({
      success: true,
      message: "Message de maintenance mis à jour",
    });
  } catch (error) {
    maintenanceCtrlLogger.error("Maintenance message update error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors de la mise à jour du message" });
  }
}
