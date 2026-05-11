/**
 * Configuration centralisée des timeouts de graceful shutdown.
 *
 * Phase H §5.x — Centralisation des constantes auparavant hardcodées dans
 * `server.ts` (`setTimeout(..., 10000)`) et dispersées entre
 * `WS_GRACEFUL_SHUTDOWN_TIMEOUT` (env) et le batcher audit (5s).
 *
 * Conventions :
 *   - Tous les noms suffixés `_MS` pour clarifier l'unité.
 *   - Valeurs paramétrables via env, fallback raisonnable si absente.
 *   - Validation simple : Number.isFinite + ≥ 1000ms pour éviter les zéros
 *     accidentels qui couperaient le shutdown avant qu'il ait le temps de
 *     démarrer.
 */

const FALLBACK_GRACEFUL_MS = 10_000;
const FALLBACK_WS_GRACEFUL_MS = 10_000;
const FALLBACK_AUDIT_FLUSH_MS = 5_000;

/**
 * Parse une valeur d'env en ms, avec fallback si invalide (NaN, ≤ 0).
 */
function parseTimeoutMs(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const parsed = parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return fallback;
  }
  return parsed;
}

/**
 * Délai max d'arrêt gracieux global (server.close + fermetures DB/Redis).
 * Au-delà, `process.exit(1)` est forcé pour éviter qu'un client zombie
 * bloque le shutdown infiniment.
 */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = parseTimeoutMs(
  process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  FALLBACK_GRACEFUL_MS,
);

/**
 * Délai max spécifique au shutdown WebSocket (notifier clients + drain).
 * Peut être différent du shutdown global : on tolère plus long pour les
 * WS car flush des ACK est important pour la perception client.
 *
 * Compat : alias historique `WS_GRACEFUL_SHUTDOWN_TIMEOUT` (sans `_MS`)
 * conservé en lecture pour ne pas casser les déploiements existants.
 */
export const WS_GRACEFUL_SHUTDOWN_TIMEOUT_MS = parseTimeoutMs(
  process.env.WS_GRACEFUL_SHUTDOWN_TIMEOUT_MS ??
    process.env.WS_GRACEFUL_SHUTDOWN_TIMEOUT,
  FALLBACK_WS_GRACEFUL_MS,
);

/**
 * Délai max de flush du batcher audit avant arrêt (Phase G — DoS fix).
 * 5s est suffisant pour vider un buffer typique (< 1000 events).
 */
export const AUDIT_FLUSH_TIMEOUT_MS = parseTimeoutMs(
  process.env.AUDIT_FLUSH_TIMEOUT_MS,
  FALLBACK_AUDIT_FLUSH_MS,
);
