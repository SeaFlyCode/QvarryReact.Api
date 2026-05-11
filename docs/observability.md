# Observabilité — Distributed Tracing OpenTelemetry

Date de création : 2026-05-11
Lié à : AUDIT_2026-05-11 §3.6 (P0 partiel)

## TL;DR

L'API embarque un SDK OpenTelemetry **désactivé par défaut**. Aucun overhead
tant que `OTEL_EXPORTER_TYPE` n'est pas défini. Active-le quand tu as une
stack de réception (Tempo / Jaeger / Datadog / Grafana Cloud).

## Activation

### Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `OTEL_EXPORTER_TYPE` | oui pour activer | `otlp-http` \| `console` \| `` (off) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | si `otlp-http` | URL du collector OTLP HTTP |
| `OTEL_SERVICE_VERSION` | non | Surcharge la version (sinon `package.json`) |
| `OTEL_SERVICE_NAME` | non | Nom logique du service (défaut `qvarry-api`) |

### Modes

- **`console`** — dump JSON des spans dans stdout. À utiliser pour du debug
  local, jamais en prod (très bruyant).
- **`otlp-http`** — envoi vers un collector OTLP HTTP. C'est le format
  standard supporté par toutes les stacks modernes (Tempo, Jaeger ≥ 1.35,
  Datadog Agent, Grafana Cloud, New Relic, etc.).
- **vide** — tracing désactivé, no-op gracieux. Le SDK n'est même pas chargé.

### Exemple local — Jaeger all-in-one

```bash
docker run -d --name jaeger \
  -p 16686:16686 -p 4317:4317 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# .env.local
OTEL_EXPORTER_TYPE=otlp-http
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Démarre l'API
npm run dev

# UI Jaeger
open http://localhost:16686
```

### Exemple debug stdout

```bash
OTEL_EXPORTER_TYPE=console LOG_LEVEL=debug npm run dev
# Les spans sont JSON-dumpés dans stdout après chaque requête
```

## Pré-chargement OTEL (timing critique)

OpenTelemetry doit hooker les modules **avant** leur chargement. Le SDK est
donc initialisé en tout début de `src/server.ts`, juste après `dotenv` et
avant les imports Express / Mongoose / ioredis :

```ts
// src/server.ts
import dotenv from "dotenv";
dotenv.config({ path: envFile });

import { initTelemetry } from "./config/telemetry";
initTelemetry();                       // ← AVANT tout autre import !

// … puis le reste (Express, Mongoose, etc.)
import express from "express";
```

### Fallback si le pré-chargement par import échoue

Si tu observes des modules non-instrumentés (typiquement quand `tsc` réordonne
les imports en mode bundle), bascule sur le pattern `--require` :

```bash
# Créer un fichier d'init dédié
echo "require('./dist/config/telemetry').initTelemetry();" > dist/instrument.js

# Lancer Node avec --require
node --require ./dist/instrument.js dist/server.js
```

Ou via `NODE_OPTIONS` :

```bash
NODE_OPTIONS="--require ./dist/instrument.js" node dist/server.js
```

## Stack recommandée

### Self-hosted (Grafana LGTM stack)

- **Tempo** pour les traces (backend OTLP natif)
- **Loki** pour les logs (corrélation trace_id / log)
- **Mimir** ou **Prometheus** pour les métriques (déjà fait via `/metrics`)
- **Grafana** pour la viz

Avantages : zéro coût récurrent, full control, RGPD-friendly.
Inconvénient : ops à charge (Tempo nécessite S3 ou GCS pour le stockage long terme).

### Managé

- **Datadog APM** — endpoint OTLP via Datadog Agent local
- **Grafana Cloud** — endpoint OTLP HTTP direct (free tier 50GB/mois)
- **New Relic** — endpoint OTLP HTTP direct
- **Honeycomb** — orienté observabilité query-driven, excellent pour le debug

Choix recommandé pour Qvarry : **Grafana Cloud free tier** pour démarrer
(zero ops, intégration native OTLP), migration vers self-hosted Tempo si le
volume dépasse 50GB/mois.

## Auto-instrumentations actives

Le SDK active automatiquement :

- `http` — toutes les requêtes/réponses HTTP entrantes et sortantes
- `express` — middleware chain + route patterns
- `mongoose` + `mongodb` — toutes les queries DB
- `ioredis` — toutes les commandes Redis (sessions, pubsub, rate limit)
- `winston` — injection automatique de `trace_id` dans les logs

Désactivées (trop bruyantes) :

- `fs` — chaque `fs.readFile` créerait un span (inutile)
- `net` — redondant avec `http`

## Spans manuels (custom)

Pour annoter des opérations métier (envoi push, encrypt batch, etc.) :

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("qvarry-api");

async function sendPushBatch(userIds: string[]) {
  return tracer.startActiveSpan("push.send-batch", async (span) => {
    span.setAttribute("push.batch-size", userIds.length);
    try {
      const result = await firebase.send(userIds);
      span.setAttribute("push.delivered", result.successCount);
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2 /* ERROR */ });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

## Performance

- **Overhead à froid (tracing OFF)** : 0 — le SDK n'est pas chargé.
- **Overhead à chaud (tracing ON)** : ~3-5% CPU + ~10MB RSS sur du traffic
  Express/Mongoose typique. Les spans sont batchés et envoyés async (pas de
  blocage du chemin de requête).
- **Sampling** : par défaut 100% (parent-based, always-on). Pour réduire en
  prod heavy traffic, ajoute `OTEL_TRACES_SAMPLER=parentbased_traceidratio` +
  `OTEL_TRACES_SAMPLER_ARG=0.1` (10%) — supporté nativement par `sdk-node`.

## Désactivation propre

Pour désactiver à chaud sans redéployer : retire `OTEL_EXPORTER_TYPE` de
l'env et restart. Pas de migration de données nécessaire — les spans sont
fire-and-forget.

## Liens

- Spec OpenTelemetry : https://opentelemetry.io/docs/
- SDK Node : https://github.com/open-telemetry/opentelemetry-js
- Jaeger : https://www.jaegertracing.io/
- Grafana Tempo : https://grafana.com/oss/tempo/
