/**
 * QVARRY API — Service de retry pour les emails critiques.
 *
 * Cf. fix.md backend #4. Persiste les emails admin (approbation / refus) dans
 * la collection `PendingEmail` et retente avec backoff exponentiel jusqu'à
 * `maxAttempts`. Empêche les pertes silencieuses lors de pannes SMTP.
 *
 * Workflow :
 *   1. Le caller appelle `enqueueAccountApproved(userId, to, name)`.
 *   2. Le service tente immédiatement l'envoi via emailService.
 *   3. Si succès → status `completed`. Si échec → status `pending` avec
 *      `nextRetryAt` planifié.
 *   4. Un cron tick (`processPendingEmails`) re-traite régulièrement la queue.
 */

import PendingEmailModel, {
  IPendingEmail,
  PendingEmailKind,
} from "../models/pendingEmail";
import {
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
} from "./emailService";
import { logger } from "./loggerService";
import { captureException } from "../config/sentry";
import mongoose from "mongoose";

const emailLogger = logger.child({ service: "pending-email" });

/** Délais de retry en ms : 1min, 5min, 30min, 2h, 12h. */
const RETRY_BACKOFF_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];

const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

/**
 * Calcule le prochain `nextRetryAt` basé sur le nombre de tentatives déjà faites.
 */
function nextRetryDate(attempts: number): Date {
  const delay = RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
  return new Date(Date.now() + delay);
}

/**
 * Tente l'envoi en fonction du `kind`. Retourne `true` si succès.
 */
async function dispatch(item: IPendingEmail): Promise<boolean> {
  const payload = item.payload as Record<string, string>;
  switch (item.kind) {
    case "account_approved":
      return sendAccountApprovedEmail(item.to, payload.userName ?? "");
    case "account_rejected":
      return sendAccountRejectedEmail(
        item.to,
        payload.userName ?? "",
        payload.rejectionReason,
      );
    default:
      emailLogger.error("Type d'email inconnu dans la queue", { kind: item.kind });
      return false;
  }
}

/**
 * Met en queue un email + tente immédiatement de l'envoyer.
 * Retourne `true` si l'envoi initial a réussi (status completed),
 * `false` si l'email est en attente de retry.
 */
async function enqueue(
  kind: PendingEmailKind,
  to: string,
  payload: Record<string, unknown>,
  userId?: string,
): Promise<boolean> {
  const doc = await PendingEmailModel.create({
    userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    kind,
    to,
    payload,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextRetryAt: new Date(),
    status: "pending",
  });

  // Tentative immédiate (best-effort, non bloquant pour la réponse HTTP).
  const success = await tryDispatch(doc);
  return success;
}

/**
 * Tente le dispatch d'un item donné, met à jour son status. Renvoie true si OK.
 */
async function tryDispatch(item: IPendingEmail): Promise<boolean> {
  try {
    const ok = await dispatch(item);
    if (ok) {
      item.status = "completed";
      item.attempts += 1;
      await item.save();
      emailLogger.info("Email envoyé avec succès", {
        emailId: item._id,
        kind: item.kind,
        attempts: item.attempts,
      });
      return true;
    }
    return await markFailureAndScheduleRetry(item, "sendEmail returned false");
  } catch (err) {
    captureException(err, { source: "pendingEmail", kind: item.kind });
    return await markFailureAndScheduleRetry(
      item,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function markFailureAndScheduleRetry(
  item: IPendingEmail,
  errorMessage: string,
): Promise<boolean> {
  item.attempts += 1;
  item.lastError = errorMessage;
  if (item.attempts >= item.maxAttempts) {
    item.status = "failed";
    emailLogger.error("Email définitivement abandonné après max tentatives", {
      emailId: item._id,
      kind: item.kind,
      attempts: item.attempts,
      lastError: errorMessage,
    });
  } else {
    item.nextRetryAt = nextRetryDate(item.attempts);
    emailLogger.warn("Email échoué, retry planifié", {
      emailId: item._id,
      kind: item.kind,
      attempts: item.attempts,
      nextRetryAt: item.nextRetryAt,
      lastError: errorMessage,
    });
  }
  await item.save();
  return false;
}

/**
 * Tick de cron : traite les emails dont `nextRetryAt` est passé.
 * À appeler depuis un cron toutes les 1-5 minutes.
 *
 * @returns Nombre d'emails traités lors de ce tick.
 */
export async function processPendingEmails(maxBatchSize = 50): Promise<number> {
  const now = new Date();
  const items = await PendingEmailModel.find({
    status: "pending",
    nextRetryAt: { $lte: now },
  })
    .sort({ nextRetryAt: 1 })
    .limit(maxBatchSize);

  if (items.length === 0) return 0;

  emailLogger.info("Traitement de la queue d'emails en attente", {
    count: items.length,
  });

  let processed = 0;
  for (const item of items) {
    await tryDispatch(item);
    processed += 1;
  }
  return processed;
}

/**
 * Helper public pour les controllers admin.
 */
export async function enqueueAccountApproved(
  userId: string,
  to: string,
  userName: string,
): Promise<void> {
  await enqueue("account_approved", to, { userName }, userId);
}

export async function enqueueAccountRejected(
  userId: string,
  to: string,
  userName: string,
  rejectionReason?: string,
): Promise<void> {
  await enqueue(
    "account_rejected",
    to,
    { userName, rejectionReason },
    userId,
  );
}

export const pendingEmailService = {
  enqueueAccountApproved,
  enqueueAccountRejected,
  processPendingEmails,
};
