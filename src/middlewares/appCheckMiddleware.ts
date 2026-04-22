// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE FIREBASE APP CHECK
// ═══════════════════════════════════════════════════════════════════════════
// Vérifie le token Firebase App Check sur les routes mobiles sensibles.
// En développement : bypass complet (le SDK mobile ne fournit pas de token).
// En staging/production : vérifie le header X-Firebase-AppCheck.
// Graceful degradation si Firebase n'est pas initialisé (ex: tests).
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import admin from "firebase-admin";
import { logger } from "../services/loggerService";

const appCheckLogger = logger.child({ service: "app-check" });

const NODE_ENV = process.env.NODE_ENV || "development";

export async function appCheckMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Bypass complet en développement
  if (NODE_ENV === "development") {
    return next();
  }

  // Fail-fast en production : Firebase non initialisé = config cassée → 503
  // En staging/test : dégradation silencieuse pour ne pas bloquer les smoke tests
  if (admin.apps.length === 0) {
    if (NODE_ENV === "production") {
      appCheckLogger.error(
        "[SECURITY] Firebase non initialisé en production — requête mobile rejetée",
        { path: req.path, method: req.method },
      );
      res.status(503).json({ error: "Service indisponible" });
      return;
    }
    appCheckLogger.warn(
      "Firebase non initialisé — App Check ignoré (non-production)",
      { path: req.path, method: req.method },
    );
    return next();
  }

  const token = req.headers["x-firebase-appcheck"] as string | undefined;

  if (!token) {
    appCheckLogger.warn("App Check token manquant", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(401).json({ error: "App Check token manquant" });
    return;
  }

  try {
    await getAppCheck().verifyToken(token);
    return next();
  } catch {
    appCheckLogger.warn("App Check token invalide", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(401).json({ error: "App Check token invalide" });
  }
}
