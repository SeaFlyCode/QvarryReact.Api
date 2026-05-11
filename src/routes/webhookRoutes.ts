// ═══════════════════════════════════════════════════════════════════════════
// ROUTES WEBHOOKS VONAGE
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour recevoir les webhooks Vonage (delivery receipts)
// Ces routes ne nécessitent PAS d'authentification (c'est Vonage qui appelle)
// Rate limiting basique pour éviter les abus
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import rateLimit from "express-rate-limit";
import { handleVonageDeliveryReceipt } from "../controllers/webhookControllers";
import { validateVonageWebhook } from "../middlewares/vonageWebhookMiddleware"; // MED-003

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || "development";

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════
// Limiter basique pour éviter les abus (pas d'auth sur ces routes)
// En production: 100 req/min, en dev: 1000 req/min
// ═══════════════════════════════════════════════════════════════════════════

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: NODE_ENV === "production" ? 100 : 1000,
  message: {
    error: "Trop de requêtes webhook, veuillez réessayer plus tard.",
    code: "WEBHOOK_RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES WEBHOOK VONAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /webhooks/vonage/delivery:
 *   post:
 *     summary: Webhook delivery receipt SMS Vonage
 *     description: |
 *       Endpoint appelé par Vonage (pas d'auth standard). Signature HMAC-SHA512
 *       validée par validateVonageWebhook (MED-003). Toujours retourne 200 même
 *       en erreur interne — l'échec est loggé pour éviter retry boucle.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               msisdn: { type: string, description: Numéro destination }
 *               to: { type: string }
 *               network-code: { type: string }
 *               messageId: { type: string }
 *               price: { type: string }
 *               status: { type: string, enum: [delivered, failed, expired, accepted, buffered, unknown, rejected] }
 *               scts: { type: string }
 *               err-code: { type: string }
 *               message-timestamp: { type: string }
 *     responses:
 *       200: { description: Toujours 200 (success ou erreur silencieuse) }
 *       401: { description: Signature HMAC invalide (MED-003) }
 *       429: { description: Rate limit (100/min prod) }
 */

/**
 * POST /api/webhooks/vonage/delivery
 * Recevoir une confirmation de livraison SMS de Vonage
 *
 * Ce webhook est appelé automatiquement par Vonage après l'envoi d'un SMS
 * pour notifier du statut de livraison (delivered, failed, expired, etc.)
 *
 * Body (format Vonage):
 * {
 *   msisdn: "33612345678",           // Numéro de destination
 *   to: "Qvarry",                    // Nom/numéro d'envoi
 *   "network-code": "20810",         // Code réseau (MCC-MNC)
 *   messageId: "0A00000012345678",   // ID unique du message
 *   price: "0.05000000",             // Prix du SMS
 *   status: "delivered",             // Statut de livraison
 *   scts: "2101011400",              // Service Centre Time Stamp
 *   "err-code": "0",                 // Code d'erreur (0 = pas d'erreur)
 *   "message-timestamp": "2021-01-01 14:00:00" // Timestamp du message
 * }
 *
 * Response 200:
 *   { success: true }
 *
 * Notes:
 *   - MED-003: Validation HMAC-SHA512 de la signature Vonage
 *   - Toujours retourner 200 OK, même en cas d'erreur interne
 *   - Les échecs sont loggés mais ne bloquent pas la réponse
 *   - Rate limiting basique pour éviter les abus
 */
router.post(
  "/delivery",
  validateVonageWebhook, // MED-003: Validation HMAC AVANT le handler
  webhookLimiter,
  handleVonageDeliveryReceipt,
);

export default router;
