// src/__tests__/services/storageService.test.ts
// Tests unitaires pour le service de stockage

import storageService from "../../services/storageService";
import * as fs from "fs";
import * as path from "path";
import {
  createMockJpegBuffer,
  cleanupTestStorage,
  setupTestStorage,
  TEST_CONSTANTS,
} from "../helpers/imageTestHelpers";

// Utiliser un dossier temporaire pour les tests
const TEST_STORAGE_PATH = TEST_CONSTANTS.TEST_STORAGE_PATH;

describe("StorageService", () => {
  beforeAll(async () => {
    // Configurer le chemin de stockage pour les tests
    process.env.STORAGE_PATH = TEST_STORAGE_PATH;
    await setupTestStorage(TEST_STORAGE_PATH);
  });

  beforeEach(async () => {
    // Nettoyer avant chaque test
    await cleanupTestStorage(TEST_STORAGE_PATH);
    await setupTestStorage(TEST_STORAGE_PATH);
  });

  afterAll(async () => {
    // Nettoyer après tous les tests
    await cleanupTestStorage(TEST_STORAGE_PATH);
  });

  describe("getPhotoPath", () => {
    it("devrait générer le chemin correct pour une photo", () => {
      const userId = "user123";
      const pointId = "point456";

      const photoPath = storageService.getPhotoPath(userId, pointId);

      expect(photoPath).toContain(userId);
      expect(photoPath).toContain(`${pointId}.jpg`);
      expect(path.extname(photoPath)).toBe(".jpg");
    });

    it("devrait générer des chemins différents pour des users différents", () => {
      const userId1 = "user1";
      const userId2 = "user2";
      const pointId = "point1";

      const path1 = storageService.getPhotoPath(userId1, pointId);
      const path2 = storageService.getPhotoPath(userId2, pointId);

      expect(path1).not.toBe(path2);
      expect(path1).toContain(userId1);
      expect(path2).toContain(userId2);
    });
  });

  describe("fileExists", () => {
    it("devrait retourner true pour un fichier existant", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Créer le fichier
      await storageService.savePointPhoto(userId, pointId, buffer);
      const filePath = storageService.getPhotoPath(userId, pointId);

      const exists = await storageService.fileExists(filePath);

      expect(exists).toBe(true);
    });

    it("devrait retourner false pour un fichier inexistant", async () => {
      const filePath = path.join(TEST_STORAGE_PATH, "nonexistent", "file.jpg");

      const exists = await storageService.fileExists(filePath);

      expect(exists).toBe(false);
    });
  });

  describe("savePointPhoto", () => {
    it("devrait sauvegarder une photo correctement", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(50);

      const relativePath = await storageService.savePointPhoto(
        userId,
        pointId,
        buffer,
      );

      expect(relativePath).toBeDefined();
      expect(relativePath).toContain(userId);
      expect(relativePath).toContain(`${pointId}.jpg`);

      // Vérifier que le fichier existe
      const fullPath = storageService.getPhotoPath(userId, pointId);
      const exists = await storageService.fileExists(fullPath);
      expect(exists).toBe(true);
    });

    it("devrait créer automatiquement le dossier utilisateur", async () => {
      const userId = "newuser789";
      const pointId = "point123";
      const buffer = createMockJpegBuffer(10);

      const userDir = path.join(TEST_STORAGE_PATH, userId);
      expect(fs.existsSync(userDir)).toBe(false);

      await storageService.savePointPhoto(userId, pointId, buffer);

      expect(fs.existsSync(userDir)).toBe(true);
    });

    it("devrait écraser une photo existante", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer1 = createMockJpegBuffer(10);
      const buffer2 = createMockJpegBuffer(20);

      // Première sauvegarde
      await storageService.savePointPhoto(userId, pointId, buffer1);
      const size1 = await storageService.getPhotoSize(userId, pointId);

      // Deuxième sauvegarde (écrase)
      await storageService.savePointPhoto(userId, pointId, buffer2);
      const size2 = await storageService.getPhotoSize(userId, pointId);

      expect(size2).not.toBe(size1);
    });

    it("devrait gérer les erreurs d'écriture", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Mock fs.promises.writeFile pour simuler une erreur
      jest
        .spyOn(fs.promises, "writeFile")
        .mockRejectedValueOnce(new Error("Permission denied"));

      await expect(
        storageService.savePointPhoto(userId, pointId, buffer),
      ).rejects.toThrow("Impossible de sauvegarder la photo");

      // Restaurer le mock
      jest.restoreAllMocks();
    });

    it("devrait sauvegarder plusieurs photos pour le même user", async () => {
      const userId = "user123";
      const pointId1 = "point1";
      const pointId2 = "point2";
      const buffer = createMockJpegBuffer(10);

      await storageService.savePointPhoto(userId, pointId1, buffer);
      await storageService.savePointPhoto(userId, pointId2, buffer);

      const photos = await storageService.listUserPhotos(userId);
      expect(photos).toHaveLength(2);
      expect(photos).toContain(pointId1);
      expect(photos).toContain(pointId2);
    });
  });

  describe("deletePointPhoto", () => {
    it("devrait supprimer une photo existante", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Créer la photo
      await storageService.savePointPhoto(userId, pointId, buffer);
      const filePath = storageService.getPhotoPath(userId, pointId);
      expect(await storageService.fileExists(filePath)).toBe(true);

      // Supprimer la photo
      await storageService.deletePointPhoto(userId, pointId);

      expect(await storageService.fileExists(filePath)).toBe(false);
    });

    it("devrait ne rien faire si la photo n'existe pas", async () => {
      const userId = "user123";
      const pointId = "nonexistent";

      // Ne devrait pas lancer d'erreur
      await expect(
        storageService.deletePointPhoto(userId, pointId),
      ).resolves.not.toThrow();
    });

    it("devrait supprimer le dossier utilisateur s'il est vide", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Créer une photo
      await storageService.savePointPhoto(userId, pointId, buffer);
      const userDir = path.join(TEST_STORAGE_PATH, userId);
      expect(fs.existsSync(userDir)).toBe(true);

      // Supprimer la photo
      await storageService.deletePointPhoto(userId, pointId);

      // Le dossier devrait être supprimé (vide)
      expect(fs.existsSync(userDir)).toBe(false);
    });

    it("ne devrait pas supprimer le dossier utilisateur s'il contient d'autres photos", async () => {
      const userId = "user123";
      const pointId1 = "point1";
      const pointId2 = "point2";
      const buffer = createMockJpegBuffer(10);

      // Créer deux photos
      await storageService.savePointPhoto(userId, pointId1, buffer);
      await storageService.savePointPhoto(userId, pointId2, buffer);

      // Supprimer une photo
      await storageService.deletePointPhoto(userId, pointId1);

      const userDir = path.join(TEST_STORAGE_PATH, userId);
      expect(fs.existsSync(userDir)).toBe(true);
    });
  });

  describe("getPhotoSize", () => {
    it("devrait retourner la taille correcte d'une photo", async () => {
      const userId = "user123";
      const pointId = "point456";
      const sizeKb = 50;
      const buffer = createMockJpegBuffer(sizeKb);

      await storageService.savePointPhoto(userId, pointId, buffer);

      const size = await storageService.getPhotoSize(userId, pointId);

      expect(size).toBe(buffer.length);
      expect(size).toBeGreaterThan(0);
    });

    it("devrait retourner 0 pour une photo inexistante", async () => {
      const userId = "user123";
      const pointId = "nonexistent";

      const size = await storageService.getPhotoSize(userId, pointId);

      expect(size).toBe(0);
    });
  });

  describe("listUserPhotos", () => {
    it("devrait lister toutes les photos d'un utilisateur", async () => {
      const userId = "user123";
      const buffer = createMockJpegBuffer(10);

      await storageService.savePointPhoto(userId, "point1", buffer);
      await storageService.savePointPhoto(userId, "point2", buffer);
      await storageService.savePointPhoto(userId, "point3", buffer);

      const photos = await storageService.listUserPhotos(userId);

      expect(photos).toHaveLength(3);
      expect(photos).toContain("point1");
      expect(photos).toContain("point2");
      expect(photos).toContain("point3");
    });

    it("devrait retourner un tableau vide pour un user sans photos", async () => {
      const userId = "userWithoutPhotos";

      const photos = await storageService.listUserPhotos(userId);

      expect(photos).toEqual([]);
    });

    it("ne devrait lister que les fichiers .jpg", async () => {
      const userId = "user123";
      const buffer = createMockJpegBuffer(10);

      await storageService.savePointPhoto(userId, "point1", buffer);

      // Créer un fichier non-jpg
      const userDir = path.join(TEST_STORAGE_PATH, userId);
      await fs.promises.writeFile(path.join(userDir, "other.txt"), "test");

      const photos = await storageService.listUserPhotos(userId);

      expect(photos).toHaveLength(1);
      expect(photos).toContain("point1");
    });
  });

  describe("calculateUserStorage", () => {
    it("devrait calculer l'espace utilisé par un utilisateur", async () => {
      const userId = "user123";
      const buffer1 = createMockJpegBuffer(50);
      const buffer2 = createMockJpegBuffer(30);

      await storageService.savePointPhoto(userId, "point1", buffer1);
      await storageService.savePointPhoto(userId, "point2", buffer2);

      const totalSize = await storageService.calculateUserStorage(userId);

      expect(totalSize).toBe(buffer1.length + buffer2.length);
    });

    it("devrait retourner 0 pour un utilisateur sans photos", async () => {
      const userId = "emptyUser";

      const totalSize = await storageService.calculateUserStorage(userId);

      expect(totalSize).toBe(0);
    });

    it("devrait calculer correctement après suppression de photos", async () => {
      const userId = "user123";
      const buffer = createMockJpegBuffer(50);

      await storageService.savePointPhoto(userId, "point1", buffer);
      await storageService.savePointPhoto(userId, "point2", buffer);

      const sizeBefore = await storageService.calculateUserStorage(userId);
      expect(sizeBefore).toBe(buffer.length * 2);

      await storageService.deletePointPhoto(userId, "point1");

      const sizeAfter = await storageService.calculateUserStorage(userId);
      expect(sizeAfter).toBe(buffer.length);
    });
  });

  describe("findOrphanFiles", () => {
    it("devrait trouver tous les fichiers stockés", async () => {
      const buffer = createMockJpegBuffer(10);

      await storageService.savePointPhoto("user1", "point1", buffer);
      await storageService.savePointPhoto("user1", "point2", buffer);
      await storageService.savePointPhoto("user2", "point3", buffer);

      const orphans = await storageService.findOrphanFiles();

      expect(orphans.size).toBe(2);
      expect(orphans.get("user1")).toEqual(["point1", "point2"]);
      expect(orphans.get("user2")).toEqual(["point3"]);
    });

    it("devrait retourner une Map vide si aucun fichier", async () => {
      const orphans = await storageService.findOrphanFiles();

      expect(orphans.size).toBe(0);
    });

    it("devrait ignorer les fichiers non-.jpg", async () => {
      const userId = "user123";
      const buffer = createMockJpegBuffer(10);

      await storageService.savePointPhoto(userId, "point1", buffer);

      // Créer un fichier non-jpg
      const userDir = path.join(TEST_STORAGE_PATH, userId);
      await fs.promises.writeFile(path.join(userDir, "other.txt"), "test");

      const orphans = await storageService.findOrphanFiles();

      expect(orphans.get(userId)).toEqual(["point1"]);
    });
  });

  describe("calculateTotalStorage", () => {
    it("devrait calculer l'espace total utilisé", async () => {
      const buffer1 = createMockJpegBuffer(50);
      const buffer2 = createMockJpegBuffer(30);
      const buffer3 = createMockJpegBuffer(20);

      await storageService.savePointPhoto("user1", "point1", buffer1);
      await storageService.savePointPhoto("user1", "point2", buffer2);
      await storageService.savePointPhoto("user2", "point3", buffer3);

      const totalSize = await storageService.calculateTotalStorage();

      expect(totalSize).toBe(buffer1.length + buffer2.length + buffer3.length);
    });

    it("devrait retourner 0 si aucune photo", async () => {
      const totalSize = await storageService.calculateTotalStorage();

      expect(totalSize).toBe(0);
    });

    it("devrait calculer correctement après suppressions", async () => {
      const buffer = createMockJpegBuffer(50);

      await storageService.savePointPhoto("user1", "point1", buffer);
      await storageService.savePointPhoto("user2", "point2", buffer);

      const sizeBefore = await storageService.calculateTotalStorage();
      expect(sizeBefore).toBe(buffer.length * 2);

      await storageService.deletePointPhoto("user1", "point1");

      const sizeAfter = await storageService.calculateTotalStorage();
      expect(sizeAfter).toBe(buffer.length);
    });
  });

  describe("Error handling", () => {
    it("devrait gérer les erreurs de permission", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Mock pour simuler une erreur de permission
      jest
        .spyOn(fs.promises, "writeFile")
        .mockRejectedValueOnce(
          Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          }),
        );

      await expect(
        storageService.savePointPhoto(userId, pointId, buffer),
      ).rejects.toThrow("Impossible de sauvegarder la photo");

      jest.restoreAllMocks();
    });

    it("devrait gérer les erreurs de disque plein", async () => {
      const userId = "user123";
      const pointId = "point456";
      const buffer = createMockJpegBuffer(10);

      // Mock pour simuler un disque plein
      jest.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(
        Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        }),
      );

      await expect(
        storageService.savePointPhoto(userId, pointId, buffer),
      ).rejects.toThrow("Impossible de sauvegarder la photo");

      jest.restoreAllMocks();
    });
  });
});
