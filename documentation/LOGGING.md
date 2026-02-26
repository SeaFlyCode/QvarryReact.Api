# 📊 Système de Logging QvarryReact.Api

## 📖 Vue d'ensemble

Système de logging structuré basé sur **Winston** avec rotation quotidienne des fichiers, sanitisation automatique des données sensibles, et traçage des requêtes via correlation IDs.

## 🎯 Fonctionnalités

- ✅ **Logging structuré JSON** en production, format coloré lisible en développement
- ✅ **Niveaux personnalisés** : critical, error, warn, info, http, debug
- ✅ **Rotation automatique des logs** : quotidienne avec compression et rétention configurable
- ✅ **Sanitisation automatique** : masquage des données sensibles (passwords, tokens, secrets)
- ✅ **Correlation IDs** : traçage des requêtes HTTP à travers les appels asynchrones
- ✅ **Child loggers** : contexte additionnel (service, controller, etc.)
- ✅ **Intégration Morgan** : logs HTTP automatiques

## 📁 Architecture

```
src/
├── services/
│   ├── loggerService.ts                    # Service Winston principal
│   └── loggerService.examples.ts.documentation  # Exemples d'utilisation
└── middlewares/
    └── correlationMiddleware.ts            # Middleware de correlation ID
```

## 🚀 Installation

Les dépendances sont déjà installées :

```json
{
  "dependencies": {
    "winston": "^3.x.x",
    "winston-daily-rotate-file": "^5.x.x"
  }
}
```

## ⚙️ Configuration

### Variables d'environnement

```env
# Dossier des logs (défaut: "logs")
LOG_DIR=logs

# Environment (dev: niveau debug, prod: niveau info)
NODE_ENV=production
```

### Structure des fichiers de logs

```
logs/
├── app-2026-02-25.log       # Tous les logs (info+), max 100MB, rétention 14 jours
├── app-2026-02-24.log.gz    # Anciens logs compressés
├── error-2026-02-25.log     # Erreurs uniquement, max 50MB, rétention 30 jours
└── error-2026-02-24.log.gz  # Anciennes erreurs compressées
```

## 📝 Utilisation

### 1. Configuration du middleware (dans server.ts ou app.ts)

```typescript
import express from "express";
import { correlationMiddleware } from "./middlewares/correlationMiddleware";
import { logger } from "./services/loggerService";

const app = express();

// ⚠️ IMPORTANT: Ajouter en premier pour tracer toutes les requêtes
app.use(correlationMiddleware);

// Autres middlewares...
app.use(express.json());

logger.info("Serveur démarré", { port: 3000 });
```

### 2. Logging basique

```typescript
import { logger } from "./services/loggerService";

// Debug (développement uniquement)
logger.debug("Détails techniques", { query: "SELECT * FROM users" });

// Info (événements importants)
logger.info("Utilisateur créé", { userId: "123", email: "user@example.com" });

// HTTP (requêtes)
logger.http("GET /api/users - 200", { method: "GET", status: 200 });

// Warning (avertissements)
logger.warn("Tentative échouée", { attempts: 3 });

// Error (erreurs récupérables)
logger.error("Erreur DB", { error: err.message });

// Critical (erreurs critiques)
logger.critical("Service indisponible", {
  error: err.message,
  stack: err.stack,
});
```

### 3. Child Logger avec contexte

```typescript
// Créer un logger avec contexte
const authLogger = logger.child({ service: "auth" });

// Tous les logs incluront { service: 'auth' }
authLogger.info("Login réussi", { userId: "123" });
// Résultat: { service: 'auth', userId: '123', message: 'Login réussi', ... }

// Dans un contrôleur
const userController = logger.child({ controller: "UserController" });
userController.info("Création utilisateur", { email: "user@example.com" });
```

### 4. Intégration Morgan pour logs HTTP

```typescript
import morgan from "morgan";
import { httpLogFormat, httpLogStream } from "./services/loggerService";

// Remplacer morgan standard
app.use(morgan(httpLogFormat, { stream: httpLogStream }));
```

### 5. Sanitisation automatique des données sensibles

```typescript
// Ces champs sont automatiquement masqués :
// password, token, secret, authorization, cookie, jwt, apikey, etc.

logger.info("Login attempt", {
  email: "user@example.com",
  password: "secret123", // Sera [REDACTED]
  token: "jwt-token", // Sera [REDACTED]
});

// Résultat:
// {
//   email: 'user@example.com',
//   password: '[REDACTED]',
//   token: '[REDACTED]'
// }
```

### 6. Correlation ID automatique

```typescript
// Le middleware ajoute automatiquement correlationId à tous les logs
app.get("/api/users", async (req, res) => {
  // Ce log inclura automatiquement le correlation ID de la requête
  logger.info("Traitement requête", { endpoint: "/api/users" });

  // Même dans des fonctions asynchrones profondes
  await getUsersFromDB();

  res.json({ success: true });
});

async function getUsersFromDB() {
  // Le correlation ID est toujours présent via AsyncLocalStorage
  logger.debug("Query DB");
}
```

### 7. Gestion des erreurs

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error("Opération échouée", {
    error: error.message,
    stack: error.stack,
    context: "additional-info",
  });
}

// Erreurs non gérées
process.on("uncaughtException", (error) => {
  logger.critical("Exception non capturée", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.critical("Promise rejection non gérée", {
    reason: reason?.message || reason,
  });
});
```

## 🎨 Niveaux de log

| Niveau   | Priorité | Usage                                  | Production | Dev |
| -------- | -------- | -------------------------------------- | ---------- | --- |
| critical | 0        | Erreurs critiques, service down        | ✅         | ✅  |
| error    | 1        | Erreurs récupérables                   | ✅         | ✅  |
| warn     | 2        | Avertissements, comportements anormaux | ✅         | ✅  |
| info     | 3        | Événements importants (défaut prod)    | ✅         | ✅  |
| http     | 4        | Requêtes HTTP                          | ❌         | ✅  |
| debug    | 5        | Détails techniques (défaut dev)        | ❌         | ✅  |

## 📊 Format des logs

### Développement (Console colorée)

```
2026-02-25 15:30:45 [info]: Serveur démarré
{
  "port": 3000,
  "env": "development",
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Production (JSON structuré)

```json
{
  "timestamp": "2026-02-25 15:30:45",
  "level": "info",
  "message": "Serveur démarré",
  "metadata": {
    "port": 3000,
    "env": "production",
    "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

## 🔒 Données sensibles masquées

Le logger masque automatiquement ces champs :

- `password`, `token`, `secret`, `authorization`
- `cookie`, `jwt`, `apikey`, `api_key`
- `access_token`, `refresh_token`, `bearer`
- `credentials`, `auth`, `sessionid`, `session_id`
- `privatekey`, `private_key`, `secretkey`, `secret_key`

### Utilisation manuelle de `sanitizeLogData`

```typescript
import { sanitizeLogData } from "./services/loggerService";

const userData = {
  email: "user@example.com",
  password: "secret",
  apiKey: "key-123",
};

const clean = sanitizeLogData(userData);
// { email: 'user@example.com', password: '[REDACTED]', apiKey: '[REDACTED]' }
```

## 🔍 Correlation ID

Le correlation ID permet de tracer une requête HTTP à travers tous les composants de l'application.

### Fonctionnement

1. Le middleware génère un UUID v4 (ou utilise `X-Correlation-ID` du header)
2. Le stocke dans `req.correlationId`
3. L'ajoute au header de réponse `X-Correlation-ID`
4. Le rend disponible via `AsyncLocalStorage` pour tous les logs

### Utilisation

```typescript
import { getCorrelationId } from "./middlewares/correlationMiddleware";

// Récupérer le correlation ID actuel
const correlationId = getCorrelationId();
console.log(correlationId); // "f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

## ✅ Bonnes pratiques

### ✅ À FAIRE

```typescript
// Utiliser le niveau approprié
logger.info("Événement important");
logger.debug("Détails techniques");
logger.error("Erreur récupérable", { error: err.message });

// Utiliser child logger pour le contexte
const serviceLogger = logger.child({ service: "auth" });

// Logger des objets structurés
logger.info("User action", { userId, action, timestamp });

// Laisser la sanitisation automatique
logger.info("Login", { email, password }); // password masqué automatiquement
```

### ❌ À ÉVITER

```typescript
// ❌ Ne pas utiliser console.log
console.log("Bad practice");

// ❌ Ne pas logger trop en production
logger.debug("Too much detail"); // Désactivé en prod de toute façon

// ❌ Ne pas logger de données sensibles manuellement
console.log("Token:", token); // ❌ Utiliser le logger avec sanitisation
```

## 📦 API du Logger

### Interface `LoggerInterface`

```typescript
interface LoggerInterface {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  http(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  critical(message: string, meta?: any): void;
  child(meta: any): LoggerInterface;
}
```

### Exports du module

```typescript
// Logger singleton
export const logger: LoggerInterface;

// Fonction de sanitisation
export function sanitizeLogData(data: any): any;

// Format Morgan
export const httpLogFormat: string;
export const httpLogStream: { write: (message: string) => void };
```

## 🔧 Dépannage

### Les logs ne s'écrivent pas dans les fichiers

- Vérifier que le dossier `logs/` existe (créé automatiquement)
- Vérifier les permissions d'écriture
- Vérifier la variable `LOG_DIR` dans `.env`

### Le correlation ID n'apparaît pas

- Vérifier que `correlationMiddleware` est ajouté AVANT les autres middlewares
- Vérifier que le logger est importé APRÈS la création du middleware

### Données sensibles non masquées

- Utiliser `sanitizeLogData()` manuellement si besoin
- Ajouter le champ dans `SENSITIVE_KEYS` dans `loggerService.ts`

## 📚 Ressources

- [Documentation Winston](https://github.com/winstonjs/winston)
- [Winston Daily Rotate File](https://github.com/winstonjs/winston-daily-rotate-file)
- [Morgan](https://github.com/expressjs/morgan)

## 🎯 Exemples complets

Voir le fichier `src/services/loggerService.examples.ts.documentation` pour des exemples détaillés d'utilisation.

---

**Créé pour QvarryReact.Api** | Dernière mise à jour : 25 février 2026
