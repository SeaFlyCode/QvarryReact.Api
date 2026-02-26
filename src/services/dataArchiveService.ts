/**
 * DataArchiveService
 *
 * Service centralisé pour gérer l'archivage des données supprimées.
 *
 * IMPORTANT : Les données sont stockées CHIFFRÉES (telles qu'elles sont en base).
 * Aucun déchiffrement n'est effectué - on archive l'état exact de la donnée.
 *
 * WORKFLOW SUPPRESSION:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  1. Utilisateur demande suppression                        │
 * │  2. archiveAndDelete() est appelé                          │
 * │  3. Données copiées dans DeletedData (chiffrées)           │
 * │  4. Données supprimées physiquement de la table d'origine  │
 * │  5. Les données archivées sont disponibles pour restauration│
 * └─────────────────────────────────────────────────────────────┘
 */

import mongoose from "mongoose";
import DeletedData, {
  DeletedEntityType,
  IDeletedData,
} from "../models/deletedData";
import { logger } from "./loggerService";

const archiveLogger = logger.child({ service: "data-archive" });

// Types pour le contexte de l'action
export interface ActionContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  endpoint?: string;
}

// Options pour l'archivage
export interface ArchiveOptions {
  reason?: string;
  context?: ActionContext;
  parentEntityType?: DeletedEntityType;
  parentEntityId?: mongoose.Types.ObjectId;
}

class DataArchiveService {
  private static instance: DataArchiveService;

  private constructor() {}

  static getInstance(): DataArchiveService {
    if (!DataArchiveService.instance) {
      DataArchiveService.instance = new DataArchiveService();
    }
    return DataArchiveService.instance;
  }

  /**
   * Archive une entité avant suppression physique
   * Les données sont copiées CHIFFRÉES dans DeletedData
   *
   * ⚠️ L'archivage et la suppression ne sont pas atomiques (pas de transaction MongoDB, nécessite replica set).
   * L'archivage se fait AVANT la suppression pour éviter toute perte de données.
   *
   * @param entityType - Type de l'entité (fiche, point, user, etc.)
   * @param entityId - ID de l'entité
   * @param data - Données complètes de l'entité (chiffrées)
   * @param deletedBy - ID de l'utilisateur qui supprime
   * @param options - Options additionnelles
   */
  async archiveEntity(
    entityType: DeletedEntityType,
    entityId: mongoose.Types.ObjectId | string,
    data: Record<string, unknown>,
    deletedBy: mongoose.Types.ObjectId | string,
    options: ArchiveOptions = {},
  ): Promise<IDeletedData> {
    try {
      const archived = await DeletedData.create({
        entityType,
        entityId: new mongoose.Types.ObjectId(entityId.toString()),
        data,
        deletedBy: new mongoose.Types.ObjectId(deletedBy.toString()),
        deletedAt: new Date(),
        deletionReason: options.reason,
        deletionContext: options.context,
        parentEntityType: options.parentEntityType,
        parentEntityId: options.parentEntityId
          ? new mongoose.Types.ObjectId(options.parentEntityId.toString())
          : undefined,
        isRestored: false,
      });

      archiveLogger.info("Entité archivée", {
        entityType,
        entityId: entityId.toString(),
        deletedBy: deletedBy.toString(),
      });
      return archived;
    } catch (error) {
      archiveLogger.error("Erreur archivage", {
        entityType,
        entityId: entityId.toString(),
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Archive et enregistre la suppression en une seule opération
   *
   * @param entityType - Type de l'entité
   * @param entityId - ID de l'entité
   * @param data - Données complètes (chiffrées)
   * @param performedBy - ID de l'utilisateur
   * @param options - Options
   */
  async archiveAndRecordDeletion(
    entityType: DeletedEntityType,
    entityId: mongoose.Types.ObjectId | string,
    data: Record<string, unknown>,
    performedBy: mongoose.Types.ObjectId | string,
    options: ArchiveOptions = {},
  ): Promise<IDeletedData> {
    return this.archiveEntity(entityType, entityId, data, performedBy, options);
  }

  /**
   * Récupérer les données supprimées d'un utilisateur (admin only)
   */
  async getDeletedByUser(
    userId: mongoose.Types.ObjectId | string,
    options: {
      limit?: number;
      skip?: number;
      entityType?: DeletedEntityType;
    } = {},
  ): Promise<IDeletedData[]> {
    const query: Record<string, unknown> = {
      deletedBy: new mongoose.Types.ObjectId(userId.toString()),
      isRestored: false,
    };

    if (options.entityType) {
      query.entityType = options.entityType;
    }

    return DeletedData.find(query)
      .sort({ deletedAt: -1 })
      .limit(options.limit || 50)
      .skip(options.skip || 0)
      .exec();
  }

  /**
   * Récupérer une entité archivée par son ID original
   */
  async getArchivedEntity(
    entityType: DeletedEntityType,
    entityId: mongoose.Types.ObjectId | string,
  ): Promise<IDeletedData | null> {
    return DeletedData.findOne({
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId.toString()),
      isRestored: false,
    });
  }

  /**
   * Marquer une entité archivée comme restaurée
   * Note: La restauration effective doit être gérée par le contrôleur
   */
  async markAsRestored(
    entityType: DeletedEntityType,
    entityId: mongoose.Types.ObjectId | string,
    restoredBy: mongoose.Types.ObjectId | string,
  ): Promise<IDeletedData | null> {
    const archived = await DeletedData.findOneAndUpdate(
      {
        entityType,
        entityId: new mongoose.Types.ObjectId(entityId.toString()),
        isRestored: false,
      },
      {
        isRestored: true,
        restoredAt: new Date(),
        restoredBy: new mongoose.Types.ObjectId(restoredBy.toString()),
      },
      { new: true },
    );

    if (archived) {
      archiveLogger.info("Entité restaurée", {
        entityType,
        entityId: entityId.toString(),
        restoredBy: restoredBy.toString(),
      });
    }

    return archived;
  }

  /**
   * Statistiques d'archivage (admin dashboard)
   */
  async getArchiveStats(): Promise<{
    totalDeleted: number;
    deletedByType: Record<string, number>;
    totalRestored: number;
    recentDeletions: number;
  }> {
    const [totalDeleted, deletedByType, totalRestored, recentDeletions] =
      await Promise.all([
        DeletedData.countDocuments({ isRestored: false }),
        DeletedData.aggregate([
          { $match: { isRestored: false } },
          { $group: { _id: "$entityType", count: { $sum: 1 } } },
        ]),
        DeletedData.countDocuments({ isRestored: true }),
        DeletedData.countDocuments({
          isRestored: false,
          deletedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 derniers jours
        }),
      ]);

    const byType: Record<string, number> = {};
    deletedByType.forEach((item: { _id: string; count: number }) => {
      byType[item._id] = item.count;
    });

    return {
      totalDeleted,
      deletedByType: byType,
      totalRestored,
      recentDeletions,
    };
  }
}

// Export du singleton
export const dataArchiveService = DataArchiveService.getInstance();
export default dataArchiveService;
