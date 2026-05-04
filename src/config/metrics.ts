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
    res.setHeader("Content-Type", register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).send(`# error generating metrics: ${(err as Error).message}`);
  }
}

export { register };
