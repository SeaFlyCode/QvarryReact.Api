import { test, expect } from "../fixtures";
import { API } from "../helpers/env";

test.describe("points", () => {
  const created: string[] = [];

  test.afterEach(async ({ request, user }) => {
    // Nettoyage garanti des points créés par le test, même en cas d'échec.
    while (created.length) {
      const id = created.pop()!;
      await request.delete(`${API}/points/${id}`, { headers: user.headers }).catch(() => undefined);
    }
  });

  test("liste paginée", async ({ user, request }) => {
    const res = await request.get(`${API}/points`, { headers: user.headers });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  test("création invalide : champs manquants / coordonnées hors bornes = 400", async ({ user, request }) => {
    const missing = await request.post(`${API}/points`, { headers: user.headers, data: { name: "x" } });
    expect(missing.status()).toBe(400);
    const range = await request.post(`${API}/points`, {
      headers: user.headers,
      data: { name: "e2e-hors-bornes", latitude: 123, longitude: 400 },
    });
    expect(range.status()).toBe(400);
  });

  test("id invalide = 400/404", async ({ user, request }) => {
    const res = await request.get(`${API}/points/pas-un-objectid`, { headers: user.headers });
    expect([400, 404]).toContain(res.status());
  });

  test("création puis suppression", async ({ user, request }) => {
    const res = await request.post(`${API}/points`, {
      headers: user.headers,
      data: { name: `e2e-point-${Date.now()}`, latitude: 48.8566, longitude: 2.3522, description: "e2e" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    const id = String(body.pointId);
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    created.push(id);

    const del = await request.delete(`${API}/points/${id}`, { headers: user.headers });
    expect(del.status()).toBe(200);
    created.length = 0;

    const again = await request.delete(`${API}/points/${id}`, { headers: user.headers });
    expect(again.status()).toBe(404);
  });
});
