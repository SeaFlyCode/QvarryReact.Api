// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTIONS MONGODB OPTIONNELLES
// ═══════════════════════════════════════════════════════════════════════════
// Permet d'exécuter une séquence d'opérations dans une vraie transaction MongoDB
// quand le déploiement la supporte (replica set / mongos), et de basculer
// automatiquement sur un mode SANS transaction (fallback) quand MongoDB tourne
// en standalone (cas où `startTransaction` lève l'erreur code 20 /
// IllegalOperation "Transaction numbers are only allowed on a replica set...").
//
// Limite connue du fallback : sans transaction, la séquence n'est plus atomique.
// La logique métier doit donc placer ses checks juste avant les écritures
// (best effort) — il reste une fenêtre de course possible.
// ═══════════════════════════════════════════════════════════════════════════

import mongoose, { ClientSession } from "mongoose";
import { logger } from "../services/loggerService";

const txLogger = logger.child({ service: "db-transaction" });

/**
 * Cache du support des transactions, déterminé au premier échec/succès.
 * - `undefined` : pas encore déterminé, on tente une vraie transaction.
 * - `true`      : transactions supportées (replica set / mongos).
 * - `false`     : standalone détecté, on n'essaie plus et on va direct au fallback.
 *
 * Mémoriser le résultat évite de réouvrir/rejouer une transaction qui échouera
 * systématiquement sur un Mongo standalone.
 */
let transactionsSupported: boolean | undefined = undefined;

/**
 * Détecte si une erreur correspond à "transactions non supportées par la
 * topologie" (MongoDB standalone). On se base sur le code Mongo (20) et/ou
 * le `codeName` IllegalOperation plutôt que sur la string du message, qui
 * peut varier selon les versions/locales.
 *
 * NB : on garde un fallback sur le message UNIQUEMENT en dernier recours, et
 * on reste volontairement strict pour ne PAS confondre une erreur métier
 * (SESSION_ALREADY_ACTIVE, INVALID_CONTACT_IDS, …) avec un échec de topologie.
 */
function isTransactionUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as {
    code?: number | string;
    codeName?: string;
    message?: string;
    errorLabels?: string[];
  };

  // Code MongoDB 20 = IllegalOperation (transactions non supportées en standalone)
  if (err.code === 20 || err.code === "20") {
    return true;
  }

  if (err.codeName === "IllegalOperation") {
    return true;
  }

  // Dernier recours : signature explicite du message standalone.
  if (
    typeof err.message === "string" &&
    err.message.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Exécute `fn` dans une transaction MongoDB si la topologie le permet, sinon
 * sans transaction (fallback standalone).
 *
 * `fn` reçoit une `ClientSession | null` :
 *   - une vraie session quand on est en mode transactionnel ;
 *   - `null` en fallback → l'appelant doit alors passer `null`/`undefined`
 *     à `.session()` / `.save({ session })` (Mongoose ignore une session nulle).
 *
 * Le commit/abort/endSession est géré ici ; `fn` ne doit PAS les appeler.
 *
 * @param fn Séquence d'opérations à exécuter de façon atomique si possible.
 * @returns La valeur retournée par `fn`.
 */
export async function withOptionalTransaction<T>(
  fn: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  // Si on sait déjà qu'on est en standalone, on évite d'ouvrir une session.
  if (transactionsSupported === false) {
    return fn(null);
  }

  const mongoSession = await mongoose.startSession();
  try {
    mongoSession.startTransaction();
    const result = await fn(mongoSession);
    await mongoSession.commitTransaction();

    if (transactionsSupported === undefined) {
      transactionsSupported = true;
      txLogger.info("MongoDB transactions supportées (replica set / mongos)");
    }

    return result;
  } catch (error) {
    // Toujours tenter d'annuler la transaction en cours.
    try {
      await mongoSession.abortTransaction();
    } catch {
      // L'abort peut lui-même échouer si la transaction n'a jamais démarré
      // (standalone) — on ignore, l'erreur d'origine prime.
    }

    // Topologie sans transaction → on mémorise et on rejoue SANS session.
    if (isTransactionUnsupportedError(error)) {
      transactionsSupported = false;
      txLogger.warn(
        "MongoDB standalone détecté : exécution sans transaction (fallback). " +
          "Les opérations ne sont plus atomiques.",
      );
      // On termine d'abord la session avant de rejouer.
      mongoSession.endSession();
      return fn(null);
    }

    // Toute autre erreur (métier ou technique) est propagée telle quelle.
    throw error;
  } finally {
    // endSession est idempotent ; sans danger même après un fallback.
    mongoSession.endSession();
  }
}

/**
 * Réinitialise le cache de détection. Réservé aux tests.
 */
export function __resetTransactionSupportCache(): void {
  transactionsSupported = undefined;
}
