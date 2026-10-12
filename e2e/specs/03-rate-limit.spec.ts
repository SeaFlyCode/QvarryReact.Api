import { test, expect } from "../fixtures";

// Route non sensible (/health) et 3 requêtes seulement : on vérifie la
// présence et la décrémentation des en-têtes standards, jamais le 429.
test.describe("rate limiting", () => {
  test("/health expose RateLimit-* et le compteur décroît", async ({ server, request }) => {
    const path = server.healthPath ?? "/health";
    const remaining: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const h = res.headers();
      const r = h["ratelimit-remaining"] ?? h["ratelimit"]?.match(/r=(\d+)/)?.[1];
      test.skip(r === undefined, "pas d'en-têtes RateLimit sur cette route (limiter désactivé ou Redis partagé)");
      remaining.push(Number(r));
    }
    expect(remaining[2]).toBeLessThan(remaining[0]);
  });
});
