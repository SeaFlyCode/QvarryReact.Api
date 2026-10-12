import { test, expect } from "../fixtures";
import { API } from "../helpers/env";

test.describe("fiches (lecture / validation uniquement)", () => {
  test("liste authentifiée", async ({ user, request }) => {
    const res = await request.get(`${API}/fiches`, { headers: user.headers });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });

  test("création vide rejetée par la validation (400), rien n'est créé", async ({ user, request }) => {
    const res = await request.post(`${API}/fiches`, { headers: user.headers, data: {} });
    expect(res.status()).toBe(400);
  });

  test("sans auth = 401", async ({ server, request, anonHeaders }) => {
    const res = await request.get(`${API}/fiches`, { headers: anonHeaders });
    expect(res.status()).toBe(401);
  });
});
