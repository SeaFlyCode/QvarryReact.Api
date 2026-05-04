// ═══════════════════════════════════════════════════════════════════════════
// ROUTES SOS WEB (ALIAS)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints SOS exposés au front web sous /api/v1/sos/*
// Réutilise les MÊMES handlers que mobileSosRoutes.ts. Pas de logique dupliquée.
// Différences avec /api/v1/mobile/sos/* :
//   - pas de appCheckMiddleware (App Check est mobile-only)
//   - pas de verifyMobilePlatform / mobileRateLimitMiddleware
//   - paths réécrits pour matcher l'API attendue par le client web :
//       POST /sos/start                          → handleSosActivate
//       POST /sos/sessions/:sessionId/heartbeat  → handleSosHeartbeat
//       POST /sos/sessions/:sessionId/safe       → handleSosConfirmSafe
//       GET  /sos/active                         → handleSosActiveSessions
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateObjectId } from "../middlewares/validateObjectIdMiddleware";
import {
  handleSosActivate,
  handleSosHeartbeat,
  handleSosConfirmSafe,
  handleSosActiveSessions,
} from "../controllers/mobileSosControllers";

const router = express.Router();

// Le client web envoie sessionId via l'URL pour heartbeat alors que le handler
// mobile lit sessionId dans le body. On le copie depuis params vers body
// AVANT d'appeler le handler, pour ne pas dupliquer la logique du controller.
function copySessionIdFromParamsToBody(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (req.params.sessionId) {
    req.body = req.body && typeof req.body === "object" ? req.body : {};
    if (!req.body.sessionId) {
      req.body.sessionId = req.params.sessionId;
    }
  }
  next();
}

// POST /api/v1/sos/start  →  équivalent /mobile/sos/activate
router.post("/start", authMiddleware, handleSosActivate);

// POST /api/v1/sos/sessions/:sessionId/heartbeat
router.post(
  "/sessions/:sessionId/heartbeat",
  authMiddleware,
  validateObjectId("sessionId"),
  copySessionIdFromParamsToBody,
  handleSosHeartbeat,
);

// POST /api/v1/sos/sessions/:sessionId/safe  →  équivalent /:sessionId/confirm-safe
router.post(
  "/sessions/:sessionId/safe",
  authMiddleware,
  validateObjectId("sessionId"),
  handleSosConfirmSafe,
);

// GET /api/v1/sos/active
router.get("/active", authMiddleware, handleSosActiveSessions);

export default router;
