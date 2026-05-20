/**
 * Tests d'intégration pour deepLinkRoutes
 * - /.well-known/apple-app-site-association (AASA iOS)
 * - /.well-known/assetlinks.json (Android App Links)
 * - /reset-password/:token (page HTML fallback)
 *
 * Les contraintes Apple/Google sont strictes :
 *   - Content-Type: application/json
 *   - Pas de redirect 3xx
 *   - 200 OK
 */

import express from "express";
import request from "supertest";
import deepLinkRoutes from "../../routes/deepLinkRoutes";

function makeApp() {
  const app = express();
  app.use(deepLinkRoutes);
  return app;
}

describe("deepLinkRoutes", () => {
  // ─── AASA (iOS) ────────────────────────────────────────────────────

  describe("GET /.well-known/apple-app-site-association", () => {
    it("retourne 200 + Content-Type application/json", async () => {
      const app = makeApp();
      const res = await request(app).get(
        "/.well-known/apple-app-site-association",
      );
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("contient le bon appID (TeamID.BundleID) et le pattern reset-password", async () => {
      const app = makeApp();
      const res = await request(app).get(
        "/.well-known/apple-app-site-association",
      );
      expect(res.body).toEqual({
        applinks: {
          details: [
            {
              appIDs: ["HB7K49N5TD.fr.qvarry.app"],
              components: [
                expect.objectContaining({
                  "/": "/reset-password/*",
                }),
              ],
            },
          ],
        },
      });
    });

    it("ne fait pas de redirect 3xx (contrainte Apple)", async () => {
      const app = makeApp();
      const res = await request(app)
        .get("/.well-known/apple-app-site-association")
        .redirects(0);
      expect(res.status).toBe(200);
    });
  });

  // ─── Asset Links (Android) ──────────────────────────────────────────

  describe("GET /.well-known/assetlinks.json", () => {
    it("retourne 200 + Content-Type application/json", async () => {
      const app = makeApp();
      const res = await request(app).get("/.well-known/assetlinks.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("contient le package_name attendu et le permission grant", async () => {
      const app = makeApp();
      const res = await request(app).get("/.well-known/assetlinks.json");
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.sealfy.qvarryphone",
        },
      });
    });

    it("inclut le SHA-256 du debug keystore", async () => {
      const app = makeApp();
      const res = await request(app).get("/.well-known/assetlinks.json");
      expect(res.body[0].target.sha256_cert_fingerprints).toContain(
        "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
      );
    });

    it("inclut le SHA-256 du release keystore (upload key)", async () => {
      const app = makeApp();
      const res = await request(app).get("/.well-known/assetlinks.json");
      expect(res.body[0].target.sha256_cert_fingerprints).toContain(
        "80:69:1D:50:AA:29:7D:27:DC:25:BE:16:BE:53:34:DB:77:5B:E5:81:58:44:13:45:9A:2E:C1:DB:67:28:6C:56",
      );
    });

    it("ne contient plus le placeholder Play Signing", async () => {
      const app = makeApp();
      const res = await request(app).get("/.well-known/assetlinks.json");
      // Si l'app passe à Play App Signing, AJOUTER (pas remplacer) la SHA-256
      // de la "App signing key" depuis Play Console > Setup > App Integrity.
      expect(res.body[0].target.sha256_cert_fingerprints).not.toContain(
        "PLACEHOLDER_PLAY_SIGNING_SHA256",
      );
    });
  });

  // ─── Page fallback HTML ────────────────────────────────────────────

  describe("GET /reset-password/:token", () => {
    const VALID_TOKEN = "a".repeat(64);

    it("retourne 200 + Content-Type text/html avec token valide", async () => {
      const app = makeApp();
      const res = await request(app).get(`/reset-password/${VALID_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it("contient un formulaire qui POST sur /api/v1/auth/reset-password-token", async () => {
      const app = makeApp();
      const res = await request(app).get(`/reset-password/${VALID_TOKEN}`);
      expect(res.text).toContain("/api/v1/auth/reset-password-token");
    });

    it("injecte le token dans le JS (JSON.stringify safe)", async () => {
      const app = makeApp();
      const res = await request(app).get(`/reset-password/${VALID_TOKEN}`);
      expect(res.text).toContain(`"${VALID_TOKEN}"`);
    });

    it("pose les bons security headers (X-Frame-Options, CSP)", async () => {
      const app = makeApp();
      const res = await request(app).get(`/reset-password/${VALID_TOKEN}`);
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    });

    it("retourne 400 + page erreur si le token est mal formé", async () => {
      const app = makeApp();
      const res = await request(app).get("/reset-password/not-a-valid-token");
      expect(res.status).toBe(400);
      expect(res.text).toContain("Lien invalide");
    });

    it("retourne 400 pour un token avec caractères non-hex", async () => {
      const app = makeApp();
      const res = await request(app).get(
        "/reset-password/" + "Z".repeat(64),
      );
      expect(res.status).toBe(400);
    });

    it("retourne 400 pour un token trop court", async () => {
      const app = makeApp();
      const res = await request(app).get("/reset-password/" + "a".repeat(32));
      expect(res.status).toBe(400);
    });
  });
});
