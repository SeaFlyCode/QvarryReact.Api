// ═══════════════════════════════════════════════════════════════════════════
// ROUTES PUBLIQUES
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints publics accessibles sans authentification
// Optimisés pour le cache (immutables, longue durée)
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import { logger } from "../services/loggerService";

const router = express.Router();

// Logger dédié pour les routes publiques
const publicLogger = logger.child({ service: "public-routes" });

// ═══════════════════════════════════════════════════════════════════════════
// GET /public/logo.svg - Servir le logo SVG de l'application
// ═══════════════════════════════════════════════════════════════════════════
// Ce endpoint sert le logo de l'application au format SVG
// Accessible sans authentification pour une intégration facile
// Cache long terme (1 an) car le contenu est immuable
// CORS ouvert pour permettre l'affichage sur n'importe quel domaine
// ═══════════════════════════════════════════════════════════════════════════

router.get("/logo.svg", async (req: Request, res: Response) => {
  try {
    // CRIT-002: Protection path traversal (défense en profondeur)
    const logoFileName = "logo.svg";
    const sanitizedFileName = path.basename(logoFileName); // Protection path traversal

    if (sanitizedFileName !== logoFileName) {
      publicLogger.warn("Tentative path traversal détectée", { ip: req.ip });
      return res.status(400).json({
        error: "Nom de fichier invalide",
        code: "INVALID_FILE_NAME",
      });
    }

    // Vérifier extension autorisée
    const allowedExtensions = [".svg"];
    const ext = path.extname(sanitizedFileName).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({
        error: "Type de fichier non autorisé",
        code: "FILE_TYPE_NOT_ALLOWED",
      });
    }

    // Chemin vers le fichier SVG (sécurisé)
    const logoPath = path.join(__dirname, "../public", sanitizedFileName);

    // Vérifier que le path final est bien dans public/ (double check)
    const resolvedPath = path.resolve(logoPath);
    const resolvedPublicDir = path.resolve(__dirname, "../public");
    if (!resolvedPath.startsWith(resolvedPublicDir)) {
      publicLogger.error("Tentative d'accès hors public/", {
        resolvedPath,
        ip: req.ip,
      });
      return res.status(403).json({
        error: "Accès refusé",
        code: "ACCESS_DENIED",
      });
    }

    // Vérifier si le fichier existe
    try {
      await fs.access(logoPath);
    } catch (error) {
      publicLogger.warn("Logo SVG non trouvé", { path: logoPath });
      return res.status(404).json({
        error: "Logo non trouvé",
        code: "LOGO_NOT_FOUND",
      });
    }

    // Lire le fichier
    const svgContent = await fs.readFile(logoPath, "utf-8");

    // Headers pour optimiser le cache et la sécurité
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // 1 an
    res.setHeader("Access-Control-Allow-Origin", "*"); // CORS ouvert
    res.setHeader("X-Content-Type-Options", "nosniff");

    publicLogger.info("Logo SVG servi avec succès", {
      size: svgContent.length,
      ip: req.ip,
    });

    res.send(svgContent);
  } catch (error) {
    publicLogger.error("Erreur lors de la lecture du logo SVG", {
      error: error instanceof Error ? error.message : error,
    });

    res.status(500).json({
      error: "Erreur interne lors de la lecture du logo",
      code: "LOGO_READ_ERROR",
    });
  }
});

export default router;
