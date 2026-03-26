// src/controllers/adminStorageController.ts
// Contrôleur admin pour la gestion du stockage

import { Request, Response } from "express";
import { logger } from "../services/loggerService";
import storageQuotaService from "../services/storageQuotaService";
import storageService from "../services/storageService";
import PointModel from "../models/points";
import mongoose from "mongoose";

/**
 * Récupère la liste paginée des utilisateurs avec leurs infos de stockage
 * GET /api/admin/users/storage
 */
export const getAllUsersStorage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await storageQuotaService.getAllUsersStorage(page, limit);

    res.status(200).json(result);
  } catch (error) {
    logger.error("Erreur lors de la récupération du stockage global", {
      error,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des informations de stockage",
    });
  }
};

/**
 * Récupère les détails de stockage d'un utilisateur spécifique
 * GET /api/admin/users/:userId/storage
 */
export const getUserStorageDetails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "ID utilisateur invalide" });
      return;
    }

    // Récupérer les informations de quota
    const storageInfo = await storageQuotaService.getUserStorageInfo(userId);

    // Récupérer la liste des photos
    const photoIds = await storageService.listUserPhotos(userId);

    // Récupérer les points avec photos
    const points = await PointModel.find({
      userId: new mongoose.Types.ObjectId(userId),
      photo: { $exists: true },
      deletedAt: null,
    })
      .select("_id name photo")
      .lean();

    // Calculer l'espace réellement utilisé sur le disque
    const actualStorageUsed = await storageService.calculateUserStorage(userId);

    res.status(200).json({
      storage: storageInfo,
      actualStorageUsed,
      photos: points.map((point) => ({
        pointId: point._id,
        pointName: point.name,
        size: point.photo?.size || 0,
        uploadedAt: point.photo?.uploadedAt,
        checksum: point.photo?.checksum,
      })),
      totalPhotos: points.length,
      filesOnDisk: photoIds.length,
    });
  } catch (error) {
    logger.error("Erreur lors de la récupération des détails de stockage", {
      error,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des détails de stockage",
    });
  }
};

/**
 * Met à jour le quota d'un utilisateur
 * PATCH /api/admin/users/:userId/quota
 */
export const updateUserQuota = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { quotaGb } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "ID utilisateur invalide" });
      return;
    }

    if (typeof quotaGb !== "number" || quotaGb < 0) {
      res.status(400).json({
        error: "Le quota doit être un nombre positif (en Go)",
      });
      return;
    }

    const quotaBytes = quotaGb * 1024 * 1024 * 1024;

    await storageQuotaService.updateUserQuota(userId, quotaBytes);

    const storageInfo = await storageQuotaService.getUserStorageInfo(userId);

    logger.info("Quota utilisateur mis à jour par admin", {
      adminId: req.user?.id,
      targetUserId: userId,
      newQuotaGb: quotaGb,
    });

    res.status(200).json({
      message: "Quota updated successfully",
      storage: storageInfo,
    });
  } catch (error) {
    logger.error("Erreur lors de la mise à jour du quota", { error });
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Erreur lors de la mise à jour du quota",
    });
  }
};

/**
 * Récupère les statistiques globales de stockage
 * GET /api/admin/storage/stats
 */
export const getGlobalStorageStats = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const stats = await storageQuotaService.getGlobalStorageStats();

    // Calculer l'espace total sur disque
    const totalStorageOnDisk = await storageService.calculateTotalStorage();

    // Compter le nombre total de photos
    const totalPhotos = await PointModel.countDocuments({
      photo: { $exists: true },
      deletedAt: null,
    });

    res.status(200).json({
      database: stats,
      disk: {
        totalStorageOnDisk,
        totalPhotos,
      },
      difference: {
        bytes: Math.abs(stats.totalUsed - totalStorageOnDisk),
        percentage:
          stats.totalUsed > 0
            ? (
                (Math.abs(stats.totalUsed - totalStorageOnDisk) /
                  stats.totalUsed) *
                100
              ).toFixed(2)
            : 0,
      },
    });
  } catch (error) {
    logger.error("Erreur lors du calcul des statistiques globales", { error });
    res.status(500).json({
      error: "Erreur lors du calcul des statistiques",
    });
  }
};

/**
 * Nettoie les fichiers orphelins (fichiers sans point correspondant)
 * POST /api/admin/storage/cleanup
 */
export const cleanupOrphanFiles = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { dryRun = true } = req.body;

    logger.info("Début du nettoyage des fichiers orphelins", {
      dryRun,
      adminId: req.user?.id,
    });

    // Trouver tous les fichiers sur le disque
    const filesOnDisk = await storageService.findOrphanFiles();

    const orphans: Array<{
      userId: string;
      pointId: string;
      deleted: boolean;
    }> = [];

    // Pour chaque fichier, vérifier s'il a un point correspondant
    for (const [userId, pointIds] of filesOnDisk.entries()) {
      for (const pointId of pointIds) {
        // Vérifier si le point existe dans la base
        const point = await PointModel.findOne({
          _id: new mongoose.Types.ObjectId(pointId),
          userId: new mongoose.Types.ObjectId(userId),
        });

        // Si le point n'existe pas ou n'a pas de photo, c'est un orphelin
        if (!point || !point.photo) {
          orphans.push({ userId, pointId, deleted: false });

          // Supprimer le fichier si ce n'est pas un dry run
          if (!dryRun) {
            try {
              await storageService.deletePointPhoto(userId, pointId);
              orphans[orphans.length - 1].deleted = true;
              logger.info("Fichier orphelin supprimé", { userId, pointId });
            } catch (error) {
              logger.error("Erreur lors de la suppression d'un orphelin", {
                userId,
                pointId,
                error,
              });
            }
          }
        }
      }
    }

    // Recalculer le stockage utilisé pour chaque utilisateur concerné
    const usersToRecalculate = new Set(orphans.map((o) => o.userId));
    const recalculated: Array<{
      userId: string;
      oldUsed: number;
      newUsed: number;
    }> = [];

    if (!dryRun) {
      for (const userId of usersToRecalculate) {
        try {
          const oldInfo = await storageQuotaService.getUserStorageInfo(userId);
          const actualSize = await storageService.calculateUserStorage(userId);
          await storageQuotaService.recalculateUserStorage(userId, actualSize);

          recalculated.push({
            userId,
            oldUsed: oldInfo.used,
            newUsed: actualSize,
          });

          logger.info("Stockage recalculé", {
            userId,
            oldUsed: oldInfo.used,
            newUsed: actualSize,
          });
        } catch (error) {
          logger.error("Erreur lors du recalcul du stockage", {
            userId,
            error,
          });
        }
      }
    }

    res.status(200).json({
      message: dryRun
        ? "Dry run completed - no files were deleted"
        : "Cleanup completed",
      orphans,
      totalOrphans: orphans.length,
      deleted: dryRun ? 0 : orphans.filter((o) => o.deleted).length,
      recalculated: recalculated.length,
      usersAffected: usersToRecalculate.size,
      recalculationDetails: recalculated,
    });
  } catch (error) {
    logger.error("Erreur lors du nettoyage des fichiers orphelins", { error });
    res.status(500).json({
      error: "Erreur lors du nettoyage des fichiers orphelins",
    });
  }
};
