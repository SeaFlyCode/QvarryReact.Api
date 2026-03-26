// src/services/storageService.ts
// Service de gestion du stockage des fichiers photo

import * as fs from "fs";
import * as path from "path";
import { logger } from "./loggerService";
import { STORAGE_CONFIG } from "../config/storageConfig";
import {
  sanitizePathId,
  validatePathWithinBase,
  PathSanitizationError,
} from "../utils/pathSanitizer";
import { createServiceLogger } from "../utils/contextLogger";
import { logPerformance } from "../utils/performanceLogger";

const log = createServiceLogger("StorageService");

/**
 * Service de stockage de fichiers sur disque
 */
class StorageService {
  private storagePath: string;

  constructor() {
    this.storagePath = STORAGE_CONFIG.STORAGE_PATH;
    log.info("Initialisation du service de stockage", {
      storagePath: this.storagePath,
    });
    this.ensureStoragePathExists();
  }

  /**
   * S'assure que le dossier de stockage existe
   */
  private ensureStoragePathExists(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
        log.info("Dossier de stockage créé", { path: this.storagePath });
      } else {
        log.debug("Dossier de stockage existant", { path: this.storagePath });
      }
    } catch (error) {
      log.error("Erreur lors de la création du dossier de stockage", {
        path: this.storagePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Impossible de créer le dossier de stockage");
    }
  }

  /**
   * Obtient le chemin complet d'une photo
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   * @param pointId - ID du point
   * @returns Chemin complet du fichier
   * @throws PathSanitizationError si les IDs sont invalides
   */
  getPhotoPath(userId: string, pointId: string): string {
    try {
      // Couche 1 : Sanitization des IDs
      const safeUserId = sanitizePathId(userId);
      const safePointId = sanitizePathId(pointId);

      // Couche 2 : Construction du chemin
      const userDir = path.join(this.storagePath, safeUserId);
      const filePath = path.join(userDir, `${safePointId}.jpg`);

      // Couche 3 : Double-check avec path.resolve()
      const resolvedPath = path.resolve(filePath);
      validatePathWithinBase(resolvedPath, this.storagePath);

      return filePath;
    } catch (error) {
      log.error("❌ Path traversal tentative détectée", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
  }

  /**
   * Vérifie si un fichier existe
   * @param filePath - Chemin du fichier
   * @returns true si le fichier existe
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sauvegarde une photo sur le disque
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   * @param pointId - ID du point
   * @param buffer - Buffer de l'image
   * @returns Chemin relatif du fichier sauvegardé
   */
  async savePointPhoto(
    userId: string,
    pointId: string,
    buffer: Buffer,
  ): Promise<string> {
    log.info("Sauvegarde d'une photo de point", {
      userId,
      pointId,
      size: buffer.length,
    });

    try {
      // Sanitization des IDs
      const safeUserId = sanitizePathId(userId);
      const safePointId = sanitizePathId(pointId);

      // Créer le dossier utilisateur s'il n'existe pas
      const userDir = path.join(this.storagePath, safeUserId);

      // Double-check
      const resolvedUserDir = path.resolve(userDir);
      validatePathWithinBase(resolvedUserDir, this.storagePath);

      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        log.debug("Dossier utilisateur créé", { userDir });
      }

      // Obtenir le chemin du fichier
      const filePath = this.getPhotoPath(userId, pointId);

      // Sauvegarder le fichier avec mesure de performance
      const { duration } = await logPerformance(
        "Storage.savePhoto",
        async () => await fs.promises.writeFile(filePath, buffer),
        { slowThreshold: 1000 },
      );

      log.info("Photo sauvegardée avec succès", {
        userId,
        pointId,
        filePath,
        size: buffer.length,
        duration,
      });

      // Retourner le chemin relatif
      return path.relative(this.storagePath, filePath);
    } catch (error) {
      log.error("Erreur lors de la sauvegarde de la photo", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Impossible de sauvegarder la photo");
    }
  }

  /**
   * Renomme un fichier photo (utilisé pour passer d'un nom temporaire au nom définitif)
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   * @param oldPointId - Ancien ID du point (ex: "123.tmp")
   * @param newPointId - Nouvel ID du point (ex: "123")
   */
  async renamePointPhoto(
    userId: string,
    oldPointId: string,
    newPointId: string,
  ): Promise<void> {
    try {
      const oldPath = this.getPhotoPath(userId, oldPointId);
      const newPath = this.getPhotoPath(userId, newPointId);

      await fs.promises.rename(oldPath, newPath);
      logger.info("Fichier renommé", { userId, oldPointId, newPointId });
    } catch (error) {
      logger.error("Erreur lors du renommage du fichier", {
        userId,
        oldPointId,
        newPointId,
        error,
      });
      throw new Error(
        `Impossible de renommer le fichier: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /**
   * Supprime une photo du disque
   * @param userId - ID de l'utilisateur
   * @param pointId - ID du point
   */
  async deletePointPhoto(userId: string, pointId: string): Promise<void> {
    log.warn("Suppression d'une photo de point", { userId, pointId });

    try {
      const filePath = this.getPhotoPath(userId, pointId);

      // Vérifier que le fichier existe
      const exists = await this.fileExists(filePath);
      if (!exists) {
        log.warn("Tentative de suppression d'un fichier inexistant", {
          userId,
          pointId,
          filePath,
        });
        return;
      }

      // Supprimer le fichier
      await fs.promises.unlink(filePath);

      log.info("Photo supprimée avec succès", {
        userId,
        pointId,
        filePath,
      });

      // Supprimer le dossier utilisateur s'il est vide
      await this.cleanupEmptyUserDirectory(userId);
    } catch (error) {
      log.error("Erreur lors de la suppression de la photo", {
        userId,
        pointId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Impossible de supprimer la photo");
    }
  }

  /**
   * Supprime le dossier utilisateur s'il est vide
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   */
  private async cleanupEmptyUserDirectory(userId: string): Promise<void> {
    try {
      // Sanitization de l'ID
      const safeUserId = sanitizePathId(userId);
      const userDir = path.join(this.storagePath, safeUserId);

      // Double-check
      const resolvedPath = path.resolve(userDir);
      validatePathWithinBase(resolvedPath, this.storagePath);

      const files = await fs.promises.readdir(userDir);

      if (files.length === 0) {
        await fs.promises.rmdir(userDir);
        logger.debug("Dossier utilisateur vide supprimé", { userDir });
      }
    } catch (error) {
      // Ignorer les erreurs, ce n'est pas critique
      logger.debug("Impossible de supprimer le dossier utilisateur", {
        userId,
        error,
      });
    }
  }

  /**
   * Obtient la taille d'un fichier
   * @param userId - ID de l'utilisateur
   * @param pointId - ID du point
   * @returns Taille du fichier en octets, ou 0 si inexistant
   */
  async getPhotoSize(userId: string, pointId: string): Promise<number> {
    try {
      const filePath = this.getPhotoPath(userId, pointId);
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Liste tous les fichiers d'un utilisateur
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   * @returns Liste des noms de fichiers (sans extension)
   */
  async listUserPhotos(userId: string): Promise<string[]> {
    try {
      // Sanitization de l'ID
      const safeUserId = sanitizePathId(userId);
      const userDir = path.join(this.storagePath, safeUserId);

      // Double-check
      const resolvedPath = path.resolve(userDir);
      validatePathWithinBase(resolvedPath, this.storagePath);

      // Vérifier que le dossier existe
      if (!fs.existsSync(userDir)) {
        return [];
      }

      const files = await fs.promises.readdir(userDir);
      return files
        .filter((file) => file.endsWith(".jpg"))
        .map((file) => file.replace(".jpg", ""));
    } catch (error) {
      logger.error("Erreur lors de la liste des photos utilisateur", {
        userId,
        error,
      });
      return [];
    }
  }

  /**
   * Calcule l'espace utilisé par un utilisateur
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL
   * @param userId - ID de l'utilisateur
   * @returns Espace utilisé en octets
   */
  async calculateUserStorage(userId: string): Promise<number> {
    log.debug("Calcul de l'espace utilisé par l'utilisateur", { userId });

    try {
      // Sanitization de l'ID
      const safeUserId = sanitizePathId(userId);
      const userDir = path.join(this.storagePath, safeUserId);

      // Double-check
      const resolvedPath = path.resolve(userDir);
      validatePathWithinBase(resolvedPath, this.storagePath);

      // Vérifier que le dossier existe
      if (!fs.existsSync(userDir)) {
        return 0;
      }

      const { result: totalSize, duration } = await logPerformance(
        "Storage.calculateUserStorage",
        async () => {
          const files = await fs.promises.readdir(userDir);
          let size = 0;

          for (const file of files) {
            const filePath = path.join(userDir, file);
            const stats = await fs.promises.stat(filePath);
            size += stats.size;
          }

          return size;
        },
        { slowThreshold: 2000 },
      );

      log.info("Espace utilisateur calculé", {
        userId,
        totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        duration,
      });

      return totalSize;
    } catch (error) {
      log.error("Erreur lors du calcul du stockage utilisateur", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Liste tous les fichiers orphelins (fichiers sans point correspondant)
   * @returns Map userId -> liste de pointIds orphelins
   */
  async findOrphanFiles(): Promise<Map<string, string[]>> {
    const orphans = new Map<string, string[]>();

    try {
      const userDirs = await fs.promises.readdir(this.storagePath);

      for (const userId of userDirs) {
        const userDir = path.join(this.storagePath, userId);
        const stats = await fs.promises.stat(userDir);

        if (!stats.isDirectory()) {
          continue;
        }

        const files = await fs.promises.readdir(userDir);
        const pointIds = files
          .filter((file) => file.endsWith(".jpg"))
          .map((file) => file.replace(".jpg", ""));

        if (pointIds.length > 0) {
          orphans.set(userId, pointIds);
        }
      }

      return orphans;
    } catch (error) {
      logger.error("Erreur lors de la recherche de fichiers orphelins", {
        error,
      });
      return orphans;
    }
  }

  /**
   * Calcule l'espace total utilisé par tous les utilisateurs
   * @returns Espace total en octets
   */
  async calculateTotalStorage(): Promise<number> {
    try {
      const userDirs = await fs.promises.readdir(this.storagePath);
      let totalSize = 0;

      for (const userId of userDirs) {
        const userDir = path.join(this.storagePath, userId);
        const stats = await fs.promises.stat(userDir);

        if (!stats.isDirectory()) {
          continue;
        }

        const userSize = await this.calculateUserStorage(userId);
        totalSize += userSize;
      }

      return totalSize;
    } catch (error) {
      logger.error("Erreur lors du calcul du stockage total", { error });
      return 0;
    }
  }
}

export default new StorageService();
