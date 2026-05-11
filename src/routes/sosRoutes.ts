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

/**
 * @swagger
 * /sos/start:
 *   post:
 *     summary: Active une session SOS (broadcast Stage 1 multi-device)
 *     description: |
 *       §V0 — Déclenche le broadcast SOS Stage 1 vers les contacts de
 *       l'utilisateur dans un rayon (SOS_BROADCAST_RADIUS_KM, default 50km).
 *       Le serveur applique : filtre géo, opt-out user, throttle anti-spam.
 *       Émet push P0 (channel qvarry_sos_critical, son alarme, bypass DND).
 *     tags: [SOS]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number, minimum: -90, maximum: 90 }
 *               longitude: { type: number, minimum: -180, maximum: 180 }
 *               message: { type: string, maxLength: 500 }
 *               accuracy: { type: number, description: Précision GPS en mètres }
 *     responses:
 *       201:
 *         description: Session SOS créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionId: { type: string }
 *                 broadcastCount: { type: integer }
 *                 status: { type: string, enum: [ACTIVE] }
 *       400: { description: Coordonnées invalides }
 *       403: { description: User opt-out SOS }
 *       429: { description: Throttle (déjà SOS actif récent) }
 *
 * /sos/sessions/{sessionId}/heartbeat:
 *   post:
 *     summary: Heartbeat pendant SOS actif (mise à jour position)
 *     tags: [SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses: { 200: { description: Position mise à jour } }
 *
 * /sos/sessions/{sessionId}/safe:
 *   post:
 *     summary: Confirme retour en sécurité (clos session)
 *     description: |
 *       Quick action button "Je suis en sécurité" notif iOS/Android.
 *       Émet push aux participants pour info.
 *     tags: [SOS]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: sessionId, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Session clos status SAFE }
 *       404: { description: Session non trouvée }
 *
 * /sos/active:
 *   get:
 *     summary: Liste les sessions SOS actives autour de l'utilisateur
 *     description: §V0 utilisé par mobile pour `qvarry://sos/active` deep link.
 *     tags: [SOS]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sessions actives ACTIVE/EXPIRED/ESCALATING }
 */
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
