/**
 * QVARRY API — OpenTelemetry scaffolding (distributed tracing).
 *
 * Cf. AUDIT_2026-05-11 §3.6. Le SDK Node OTEL doit être initialisé AVANT tout
 * autre import (Express / Mongoose / ioredis), sinon les auto-instrumentations
 * ne peuvent pas hooker les modules déjà chargés. Pattern :
 *
 *   // tout début de src/server.ts
 *   import { initTelemetry } from "./config/telemetry";
 *   initTelemetry();
 *
 *   // … puis le reste des imports
 *
 * Activation via env vars (no-op gracieux si aucune n'est définie) :
 *   - OTEL_EXPORTER_TYPE         : "otlp-http" | "console" | "" (off)
 *   - OTEL_EXPORTER_OTLP_ENDPOINT: URL collector OTLP (ex. http://localhost:4318/v1/traces)
 *   - OTEL_SERVICE_VERSION       : surcharge la version (sinon package.json)
 *
 * Doc complète : docs/observability.md
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

let initialized = false;
let sdkInstance: unknown = null;

/**
 * Lit la version du service depuis OTEL_SERVICE_VERSION puis package.json.
 * Fallback "unknown" si rien n'est dispo.
 */
function resolveServiceVersion(): string {
  if (process.env.OTEL_SERVICE_VERSION) {
    return process.env.OTEL_SERVICE_VERSION;
  }
  try {
    // Lazy require pour éviter de bundle package.json dans certains contextes
    const pkg = require("../../package.json");
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Initialise le SDK OpenTelemetry SI OTEL_EXPORTER_TYPE est défini.
 * No-op gracieux sinon — pas d'erreur, juste un log debug.
 *
 * Idempotent : appels multiples ignorés.
 *
 * IMPORTANT : à appeler en tout début de src/server.ts, AVANT les imports
 * d'Express / Mongoose / ioredis, sinon les auto-instrumentations ratent
 * leur hook.
 */
export function initTelemetry(): void {
  if (initialized) {
    return;
  }

  const exporterType = (process.env.OTEL_EXPORTER_TYPE ?? "").trim();

  if (!exporterType) {
    // Pas de log avec logger ici car logger peut ne pas être chargé encore
    // (initTelemetry est appelé AVANT loggerService).
    if (process.env.LOG_LEVEL === "debug") {
      console.debug(
        "[telemetry] OTEL_EXPORTER_TYPE non défini — tracing désactivé (no-op).",
      );
    }
    initialized = true;
    return;
  }

  try {
    // Active les logs diag OTEL si LOG_LEVEL=debug
    if (process.env.LOG_LEVEL === "debug") {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
    }

    // Imports lazy : ne pas charger sdk-node si tracing désactivé.
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const {
      getNodeAutoInstrumentations,
    } = require("@opentelemetry/auto-instrumentations-node");
    const { resourceFromAttributes } = require("@opentelemetry/resources");
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = require("@opentelemetry/semantic-conventions");

    const serviceName = process.env.OTEL_SERVICE_NAME ?? "qvarry-api";
    const serviceVersion = resolveServiceVersion();

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      "deployment.environment": process.env.NODE_ENV ?? "development",
    });

    // Choix de l'exporter
    let traceExporter: unknown;
    switch (exporterType) {
      case "otlp-http": {
        const {
          OTLPTraceExporter,
        } = require("@opentelemetry/exporter-trace-otlp-http");
        const endpoint =
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
          "http://localhost:4318/v1/traces";
        traceExporter = new OTLPTraceExporter({ url: endpoint });
        console.info(
          `[telemetry] Exporter OTLP HTTP activé → ${endpoint} (service=${serviceName}@${serviceVersion})`,
        );
        break;
      }
      case "console": {
        const { ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-base");
        traceExporter = new ConsoleSpanExporter();
        console.info(
          `[telemetry] Exporter console activé (service=${serviceName}@${serviceVersion}) — traces dans stdout.`,
        );
        break;
      }
      default:
        console.warn(
          `[telemetry] OTEL_EXPORTER_TYPE="${exporterType}" inconnu. Supportés : "otlp-http" | "console". Tracing désactivé.`,
        );
        initialized = true;
        return;
    }

    // Auto-instrumentations : HTTP, Express, MongoDB, ioredis, etc.
    // On désactive fs (trop bruyant) et net (redondant avec HTTP).
    const instrumentations = getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-express": { enabled: true },
      "@opentelemetry/instrumentation-mongoose": { enabled: true },
      "@opentelemetry/instrumentation-mongodb": { enabled: true },
      "@opentelemetry/instrumentation-ioredis": { enabled: true },
      "@opentelemetry/instrumentation-winston": { enabled: true },
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      instrumentations,
    });

    sdk.start();
    sdkInstance = sdk;

    // Shutdown propre sur signal pour flush les spans pendants
    const shutdown = async (signal: string) => {
      try {
        await sdk.shutdown();
        console.info(`[telemetry] SDK shutdown OK (signal=${signal})`);
      } catch (err) {
        console.error(
          `[telemetry] SDK shutdown KO (signal=${signal}):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));

    initialized = true;
  } catch (err) {
    // En cas d'échec d'init, on ne fait PAS crasher le serveur — on log
    // et on continue sans tracing. Le tracing est un outil d'observabilité,
    // pas un composant critique du chemin de requête.
    console.error(
      "[telemetry] Échec init OTEL — tracing désactivé pour cette instance:",
      err instanceof Error ? err.message : String(err),
    );
    initialized = true; // on bloque les retries
  }
}

/**
 * Shutdown explicite (utile en tests ou avant un fork). No-op si pas init.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdkInstance) return;
  try {
    // @ts-expect-error sdk-node n'a pas de type export propre ici
    await sdkInstance.shutdown();
  } catch {
    // best effort
  } finally {
    sdkInstance = null;
    initialized = false;
  }
}

/**
 * Indique si le SDK OTEL est actuellement actif (pour conditional spans).
 */
export function isTelemetryEnabled(): boolean {
  return sdkInstance !== null;
}
