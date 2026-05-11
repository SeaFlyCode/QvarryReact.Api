// ═══════════════════════════════════════════════════════════════════════════
// ROUTES WEBHOOKS VONAGE
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour recevoir les webhooks Vonage (delivery receipts)
// Ces routes ne nécessitent PAS d'authentification (c'est Vonage qui appelle)
// Rate limiting basique pour éviter les abus
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request } from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "crypto";
import { handleVonageDeliveryReceipt } from "../controllers/webhookControllers";
import { validateVonageWebhook } from "../middlewares/vonageWebhookMiddleware"; // MED-003

const router = express.Router();

const NODE_ENV = process.env.NODE_ENV || "development";

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════
// AUDIT_2026-05-11 Phase C — Fix P1 #3
// Vonage émet depuis un pool d'IP restreint. Un rate-limit IP-only laisse une
// fenêtre de DoS si un attaquant rejoue des signatures HMAC volées vers le
// même endpoint. On bascule sur une clé composite hash(messageId + msisdn) :
//   - Un même message ne peut être rejoué que 50 fois/min (forte protection)
//   - Si messageId absent (payload mal formé), fallback IP (signature HMAC
//     validera ensuite et rejettera).
//   - Limite abaissée à 50/min (au lieu de 100) pour réduire la marge
//     d'erreur d'un attaquant tout en restant large pour Vonage légitime
//     (qui ne renvoie pas le même messageId à 50/min en usage normal).
// ═══════════════════════════════════════════════════════════════════════════

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: NODE_ENV === "production" ? 50 : 1000, // 50/min/message en prod
  message: {
    error: "Trop de requêtes webhook, veuillez réessayer plus tard.",
    code: "WEBHOOK_RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const body = (req.body as any) || {};
    const messageId =
      typeof body.messageId === "string" ? body.messageId.trim() : "";
    const msisdn = typeof body.msisdn === "string" ? body.msisdn.trim() : "";

    if (messageId.length > 0) {
      // Hash composite — pas de PII brut dans Redis
      const hash = createHash("sha256")
        .update(`${messageId}|${msisdn}`)
        .digest("hex");
      return `vonage_msg:${hash}`;
    }

    // Fallback IP — hash pour normaliser IPv6 + privacy
    const ipHash = createHash("sha256")
      .update(req.ip || "unknown")
      .digest("hex");
    return `vonage_ip:${ipHash}`;
  },
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
