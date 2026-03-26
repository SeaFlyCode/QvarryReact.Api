// src/services/imageProcessingService.ts
// Service de traitement et compression d'images

import sharp from "sharp";
import * as crypto from "crypto";
import { logger } from "./loggerService";
import { STORAGE_CONFIG, MAGIC_NUMBERS } from "../config/storageConfig";
import heicConvert from "heic-convert";

/**
 * Interface pour une image traitée
 */
export interface ProcessedImage {
  buffer: Buffer;
  size: number;
  mimeType: string;
  checksum: string;
  width: number;
  height: number;
}

/**
 * Service de traitement d'images
 */
class ImageProcessingService {
  /**
   * Valide le MIME type d'un fichier en vérifiant ses magic numbers
   * @param buffer - Buffer du fichier
   * @param declaredMimeType - Type MIME déclaré
   * @returns true si valide, false sinon
   */
  validateMimeType(buffer: Buffer, declaredMimeType: string): boolean {
    try {
      // Vérifier que le type déclaré est autorisé
      if (
        !STORAGE_CONFIG.ALLOWED_MIME_TYPES.includes(declaredMimeType as any)
      ) {
        logger.warn("Type MIME non autorisé", { declaredMimeType });
        return false;
      }

      // Pour HEIC/HEIF, on ne peut pas vérifier les magic numbers simplement
      if (
        declaredMimeType === "image/heic" ||
        declaredMimeType === "image/heif"
      ) {
        // Vérifier que c'est bien un conteneur ISO (ftyp)
        const ftypSignature = buffer.slice(4, 8).toString("ascii");
        const isHeic =
          ftypSignature === "ftyp" &&
          (buffer.slice(8, 12).toString("ascii").includes("heic") ||
            buffer.slice(8, 12).toString("ascii").includes("mif1"));
        return isHeic;
      }

      // Vérifier les magic numbers pour les autres formats
      const magicNumbers = MAGIC_NUMBERS[declaredMimeType];
      if (!magicNumbers) {
        return false;
      }

      // Comparer les premiers octets
      for (let i = 0; i < magicNumbers.length; i++) {
        if (buffer[i] !== magicNumbers[i]) {
          logger.warn("Magic numbers ne correspondent pas", {
            declaredMimeType,
            expected: magicNumbers,
            actual: Array.from(buffer.slice(0, magicNumbers.length)),
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error("Erreur lors de la validation du MIME type", { error });
      return false;
    }
  }

  /**
   * Compresse une image jusqu'à atteindre la taille cible
   * 🔒 CORRECTION: Rejette les images qui dépassent toujours la limite après compression
   * @param buffer - Buffer de l'image
   * @param targetSizeKb - Taille cible en Ko
   * @returns Buffer de l'image compressée
   * @throws Error si l'image ne peut pas être compressée sous la limite
   */
  async compressImage(
    buffer: Buffer,
    targetSizeKb: number = STORAGE_CONFIG.MAX_IMAGE_SIZE_KB,
  ): Promise<Buffer> {
    try {
      let quality = STORAGE_CONFIG.JPEG_QUALITY;
      let compressed = buffer;
      let attempt = 0;
      const maxAttempts = 10;
      const targetBytes = targetSizeKb * 1024;

      // Obtenir les métadonnées pour le logging
      const metadata = await sharp(buffer).metadata();

      logger.debug("Début compression image", {
        initialSize: buffer.length,
        targetBytes,
        originalWidth: metadata.width,
        originalHeight: metadata.height,
      });

      // Boucle de compression itérative
      while (compressed.length > targetBytes && attempt < maxAttempts) {
        compressed = await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();

        logger.debug("Tentative de compression", {
          attempt: attempt + 1,
          quality,
          resultSize: compressed.length,
          targetSize: targetBytes,
        });

        // Réduire la qualité progressivement
        quality -= 5;
        attempt++;

        if (quality < 20) {
          logger.warn("Qualité trop basse pour atteindre la taille cible", {
            finalSize: compressed.length,
            targetSize: targetBytes,
          });
          break;
        }
      }

      // Vérification finale de la taille - REJETER si trop grande
      if (compressed.length > targetBytes) {
        const finalSizeKb = (compressed.length / 1024).toFixed(2);

        logger.error(
          "Impossible de compresser l'image sous la limite requise",
          {
            finalSize: compressed.length,
            finalSizeKb,
            targetSize: targetBytes,
            targetSizeKb: targetSizeKb,
            attempts: attempt,
            originalWidth: metadata.width,
            originalHeight: metadata.height,
          },
        );

        throw new Error(
          `L'image ne peut pas être compressée sous ${targetSizeKb}Ko. ` +
            `Taille finale: ${finalSizeKb}Ko. ` +
            `Veuillez réduire la résolution de l'image ou choisir une photo moins détaillée.`,
        );
      }

      logger.info("Compression réussie", {
        finalSize: compressed.length,
        finalSizeKb: (compressed.length / 1024).toFixed(2),
        attempts: attempt,
        compressionRatio:
          ((1 - compressed.length / buffer.length) * 100).toFixed(1) + "%",
      });

      return compressed;
    } catch (error) {
      logger.error("Erreur lors de la compression de l'image", { error });
      throw error instanceof Error
        ? error
        : new Error("Échec de la compression de l'image");
    }
  }

  /**
   * Génère un checksum SHA256 d'un buffer
   * @param buffer - Buffer à hasher
   * @returns Checksum en hexadécimal
   */
  generateChecksum(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Convertit une image HEIC en JPEG
   * @param buffer - Buffer de l'image HEIC
   * @returns Buffer de l'image JPEG
   */
  async convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
    try {
      logger.info("Conversion HEIC vers JPEG");

      const outputBuffer = await heicConvert({
        buffer,
        format: "JPEG",
        quality: 1, // Qualité max, on compressera après
      });

      return Buffer.from(outputBuffer);
    } catch (error) {
      logger.error("Erreur lors de la conversion HEIC vers JPEG", { error });
      throw new Error("Échec de la conversion HEIC vers JPEG");
    }
  }

  /**
   * Traite une image : validation, conversion, redimensionnement, compression
   * @param buffer - Buffer de l'image
   * @param mimeType - Type MIME déclaré
   * @param originalName - Nom du fichier original
   * @returns Image traitée
   */
  async processImage(
    buffer: Buffer,
    mimeType: string,
    originalName: string = "unknown",
  ): Promise<ProcessedImage> {
    try {
      logger.info("Début du traitement d'image", {
        originalName,
        mimeType,
        size: buffer.length,
      });

      // 1. Validation du MIME type
      if (!this.validateMimeType(buffer, mimeType)) {
        throw new Error("Type MIME invalide détecté");
      }

      let processedBuffer = buffer;

      // 2. Conversion HEIC → JPEG si nécessaire
      if (mimeType === "image/heic" || mimeType === "image/heif") {
        processedBuffer = await this.convertHeicToJpeg(buffer);
        mimeType = "image/jpeg";
      }

      // 3. Obtenir les métadonnées de l'image
      const metadata = await sharp(processedBuffer).metadata();
      logger.debug("Métadonnées image", {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      });

      // 4. Redimensionner si nécessaire
      if (
        metadata.width &&
        metadata.height &&
        (metadata.width > STORAGE_CONFIG.IMAGE_MAX_WIDTH ||
          metadata.height > STORAGE_CONFIG.IMAGE_MAX_HEIGHT)
      ) {
        logger.info("Redimensionnement de l'image", {
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          maxWidth: STORAGE_CONFIG.IMAGE_MAX_WIDTH,
          maxHeight: STORAGE_CONFIG.IMAGE_MAX_HEIGHT,
        });

        processedBuffer = await sharp(processedBuffer)
          .resize(
            STORAGE_CONFIG.IMAGE_MAX_WIDTH,
            STORAGE_CONFIG.IMAGE_MAX_HEIGHT,
            {
              fit: "inside",
              withoutEnlargement: true,
            },
          )
          .toBuffer();
      }

      // 5. Compresser l'image jusqu'à atteindre la taille max
      processedBuffer = await this.compressImage(
        processedBuffer,
        STORAGE_CONFIG.MAX_IMAGE_SIZE_KB,
      );

      // 6. Obtenir les dimensions finales
      const finalMetadata = await sharp(processedBuffer).metadata();

      // 7. Générer le checksum
      const checksum = this.generateChecksum(processedBuffer);

      logger.info("Traitement d'image terminé", {
        originalName,
        originalSize: buffer.length,
        finalSize: processedBuffer.length,
        compressionRatio: (
          ((buffer.length - processedBuffer.length) / buffer.length) *
          100
        ).toFixed(2),
        finalWidth: finalMetadata.width,
        finalHeight: finalMetadata.height,
        checksum,
      });

      return {
        buffer: processedBuffer,
        size: processedBuffer.length,
        mimeType: "image/jpeg", // Toujours JPEG après traitement
        checksum,
        width: finalMetadata.width || 0,
        height: finalMetadata.height || 0,
      };
    } catch (error) {
      logger.error("Erreur lors du traitement de l'image", {
        originalName,
        error,
      });
      throw error;
    }
  }
}

export default new ImageProcessingService();
