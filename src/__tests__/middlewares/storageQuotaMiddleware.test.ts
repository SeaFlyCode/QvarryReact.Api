// src/__tests__/middlewares/storageQuotaMiddleware.test.ts
// Tests unitaires pour le middleware de vérification de quota

import { Request, Response, NextFunction } from "express";
import { checkStorageQuota } from "../../middlewares/storageQuotaMiddleware";
import storageQuotaService from "../../services/storageQuotaService";
import { STORAGE_CONFIG } from "../../config/storageConfig";
import {
  createMockJpegBuffer,
  TEST_CONSTANTS,
} from "../helpers/imageTestHelpers";

const { GB } = TEST_CONSTANTS;

// V7r4: mock logger requis sinon `logger.child(...)` retourne undefined et
// le middleware crash sur `quotaLogger.error(...)` dans le catch.
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Mock du service de quota
jest.mock("../../services/storageQuotaService");

describe("StorageQuotaMiddleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    // V7r4: middleware utilise req.user.id (posé par authMiddleware), pas req.userId.
    mockReq = {
      user: { id: "user123" },
    } as any;

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe("checkStorageQuota", () => {
    it("devrait passer si quota disponible", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        true,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(storageQuotaService.checkQuotaAvailable).toHaveBeenCalledWith(
        "user123",
        STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
      );
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("devrait bloquer si quota dépassé", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        false,
      );

      const mockStorageInfo = {
        used: 1.9 * GB,
        quota: 2 * GB,
        available: 0.1 * GB,
        percentage: 95,
      };

      (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue(
        mockStorageInfo,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(507);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Quota de stockage dépassé",
          required: STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
          available: mockStorageInfo.available,
          quota: mockStorageInfo.quota,
          used: mockStorageInfo.used,
          percentage: mockStorageInfo.percentage,
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("devrait rejeter si utilisateur non authentifié", async () => {
      (mockReq as any).userId = undefined;

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Non authentifié",
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("devrait rejeter si aucun fichier fourni", async () => {
      mockReq.file = undefined;

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Aucun fichier fourni",
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("devrait vérifier avec la taille max après compression", async () => {
      const largeBuffer = createMockJpegBuffer(500); // 500 Ko avant compression
      mockReq.file = {
        buffer: largeBuffer,
        originalname: "large.jpg",
        mimetype: "image/jpeg",
        size: largeBuffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        true,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      // Devrait vérifier avec MAX_IMAGE_SIZE_BYTES (250 Ko après compression)
      expect(storageQuotaService.checkQuotaAvailable).toHaveBeenCalledWith(
        "user123",
        STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Erreur lors de la vérification du quota de stockage",
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("devrait inclure les informations détaillées de quota dans l'erreur", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        false,
      );

      const mockStorageInfo = {
        used: 1.95 * GB,
        quota: 2 * GB,
        available: 0.05 * GB,
        percentage: 97.5,
      };

      (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue(
        mockStorageInfo,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      const response = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(response).toMatchObject({
        error: "Quota de stockage dépassé",
        required: STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
        available: mockStorageInfo.available,
        quota: mockStorageInfo.quota,
        used: mockStorageInfo.used,
        percentage: mockStorageInfo.percentage,
      });
    });

    it("devrait passer même si le fichier est gros (sera compressé)", async () => {
      const hugeBuffer = createMockJpegBuffer(5000); // 5 Mo
      mockReq.file = {
        buffer: hugeBuffer,
        originalname: "huge.jpg",
        mimetype: "image/jpeg",
        size: hugeBuffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        true,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      // Le middleware vérifie seulement avec MAX_IMAGE_SIZE_BYTES
      expect(storageQuotaService.checkQuotaAvailable).toHaveBeenCalledWith(
        "user123",
        STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it("devrait gérer le cas où getUserStorageInfo échoue", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        false,
      );

      (storageQuotaService.getUserStorageInfo as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it("devrait utiliser userId depuis req.userId", async () => {
      const buffer = createMockJpegBuffer(100);
      (mockReq as any).userId = "customUserId";
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        true,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(storageQuotaService.checkQuotaAvailable).toHaveBeenCalledWith(
        "customUserId",
        STORAGE_CONFIG.MAX_IMAGE_SIZE_BYTES,
      );
    });
  });

  describe("Error scenarios", () => {
    it("devrait gérer quota exactement à zéro", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        false,
      );

      const mockStorageInfo = {
        used: 2 * GB,
        quota: 2 * GB,
        available: 0,
        percentage: 100,
      };

      (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue(
        mockStorageInfo,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(507);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          available: 0,
          percentage: 100,
        }),
      );
    });

    it("devrait gérer quota dépassé (over 100%)", async () => {
      const buffer = createMockJpegBuffer(100);
      mockReq.file = {
        buffer,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: buffer.length,
      } as Express.Multer.File;

      (storageQuotaService.checkQuotaAvailable as jest.Mock).mockResolvedValue(
        false,
      );

      const mockStorageInfo = {
        used: 2.5 * GB,
        quota: 2 * GB,
        available: 0, // Le service retourne 0 pour les valeurs négatives
        percentage: 125,
      };

      (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue(
        mockStorageInfo,
      );

      await checkStorageQuota(
        mockReq as Request,
        mockRes as Response,
        mockNext,
      );

      expect(mockRes.status).toHaveBeenCalledWith(507);
    });
  });
});
