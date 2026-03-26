// src/__tests__/helpers/imageTestHelpers.ts
// Helpers pour les tests d'images

import { Types } from "mongoose";
import * as fs from "fs";
import * as path from "path";
import { MAGIC_NUMBERS } from "../../config/storageConfig";

/**
 * Crée un buffer minimal simulant un JPEG valide
 * @param sizeKb - Taille en Ko (approximative)
 * @returns Buffer JPEG
 */
export const createMockJpegBuffer = (sizeKb: number = 10): Buffer => {
  const magicNumbers = Buffer.from(MAGIC_NUMBERS["image/jpeg"]);
  const targetSize = sizeKb * 1024;

  // SOI (Start of Image) + quelques segments JPEG + EOI (End of Image)
  const header = Buffer.from([
    0xff,
    0xd8,
    0xff, // SOI
    0xe0,
    0x00,
    0x10, // APP0 segment
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
  ]);

  const footer = Buffer.from([0xff, 0xd9]); // EOI

  // Remplir avec des données aléatoires pour atteindre la taille cible
  const remainingSize = Math.max(0, targetSize - header.length - footer.length);
  const padding = Buffer.alloc(remainingSize, 0xff);

  return Buffer.concat([header, padding, footer]);
};

/**
 * Crée un buffer minimal simulant un PNG valide
 * @param sizeKb - Taille en Ko (approximative)
 * @returns Buffer PNG
 */
export const createMockPngBuffer = (sizeKb: number = 10): Buffer => {
  const magicNumbers = Buffer.from(MAGIC_NUMBERS["image/png"]);
  const targetSize = sizeKb * 1024;

  // PNG signature + IHDR + IEND
  const header = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    0x00,
    0x00,
    0x00,
    0x64, // Width: 100px
    0x00,
    0x00,
    0x00,
    0x64, // Height: 100px
    0x08,
    0x02,
    0x00,
    0x00,
    0x00, // Bit depth, color type, etc.
    0xff,
    0x80,
    0x02,
    0x03, // CRC
  ]);

  const footer = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x00, // IEND length
    0x49,
    0x45,
    0x4e,
    0x44, // "IEND"
    0xae,
    0x42,
    0x60,
    0x82, // CRC
  ]);

  const remainingSize = Math.max(0, targetSize - header.length - footer.length);
  const padding = Buffer.alloc(remainingSize, 0x00);

  return Buffer.concat([header, padding, footer]);
};

/**
 * Crée un buffer minimal simulant un HEIC valide
 * @param sizeKb - Taille en Ko (approximative)
 * @returns Buffer HEIC
 */
export const createMockHeicBuffer = (sizeKb: number = 10): Buffer => {
  const targetSize = sizeKb * 1024;

  // HEIC commence par un conteneur ISO (ftyp box)
  const header = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x18, // Box size
    0x66,
    0x74,
    0x79,
    0x70, // "ftyp"
    0x68,
    0x65,
    0x69,
    0x63, // "heic" - major brand
    0x00,
    0x00,
    0x00,
    0x00, // Minor version
    0x68,
    0x65,
    0x69,
    0x63, // Compatible brand
    0x6d,
    0x69,
    0x66,
    0x31, // "mif1"
  ]);

  const remainingSize = Math.max(0, targetSize - header.length);
  const padding = Buffer.alloc(remainingSize, 0x00);

  return Buffer.concat([header, padding]);
};

/**
 * Crée un buffer simulant un WebP valide
 * @param sizeKb - Taille en Ko (approximative)
 * @returns Buffer WebP
 */
export const createMockWebpBuffer = (sizeKb: number = 10): Buffer => {
  const targetSize = sizeKb * 1024;

  const header = Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    0x00,
    0x00,
    0x00,
    0x00, // File size (placeholder)
    0x57,
    0x45,
    0x42,
    0x50, // "WEBP"
    0x56,
    0x50,
    0x38,
    0x20, // "VP8 "
  ]);

  const remainingSize = Math.max(0, targetSize - header.length);
  const padding = Buffer.alloc(remainingSize, 0x00);

  return Buffer.concat([header, padding]);
};

/**
 * Crée un buffer de taille spécifique
 * @param sizeKb - Taille exacte en Ko
 * @returns Buffer JPEG de la taille spécifiée
 */
export const createLargeImageBuffer = (sizeKb: number): Buffer => {
  return createMockJpegBuffer(sizeKb);
};

/**
 * Crée un buffer avec un format invalide (PDF)
 * @returns Buffer PDF
 */
export const createMockPdfBuffer = (): Buffer => {
  return Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"
};

/**
 * Interface pour les données de test d'utilisateur
 */
export interface TestUserData {
  _id?: Types.ObjectId | string;
  name?: string;
  surname?: string;
  email?: string;
  password?: string;
  storage_quota?: number;
  storage_used?: number;
}

/**
 * Crée un utilisateur de test
 * @param overrides - Propriétés personnalisées
 * @returns Données utilisateur
 */
export const createTestUser = (overrides: TestUserData = {}): TestUserData => {
  const timestamp = Date.now();
  return {
    _id: overrides._id || new Types.ObjectId(),
    name: overrides.name || "Test",
    surname: overrides.surname || "User",
    email: overrides.email || `test${timestamp}@example.com`,
    password: overrides.password || "$2b$10$mockedHashedPassword",
    storage_quota: overrides.storage_quota ?? 2 * 1024 * 1024 * 1024, // 2 GB par défaut
    storage_used: overrides.storage_used ?? 0,
  };
};

/**
 * Interface pour les données de test de point
 */
export interface TestPointData {
  _id?: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  name?: string;
  latitude?: number;
  longitude?: number;
  photo?: {
    url: string;
    size: number;
    mimeType: string;
    uploadedAt: Date;
    originalName: string;
    checksum: string;
  };
  deletedAt?: Date | null;
}

/**
 * Crée un point de test
 * @param userId - ID de l'utilisateur propriétaire
 * @param overrides - Propriétés personnalisées
 * @returns Données point
 */
export const createTestPoint = (
  userId: Types.ObjectId | string,
  overrides: Partial<TestPointData> = {},
): TestPointData => {
  const pointId = overrides._id || new Types.ObjectId();
  return {
    _id: pointId,
    userId,
    name: overrides.name || `Test Point ${Date.now()}`,
    latitude: overrides.latitude ?? 48.8566,
    longitude: overrides.longitude ?? 2.3522,
    photo: overrides.photo,
    deletedAt: overrides.deletedAt ?? null,
  };
};

/**
 * Nettoie les fichiers de test
 * @param testStoragePath - Chemin du dossier de test (par défaut: /tmp/qvarry-test-uploads)
 */
export const cleanupTestStorage = async (
  testStoragePath: string = "/tmp/qvarry-test-uploads",
): Promise<void> => {
  try {
    if (fs.existsSync(testStoragePath)) {
      await fs.promises.rm(testStoragePath, { recursive: true, force: true });
    }
  } catch (error) {
    console.error("Erreur lors du nettoyage du stockage de test:", error);
  }
};

/**
 * Crée un dossier de test temporaire
 * @param testStoragePath - Chemin du dossier de test
 */
export const setupTestStorage = async (
  testStoragePath: string = "/tmp/qvarry-test-uploads",
): Promise<void> => {
  try {
    if (!fs.existsSync(testStoragePath)) {
      await fs.promises.mkdir(testStoragePath, { recursive: true });
    }
  } catch (error) {
    console.error("Erreur lors de la création du stockage de test:", error);
  }
};

/**
 * Constantes pour les tests
 */
export const TEST_CONSTANTS = {
  GB: 1024 * 1024 * 1024,
  MB: 1024 * 1024,
  KB: 1024,

  SMALL_IMAGE_KB: 50,
  MEDIUM_IMAGE_KB: 150,
  LARGE_IMAGE_KB: 300,
  VERY_LARGE_IMAGE_KB: 500,
  HUGE_IMAGE_MB: 15,

  DEFAULT_QUOTA_GB: 2,
  ADMIN_QUOTA_GB: 10,

  TEST_STORAGE_PATH: "/tmp/qvarry-test-uploads",
};

/**
 * Génère un token JWT de test
 * @param userId - ID de l'utilisateur
 * @returns Token JWT
 */
export const generateTestToken = (userId: string): string => {
  // Mock simple du token (en réalité, on utiliserait jsonwebtoken)
  return `test-token-${userId}`;
};

/**
 * Attend un certain temps (pour les tests asynchrones)
 * @param ms - Millisecondes à attendre
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Vérifie si un fichier existe
 * @param filePath - Chemin du fichier
 * @returns true si le fichier existe
 */
export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Obtient la taille d'un fichier
 * @param filePath - Chemin du fichier
 * @returns Taille en octets
 */
export const getFileSize = async (filePath: string): Promise<number> => {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
};
