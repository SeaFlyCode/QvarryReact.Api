import { test, expect } from "../fixtures";

test.describe("openapi", () => {
  test("/api-docs.json cohérent si exposé", async ({ server, request }) => {
    const res = await request.get("/api-docs.json");
    test.skip(res.status() === 404, "Swagger désactivé (production sans ENABLE_SWAGGER)");
    expect(res.status()).toBe(200);
    const spec = await res.json();
    expect(String(spec.openapi ?? spec.swagger)).toMatch(/^\d/);
    expect(spec.info?.title).toBeTruthy();
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
    expect(paths).toContain("/plans");
    expect(paths).toContain("/points");
  });
});
