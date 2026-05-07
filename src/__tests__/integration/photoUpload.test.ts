/**
 * Tests d'intégration end-to-end pour POST /points/:pointId/photo (multipart).
 *
 * Couverture (REFONTE §4.1.2 B) :
 * - 201 sur upload OK avec un Buffer JPEG valide (magic number JPEG)
 * - 400 si aucun fichier fourni
 * - 400 si pointId invalide (mongoose ObjectId)
 * - 404 si point inexistant
 * - 413 si fichier trop volumineux (multer fileSize limit)
 * - 400 sur extension/MIME non autorisé (multer fileFilter)
 * - 507 si quota stockage dépassé (QuotaExceededError du service)
 *
 * Approche : mini-app Express qui monte le pipeline réel
 * (multer + validateImageUpload + uploadPointPhoto). Les services en aval
 * (PointModel, storageService, imageProcessingService, storageQuotaService)
 * sont mockés pour isoler la logique du pipeline d'upload.
 */

// Stubs des dépendances HEAVY avant les imports
jest.mock("../../models/points");
jest.mock("../../services/storageService");
jest.mock("../../services/imageProcessingService");
jest.mock("../../services/storageQuotaService", () => {
  const actual = jest.requireActual("../../services/storageQuotaService");
  return {
    __esModule: true,
    default: {
      incrementStorageUsed: jest.fn(),
      decrementStorageUsed: jest.fn(),
      getUserStorageInfo: jest.fn(),
    },
    QuotaExceededError: actual.QuotaExceededError,
  };
});
jest.mock("../../services/memoryStorageService", () => ({
  memoryStorage: {
    getPointById: jest.fn(),
    storePoint: jest.fn(),
  },
}));
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import mongoose from "mongoose";
import {
  upload,
  validateImageUpload,
} from "../../middlewares/imageUploadMiddleware";
import { uploadPointPhoto } from "../../controllers/pointsPhotosController";
import PointModel from "../../models/points";
import storageService from "../../services/storageService";
import imageProcessingService from "../../services/imageProcessingService";
import storageQuotaService, {
  QuotaExceededError,
} from "../../services/storageQuotaService";

// Mini buffer JPEG valide : magic number JPEG (FF D8 FF) + padding minimal.
// Le service de processing est mocké, donc le contenu est juste accepté par
// le fileFilter de multer (qui ne lit que le mimetype declarated).
const fakeJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const validUserId = "507f1f77bcf86cd799439011";
const validPointId = "507f1f77bcf86cd799439012";

function buildTestApp() {
  const app = express();
  app.post(
    "/points/:pointId/photo",
    // Auth fake : injecte un user dans req
    (req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { id: validUserId, isAdmin: false };
      next();
    },
    upload.single("photo"),
    validateImageUpload,
    uploadPointPhoto,
  );
  // Error handler multer (pour fileFilter rejet → renvoie 400)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err && err.message && err.message.includes("Format non supporté")) {
      return res.status(400).json({ error: err.message });
    }
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Fichier trop volumineux" });
    }
    return res.status(500).json({ error: "Internal" });
  });
  return app;
}

describe("Integration: POST /points/:pointId/photo (multipart)", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildTestApp();

    // Defaults : point trouvé, pas de photo existante.
    (PointModel.findOne as jest.Mock).mockResolvedValue({
      _id: new mongoose.Types.ObjectId(validPointId),
      userId: new mongoose.Types.ObjectId(validUserId),
      photo: undefined,
      save: jest.fn().mockResolvedValue(true),
    });

    (imageProcessingService.processImage as jest.Mock).mockResolvedValue({
      buffer: fakeJpegBuffer,
      size: 12345,
      mimeType: "image/jpeg",
      checksum: "deadbeef",
    });

    (storageService.savePointPhoto as jest.Mock).mockResolvedValue(
      "/tmp/test/photo.jpg.tmp",
    );
    (storageService.renamePointPhoto as jest.Mock).mockResolvedValue(undefined);
    (storageService.deletePointPhoto as jest.Mock).mockResolvedValue(undefined);

    (storageQuotaService.incrementStorageUsed as jest.Mock).mockResolvedValue(
      true,
    );
    (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue({
      used: 12345,
      quota: 2 * 1024 * 1024 * 1024,
      percentage: 0.001,
    });
  });

  it("retourne 201 sur upload JPEG valide", async () => {
    const res = await request(app)
      .post(`/points/${validPointId}/photo`)
      .attach("photo", fakeJpegBuffer, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Photo uploaded successfully");
    expect(res.body.photo).toEqual(
      expect.objectContaining({
        size: 12345,
        checksum: "deadbeef",
      }),
    );
    expect(imageProcessingService.processImage).toHaveBeenCalledTimes(1);
    expect(storageService.savePointPhoto).toHaveBeenCalledTimes(1);
    expect(storageService.renamePointPhoto).toHaveBeenCalledTimes(1);
    expect(storageQuotaService.incrementStorageUsed).toHaveBeenCalledWith(
      validUserId,
      12345,
    );
  });

  it("retourne 400 si aucun fichier fourni", async () => {
    const res = await request(app).post(`/points/${validPointId}/photo`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Aucun fichier fourni");
  });

  it("retourne 400 si pointId invalide (ObjectId)", async () => {
    const res = await request(app)
      .post(`/points/not-an-objectid/photo`)
      .attach("photo", fakeJpegBuffer, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ID de point invalide");
  });

  it("retourne 404 si point inexistant", async () => {
    (PointModel.findOne as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post(`/points/${validPointId}/photo`)
      .attach("photo", fakeJpegBuffer, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Point non trouvé");
  });

  it("retourne 400 sur MIME non autorisé (text/plain)", async () => {
    const res = await request(app)
      .post(`/points/${validPointId}/photo`)
      .attach("photo", Buffer.from("not an image"), {
        filename: "evil.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format non supporté/);
  });

  it("retourne 413 sur fichier trop volumineux (>10 Mo)", async () => {
    // Buffer >10 Mo pour déclencher LIMIT_FILE_SIZE de multer
    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    // Magic JPEG en tête pour passer le fileFilter
    oversize[0] = 0xff;
    oversize[1] = 0xd8;
    oversize[2] = 0xff;

    const res = await request(app)
      .post(`/points/${validPointId}/photo`)
      .attach("photo", oversize, {
        filename: "huge.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
  });

  it("retourne 507 si quota dépassé (QuotaExceededError)", async () => {
    (storageQuotaService.incrementStorageUsed as jest.Mock).mockRejectedValue(
      new QuotaExceededError("Quota dépassé pour user " + validUserId, 12345),
    );

    const res = await request(app)
      .post(`/points/${validPointId}/photo`)
      .attach("photo", fakeJpegBuffer, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(507);
  });
});
