/**
 * Tests unitaires pour adminStorageController.
 * Focus P1 : nouveau endpoint POST /api/v1/admin/users/:userId/quota
 * (body { quotaBytes }) appelé par l'interface admin web.
 */

jest.mock("../../services/storageQuotaService", () => ({
  __esModule: true,
  default: {
    updateUserQuota: jest.fn(),
    getUserStorageInfo: jest.fn(),
    getAllUsersStorage: jest.fn(),
  },
}));
jest.mock("../../services/storageService", () => ({
  __esModule: true,
  default: {
    listUserPhotos: jest.fn(),
    calculateUserStorage: jest.fn(),
    findOrphanFiles: jest.fn(),
    deletePointPhoto: jest.fn(),
    calculateTotalStorage: jest.fn(),
  },
}));
jest.mock("../../models/points");

import { Request, Response } from "express";
import {
  setUserQuotaBytes,
  updateUserQuota,
} from "../../controllers/adminStorageController";
import storageQuotaService from "../../services/storageQuotaService";
import { mockRequest, mockResponse } from "../mocks";

const VALID_OBJECT_ID = "507f1f77bcf86cd799439011";

describe("adminStorageController — setUserQuotaBytes (P1)", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = mockRequest({
      user: { id: "admin-1", isAdmin: true },
      params: { userId: VALID_OBJECT_ID },
      body: { quotaBytes: 5 * 1024 * 1024 * 1024 }, // 5 Go
    });
    res = mockResponse();

    (storageQuotaService.updateUserQuota as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  it("met à jour le quota et retourne { id, quotaBytes }", async () => {
    await setUserQuotaBytes(req as Request, res as Response);

    expect(storageQuotaService.updateUserQuota).toHaveBeenCalledWith(
      VALID_OBJECT_ID,
      5 * 1024 * 1024 * 1024,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: VALID_OBJECT_ID,
      quotaBytes: 5 * 1024 * 1024 * 1024,
    });
  });

  it("rejette un userId non ObjectId valide (400)", async () => {
    req.params = { userId: "not-an-object-id" };
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ID utilisateur invalide" }),
    );
    expect(storageQuotaService.updateUserQuota).not.toHaveBeenCalled();
  });

  it("rejette un quotaBytes manquant (400)", async () => {
    req.body = {};
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_QUOTA_BYTES" }),
    );
  });

  it("rejette un quotaBytes négatif (400)", async () => {
    req.body = { quotaBytes: -1 };
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_QUOTA_BYTES" }),
    );
  });

  it("rejette un quotaBytes non-finite (400)", async () => {
    req.body = { quotaBytes: Number.NaN };
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_QUOTA_BYTES" }),
    );
  });

  it("rejette un quotaBytes excessif (> 1 Po) avec QUOTA_TOO_LARGE (400)", async () => {
    req.body = { quotaBytes: 2 * 1024 * 1024 * 1024 * 1024 * 1024 };
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "QUOTA_TOO_LARGE" }),
    );
  });

  it("retourne 500 si le service throw", async () => {
    (storageQuotaService.updateUserQuota as jest.Mock).mockRejectedValue(
      new Error("DB down"),
    );
    await setUserQuotaBytes(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("le PATCH historique (quotaGb) reste fonctionnel — rétro-compat", async () => {
    (storageQuotaService.updateUserQuota as jest.Mock).mockResolvedValue(
      undefined,
    );
    (storageQuotaService.getUserStorageInfo as jest.Mock).mockResolvedValue({
      used: 0,
      quota: 5 * 1024 * 1024 * 1024,
      available: 5 * 1024 * 1024 * 1024,
      percentage: 0,
    });
    req.body = { quotaGb: 5 };
    await updateUserQuota(req as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(storageQuotaService.updateUserQuota).toHaveBeenCalledWith(
      VALID_OBJECT_ID,
      5 * 1024 * 1024 * 1024,
    );
  });
});
