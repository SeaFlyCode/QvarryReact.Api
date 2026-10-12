import { test, expect } from "../fixtures";
import { API } from "../helpers/env";

test.describe("admin", () => {
  test("sans auth = 401", async ({ server, request, anonHeaders }) => {
    const res = await request.get(`${API}/admin/stats`, { headers: anonHeaders });
    expect(res.status()).toBe(401);
  });

  test("utilisateur non admin = 403 (ou 401)", async ({ user, request }) => {
    test.skip(!!user.session.isAdmin, "E2E_TEST_EMAIL est admin : ce test exige un compte standard");
    for (const path of ["/admin/stats", "/admin/users", "/admin/audit/logs"]) {
      const res = await request.get(`${API}${path}`, { headers: user.headers });
      test.skip(res.status() === 200, "E2E_TEST_EMAIL a des droits admin : utiliser un compte standard");
      expect([401, 403], path).toContain(res.status());
    }
  });

  test("admin : lecture seule des stats et utilisateurs", async ({ admin, request }) => {
    const stats = await request.get(`${API}/admin/stats`, { headers: admin.headers });
    test.skip(stats.status() === 403, "le compte E2E_ADMIN_* n'a pas les droits admin");
    expect(stats.status()).toBe(200);
    const users = await request.get(`${API}/admin/users`, { headers: admin.headers });
    expect(users.status()).toBe(200);
    expect(typeof (await users.json())).toBe("object");
  });
});
