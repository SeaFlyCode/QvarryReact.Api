// src/__tests__/services/imageProcessingService.test.ts
// Tests unitaires pour le service de traitement d'images

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import imageProcessingService from "../../services/imageProcessingService";
import {
  createMockJpegBuffer,
  createMockPngBuffer,
  createMockHeicBuffer,
  createMockWebpBuffer,
  createMockPdfBuffer,
  createLargeImageBuffer,
} from "../helpers/imageTestHelpers";
import { STORAGE_CONFIG } from "../../config/storageConfig";
import sharp from "sharp";

// Mock Sharp pour certains tests
jest.mock("sharp", () => {
  return jest.fn();
});

// Mock heic-convert
jest.mock("heic-convert", () => {
  return jest.fn().mockImplementation(({ buffer, format }: any) => {
    // Retourner un buffer JPEG simulé
    return Promise.resolve(
      Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01,
      ]),
    );
  });
});

describe("ImageProcessingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateMimeType", () => {
    it("devrait valider un JPEG avec magic numbers corrects", () => {
      const buffer = createMockJpegBuffer(10);
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/jpeg",
      );
      expect(isValid).toBe(true);
    });

    it("devrait valider un PNG avec magic numbers corrects", () => {
      const buffer = createMockPngBuffer(10);
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/png",
      );
      expect(isValid).toBe(true);
    });

    it("devrait valider un WebP avec magic numbers corrects", () => {
      const buffer = createMockWebpBuffer(10);
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/webp",
      );
      expect(isValid).toBe(true);
    });

    it("devrait valider un HEIC avec conteneur ISO correct", () => {
      const buffer = createMockHeicBuffer(10);
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/heic",
      );
      expect(isValid).toBe(true);
    });

    it("devrait rejeter un MIME type non autorisé", () => {
      const buffer = createMockPdfBuffer();
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "application/pdf",
      );
      expect(isValid).toBe(false);
    });

    it("devrait rejeter un fichier avec magic numbers incorrects", () => {
      const buffer = createMockPdfBuffer();
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/jpeg",
      );
      expect(isValid).toBe(false);
    });

    it("devrait rejeter un buffer vide", () => {
      const buffer = Buffer.alloc(0);
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/jpeg",
      );
      expect(isValid).toBe(false);
    });

    it("devrait gérer les erreurs gracieusement", () => {
      const buffer = Buffer.from([0x00]); // Buffer trop petit
      const isValid = imageProcessingService.validateMimeType(
        buffer,
        "image/jpeg",
      );
      expect(isValid).toBe(false);
    });
  });

  describe("generateChecksum", () => {
    it("devrait générer un checksum SHA256 valide", () => {
      const buffer = createMockJpegBuffer(10);
      const checksum = imageProcessingService.generateChecksum(buffer);

      expect(checksum).toBeDefined();
      expect(typeof checksum).toBe("string");
      expect(checksum.length).toBe(64); // SHA256 = 64 caractères hexa
      expect(/^[a-f0-9]{64}$/.test(checksum)).toBe(true);
    });

    it("devrait générer des checksums différents pour des buffers différents", () => {
      const buffer1 = createMockJpegBuffer(10);
      const buffer2 = createMockPngBuffer(10);

      const checksum1 = imageProcessingService.generateChecksum(buffer1);
      const checksum2 = imageProcessingService.generateChecksum(buffer2);

      expect(checksum1).not.toBe(checksum2);
    });

    it("devrait générer le même checksum pour le même buffer", () => {
      const buffer = createMockJpegBuffer(10);

      const checksum1 = imageProcessingService.generateChecksum(buffer);
      const checksum2 = imageProcessingService.generateChecksum(buffer);

      expect(checksum1).toBe(checksum2);
    });

    it("devrait gérer un buffer vide", () => {
      const buffer = Buffer.alloc(0);
      const checksum = imageProcessingService.generateChecksum(buffer);

      expect(checksum).toBeDefined();
      expect(typeof checksum).toBe("string");
      expect(checksum.length).toBe(64);
    });
  });

  describe("compressImage", () => {
    beforeEach(() => {
      // Reset du mock Sharp
      (sharp as any).mockReset();
    });

    it("devrait compresser une image jusqu'à la taille cible", async () => {
      const inputBuffer = createMockJpegBuffer(500); // 500 Ko
      const targetSizeKb = 250;

      // Mock Sharp pour retourner un buffer compressé
      const mockSharpInstance: any = {
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest
          .fn()
          .mockResolvedValue(createMockJpegBuffer(targetSizeKb - 10)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.compressImage(
        inputBuffer,
        targetSizeKb,
      );

      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockSharpInstance.jpeg).toHaveBeenCalled();
      expect(mockSharpInstance.toBuffer).toHaveBeenCalled();
    });

    it("devrait réduire la qualité progressivement jusqu'à atteindre la cible", async () => {
      const inputBuffer = createMockJpegBuffer(500);
      const targetSizeKb = 250;
      let callCount = 0;

      const mockSharpInstance: any = {
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockImplementation(async () => {
          callCount++;
          // Première tentative: trop gros, deuxième: OK
          if (callCount === 1) {
            return createMockJpegBuffer(300);
          }
          return createMockJpegBuffer(240);
        }),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.compressImage(
        inputBuffer,
        targetSizeKb,
      );

      expect(mockSharpInstance.jpeg).toHaveBeenCalledTimes(2);
      expect(result.length).toBeLessThanOrEqual(targetSizeKb * 1024);
    });

    it("devrait s'arrêter après un nombre maximum de tentatives", async () => {
      const inputBuffer = createMockJpegBuffer(1000);
      const targetSizeKb = 50;

      const mockSharpInstance: any = {
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(500)), // Toujours trop gros
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.compressImage(
        inputBuffer,
        targetSizeKb,
      );

      expect(result).toBeDefined();
      expect(mockSharpInstance.jpeg).toHaveBeenCalled();
      // Devrait s'arrêter après max attempts
    });

    it("devrait gérer les erreurs de compression", async () => {
      const inputBuffer = createMockJpegBuffer(100);

      (sharp as any).mockImplementation(() => {
        throw new Error("Compression error");
      });

      await expect(
        imageProcessingService.compressImage(inputBuffer, 250),
      ).rejects.toThrow("Échec de la compression de l'image");
    });

    it("devrait utiliser la taille par défaut si non spécifiée", async () => {
      const inputBuffer = createMockJpegBuffer(100);

      const mockSharpInstance: any = {
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(240)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.compressImage(inputBuffer);

      expect(result).toBeDefined();
      expect(mockSharpInstance.jpeg).toHaveBeenCalled();
    });
  });

  describe("convertHeicToJpeg", () => {
    it("devrait convertir un HEIC en JPEG", async () => {
      const heicBuffer = createMockHeicBuffer(100);

      const result = await imageProcessingService.convertHeicToJpeg(heicBuffer);

      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("devrait gérer les erreurs de conversion", async () => {
      const heicConvert = require("heic-convert");
      heicConvert.mockImplementationOnce(() => {
        throw new Error("Conversion error");
      });

      const heicBuffer = createMockHeicBuffer(100);

      await expect(
        imageProcessingService.convertHeicToJpeg(heicBuffer),
      ).rejects.toThrow("Échec de la conversion HEIC vers JPEG");
    });
  });

  describe("processImage", () => {
    beforeEach(() => {
      (sharp as any).mockReset();
    });

    it("devrait traiter une image JPEG valide", async () => {
      const inputBuffer = createMockJpegBuffer(100);

      const mockSharpInstance: any = {
        metadata: jest
          .fn()
          .mockResolvedValue({ width: 1000, height: 1000, format: "jpeg" }),
        jpeg: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(200)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        inputBuffer,
        "image/jpeg",
        "test.jpg",
      );

      expect(result).toBeDefined();
      expect(result.buffer).toBeDefined();
      expect(result.size).toBeGreaterThan(0);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.checksum).toBeDefined();
      expect(result.width).toBeDefined();
      expect(result.height).toBeDefined();
    });

    it("devrait redimensionner les images trop grandes", async () => {
      const inputBuffer = createMockJpegBuffer(100);

      const mockSharpInstance: any = {
        metadata: jest.fn().mockResolvedValueOnce({
          width: 3000,
          height: 2500,
          format: "jpeg",
        }),
        jpeg: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(200)),
      };

      // Pour le deuxième appel à sharp (après compression)
      mockSharpInstance.metadata.mockResolvedValueOnce({
        width: 1920,
        height: 1600,
        format: "jpeg",
      });

      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        inputBuffer,
        "image/jpeg",
        "large.jpg",
      );

      expect(result).toBeDefined();
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(
        STORAGE_CONFIG.IMAGE_MAX_WIDTH,
        STORAGE_CONFIG.IMAGE_MAX_HEIGHT,
        {
          fit: "inside",
          withoutEnlargement: true,
        },
      );
    });

    it("devrait convertir HEIC en JPEG", async () => {
      const heicBuffer = createMockHeicBuffer(100);

      const mockSharpInstance: any = {
        metadata: jest
          .fn()
          .mockResolvedValue({ width: 1000, height: 1000, format: "jpeg" }),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(200)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        heicBuffer,
        "image/heic",
        "test.heic",
      );

      expect(result).toBeDefined();
      expect(result.mimeType).toBe("image/jpeg");
    });

    it("devrait rejeter un MIME type invalide", async () => {
      const pdfBuffer = createMockPdfBuffer();

      await expect(
        imageProcessingService.processImage(pdfBuffer, "application/pdf"),
      ).rejects.toThrow("Type MIME invalide détecté");
    });

    it("devrait rejeter un fichier avec magic numbers incorrects", async () => {
      const fakeBuffer = createMockPdfBuffer();

      await expect(
        imageProcessingService.processImage(fakeBuffer, "image/jpeg"),
      ).rejects.toThrow("Type MIME invalide détecté");
    });

    it("devrait gérer un buffer vide", async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(
        imageProcessingService.processImage(emptyBuffer, "image/jpeg"),
      ).rejects.toThrow();
    });

    it("devrait inclure le checksum dans le résultat", async () => {
      const inputBuffer = createMockJpegBuffer(100);

      const mockSharpInstance: any = {
        metadata: jest
          .fn()
          .mockResolvedValue({ width: 1000, height: 1000, format: "jpeg" }),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(200)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        inputBuffer,
        "image/jpeg",
      );

      expect(result.checksum).toBeDefined();
      expect(typeof result.checksum).toBe("string");
      expect(result.checksum.length).toBe(64);
    });

    it("devrait compresser l'image jusqu'à la taille max", async () => {
      const largeBuffer = createMockJpegBuffer(500);

      const mockSharpInstance: any = {
        metadata: jest
          .fn()
          .mockResolvedValue({ width: 1000, height: 1000, format: "jpeg" }),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(240)), // < 250 Ko
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        largeBuffer,
        "image/jpeg",
      );

      expect(result.size).toBeLessThanOrEqual(
        STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
      );
    });

    it("devrait gérer les formats image/heif", async () => {
      const heifBuffer = createMockHeicBuffer(100);

      const mockSharpInstance: any = {
        metadata: jest
          .fn()
          .mockResolvedValue({ width: 1000, height: 1000, format: "jpeg" }),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(createMockJpegBuffer(200)),
      };
      (sharp as any).mockReturnValue(mockSharpInstance);

      const result = await imageProcessingService.processImage(
        heifBuffer,
        "image/heif",
      );

      expect(result.mimeType).toBe("image/jpeg");
    });
  });
});
