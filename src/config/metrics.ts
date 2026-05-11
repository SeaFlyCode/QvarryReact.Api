/**
 * QVARRY API — Endpoint Prometheus `/metrics`.
 *
 * Cf. fix.md backend #3b. Métriques de base + 4 métriques custom utiles
 * pour piloter la production (durée HTTP, sessions SOS actives, taille
 * du memoryStorage, taille de la queue de notifs en attente).
 *
 * Sécurité : l'endpoint doit être protégé via auth basic ou allowlist IP
 * au site d'usage (cf. server.ts).
 */

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  register,
} from "prom-client";
import mongoose from "mongoose";

// Préfixe par défaut pour différencier les métriques de cette API si on
// pousse plusieurs services dans le même Prometheus.
const PREFIX = "qvarry_api_";

// Init des métriques par défaut (CPU, mémoire, GC, event loop).
collectDefaultMetrics({ prefix: PREFIX });

// ─────────────────────────────────────────────────────────────────────────
// Métriques HTTP
// ─────────────────────────────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: "Durée des requêtes HTTP en secondes",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

export const httpRequestTotal = new Counter({
  name: `${PREFIX}http_requests_total`,
  help: "Nombre total de requêtes HTTP",
  labelNames: ["method", "route", "status_code"],
});

// ─────────────────────────────────────────────────────────────────────────
// Métriques applicatives
// ─────────────────────────────────────────────────────────────────────────
export const sosActiveSessionsGauge = new Gauge({
  name: `${PREFIX}sos_active_sessions`,
  help: "Nombre de sessions SOS actuellement actives",
});

export const memoryStorageSizeGauge = new Gauge({
  name: `${PREFIX}memory_storage_users`,
  help: "Nombre d'utilisateurs avec une session memoryStorage active",
});

export const pendingNotificationsGauge = new Gauge({
  name: `${PREFIX}pending_notifications`,
  help: "Nombre de notifications en attente de retry",
});

export const mongoSyncFailuresCounter = new Counter({
  name: `${PREFIX}mongo_sync_failures_total`,
  help: "Nombre de syncs Mongo échoués (cf. fix.md backend #1)",
  labelNames: ["resource"],
});

// ─────────────────────────────────────────────────────────────────────────
// Métriques pool MongoDB (audit §4.4 P1)
//
// Audit en prod : maxPoolSize=50, mais aucune métrique exposée si saturation.
// On expose les compteurs natifs du driver mongodb (v6.x via Mongoose 8) :
//   - totalConnectionCount    = available + pending + currentCheckedOut
//   - availableConnectionCount = sockets idle prêts à servir
//   - pendingConnectionCount   = sockets en cours d'handshake
//   - currentCheckedOutCount   = sockets actuellement utilisés par une op
//   - waitQueueSize            = opérations qui attendent un socket
//
// Si le pool sature : `waitQueueSize > 0` et `currentCheckedOut == maxPoolSize`.
// ─────────────────────────────────────────────────────────────────────────
export const mongoPoolSizeGauge = new Gauge({
  name: `${PREFIX}mongo_pool_size`,
  help: "Nombre total de connexions dans le pool MongoDB (available + pending + checked out)",
});

export const mongoPoolAvailableGauge = new Gauge({
  name: `${PREFIX}mongo_pool_available`,
  help: "Nombre de connexions MongoDB idle disponibles immédiatement",
});

export const mongoPoolPendingGauge = new Gauge({
  name: `${PREFIX}mongo_pool_pending`,
  help: "Nombre de connexions MongoDB en cours d'établissement (handshake)",
});

export const mongoPoolCheckedOutGauge = new Gauge({
  name: `${PREFIX}mongo_pool_checked_out`,
  help: "Nombre de connexions MongoDB actuellement utilisées par une opération",
});

export const mongoPoolWaitQueueGauge = new Gauge({
  name: `${PREFIX}mongo_pool_wait_queue`,
  help: "Nombre d'opérations en attente d'une connexion MongoDB libre",
});

export const mongoConnectionReadyStateGauge = new Gauge({
  name: `${PREFIX}mongo_connection_ready_state`,
  help: "État de la connexion Mongoose (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)",
});

/**
 * Interface minimale du pool exposée par le driver mongodb 6.x.
 * On ne déclare que ce qu'on lit ici — évite de typer toute la lib.
 */
interface MongoCmapPool {
  totalConnectionCount: number;
  availableConnectionCount: number;
  pendingConnectionCount: number;
  currentCheckedOutCount: number;
  waitQueueSize: number;
}

/**
 * Lit le pool CMAP du driver mongodb via le topology Mongoose.
 *
 * Chemin (Mongoose 8 + mongodb 6.x) :
 *   mongoose.connection.client.topology.s.servers (Map<address, Server>)
 *   chaque Server expose un `.pool` avec les getters CMAP.
 *
 * On agrège tous les serveurs (utile en replica set / sharded).
 * Si l'API change ou que le topology n'est pas prêt, on retourne null
 * et on se rabat sur `readyState` uniquement.
 */
function readMongoPoolStats(): MongoCmapPool | null {
  try {
    // Mongoose 8 n'expose pas le MongoClient ni la topology dans ses types
    // publics — on accède via un cast `unknown -> Record`. Le path concret
    // est : connection.client (MongoClient) → topology → s.servers (Map).
    const conn = mongoose.connection as unknown as {
      client?: { topology?: { s?: { servers?: Map<string, unknown> } } };
    };
    const servers = conn.client?.topology?.s?.servers;
    if (!servers || servers.size === 0) {
      return null;
    }

    const agg: MongoCmapPool = {
      totalConnectionCount: 0,
      availableConnectionCount: 0,
      pendingConnectionCount: 0,
      currentCheckedOutCount: 0,
      waitQueueSize: 0,
    };

    for (const server of servers.values()) {
      const pool = (server as { pool?: Partial<MongoCmapPool> })?.pool;
      if (!pool) continue;
      if (typeof pool.totalConnectionCount === "number") {
        agg.totalConnectionCount += pool.totalConnectionCount;
      }
      if (typeof pool.availableConnectionCount === "number") {
        agg.availableConnectionCount += pool.availableConnectionCount;
      }
      if (typeof pool.pendingConnectionCount === "number") {
        agg.pendingConnectionCount += pool.pendingConnectionCount;
      }
      if (typeof pool.currentCheckedOutCount === "number") {
        agg.currentCheckedOutCount += pool.currentCheckedOutCount;
      }
      if (typeof pool.waitQueueSize === "number") {
        agg.waitQueueSize += pool.waitQueueSize;
      }
    }

    return agg;
  } catch {
    return null;
  }
}

/**
 * Update les gauges du pool MongoDB. Appelée juste avant `register.metrics()`
 * pour avoir des valeurs fraîches au scrape (Prometheus scrape ~ toutes les
 * 15s — pas la peine d'un setInterval séparé).
 *
 * Si le pool n'est pas accessible (API driver modifiée, connexion KO), on
 * expose uniquement `mongo_connection_ready_state` — fallback documenté
 * dans la tâche.
 */
export function collectMongoMetrics(): void {
  const readyState = mongoose.connection.readyState;
  mongoConnectionReadyStateGauge.set(readyState);

  const stats = readMongoPoolStats();
  if (!stats) {
    // Fallback : on ne touche pas les autres gauges, prom-client gardera la
    // dernière valeur connue (ou 0 si jamais set).
    return;
  }

  mongoPoolSizeGauge.set(stats.totalConnectionCount);
  mongoPoolAvailableGauge.set(stats.availableConnectionCount);
  mongoPoolPendingGauge.set(stats.pendingConnectionCount);
  mongoPoolCheckedOutGauge.set(stats.currentCheckedOutCount);
  mongoPoolWaitQueueGauge.set(stats.waitQueueSize);
}

/**
 * Middleware Express qui mesure la durée et le code retour de chaque requête.
 * À monter avant les routes mais après le correlationMiddleware.
 */
export function metricsMiddleware() {
  return (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    const startNs = process.hrtime.bigint();
    res.on("finish", () => {
      const durationS =
        Number(process.hrtime.bigint() - startNs) / 1_000_000_000;
      // `req.route?.path` n'est dispo qu'après matching ; en cas de 404 on
      // tombe sur req.path. Ne pas inclure les paramètres dynamiques pour
      // éviter une explosion de cardinalité.
      const route =
        (req.route?.path as string | undefined) ??
        normalizeRoute(req.path);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      httpRequestDuration.observe(labels, durationS);
      httpRequestTotal.inc(labels);
    });
    next();
  };
}

/**
 * Réduit la cardinalité des labels en remplaçant les segments dynamiques
 * (IDs, codes) par `:id`. Ex. `/users/abc123/photos` → `/users/:id/photos`.
 */
function normalizeRoute(path: string): string {
  return path
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, "/:id") // ObjectId
    .replace(/\/[0-9a-fA-F-]{36}(?=\/|$)/g, "/:uuid") // UUID
    .replace(/\/\d+(?=\/|$)/g, "/:n");
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot métriques pour détection d'anomalies (cf. admin_metrics_anomaly)
// ─────────────────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  /** Latence p95 sur la fenêtre courante (secondes), null si insuffisamment de samples */
  p95Seconds: number | null;
  /** Taux d'erreur (5xx) sur la fenêtre courante, null si pas de requêtes */
  errorRate: number | null;
  /** Nombre total de requêtes observées depuis le démarrage */
  totalRequests: number;
}

/**
 * Snapshot des métriques HTTP utiles pour le monitoring.
 * Lit l'histogramme de durée + compteur de requêtes prom-client.
 *
 * Note : prom-client expose des sums/counts cumulés depuis le démarrage —
 * pas de fenêtre glissante. Pour une vraie détection d'anomalie en
 * production, utiliser Prometheus + Alertmanager. Cette fonction donne un
 * proxy approximatif du p95 via la moyenne pondérée des buckets.
 */
export async function getMetricsSnapshot(): Promise<MetricsSnapshot> {
  const all = await register.getMetricsAsJSON();

  let p95Seconds: number | null = null;
  let totalRequests = 0;
  let errorRequests = 0;

  for (const m of all) {
    const mType = String(m.type).toLowerCase();
    if (
      m.name === `${PREFIX}http_request_duration_seconds` &&
      mType === "histogram"
    ) {
      // Agrégation tous labels confondus : on additionne les buckets cumulatifs
      const bucketTotals = new Map<number, number>();
      let count = 0;
      for (const v of m.values as Array<{
        labels: Record<string, string | number>;
        value: number;
        metricName?: string;
      }>) {
        const name = v.metricName ?? "";
        if (name.endsWith("_bucket")) {
          const le = Number(v.labels.le);
          if (Number.isFinite(le)) {
            bucketTotals.set(le, (bucketTotals.get(le) ?? 0) + v.value);
          }
        } else if (name.endsWith("_count")) {
          count += v.value;
        }
      }

      if (count > 0 && bucketTotals.size > 0) {
        const target = count * 0.95;
        const sortedBuckets = Array.from(bucketTotals.entries()).sort(
          (a, b) => a[0] - b[0],
        );
        for (const [le, cum] of sortedBuckets) {
          if (cum >= target) {
            p95Seconds = le;
            break;
          }
        }
      }
    }

    if (m.name === `${PREFIX}http_requests_total` && mType === "counter") {
      for (const v of m.values as Array<{
        labels: Record<string, string | number>;
        value: number;
      }>) {
        totalRequests += v.value;
        const status = String(v.labels.status_code ?? "");
        if (status.startsWith("5")) {
          errorRequests += v.value;
        }
      }
    }
  }

  const errorRate = totalRequests > 0 ? errorRequests / totalRequests : null;
  return { p95Seconds, errorRate, totalRequests };
}

/**
 * Handler GET `/metrics` à monter dans une route Express protégée.
 */
export async function metricsHandler(
  _req: import("express").Request,
  res: import("express").Response,
) {
  try {
    // Refresh des gauges Mongo juste avant le scrape — coût négligeable
    // (lecture de getters synchrones), évite un setInterval supplémentaire.
    collectMongoMetrics();
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).send(`# error generating metrics: ${(err as Error).message}`);
  }
}

export { register };
