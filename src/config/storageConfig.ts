// src/config/storageConfig.ts
// Configuration centralisée du stockage et des photos

/**
 * Configuration du stockage et des limites de photos
 */
export const STORAGE_CONFIG = {
  // Quotas par défaut
  DEFAULT_QUOTA_GB: 2,
  DEFAULT_QUOTA_BYTES: 2 * 1024 * 1024 * 1024, // 2 Go

  // Taille maximale des images compressées
  MAX_IMAGE_SIZE_KB: 250,
  MAX_IMAGE_SIZE_BYTES: 250 * 1024, // 250 Ko

  // Taille maximale avant compression
  MAX_UPLOAD_SIZE_MB: 10,
  MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024, // 10 Mo

  // Formats acceptés
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ],

  // Dimensions maximales
  IMAGE_MAX_WIDTH: 1920,
  IMAGE_MAX_HEIGHT: 1920,

  // Qualité de compression JPEG
  JPEG_QUALITY: 85,

  // Chemin de stockage
  STORAGE_PATH: process.env.STORAGE_PATH || "./uploads/points",
} as const;

/**
 * Alias publics (Phase H §5.x) — source unique pour la taille max d'upload
 * pré-compression, à utiliser dans les messages UI/erreur et les schémas.
 *
 * À préférer aux constantes dupliquées comme `10 * 1024 * 1024` ou
 * `"10mb"` qui rendraient une modification de la limite incohérente.
 */
export const MAX_FILE_SIZE_BYTES = STORAGE_CONFIG.MAX_UPLOAD_SIZE_BYTES;
export const MAX_FILE_SIZE_MB = STORAGE_CONFIG.MAX_UPLOAD_SIZE_MB;

/**
 * Magic numbers pour validation stricte des MIME types
 * Utilisés pour détecter le vrai type de fichier indépendamment de l'extension
 */
export const MAGIC_NUMBERS: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF
  // HEIC n'a pas de magic number simple, on se base sur le conteneur
};

/**
 * Extensions de fichiers autorisées
 */
export const ALLOWED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
] as const;

/**
 * Messages d'erreur standardisés
 */
export const STORAGE_ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota de stockage dépassé",
  FILE_TOO_LARGE: "Fichier trop volumineux",
  INVALID_FORMAT: "Format de fichier non supporté",
  INVALID_MIME_TYPE: "Type MIME invalide détecté",
  PROCESSING_FAILED: "Échec du traitement de l'image",
  SAVE_FAILED: "Échec de la sauvegarde du fichier",
  DELETE_FAILED: "Échec de la suppression du fichier",
  PHOTO_NOT_FOUND: "Photo non trouvée",
  POINT_NOT_FOUND: "Point non trouvé",
  UNAUTHORIZED: "Non autorisé à accéder à cette ressource",
} as const;

/**
 * Configuration des plans (calques image privés posés sur la carte).
 * Fichiers chiffrés AES-256-GCM (clé utilisateur) dans
 * <PLANS_STORAGE_PATH>/<userId>/<planId>.bin
 * Pas de PDF, pas de recompression agressive.
 */
export const PLANS_CONFIG = {
  STORAGE_PATH: process.env.PLANS_STORAGE_PATH || "./uploads/plans",
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 Mo
  MAX_FILES_PER_USER: 50,
  MAX_DIMENSION_PX: 4096, // côté long (redimensionnement si dépassé)
  MAX_INPUT_PIXELS: 64_000_000, // garde-fou decompression bomb (~8000x8000)
  MAX_CONCURRENT_IMAGE_JOBS: 2, // décodages sharp simultanés (borne la mémoire)
  /** Surcoût du chiffrement de buffer : iv (12 o) + authTag (16 o). Taille disque = taille claire + 28. */
  ENCRYPTION_OVERHEAD_BYTES: 28,
  /** Un blob plus récent que ça n'est jamais considéré orphelin (création en cours). */
  ORPHAN_MIN_AGE_MS: 10 * 60 * 1000,
  MAX_NAME_LENGTH: 100,
  MAX_PLACEMENT_JSON_LENGTH: 2048,
  ALLOWED_MIME_TYPES: ["image/png", "image/jpeg", "image/webp"],
} as const;

/**
 * Détecte le vrai type d'une image via ses magic bytes (PNG, JPEG, WebP).
 * @returns le MIME détecté ou null
 */
export function detectPlanMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
