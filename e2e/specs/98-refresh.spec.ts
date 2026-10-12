import { test, expect } from "../fixtures";
import { API } from "../helpers/env";
import { mobileHeaders } from "../helpers/auth";

// Exécuté en dernier : la rotation consomme le refresh token de la session.
test.describe("refresh token", () => {
  test("refresh token : rotation, nouvel access token valide", async ({ user, request }) => {
    // La rotation invalide l'ancien refresh token : on persiste le nouveau dans la session en mémoire.
    const res = await request.post(`${API}/mobile/auth/refresh`, {
      headers: mobileHeaders(user.session.deviceId),
      data: { refreshToken: user.session.refreshToken },
    });
    test.skip(res.status() === 429, "refresh limité par le serveur");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.accessToken ?? body.token).toBeTruthy();
    const newAccess = body.accessToken ?? body.token;
    const check = await request.get(`${API}/points`, {
      headers: mobileHeaders(user.session.deviceId, newAccess),
    });
    expect(check.status()).toBe(200);
    // Refresh token invalide
    const bad = await request.post(`${API}/mobile/auth/refresh`, {
      headers: mobileHeaders(user.session.deviceId),
      data: { refreshToken: "refresh-invalide-e2e" },
    });
    test.skip(bad.status() === 429, "refresh limité par le serveur");
    expect(bad.status()).toBe(401);
  });
});
