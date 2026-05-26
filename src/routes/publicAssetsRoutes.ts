// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ASSETS ROUTES
// ═══════════════════════════════════════════════════════════════════════════
// Routes publiques (hors `/api`) servant des assets statiques accessibles sans
// auth — typiquement consommés par les clients mail (logo dans les templates
// d'email), qui ne peuvent pas porter de credentials.
//
// CONTRAINTES :
//   - Pas d'auth ni CSRF (les clients mail récupèrent sans cookies)
//   - URLs stables et cacheables (Cache-Control long)
//   - Whitelist explicite des fichiers exposés (pas de path traversal)
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";

const router = express.Router();

const ASSETS_DIR = path.join(__dirname, "../assets");

// Whitelist : { route → { file, contentType } }
const PUBLIC_ASSETS: Record<string, { file: string; contentType: string }> = {
  "/public/icon.svg": {
    file: "icon-light.svg",
    contentType: "image/svg+xml",
  },
};

for (const [route, { file, contentType }] of Object.entries(PUBLIC_ASSETS)) {
  router.get(route, (_req: Request, res: Response) => {
    const filePath = path.join(ASSETS_DIR, file);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Asset introuvable" });
      return;
    }
    res
      .status(200)
      .type(contentType)
      .set("Cache-Control", "public, max-age=86400, immutable")
      .sendFile(filePath);
  });
}

export default router;
