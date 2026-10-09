/**
 * Tests plansController : autorisation inter-users, quota, validation, magic bytes,
 * chiffrement du fichier et des métadonnées.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import sharp from "sharp";

jest.mock("../../services/loggerService");
jest.mock("../../models/plan");
jest.mock("../../services/planStorageService");
jest.mock("../../services/storageQuotaService", () => {
  class QuotaExceededError extends Error {
    constructor() {
      super("quota");
      this.name = "QuotaExceededError";
    }
  }
  return {
    __esModule: true,
    QuotaExceededError,
    default: {
      checkQuotaAvailable: jest.fn(),
      incrementStorageUsed: jest.fn(),
      decrementStorageUsed: jest.fn(),
      getUserStorageInfo: jest.fn(),
    },
  };
});
jest.mock("../../utils/userEncryptionUtils", () => {
  const actual = jest.requireActual("../../utils/userEncryptionUtils");
  return { ...actual, getUserEncryptionKey: jest.fn() };
});

import {
  listPlans,
  createPlan,
  getPlanFile,
  updatePlan,
  deletePlan,
} from "../../controllers/plansController";
import PlanModel from "../../models/plan";
import planStorageService from "../../services/planStorageService";
import storageQuotaService, { QuotaExceededError } from "../../services/storageQuotaService";
import {
  getUserEncryptionKey,
  decryptBufferWithKey,
  decryptWithKey,
} from "../../utils/userEncryptionUtils";
import { mockRequest, mockResponse } from "../mocks";

const key = crypto.randomBytes(32).toString("hex");
const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();

const placement = {
  centerLat: 48.1, centerLng: 2.3, widthMeters: 100,
  aspectRatio: 1.5, rotationDeg: 10, opacity: 0.8, visible: true,
};

const quota = storageQuotaService as jest.Mocked<typeof storageQuotaService>;
const model = PlanModel as unknown as jest.Mocked<Record<string, jest.Mock>>;
const storage = planStorageService as jest.Mocked<typeof planStorageService>;

async function png(w = 20, h = 10): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
}

function file(buffer: Buffer, mimetype = "image/png"): any {
  return { buffer, mimetype, originalname: "plan.png", size: buffer.length };
}

function makeDoc(overrides: any = {}) {
  const { encryptWithKey } = jest.requireActual("../../utils/userEncryptionUtils");
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(userA),
    nameEncrypted: encryptWithKey("Mon plan", key),
    mime: "image/png",
    size: 1234,
    filePath: "x/y.bin",
    placementEncrypted: encryptWithKey(JSON.stringify(placement), key),
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("plansController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserEncryptionKey as jest.Mock).mockResolvedValue(key);
    quota.checkQuotaAvailable.mockResolvedValue(true);
    quota.incrementStorageUsed.mockResolvedValue(undefined);
    quota.decrementStorageUsed.mockResolvedValue(undefined);
    quota.getUserStorageInfo.mockResolvedValue({ used: 1, quota: 2, available: 1, percentage: 50 });
    storage.savePlanBlob.mockResolvedValue("u/p.bin");
    storage.deletePlanBlob.mockResolvedValue(undefined);
    model.countDocuments = jest.fn().mockResolvedValue(0);
    model.create = jest.fn().mockImplementation(async (d: any) => ({ ...makeDoc(), ...d }));
  });

  describe("createPlan", () => {
    it("401 sans auth", async () => {
      const res = mockResponse();
      await createPlan(mockRequest() as any, res as any);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("400 sans fichier", async () => {
      const res = mockResponse();
      await createPlan(mockRequest({ user: { id: userA } }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("201 : chiffre le blob et les métadonnées", async () => {
      const buf = await png();
      const req: any = mockRequest({
        user: { id: userA },
        body: { name: "Galerie", placement: JSON.stringify(placement) },
      });
      req.file = file(buf);
      const res = mockResponse();
      await createPlan(req, res as any);

      expect(res.status).toHaveBeenCalledWith(201);
      const saved = storage.savePlanBlob.mock.calls[0][2] as Buffer;
      expect(saved.equals(buf)).toBe(false);
      expect(decryptBufferWithKey(saved, key).equals(buf)).toBe(true);
      expect(quota.incrementStorageUsed).toHaveBeenCalledWith(userA, buf.length);

      const created = model.create.mock.calls[0][0];
      expect(created.nameEncrypted).not.toContain("Galerie");
      expect(decryptWithKey(created.nameEncrypted, key)).toBe("Galerie");
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.plan).toEqual(
        expect.objectContaining({ name: "Galerie", mime: "image/png", placement }),
      );
    });

    it("400 si le contenu n'est pas une image (MIME déclaré png mais magic bytes faux)", async () => {
      const req: any = mockRequest({ user: { id: userA } });
      req.file = file(Buffer.from("%PDF-1.4 fake pdf content"), "image/png");
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(storage.savePlanBlob).not.toHaveBeenCalled();
    });

    it("400 si MIME déclaré jpeg mais contenu PNG", async () => {
      const req: any = mockRequest({ user: { id: userA } });
      req.file = file(await png(), "image/jpeg");
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(storage.savePlanBlob).not.toHaveBeenCalled();
    });

    it("400 si image tronquée/corrompue malgré des magic bytes valides", async () => {
      const req: any = mockRequest({ user: { id: userA } });
      req.file = file(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]));
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it.each([
      ["JSON invalide", "{nope"],
      ["lat hors bornes", JSON.stringify({ ...placement, centerLat: 91 })],
      ["opacity > 1", JSON.stringify({ ...placement, opacity: 2 })],
    ])("400 placement : %s", async (_n, raw) => {
      const req: any = mockRequest({ user: { id: userA }, body: { placement: raw } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(storage.savePlanBlob).not.toHaveBeenCalled();
    });

    it("400 si nom > 100 caractères", async () => {
      const req: any = mockRequest({ user: { id: userA }, body: { name: "a".repeat(101) } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("409 si limite de 50 plans atteinte", async () => {
      model.countDocuments.mockResolvedValue(50);
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(409);
      expect((res.json as jest.Mock).mock.calls[0][0].code).toBe("PLAN_LIMIT_REACHED");
    });

    it("507 si quota insuffisant avant écriture (rien n'est écrit)", async () => {
      quota.checkQuotaAvailable.mockResolvedValue(false);
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(507);
      expect(storage.savePlanBlob).not.toHaveBeenCalled();
    });

    it("507 + nettoyage du blob si QuotaExceededError à l'incrément atomique", async () => {
      quota.incrementStorageUsed.mockRejectedValue(new (QuotaExceededError as any)());
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(507);
      expect(storage.deletePlanBlob).toHaveBeenCalledTimes(1);
      expect(quota.decrementStorageUsed).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    });

    it("rollback blob + quota si la création du document échoue", async () => {
      model.create.mockRejectedValue(new Error("db down"));
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(storage.deletePlanBlob).toHaveBeenCalled();
      expect(quota.decrementStorageUsed).toHaveBeenCalled();
    });

    it("409 + rollback complet si des uploads concurrents dépassent la limite (rang > 50)", async () => {
      model.countDocuments = jest
        .fn()
        .mockResolvedValueOnce(49) // pré-check
        .mockResolvedValueOnce(51); // rang après création
      model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(409);
      expect((res.json as jest.Mock).mock.calls[0][0].code).toBe("PLAN_LIMIT_REACHED");
      expect(model.deleteOne).toHaveBeenCalledTimes(1);
      expect(storage.deletePlanBlob).toHaveBeenCalledTimes(1);
      expect(quota.decrementStorageUsed).toHaveBeenCalledTimes(1);
    });

    it("500 sans rien écrire si la clé utilisateur n'existe pas", async () => {
      (getUserEncryptionKey as jest.Mock).mockRejectedValue(new Error("Clé AES non trouvée"));
      const req: any = mockRequest({ user: { id: userA }, body: { name: "x" } });
      req.file = file(await png());
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(storage.savePlanBlob).not.toHaveBeenCalled();
      expect(quota.incrementStorageUsed).not.toHaveBeenCalled();
      expect(quota.decrementStorageUsed).not.toHaveBeenCalled();
    });

    it("redimensionne si le côté long dépasse 4096 px", async () => {
      const big = await png(5000, 100);
      const req: any = mockRequest({ user: { id: userA }, body: { name: "big" } });
      req.file = file(big);
      const res = mockResponse();
      await createPlan(req, res as any);
      expect(res.status).toHaveBeenCalledWith(201);
      const clear = decryptBufferWithKey(storage.savePlanBlob.mock.calls[0][2] as Buffer, key);
      const meta = await sharp(clear).metadata();
      expect(meta.width).toBe(4096);
      expect(meta.format).toBe("png");
    });

    it("conserve le fichier tel quel (sans recompression) sous 4096 px", async () => {
      const buf = await png(300, 200);
      const req: any = mockRequest({ user: { id: userA }, body: { name: "ok" } });
      req.file = file(buf);
      const res = mockResponse();
      await createPlan(req, res as any);
      const clear = decryptBufferWithKey(storage.savePlanBlob.mock.calls[0][2] as Buffer, key);
      expect(clear.equals(buf)).toBe(true);
    });
  });

  describe("autorisation inter-users", () => {
    // Le modèle filtre par userId : un plan d'un autre user n'est jamais renvoyé.
    beforeEach(() => {
      model.findOne = jest.fn().mockResolvedValue(null);
    });

    it.each([
      ["getPlanFile", getPlanFile],
      ["updatePlan", updatePlan],
      ["deletePlan", deletePlan],
    ])("%s -> 404 (pas 403) sur le plan d'un autre user", async (_n, handler) => {
      const id = new mongoose.Types.ObjectId().toString();
      const req: any = mockRequest({ user: { id: userB }, params: { id }, body: { name: "x" } });
      const res = mockResponse();
      await (handler as any)(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      const filter = model.findOne.mock.calls[0][0];
      expect(String(filter.userId)).toBe(userB);
      expect(storage.readPlanBlob).not.toHaveBeenCalled();
      expect(quota.decrementStorageUsed).not.toHaveBeenCalled();
    });

    it("404 sur un id malformé", async () => {
      const res = mockResponse();
      await getPlanFile(mockRequest({ user: { id: userA }, params: { id: "../etc" } }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("listPlans", () => {
    it("filtre sur le user et déchiffre nom/placement", async () => {
      const sort = jest.fn().mockResolvedValue([makeDoc()]);
      model.find = jest.fn().mockReturnValue({ sort });
      const res = mockResponse();
      await listPlans(mockRequest({ user: { id: userA } }) as any, res as any);
      expect(String(model.find.mock.calls[0][0].userId)).toBe(userA);
      const { plans } = (res.json as jest.Mock).mock.calls[0][0];
      expect(plans[0]).toEqual(expect.objectContaining({ name: "Mon plan", placement, size: 1234 }));
      expect(plans[0]).not.toHaveProperty("nameEncrypted");
      expect(plans[0]).not.toHaveProperty("filePath");
    });
  });

  describe("getPlanFile", () => {
    it("renvoie le binaire déchiffré avec Content-Type et Cache-Control private", async () => {
      const buf = await png();
      const { encryptBufferWithKey } = jest.requireActual("../../utils/userEncryptionUtils");
      model.findOne = jest.fn().mockResolvedValue(makeDoc());
      storage.readPlanBlob.mockResolvedValue(encryptBufferWithKey(buf, key));
      const res: any = mockResponse();
      res.setHeader = jest.fn();
      res.end = jest.fn();
      await getPlanFile(
        mockRequest({ user: { id: userA }, params: { id: new mongoose.Types.ObjectId().toString() } }) as any,
        res,
      );
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.stringContaining("private"));
      expect((res.end as jest.Mock).mock.calls[0][0].equals(buf)).toBe(true);
    });

    it("500 si le blob est altéré", async () => {
      const { encryptBufferWithKey } = jest.requireActual("../../utils/userEncryptionUtils");
      const enc = Buffer.from(encryptBufferWithKey(Buffer.from("abc"), key));
      enc[enc.length - 1] ^= 1;
      model.findOne = jest.fn().mockResolvedValue(makeDoc());
      storage.readPlanBlob.mockResolvedValue(enc);
      const res: any = mockResponse();
      await getPlanFile(
        mockRequest({ user: { id: userA }, params: { id: new mongoose.Types.ObjectId().toString() } }) as any,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("404 si le fichier est absent du disque", async () => {
      model.findOne = jest.fn().mockResolvedValue(makeDoc());
      storage.readPlanBlob.mockResolvedValue(null);
      const res: any = mockResponse();
      await getPlanFile(
        mockRequest({ user: { id: userA }, params: { id: new mongoose.Types.ObjectId().toString() } }) as any,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("updatePlan", () => {
    const id = new mongoose.Types.ObjectId().toString();

    it("met à jour nom et placement (chiffrés)", async () => {
      const doc = makeDoc();
      model.findOne = jest.fn().mockResolvedValue(doc);
      const newPlacement = { ...placement, rotationDeg: -90, visible: false };
      const res = mockResponse();
      await updatePlan(
        mockRequest({ user: { id: userA }, params: { id }, body: { name: "Nouveau", placement: newPlacement } }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(doc.save).toHaveBeenCalled();
      expect(decryptWithKey(doc.nameEncrypted, key)).toBe("Nouveau");
      expect(JSON.parse(decryptWithKey(doc.placementEncrypted as string, key))).toEqual(newPlacement);
    });

    it("placement null retire le calage", async () => {
      const doc = makeDoc();
      model.findOne = jest.fn().mockResolvedValue(doc);
      const res = mockResponse();
      await updatePlan(mockRequest({ user: { id: userA }, params: { id }, body: { placement: null } }) as any, res as any);
      expect(doc.placementEncrypted).toBeNull();
      expect((res.json as jest.Mock).mock.calls[0][0].plan.placement).toBeNull();
    });

    it.each([
      [{}],
      [{ name: "" }],
      [{ placement: { ...placement, widthMeters: 0 } }],
      [{ placement: { ...placement, opacity: 3 } }],
      [{ name: "a".repeat(101) }],
      [{ unknown: 1 }],
    ])("400 sur body invalide %j", async (body) => {
      const doc = makeDoc();
      model.findOne = jest.fn().mockResolvedValue(doc);
      const res = mockResponse();
      await updatePlan(mockRequest({ user: { id: userA }, params: { id }, body }) as any, res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe("deletePlan", () => {
    it("supprime doc + blob et libère le quota", async () => {
      const doc = makeDoc({ size: 4321 });
      model.findOne = jest.fn().mockResolvedValue(doc);
      model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
      const res = mockResponse();
      await deletePlan(
        mockRequest({ user: { id: userA }, params: { id: String(doc._id) } }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(storage.deletePlanBlob).toHaveBeenCalledWith(userA, String(doc._id));
      expect(quota.decrementStorageUsed).toHaveBeenCalledWith(userA, 4321);
    });

    it("deux DELETE concurrents : le quota n'est libéré qu'une fois", async () => {
      const doc = makeDoc({ size: 500 });
      model.findOne = jest.fn().mockResolvedValue(doc);
      model.deleteOne = jest
        .fn()
        .mockResolvedValueOnce({ deletedCount: 1 })
        .mockResolvedValueOnce({ deletedCount: 0 });
      const mk = () =>
        mockRequest({ user: { id: userA }, params: { id: String(doc._id) } }) as any;
      const res1 = mockResponse();
      const res2 = mockResponse();
      await Promise.all([deletePlan(mk(), res1 as any), deletePlan(mk(), res2 as any)]);
      expect(quota.decrementStorageUsed).toHaveBeenCalledTimes(1);
      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res2.status).toHaveBeenCalledWith(404);
    });

    it("200 même si la libération du quota échoue (document déjà supprimé)", async () => {
      const doc = makeDoc();
      model.findOne = jest.fn().mockResolvedValue(doc);
      model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
      quota.decrementStorageUsed.mockRejectedValue(new Error("db"));
      const res = mockResponse();
      await deletePlan(
        mockRequest({ user: { id: userA }, params: { id: String(doc._id) } }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("200 même si la suppression du blob échoue (orphelin loggué)", async () => {
      const doc = makeDoc();
      model.findOne = jest.fn().mockResolvedValue(doc);
      model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
      storage.deletePlanBlob.mockRejectedValue(new Error("EACCES"));
      const res = mockResponse();
      await deletePlan(
        mockRequest({ user: { id: userA }, params: { id: String(doc._id) } }) as any,
        res as any,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(quota.decrementStorageUsed).toHaveBeenCalled();
    });
  });
});
