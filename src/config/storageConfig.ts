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
