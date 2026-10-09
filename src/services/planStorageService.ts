// src/services/planStorageService.ts
// Stockage disque des plans (images chiffrées) : <PLANS_STORAGE_PATH>/<userId>/<planId>.bin

import * as fs from "fs";
import * as path from "path";
import { PLANS_CONFIG } from "../config/storageConfig";
import { sanitizePathId, validatePathWithinBase } from "../utils/pathSanitizer";
import { createServiceLogger } from "../utils/contextLogger";

const log = createServiceLogger("PlanStorageService");

class PlanStorageService {
  private basePath: string = PLANS_CONFIG.STORAGE_PATH;

  /**
   * Chemin absolu-safe d'un blob de plan.
   * 🛡️ PROTÉGÉ CONTRE PATH TRAVERSAL (sanitizePathId + validatePathWithinBase)
   */
  getPlanPath(userId: string, planId: string): string {
    const safeUserId = sanitizePathId(userId);
    const safePlanId = sanitizePathId(planId);
    const filePath = path.join(this.basePath, safeUserId, `${safePlanId}.bin`);
    validatePathWithinBase(path.resolve(filePath), this.basePath);
    return filePath;
  }

  private getUserDir(userId: string): string {
    const dir = path.join(this.basePath, sanitizePathId(userId));
    validatePathWithinBase(path.resolve(dir), this.basePath);
    return dir;
  }

  /** Chemin relatif stocké en base (informatif : la lecture recalcule toujours depuis les ids). */
  getRelativePath(userId: string, planId: string): string {
    return path.relative(this.basePath, this.getPlanPath(userId, planId));
  }

  async savePlanBlob(
    userId: string,
    planId: string,
    encrypted: Buffer,
  ): Promise<string> {
    const filePath = this.getPlanPath(userId, planId);
    const dir = this.getUserDir(userId);
    // Retry unique : un deletePlanBlob concurrent peut supprimer le dossier
    // (devenu vide) entre le mkdir et l'écriture.
    for (let attempt = 0; ; attempt++) {
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      try {
        await fs.promises.writeFile(filePath, encrypted, { mode: 0o600 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= 1) {
          throw error;
        }
      }
    }
    return path.relative(this.basePath, filePath);
  }

  /** @returns le blob chiffré, ou null s'il n'existe pas */
  async readPlanBlob(userId: string, planId: string): Promise<Buffer | null> {
    const filePath = this.getPlanPath(userId, planId);
    try {
      return await fs.promises.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** Supprime un blob (idempotent) et le dossier utilisateur s'il est vide. */
  async deletePlanBlob(userId: string, planId: string): Promise<void> {
    const filePath = this.getPlanPath(userId, planId);
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await fs.promises.rmdir(this.getUserDir(userId)); // échoue si non vide
    } catch {
      /* dossier non vide ou absent : OK */
    }
  }

  /** Supprime tous les plans d'un utilisateur (suppression de compte). */
  async deleteAllUserPlans(userId: string): Promise<void> {
    const dir = this.getUserDir(userId);
    await fs.promises.rm(dir, { recursive: true, force: true });
    log.info("Dossier plans utilisateur supprimé", { userId });
  }

  /**
   * Taille CLAIRE cumulée des plans d'un utilisateur, lue sur le disque
   * (taille du blob - surcoût de chiffrement), donc comparable à `storage_used`.
   * @returns 0 si le dossier n'existe pas ; propage les autres erreurs.
   */
  async calculateUserPlansSize(userId: string): Promise<number> {
    const dir = this.getUserDir(userId);
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let total = 0;
    for (const name of names) {
      if (!name.endsWith(".bin")) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        if (st.isFile()) {
          total += Math.max(0, st.size - PLANS_CONFIG.ENCRYPTION_OVERHEAD_BYTES);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return total;
  }

  /** Taille claire cumulée de tous les plans présents sur le disque. */
  async calculateTotalPlansSize(): Promise<number> {
    let total = 0;
    for (const blob of await this.listAllBlobs()) total += blob.clearSize;
    return total;
  }

  /**
   * Liste tous les blobs de plans présents sur le disque (ids validés).
   * Les entrées dont le nom n'est pas un ObjectId sont ignorées.
   */
  async listAllBlobs(): Promise<
    Array<{ userId: string; planId: string; clearSize: number; mtimeMs: number }>
  > {
    const out: Array<{
      userId: string;
      planId: string;
      clearSize: number;
      mtimeMs: number;
    }> = [];
    let userDirs: string[];
    try {
      userDirs = await fs.promises.readdir(this.basePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return out;
      throw error;
    }
    const isId = (v: string) => /^[a-f0-9]{24}$/i.test(v);
    for (const userId of userDirs) {
      if (!isId(userId)) continue;
      const dir = path.join(this.basePath, userId);
      let files: string[];
      try {
        files = await fs.promises.readdir(dir);
      } catch {
        continue; // pas un dossier / disparu
      }
      for (const file of files) {
        if (!file.endsWith(".bin")) continue;
        const planId = file.slice(0, -4);
        if (!isId(planId)) continue;
        try {
          const st = await fs.promises.stat(path.join(dir, file));
          if (!st.isFile()) continue;
          out.push({
            userId,
            planId,
            clearSize: Math.max(0, st.size - PLANS_CONFIG.ENCRYPTION_OVERHEAD_BYTES),
            mtimeMs: st.mtimeMs,
          });
        } catch {
          /* supprimé entre-temps */
        }
      }
    }
    return out;
  }
}

export default new PlanStorageService();
