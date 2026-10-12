import { test, expect } from "../fixtures";

test.describe("health & en-têtes de sécurité", () => {
  test("GET /health répond healthy", async ({ server, request }) => {
    const res = await request.get(server.healthPath ?? "/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(["healthy", "ok"]).toContain(body.status); // /health = healthy, /api/v1/health = ok
    expect(typeof body.uptime).toBe("number");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  test("en-têtes de sécurité présents, pas de X-Powered-By", async ({ server, request }) => {
    const res = await request.get(server.healthPath ?? "/health");
    const h = res.headers();
    expect(h["x-powered-by"]).toBeUndefined();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
  });

  test("route inconnue : 404 sans fuite de stack", async ({ server, request }) => {
    const res = await request.get("/api/v1/__e2e_route_inexistante__");
    expect([401, 404]).toContain(res.status());
    expect(await res.text()).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});
