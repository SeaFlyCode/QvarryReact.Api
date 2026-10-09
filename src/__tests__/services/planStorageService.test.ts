import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import mongoose from "mongoose";

jest.mock("../../utils/contextLogger", () => ({
  createServiceLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
jest.mock("../../config/storageConfig", () => ({
  ...jest.requireActual("../../config/storageConfig"),
  PLANS_CONFIG: {
    ...jest.requireActual("../../config/storageConfig").PLANS_CONFIG,
    get STORAGE_PATH() {
      return require("path").join(require("os").tmpdir(), "plans-test-fixed");
    },
  },
}));

import planStorageService from "../../services/planStorageService";
import { detectPlanMimeType } from "../../config/storageConfig";

describe("planStorageService", () => {
  const uid = new mongoose.Types.ObjectId().toString();
  const pid = new mongoose.Types.ObjectId().toString();

  afterAll(() => {
    fs.rmSync(path.join(os.tmpdir(), "plans-test-fixed"), { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("écrit, relit puis supprime un blob", async () => {
    const rel = await planStorageService.savePlanBlob(uid, pid, Buffer.from("abc"));
    expect(rel).toBe(path.join(uid, `${pid}.bin`));
    expect((await planStorageService.readPlanBlob(uid, pid))?.toString()).toBe("abc");
    await planStorageService.deletePlanBlob(uid, pid);
    expect(await planStorageService.readPlanBlob(uid, pid)).toBeNull();
  });

  it("deletePlanBlob est idempotent", async () => {
    await expect(planStorageService.deletePlanBlob(uid, pid)).resolves.toBeUndefined();
  });

  it.each(["../../etc/passwd", "..", "a/b", "%2e%2e", ""])("rejette l'id %p (path traversal)", (bad) => {
    expect(() => planStorageService.getPlanPath(uid, bad)).toThrow();
    expect(() => planStorageService.getPlanPath(bad, pid)).toThrow();
  });

  it("calculateUserPlansSize compte la taille claire (blob - 28 o de surcoût)", async () => {
    const u = new mongoose.Types.ObjectId().toString();
    const p1 = new mongoose.Types.ObjectId().toString();
    const p2 = new mongoose.Types.ObjectId().toString();
    await planStorageService.savePlanBlob(u, p1, Buffer.alloc(128));
    await planStorageService.savePlanBlob(u, p2, Buffer.alloc(78));
    expect(await planStorageService.calculateUserPlansSize(u)).toBe(100 + 50);
    await planStorageService.deleteAllUserPlans(u);
  });

  it("calculateUserPlansSize renvoie 0 sans dossier", async () => {
    expect(
      await planStorageService.calculateUserPlansSize(new mongoose.Types.ObjectId().toString()),
    ).toBe(0);
  });

  it("listAllBlobs liste uniquement les <objectId>/<objectId>.bin et ignore le reste", async () => {
    const u = new mongoose.Types.ObjectId().toString();
    const p1 = new mongoose.Types.ObjectId().toString();
    await planStorageService.savePlanBlob(u, p1, Buffer.alloc(40));
    const dir = path.join(os.tmpdir(), "plans-test-fixed", u);
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    fs.writeFileSync(path.join(dir, "zzz.bin"), "x");
    const blobs = (await planStorageService.listAllBlobs()).filter((b) => b.userId === u);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toEqual(expect.objectContaining({ planId: p1, clearSize: 12 }));
    expect(await planStorageService.calculateTotalPlansSize()).toBeGreaterThanOrEqual(12);
    await planStorageService.deleteAllUserPlans(u);
  });

  it("savePlanBlob se rétablit si le dossier est supprimé entre mkdir et écriture", async () => {
    const u = new mongoose.Types.ObjectId().toString();
    const p1 = new mongoose.Types.ObjectId().toString();
    const real = fs.promises.writeFile;
    const spy = jest
      .spyOn(fs.promises, "writeFile")
      .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await planStorageService.savePlanBlob(u, p1, Buffer.from("ok"));
    spy.mockRestore();
    expect(fs.promises.writeFile).toBe(real);
    expect((await planStorageService.readPlanBlob(u, p1))?.toString()).toBe("ok");
    await planStorageService.deleteAllUserPlans(u);
  });

  it("deleteAllUserPlans supprime le dossier utilisateur", async () => {
    await planStorageService.savePlanBlob(uid, pid, Buffer.from("x"));
    await planStorageService.deleteAllUserPlans(uid);
    expect(await planStorageService.readPlanBlob(uid, pid)).toBeNull();
  });
});

describe("detectPlanMimeType", () => {
  it("détecte PNG / JPEG / WebP", () => {
    expect(detectPlanMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectPlanMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectPlanMimeType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("rejette PDF, GIF, WAV (RIFF non WebP) et vide", () => {
    expect(detectPlanMimeType(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(detectPlanMimeType(Buffer.from("GIF89a......"))).toBeNull();
    expect(detectPlanMimeType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(detectPlanMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe("overhead de chiffrement", () => {
  it("PLANS_CONFIG.ENCRYPTION_OVERHEAD_BYTES correspond à encryptBufferWithKey", () => {
    const { encryptBufferWithKey } = jest.requireActual("../../utils/userEncryptionUtils");
    const { PLANS_CONFIG } = jest.requireActual("../../config/storageConfig");
    const key = "ab".repeat(32);
    expect(encryptBufferWithKey(Buffer.alloc(77), key).length - 77).toBe(
      PLANS_CONFIG.ENCRYPTION_OVERHEAD_BYTES,
    );
  });
});
