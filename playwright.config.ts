import { defineConfig } from "@playwright/test";

// Suite E2E "API" : aucun navigateur, aucun webServer.
// Le serveur Qvarry local doit déjà tourner (E2E_API_URL, défaut http://localhost:3000).
export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_API_URL || "http://localhost:3000",
    extraHTTPHeaders: { Accept: "application/json" },
  },
});
