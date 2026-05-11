import express from "express";
import {
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
} from "../middlewares/mobileSecurityMiddleware";
import { checkMobileAppVersion } from "../controllers/mobileAppVersionController";

const router = express.Router();

/**
 * @swagger
 * /mobile/app-version/check:
 *   get:
 *     summary: Vérifie si l'app mobile est à jour (force update / soft update)
 *     description: |
 *       Compare X-App-Version vs MIN_APP_VERSION_IOS / MIN_APP_VERSION_ANDROID
 *       (env). Réponse indique si update obligatoire (kill switch) ou recommandée.
 *     tags: [Mobile]
 *     parameters:
 *       - in: header
 *         name: X-Platform
 *         required: true
 *         schema: { type: string, enum: [ios, android] }
 *       - in: header
 *         name: X-App-Version
 *         required: true
 *         schema: { type: string, example: "1.2.3" }
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 forceUpdate: { type: boolean, description: Bloque l'app si true (kill switch) }
 *                 recommendUpdate: { type: boolean }
 *                 latestVersion: { type: string }
 *                 storeUrl: { type: string }
 *       400: { description: Headers manquants }
 */
router.get("/check", verifyMobilePlatform, mobileRateLimitMiddleware, checkMobileAppVersion);

export default router;
