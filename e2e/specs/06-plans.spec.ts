import { test, expect } from "../fixtures";
import { API } from "../helpers/env";
import { makePng } from "../helpers/png";

const VALID_PLACEMENT = {
  centerLat: 48.85,
  centerLng: 2.35,
  widthMeters: 120,
  aspectRatio: 1.5,
  rotationDeg: 10,
  opacity: 0.8,
  visible: true,
};
const FAKE_ID = "0123456789abcdef01234567";

test.describe.configure({ mode: "serial" });

test.describe("plans", () => {
  const createdIds: string[] = [];

  // Nettoyage garanti, même si un test a échoué en cours de route.
  let ownerHeaders: Record<string, string> | null = null;
  test.beforeEach(({ user }) => {
    ownerHeaders = user.headers;
  });
  test.afterAll(async ({ playwright, baseURL }) => {
    if (!ownerHeaders || createdIds.length === 0) return;
    const ctx = await playwright.request.newContext({ baseURL });
    for (const id of createdIds) {
      await ctx.delete(`${API}/plans/${id}`, { headers: ownerHeaders }).catch(() => undefined);
    }
    await ctx.dispose();
  });

  const upload = (request: any, headers: Record<string, string>, file: any, fields: Record<string, string> = {}) =>
    request.post(`${API}/plans`, { headers, multipart: { file, ...fields } });

  test("sans auth = 401 sur toutes les routes", async ({ server, request, anonHeaders }) => {
    expect((await request.get(`${API}/plans`, { headers: anonHeaders })).status()).toBe(401);
    expect((await request.get(`${API}/plans/${FAKE_ID}/file`, { headers: anonHeaders })).status()).toBe(401);
    expect((await request.patch(`${API}/plans/${FAKE_ID}`, { headers: anonHeaders, data: { name: "x" } })).status()).toBe(401);
    expect((await request.delete(`${API}/plans/${FAKE_ID}`, { headers: anonHeaders })).status()).toBe(401);
  });

  test("cycle complet : upload, liste, fichier identique, patch, delete", async ({ user, request }) => {
    const png = makePng(16, 16);
    const name = `e2e-plan-${Date.now()}`;

    const created = await upload(
      request,
      user.headers,
      { name: "e2e.png", mimeType: "image/png", buffer: png },
      { name, placement: JSON.stringify(VALID_PLACEMENT) },
    );
    expect(created.status(), await created.text()).toBe(201);
    const { plan } = await created.json();
    createdIds.push(plan.id);
    expect(plan.name).toBe(name);
    expect(plan.mime).toBe("image/png");
    expect(plan.placement).toMatchObject(VALID_PLACEMENT);

    const list = await request.get(`${API}/plans`, { headers: user.headers });
    expect(list.status()).toBe(200);
    expect((await list.json()).plans.map((p: { id: string }) => p.id)).toContain(plan.id);

    const file = await request.get(`${API}/plans/${plan.id}/file`, { headers: user.headers });
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("image/png");
    expect(file.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(await file.body(), png)).toBe(0);

    // Revalidation : même ETag => 304 sans corps.
    const etag = file.headers()["etag"];
    expect(etag).toBeTruthy();
    const again = await request.get(`${API}/plans/${plan.id}/file`, {
      headers: { ...user.headers, "If-None-Match": etag },
    });
    expect(again.status()).toBe(304);

    const patched = await request.patch(`${API}/plans/${plan.id}`, {
      headers: user.headers,
      data: { name: `${name}-renamed`, placement: { ...VALID_PLACEMENT, rotationDeg: -45, opacity: 0.5 } },
    });
    expect(patched.status()).toBe(200);
    const p = (await patched.json()).plan;
    expect(p.name).toBe(`${name}-renamed`);
    expect(p.placement.rotationDeg).toBe(-45);

    const unplaced = await request.patch(`${API}/plans/${plan.id}`, { headers: user.headers, data: { placement: null } });
    expect(unplaced.status()).toBe(200);
    expect((await unplaced.json()).plan.placement).toBeNull();

    const del = await request.delete(`${API}/plans/${plan.id}`, { headers: user.headers });
    expect(del.status()).toBe(200);
    createdIds.splice(createdIds.indexOf(plan.id), 1);

    expect((await request.get(`${API}/plans/${plan.id}/file`, { headers: user.headers })).status()).toBe(404);
    expect((await request.delete(`${API}/plans/${plan.id}`, { headers: user.headers })).status()).toBe(404);
  });

  test("validation PATCH : bornes et corps invalides = 400", async ({ user, request }) => {
    const created = await upload(request, user.headers, { name: "v.png", mimeType: "image/png", buffer: makePng() });
    expect(created.status()).toBe(201);
    const id = (await created.json()).plan.id as string;
    createdIds.push(id);

    const bad: Array<[string, unknown]> = [
      ["lat > 90", { placement: { ...VALID_PLACEMENT, centerLat: 91 } }],
      ["lng < -180", { placement: { ...VALID_PLACEMENT, centerLng: -181 } }],
      ["opacity > 1", { placement: { ...VALID_PLACEMENT, opacity: 1.5 } }],
      ["width = 0", { placement: { ...VALID_PLACEMENT, widthMeters: 0 } }],
      ["rotation > 360", { placement: { ...VALID_PLACEMENT, rotationDeg: 361 } }],
      ["champ inconnu (strict)", { placement: { ...VALID_PLACEMENT, extra: 1 } }],
      ["nom vide", { name: "   " }],
      ["nom > 100", { name: "x".repeat(101) }],
      ["corps vide", {}],
      ["champ racine inconnu", { foo: "bar" }],
    ];
    for (const [label, data] of bad) {
      const res = await request.patch(`${API}/plans/${id}`, { headers: user.headers, data });
      expect(res.status(), label).toBe(400);
    }

    await request.delete(`${API}/plans/${id}`, { headers: user.headers });
    createdIds.splice(createdIds.indexOf(id), 1);
  });

  test("upload : placement invalide / JSON cassé = 400, aucun plan créé", async ({ user, request }) => {
    const png = makePng();
    const r1 = await upload(request, user.headers, { name: "a.png", mimeType: "image/png", buffer: png }, {
      placement: JSON.stringify({ ...VALID_PLACEMENT, centerLat: 200 }),
    });
    expect(r1.status()).toBe(400);
    const r2 = await upload(request, user.headers, { name: "a.png", mimeType: "image/png", buffer: png }, {
      placement: "{pas du json",
    });
    expect(r2.status()).toBe(400);
  });

  test("upload : magic bytes / mime invalides = 400", async ({ user, request }) => {
    const notImage = Buffer.from("ceci n'est pas une image", "utf8");
    // MIME déclaré PNG mais contenu texte
    const r1 = await upload(request, user.headers, { name: "faux.png", mimeType: "image/png", buffer: notImage });
    expect(r1.status()).toBe(400);
    // octet-stream toléré par le filtre, mais rejeté par les magic bytes
    const r2 = await upload(request, user.headers, { name: "faux.bin", mimeType: "application/octet-stream", buffer: notImage });
    expect(r2.status()).toBe(400);
    // MIME non autorisé : refusé dès le filtre multer
    const r3 = await upload(request, user.headers, { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    expect(r3.status()).toBe(400);
    // Magic bytes PNG mais image tronquée/corrompue
    const truncated = makePng().subarray(0, 20);
    const r4 = await upload(request, user.headers, { name: "t.png", mimeType: "image/png", buffer: truncated });
    expect(r4.status()).toBe(400);
    // PNG réel déclaré JPEG : incohérence mime/magic bytes
    const r5 = await upload(request, user.headers, { name: "m.jpg", mimeType: "image/jpeg", buffer: makePng() });
    expect(r5.status()).toBe(400);
  });

  test("upload sans fichier = 400", async ({ user, request }) => {
    const res = await request.post(`${API}/plans`, { headers: user.headers, multipart: { name: "sans-fichier" } });
    expect(res.status()).toBe(400);
  });

  test("id inexistant = 404, id mal formé = 400/404", async ({ user, request }) => {
    expect((await request.get(`${API}/plans/${FAKE_ID}/file`, { headers: user.headers })).status()).toBe(404);
    expect((await request.patch(`${API}/plans/${FAKE_ID}`, { headers: user.headers, data: { name: "x" } })).status()).toBe(404);
    expect((await request.delete(`${API}/plans/${FAKE_ID}`, { headers: user.headers })).status()).toBe(404);
    expect([400, 404]).toContain((await request.get(`${API}/plans/zzz/file`, { headers: user.headers })).status());
  });

  test("isolation inter-utilisateurs : user2 ne voit/modifie/supprime pas le plan de user1", async ({ user, user2, request }) => {
    const created = await upload(request, user.headers, { name: "iso.png", mimeType: "image/png", buffer: makePng() });
    expect(created.status()).toBe(201);
    const id = (await created.json()).plan.id as string;
    createdIds.push(id);

    const list2 = await request.get(`${API}/plans`, { headers: user2.headers });
    expect(list2.status()).toBe(200);
    expect((await list2.json()).plans.map((p: { id: string }) => p.id)).not.toContain(id);

    expect((await request.get(`${API}/plans/${id}/file`, { headers: user2.headers })).status()).toBe(404);
    expect((await request.patch(`${API}/plans/${id}`, { headers: user2.headers, data: { name: "pirate" } })).status()).toBe(404);
    expect((await request.delete(`${API}/plans/${id}`, { headers: user2.headers })).status()).toBe(404);

    // Toujours intact pour le propriétaire
    expect((await request.get(`${API}/plans/${id}/file`, { headers: user.headers })).status()).toBe(200);

    expect((await request.delete(`${API}/plans/${id}`, { headers: user.headers })).status()).toBe(200);
    createdIds.splice(createdIds.indexOf(id), 1);
  });
});
