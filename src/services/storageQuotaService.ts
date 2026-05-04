// src/services/storageQuotaService.ts
// Service de gestion des quotas de stockage utilisateur

import { logger } from "./loggerService";
import { STORAGE_CONFIG } from "../config/storageConfig";
import UserModel from "../models/users";
import mongoose from "mongoose";
import { getErrorMessage } from "../utils/errorUtils";
import { decrypt } from "../utils/masterEncryptionUtils";
import { notifyAllAdmins } from "./adminNotificationService";

/**
 * Erreur levée quand un upload dépasserait le quota de l'utilisateur.
 * Le caller doit attraper cette erreur, abandonner l'upload, et nettoyer
 * tout blob qui aurait déjà été écrit (S3 / disque).
 */
export class QuotaExceededError extends Error {
  public readonly code = "QUOTA_EXCEEDED";
  constructor(
    public readonly userId: string,
    public readonly attemptedBytes: number,
  ) {
    super(`Quota dépassé pour l'utilisateur ${userId} (${attemptedBytes} octets demandés)`);
    this.name = "QuotaExceededError";
  }
}

/**
 * Interface pour les informations de stockage d'un utilisateur
 */
export interface StorageInfo {
  used: number;
  quota: number;
  available: number;
  percentage: number;
}

/**
 * Interface pour les informations paginées de stockage
 */
export interface PaginatedStorage {
  users: Array<{
    userId: string;
    name: string;
    email: string;
    storage: StorageInfo;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Service de gestion des quotas de stockage
 */
class StorageQuotaService {
  /**
   * Vérifie si un utilisateur a suffisamment d'espace disponible
   * @param userId - ID de l'utilisateur
   * @param requiredBytes - Nombre d'octets requis
   * @returns true si l'espace est disponible
   */
  async checkQuotaAvailable(
    userId: string,
    requiredBytes: number,
  ): Promise<boolean> {
    try {
      const user = await UserModel.findById(userId);

      if (!user) {
        logger.error("Utilisateur non trouvé pour vérification quota", {
          userId,
        });
        return false;
      }

      const quota = user.storage_quota || STORAGE_CONFIG.DEFAULT_QUOTA_BYTES;
      const used = user.storage_used || 0;
      const available = quota - used;

      logger.debug("Vérification quota", {
        userId,
        quota,
        used,
        available,
        requiredBytes,
      });

      return available >= requiredBytes;
    } catch (error) {
      logger.error("Erreur lors de la vérification du quota", {
        userId,
        error,
      });
      return false;
    }
  }

  /**
   * Incrémente l'espace utilisé d'un utilisateur de manière atomique avec
   * vérification du quota dans la même opération Mongo.
   *
   * Cf. fix.md backend #2 — race condition asymétrique : auparavant, deux
   * uploads concurrents pouvaient passer la check `canUploadPhoto()` puis
   * faire chacun un `$inc`, dépassant le quota. La vérification est désormais
   * portée par le filtre Mongo via `$expr`, garantissant que la transition
   * `storage_used → storage_used + bytes` ne se fait que si le résultat reste
   * inférieur au `storage_quota` actuel du document.
   *
   * @throws QuotaExceededError si le quota serait dépassé OU si l'utilisateur
   *         n'existe pas. Le caller doit nettoyer tout blob déjà uploadé.
   */
  async incrementStorageUsed(userId: string, bytes: number): Promise<void> {
    if (bytes < 0) {
      throw new Error("incrementStorageUsed: bytes doit être positif");
    }

    try {
      const result = await UserModel.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(userId),
          // Filtre conditionnel : on n'écrit que si used + bytes <= quota.
          // Avec un quota par défaut si le champ est absent.
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ["$storage_used", 0] }, bytes] },
              {
                $ifNull: [
                  "$storage_quota",
                  STORAGE_CONFIG.DEFAULT_QUOTA_BYTES,
                ],
              },
            ],
          },
        },
        { $inc: { storage_used: bytes } },
        { new: true },
      );

      if (!result) {
        // Le filtre n'a pas matché : soit user inexistant, soit quota dépassé.
        // On le distingue avec un read séparé pour le log (pas critique).
        logger.warn("Quota dépassé ou utilisateur introuvable lors de l'incrémentation", {
          userId,
          bytes,
        });

        // Notification admin (P1) — dédup par user pour éviter le spam
        // si l'utilisateur retente l'upload plusieurs fois
        try {
          await notifyAllAdmins(
            "admin_quota_exceeded",
            "📦 Quota stockage dépassé",
            `Tentative d'upload bloquée : ${bytes} octets demandés par l'utilisateur ${userId}.`,
            {
              userId,
              attemptedBytes: bytes,
              dedupKey: `quota-exceeded:${userId}`,
            },
          );
        } catch (notifErr) {
          logger.warn("Échec de notification admin (quota_exceeded)", {
            userId,
            error:
              notifErr instanceof Error
                ? notifErr.message
                : String(notifErr),
          });
        }

        throw new QuotaExceededError(userId, bytes);
      }

      logger.info("Stockage incrémenté", {
        userId,
        bytes,
        newStorageUsed: result.storage_used,
      });
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        throw error;
      }
      logger.error("Erreur lors de l'incrémentation du stockage", {
        userId,
        bytes,
        error,
      });
      throw new Error("Impossible de mettre à jour le quota");
    }
  }

  /**
   * Décrémente l'espace utilisé d'un utilisateur
   * 🔒 CORRECTION: Empêche les valeurs négatives avec validation atomique
   * @param userId - ID de l'utilisateur
   * @param bytes - Nombre d'octets à retirer
   */
  async decrementStorageUsed(userId: string, bytes: number): Promise<void> {
    try {
      // Essayer de décrémenter normalement avec condition
      const result = await UserModel.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(userId),
          storage_used: { $gte: bytes }, // Vérifier qu'on a assez à décrémenter
        },
        {
          $inc: { storage_used: -bytes },
        },
        { new: true },
      );

      if (!result) {
        // L'update a échoué : soit user inexistant, soit storage_used < bytes
        const user = await UserModel.findById(userId);

        if (!user) {
          logger.error(
            "Utilisateur introuvable lors de la décrémentation du quota",
            {
              userId,
              bytes,
            },
          );
          throw new Error("Utilisateur introuvable");
        }

        // Incohérence détectée : storage_used < bytes
        logger.warn("Incohérence de quota détectée, recalcul nécessaire", {
          userId,
          currentStorageUsed: user.storage_used,
          attemptedDecrement: bytes,
        });

        // Forcer à 0 plutôt que d'avoir un négatif
        await UserModel.findByIdAndUpdate(userId, {
          $set: { storage_used: 0 },
        });

        logger.info("Quota réinitialisé à 0 pour éviter valeur négative", {
          userId,
          previousValue: user.storage_used,
        });
      } else {
        logger.debug("Quota décrémenté avec succès", {
          userId,
          decrementedBytes: bytes,
          newStorageUsed: result.storage_used,
        });
      }
    } catch (error) {
      logger.error("Erreur lors de la décrémentation du quota", {
        userId,
        bytes,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Récupère les informations de stockage d'un utilisateur
   * @param userId - ID de l'utilisateur
   * @returns Informations de stockage
   */
  async getUserStorageInfo(userId: string): Promise<StorageInfo> {
    try {
      logger.debug("getUserStorageInfo - Début", {
        userId,
        userIdType: typeof userId,
      });

      const user = await UserModel.findById(userId);

      if (!user) {
        logger.warn("getUserStorageInfo - Utilisateur non trouvé", {
          userId,
        });
        throw new Error("Utilisateur non trouvé");
      }

      const quota = user.storage_quota || STORAGE_CONFIG.DEFAULT_QUOTA_BYTES;
      const used = user.storage_used || 0;
      const available = Math.max(0, quota - used);
      const percentage = quota > 0 ? (used / quota) * 100 : 0;

      logger.debug("getUserStorageInfo - Succès", {
        userId,
        quota,
        used,
        available,
        percentage,
      });

      return {
        used,
        quota,
        available,
        percentage: parseFloat(percentage.toFixed(2)),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error("Erreur lors de la récupération des infos de stockage", {
        userId,
        errorMessage,
        errorStack,
        errorType: error?.constructor?.name,
      });
      throw error;
    }
  }

  /**
   * Récupère la liste paginée des utilisateurs avec leurs infos de stockage
   * @param page - Numéro de page (1-indexed)
   * @param limit - Nombre d'éléments par page
   * @returns Liste paginée
   */
  async getAllUsersStorage(
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedStorage> {
    try {
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        UserModel.find({})
          .select("_id name surname email storage_quota storage_used")
          .skip(skip)
          .limit(limit)
          .sort({ storage_used: -1 })
          .lean(),
        UserModel.countDocuments({}),
      ]);

      const usersWithStorage = users.map((user) => {
        const quota = user.storage_quota || STORAGE_CONFIG.DEFAULT_QUOTA_BYTES;
        const used = user.storage_used || 0;
        const available = Math.max(0, quota - used);
        const percentage = quota > 0 ? (used / quota) * 100 : 0;

        // Fonction utilitaire pour déchiffrer de manière sécurisée
        const safeDecrypt = (value: string | undefined): string => {
          if (!value) return "";
          try {
            return decrypt(value);
          } catch (e) {
            logger.warn("Erreur déchiffrement donnée utilisateur", {
              userId: user._id,
              error: e instanceof Error ? e.message : String(e),
            });
            return "[Données indisponibles]";
          }
        };

        return {
          userId: user._id.toString(),
          name: `${safeDecrypt(user.name)} ${safeDecrypt(user.surname)}`.trim(),
          email: safeDecrypt(user.email),
          storage: {
            used,
            quota,
            available,
            percentage: parseFloat(percentage.toFixed(2)),
          },
        };
      });

      return {
        users: usersWithStorage,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Erreur lors de la récupération du stockage global", {
        error,
      });
      throw error;
    }
  }

  /**
   * Met à jour le quota d'un utilisateur
   * @param userId - ID de l'utilisateur
   * @param newQuotaBytes - Nouveau quota en octets
   */
  async updateUserQuota(userId: string, newQuotaBytes: number): Promise<void> {
    try {
      const user = await UserModel.findById(userId);

      if (!user) {
        throw new Error("Utilisateur non trouvé");
      }

      // Vérifier que le nouveau quota est supérieur ou égal à l'espace utilisé
      const used = user.storage_used || 0;
      if (newQuotaBytes < used) {
        throw new Error(
          "Le nouveau quota doit être supérieur ou égal à l'espace utilisé",
        );
      }

      await UserModel.findByIdAndUpdate(userId, {
        storage_quota: newQuotaBytes,
      });

      logger.info("Quota utilisateur mis à jour", {
        userId,
        oldQuota: user.storage_quota,
        newQuota: newQuotaBytes,
      });
    } catch (error) {
      logger.error("Erreur lors de la mise à jour du quota utilisateur", {
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Recalcule l'espace utilisé d'un utilisateur basé sur les fichiers réels
   * @param userId - ID de l'utilisateur
   * @param actualSize - Taille réelle calculée
   */
  async recalculateUserStorage(
    userId: string,
    actualSize: number,
  ): Promise<void> {
    try {
      await UserModel.findByIdAndUpdate(userId, {
        storage_used: actualSize,
      });

      logger.info("Stockage utilisateur recalculé", {
        userId,
        actualSize,
      });
    } catch (error) {
      logger.error("Erreur lors du recalcul du stockage utilisateur", {
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Obtient les statistiques globales de stockage
   * @returns Statistiques globales
   */
  async getGlobalStorageStats(): Promise<{
    totalUsers: number;
    totalUsed: number;
    totalQuota: number;
    averageUsage: number;
    usersOverQuota: number;
  }> {
    try {
      const stats = await UserModel.aggregate([
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            totalUsed: { $sum: "$storage_used" },
            totalQuota: { $sum: "$storage_quota" },
            usersOverQuota: {
              $sum: {
                $cond: [{ $gt: ["$storage_used", "$storage_quota"] }, 1, 0],
              },
            },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalUsers: 0,
          totalUsed: 0,
          totalQuota: 0,
          averageUsage: 0,
          usersOverQuota: 0,
        };
      }

      const result = stats[0];
      const averageUsage =
        result.totalUsers > 0 ? result.totalUsed / result.totalUsers : 0;

      return {
        totalUsers: result.totalUsers,
        totalUsed: result.totalUsed,
        totalQuota: result.totalQuota,
        averageUsage,
        usersOverQuota: result.usersOverQuota,
      };
    } catch (error) {
      logger.error("Erreur lors du calcul des statistiques globales", {
        error,
      });
      throw error;
    }
  }
}

export default new StorageQuotaService();
