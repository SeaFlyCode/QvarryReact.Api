/**
 * QVARRY API — Init et helpers Sentry.
 *
 * Cf. fix.md backend #3a. À init très tôt dans `server.ts`, AVANT les routes.
 * Désactivé silencieusement si `SENTRY_DSN` manquant (dev sans Sentry).
 *
 * Cross-project : viser un seul projet Sentry partagé entre `Qvarry-phone`,
 * `QvarryReact` et cette API, avec des tags `service` distincts pour filtrer.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

// Garde anti-boucle : si notifyAllAdmins throw vers Sentry, on ne renotifie pas.
let notifyingAdminFromSentry = false;

async function notifyAdminFromSentry(event: Sentry.Event): Promise<void> {
  if (notifyingAdminFromSentry) return;
  notifyingAdminFromSentry = true;
  try {
    const exception = event.exception?.values?.[0];
    const errorType = exception?.type ?? "Error";
    const errorValue = exception?.value ?? event.message ?? "Unknown error";
    const fingerprint =
      (Array.isArray(event.fingerprint) && event.fingerprint.join(":")) ||
      errorType;

    const { notifyAllAdmins } = await import(
      "../services/adminNotificationService"
    );
    await notifyAllAdmins(
      "admin_sentry_high",
      "🐛 Erreur Sentry (severity ≥ error)",
      `${errorType}: ${String(errorValue).slice(0, 200)}`,
      {
        level: event.level,
        errorType,
        fingerprint,
        eventId: event.event_id,
        dedupKey: `sentry:${fingerprint}`,
      },
    );
  } catch {
    // Ne jamais throw depuis beforeSend / hook Sentry
  } finally {
    notifyingAdminFromSentry = false;
  }
}

export function initSentry(): boolean {
  if (initialized) return true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // En dev / test sans Sentry configuré, on no-op silencieusement.
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? process.env.npm_package_version,
    // Sample rate par défaut : 10 % en prod (économie quota), 100 % sinon.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // PII — on filtre nous-mêmes les données sensibles via le logger.
    sendDefaultPii: false,
    // beforeSend : dernière chance de scrubber un payload à risque.
    beforeSend(event) {
      // Retire les headers sensibles si Sentry les a capturés via integrations.
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        delete h.authorization;
        delete h.cookie;
        delete h["x-csrf-token"];
      }

      // admin_sentry_high : notif admin pour severity ≥ error (async, non
      // bloquant). Throttle via dedupKey: 'sentry:{fingerprint}'.
      if (event.level === "error" || event.level === "fatal") {
        void notifyAdminFromSentry(event);
      }

      return event;
    },
  });

  Sentry.setTag("service", "qvarry-api");
  initialized = true;
  return true;
}

/**
 * Helpers pour capturer les erreurs depuis n'importe où dans la codebase
 * sans dépendance directe sur l'import `@sentry/node`.
 */
export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = "info") {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

export { Sentry };
