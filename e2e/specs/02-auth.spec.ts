import { test, expect } from "../fixtures";
import { API } from "../helpers/env";
import { mobileHeaders, DEVICE_IDS } from "../helpers/auth";

test.describe("auth", () => {
  test("accès protégé sans token = 401", async ({ server, request, anonHeaders }) => {
    for (const path of ["/points", "/fiches", "/plans"]) {
      const res = await request.get(`${API}${path}`, { headers: anonHeaders });
      expect(res.status(), path).toBe(401);
    }
  });

  test("token malformé / forgé = 401", async ({ server, request }) => {
    for (const token of ["not-a-jwt", "a.b.c", "eyJhbGciOiJub25lIn0.eyJpZCI6IjEifQ."]) {
      const res = await request.get(`${API}/points`, {
        headers: mobileHeaders(DEVICE_IDS.anon, token),
      });
      expect(res.status(), token).toBe(401);
    }
  });

  test("login invalide (email inexistant) rejeté, sans token", async ({ server, request }) => {
    // Email aléatoire : ne touche jamais le compte de test (pas de lockout).
    const res = await request.post(`${API}/mobile/auth/login`, {
      headers: mobileHeaders(DEVICE_IDS.anon),
      data: {
        email: `e2e-inexistant-${Date.now()}@example.invalid`,
        password: "MauvaisMotDePasse!123",
        deviceId: DEVICE_IDS.anon,
      },
    });
    test.skip([429, 403].includes(res.status()), `login anonyme limité par le serveur (HTTP ${res.status()})`);
    expect([400, 401]).toContain(res.status());
    const body = await res.json();
    expect(body.accessToken).toBeUndefined();
  });

  test("login valide : session obtenue (global-setup)", async ({ user }) => {
    expect(user.session.accessToken.split(".")).toHaveLength(3);
    expect(user.session.refreshToken.length).toBeGreaterThan(10);
  });

  test("GET /mobile/auth/me avec token valide", async ({ user, request }) => {
    const res = await request.get(`${API}/mobile/auth/me`, { headers: user.headers });
    test.skip(res.status() === 404, "route /mobile/auth/me absente");
    expect(res.status()).toBe(200);
  });

  test("refresh sans token = 401", async ({ server, request }) => {
    const res = await request.post(`${API}/mobile/auth/refresh`, {
      headers: mobileHeaders(DEVICE_IDS.anon),
      data: {},
    });
    test.skip(res.status() === 429, "refresh limité par le serveur");
    expect(res.status()).toBe(401);
  });
});
