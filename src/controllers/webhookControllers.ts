// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour recevoir les webhooks des services externes (Vonage, etc.)
// Ces routes ne nécessitent PAS d'authentification (c'est le service externe qui appelle)
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { logger } from "../services/loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import SmsDeliveryReceiptModel from "../models/smsDeliveryReceipt";

const webhookLogger = logger.child({ service: "webhook-vonage" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: VONAGE DELIVERY RECEIPT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhooks/vonage/delivery - Recevoir une confirmation de livraison SMS de Vonage
 *
 * Body (format Vonage):
 * {
 *   msisdn: string,           // Numéro de destination (format international sans +)
 *   to: string,               // Numéro d'envoi (notre numéro Vonage)
 *   "network-code": string,   // Code réseau (MCC-MNC)
 *   messageId: string,        // ID unique du message
 *   price: string,            // Prix du SMS
 *   status: string,           // delivered|expired|failed|rejected|accepted|buffered|unknown
 *   scts: string,             // Service Centre Time Stamp
 *   "err-code": string,       // Code d'erreur si échec
 *   "message-timestamp": string // Timestamp du message
 * }
 *
 * Response: { success: true } (TOUJOURS 200 OK pour éviter les retry Vonage)
 *
 * Notes:
 * - Ce webhook est appelé par Vonage après l'envoi d'un SMS
 * - Pas d'authentification (Vonage ne supporte pas les headers custom)
 * - Toujours retourner 200 OK, même en cas d'erreur interne
 * - Les échecs sont loggés mais ne bloquent pas la réponse
 */
export async function handleVonageDeliveryReceipt(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    // Vonage envoie les données dans le body (POST)
    // Les noms de champs ont des tirets (network-code, err-code, message-timestamp)
    const {
      msisdn, // Numéro de destination
      to, // Numéro d'envoi (notre numéro Vonage)
      "network-code": networkCode,
      messageId,
      price,
      status,
      "err-code": errorCode,
      "message-timestamp": messageTimestamp,
    } = req.body;

    // Validation: messageId et status sont requis
    if (!messageId || !status) {
      webhookLogger.warn("Webhook Vonage reçu sans messageId ou status", {
        body: req.body,
      });
      // TOUJOURS retourner 200 OK pour éviter les retry
      return res.status(200).json({ success: true });
    }

    // Normaliser le numéro de destination (ajouter le + si absent)
    const destinationNumber = msisdn?.startsWith("+")
      ? msisdn
      : msisdn
        ? `+${msisdn}`
        : undefined;

    // Sauvegarder la confirmation de livraison
    const receipt = await SmsDeliveryReceiptModel.create({
      messageId,
      from: to || "unknown", // Numéro d'envoi (notre numéro Vonage)
      to: destinationNumber || "unknown",
      status,
      price,
      networkCode,
      errorCode,
      messageTimestamp,
      receivedAt: new Date(),
    });

    const duration = Date.now() - startTime;

    // Logger selon le statut
    if (status === "delivered") {
      webhookLogger.info("SMS délivré avec succès", {
        messageId,
        to: destinationNumber?.substring(0, 6) + "***",
        price,
        duration: `${duration}ms`,
      });
    } else if (
      status === "failed" ||
      status === "rejected" ||
      status === "expired"
    ) {
      webhookLogger.warn("Échec de livraison SMS", {
        messageId,
        to: destinationNumber?.substring(0, 6) + "***",
        status,
        errorCode,
        networkCode,
        duration: `${duration}ms`,
      });
    } else {
      // accepted, buffered, unknown
      webhookLogger.info("Statut SMS reçu", {
        messageId,
        to: destinationNumber?.substring(0, 6) + "***",
        status,
        duration: `${duration}ms`,
      });
    }

    // TOUJOURS retourner 200 OK (sinon Vonage retry)
    res.status(200).json({ success: true });
  } catch (error) {
    // En cas d'erreur interne, on log mais on retourne quand même 200 OK
    webhookLogger.error("Erreur lors du traitement du webhook Vonage", {
      error: getErrorMessage(error),
      body: req.body,
    });

    // TOUJOURS retourner 200 OK pour éviter les retry Vonage
    res.status(200).json({ success: true });
  }
}
