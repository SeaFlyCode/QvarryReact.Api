# Service Logger (Winston)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Niveaux de log](#niveaux-de-log)
- [Configuration](#configuration)
- [Transports](#transports)
- [Filtrage des données sensibles](#filtrage-des-données-sensibles)
- [Correlation ID](#correlation-id)
- [Child loggers](#child-loggers)
- [Logs HTTP Morgan](#logs-http-morgan)
- [Utilisation dans le code](#utilisation-dans-le-code)

---

## Vue d'ensemble

Le service de logging utilise **Winston** avec rotation quotidienne des fichiers via `winston-daily-rotate-file`. Il fournit des logs structurés avec filtrage automatique des données sensibles et corrélation des requêtes.

```
┌─────────────────────────────────────────────────────────┐
│                     logger (Winston)                    │
│                                                         │
│  logger.critical('message', { metadata })               │
│  logger.error('message', { metadata })                  │
│  logger.warn('message', { metadata })                   │
│  logger.info('message', { metadata })                   │
│  logger.http('message', { metadata })                   │
│  logger.debug('message', { metadata })                  │
│         │                                               │
│         ▼ Filtre données sensibles                      │
│         ▼ Ajoute correlationId                          │
│         │                                               │
│  ┌──────┴──────────┐                                    │
│  ▼                 ▼                                    │
│ Console       DailyRotateFile                           │
│ (colorisé)    (JSON, rotation quotidienne)              │
└─────────────────────────────────────────────────────────┘
```

---

## Niveaux de log

Les niveaux sont définis par ordre de criticité croissante :

| Niveau     | Valeur numérique | Couleur (dev) | Usage                                                 |
| ---------- | ---------------- | ------------- | ----------------------------------------------------- |
| `critical` | 0                | Rouge vif     | Erreurs système fatales, incidents sécurité critiques |
| `error`    | 1                | Rouge         | Erreurs applicatives récupérables                     |
| `warn`     | 2                | Jaune         | Avertissements, anomalies non bloquantes              |
| `info`     | 3                | Vert          | Informations générales (démarrage, requêtes normales) |
| `http`     | 4                | Cyan          | Logs des requêtes HTTP (Morgan)                       |
| `debug`    | 5                | Blanc         | Informations de débogage détaillées                   |

> ⚠️ Le niveau `critical` est un niveau **personnalisé** ajouté à Winston (non standard). Il est réservé aux incidents de sécurité, aux échecs de composants safety-critical (SOS, Vonage) et aux conditions qui nécessitent une intervention immédiate.

---

## Configuration

### Variables d'environnement

| Variable    | Description                                       | Défaut |
| ----------- | ------------------------------------------------- | ------ |
| `LOG_LEVEL` | Niveau minimum de log                             | `info` |
| `LOG_DIR`   | Répertoire des fichiers de log                    | `logs` |
| `NODE_ENV`  | Affecte le format (JSON en prod, colorisé en dev) | —      |

### Niveaux effectifs selon l'environnement

| Environnement | `LOG_LEVEL` recommandé | Format            |
| ------------- | ---------------------- | ----------------- |
| Développement | `debug`                | Colorisé, lisible |
| Staging       | `info`                 | JSON              |
| Production    | `info` ou `warn`       | JSON              |

```env
# Développement
LOG_LEVEL=debug
LOG_DIR=./logs

# Production
LOG_LEVEL=info
LOG_DIR=/var/log/qvarry
```

---

## Transports

### Console (tous environnements)

```
Format développement (NODE_ENV != production) :
  2026-03-18 10:00:00 [info]    [SYNC] Synchronisation démarrée pour userId: 64a1b2c3
  2026-03-18 10:00:01 [warn]    [REDIS] Connexion Redis lente (245ms)
  2026-03-18 10:00:02 [critical] [VONAGE] Service SMS non configuré

Format production (JSON) :
  {"timestamp":"2026-03-18T10:00:00.000Z","level":"info","service":"SYNC","message":"Synchronisation démarrée","correlationId":"req-uuid-1234","userId":"64a1b2c3"}
```

### DailyRotateFile (fichiers)

```
Répertoire : LOG_DIR (défaut: ./logs)
Format : JSON (toujours, indépendamment de NODE_ENV)
Rotation : Quotidienne à minuit
Nom des fichiers : application-%DATE%.log
Pattern date : YYYY-MM-DD
Rétention : 14 jours (fichiers plus anciens supprimés automatiquement)
Compression : .gz après rotation

Exemple :
  logs/
  ├── application-2026-03-18.log     ← Fichier courant
  ├── application-2026-03-17.log.gz  ← Compressé J-1
  ├── application-2026-03-16.log.gz  ← Compressé J-2
  └── ...
```

---

## Filtrage des données sensibles

Le logger filtre automatiquement les données sensibles dans les métadonnées avant de les écrire. Les champs suivants sont remplacés par `[FILTERED]` :

| Champ filtré    | Exemples                                 |
| --------------- | ---------------------------------------- |
| `password`      | `password`, `newPassword`, `oldPassword` |
| `token`         | `accessToken`, `refreshToken`, `wsToken` |
| `secret`        | `apiSecret`, `totpSecret`                |
| `authorization` | Header `Authorization`                   |
| `cookie`        | Valeurs de cookies                       |
| `jwt`           | Tout champ contenant `jwt`               |
| `key`           | `apiKey`, `privateKey`                   |
| `credential`    | `credentials`                            |

### Exemple de filtrage

```typescript
// Code appelant
logger.info('[AUTH] Tentative de connexion', {
  email: 'user@example.com',
  password: 'MonMotDePasse123',    // Sera filtré
  accessToken: 'eyJhbGci...',       // Sera filtré
  platform: 'ios',                  // Conservé
});

// Log écrit (filtré)
{
  "level": "info",
  "message": "[AUTH] Tentative de connexion",
  "email": "user@example.com",
  "password": "[FILTERED]",
  "accessToken": "[FILTERED]",
  "platform": "ios"
}
```

---

## Correlation ID

Chaque requête HTTP reçoit un **Correlation ID** unique généré par le `correlationMiddleware`. Ce ID est automatiquement inclus dans tous les logs de la requête, permettant de tracer l'ensemble des logs d'une même requête.

### Middleware de corrélation

```typescript
// correlationMiddleware.ts
import { v4 as uuidv4 } from "uuid";
import { AsyncLocalStorage } from "async_hooks";

const correlationStorage = new AsyncLocalStorage<string>();

export const correlationMiddleware = (req, res, next) => {
  const correlationId = req.headers["x-correlation-id"] || uuidv4();
  res.setHeader("X-Correlation-ID", correlationId);
  correlationStorage.run(correlationId, next);
};

export const getCorrelationId = () =>
  correlationStorage.getStore() || "no-context";
```

### Résultat dans les logs

```json
// Tous les logs d'une même requête partagent le même correlationId
{"level":"info","message":"[AUTH] Login","correlationId":"req-550e8400-e29b-41d4","userId":"64a1b2c3"}
{"level":"info","message":"[REDIS] Token créé","correlationId":"req-550e8400-e29b-41d4"}
{"level":"http","message":"POST /api/v1/mobile/auth/login 200 45ms","correlationId":"req-550e8400-e29b-41d4"}
```

---

## Child loggers

Les child loggers permettent d'ajouter un contexte permanent (par exemple le nom du service) à tous les messages sans le répéter à chaque appel.

```typescript
// Création d'un child logger
import { logger } from '../utils/logger';

const sosLogger = logger.child({ service: 'SOS', component: 'escalation' });

// Utilisation
sosLogger.warn('Session expirée sans heartbeat', { sessionId: '64a1b2c3' });

// Log résultant
{
  "level": "warn",
  "message": "Session expirée sans heartbeat",
  "service": "SOS",
  "component": "escalation",
  "sessionId": "64a1b2c3",
  "correlationId": "req-550e8400-..."
}
```

### Child loggers par service

| Service                               | Usage recommandé |
| ------------------------------------- | ---------------- |
| `logger.child({ service: 'SOS' })`    | Service SOS      |
| `logger.child({ service: 'SYNC' })`   | Service sync     |
| `logger.child({ service: 'VONAGE' })` | Service SMS      |
| `logger.child({ service: 'FCM' })`    | Service push     |
| `logger.child({ service: 'REDIS' })`  | Service Redis    |
| `logger.child({ service: 'CRON' })`   | Jobs planifiés   |

---

## Logs HTTP Morgan

Les requêtes HTTP sont loggées via **Morgan** qui utilise le stream Winston.

```typescript
// Configuration Morgan
import morgan from "morgan";
import { httpLogStream } from "../utils/logger";

app.use(morgan("combined", { stream: httpLogStream }));

// httpLogStream = { write: (message) => logger.http(message.trim()) }
```

### Format des logs HTTP

```
POST /api/v1/mobile/auth/login 200 45ms - 312b
GET  /api/v1/mobile/sync       200 123ms - 8432b
POST /api/v1/mobile/sos/heartbeat 200 12ms - 256b
```

---

## Utilisation dans le code

### Import

```typescript
import { logger } from "../utils/logger";
```

### Exemples d'utilisation

```typescript
// Log simple
logger.info("Serveur démarré sur le port 3000");

// Log avec métadonnées
logger.info("[SYNC] Synchronisation démarrée", {
  userId: "64a1b2c3",
  deviceId: "550e8400-...",
  changesCount: 12,
});

// Log d'erreur avec stack trace
try {
  await riskyOperation();
} catch (error) {
  logger.error("[SERVICE] Opération échouée", {
    error: error.message,
    stack: error.stack,
    context: "quelque contexte",
  });
}

// Log critique (incidents safety)
logger.critical("[VONAGE] SMS SOS Stage 2 non envoyé", {
  sessionId: "64a1b2c3",
  contactPhone: "+336...",
  error: vonageError.message,
});

// Child logger
const syncLogger = logger.child({ service: "SYNC" });
syncLogger.debug("Delta sync calculé", { changes: 5, conflicts: 1 });
```

---

_Voir aussi : [audit-service.md](./audit-service.md)_
