# 🚀 Guide d'intégration dans server.ts

## Exemple d'intégration complète

Voici comment intégrer le système de logging dans votre fichier `src/server.ts` :

```typescript
import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";

// ⚠️ IMPORTANT: Importer le logger et le middleware de corrélation EN PREMIER
import { logger, httpLogFormat, httpLogStream } from "./services/loggerService";
import { correlationMiddleware } from "./middlewares/correlationMiddleware";

// Autres imports...
import helmet from "helmet";
import cors from "cors";
import compression from "compression";

// Configuration
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════
// 🔧 MIDDLEWARES - ORDRE IMPORTANT !
// ════════════════════════════════════════════════════════

// 1️⃣ Correlation ID - DOIT ÊTRE EN PREMIER
app.use(correlationMiddleware);

// 2️⃣ Logging HTTP avec Morgan + Winston
app.use(morgan(httpLogFormat, { stream: httpLogStream }));

// 3️⃣ Sécurité
app.use(helmet());
app.use(cors());

// 4️⃣ Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// 5️⃣ Vos autres middlewares...
// app.use(authMiddleware);
// etc.

// ════════════════════════════════════════════════════════
// 📍 ROUTES
// ════════════════════════════════════════════════════════

app.get("/health", (req, res) => {
  logger.info("Health check endpoint called", {
    correlationId: req.correlationId,
  });
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Vos autres routes...
// app.use('/api/auth', authRoutes);
// app.use('/api/users', userRoutes);

// ════════════════════════════════════════════════════════
// 🚨 GESTION DES ERREURS
// ════════════════════════════════════════════════════════

// Middleware d'erreur global
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    logger.error("Erreur non gérée", {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      correlationId: req.correlationId,
    });

    res.status(err.status || 500).json({
      error:
        process.env.NODE_ENV === "production"
          ? "Une erreur est survenue"
          : err.message,
      correlationId: req.correlationId,
    });
  },
);

// 404 - Route non trouvée
app.use((req, res) => {
  logger.warn("Route non trouvée", {
    path: req.path,
    method: req.method,
    correlationId: req.correlationId,
  });

  res.status(404).json({
    error: "Route non trouvée",
    correlationId: req.correlationId,
  });
});

// ════════════════════════════════════════════════════════
// 🌐 DÉMARRAGE DU SERVEUR
// ════════════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  logger.info("🚀 Serveur démarré avec succès", {
    port: PORT,
    env: process.env.NODE_ENV,
    nodeVersion: process.version,
  });
});

// ════════════════════════════════════════════════════════
// 🛑 GESTION DES SIGNAUX ET ERREURS
// ════════════════════════════════════════════════════════

// Arrêt propre
process.on("SIGTERM", () => {
  logger.info("Signal SIGTERM reçu, arrêt en cours...");

  server.close(() => {
    logger.info("Serveur arrêté proprement");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("Signal SIGINT reçu (Ctrl+C), arrêt en cours...");

  server.close(() => {
    logger.info("Serveur arrêté proprement");
    process.exit(0);
  });
});

// Exceptions non capturées
process.on("uncaughtException", (error: Error) => {
  logger.critical("💥 Exception non capturée détectée", {
    error: error.message,
    stack: error.stack,
    type: "uncaughtException",
  });

  // Laisser le temps au logger d'écrire
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Promesses rejetées non gérées
process.on("unhandledRejection", (reason: any) => {
  logger.critical("💥 Promise rejection non gérée détectée", {
    reason: reason?.message || reason,
    stack: reason?.stack,
    type: "unhandledRejection",
  });
});

export default app;
```

## 📝 Points clés

### 1. Ordre des middlewares

```typescript
// ✅ CORRECT - Correlation en premier
app.use(correlationMiddleware);
app.use(morgan(httpLogFormat, { stream: httpLogStream }));
app.use(express.json());

// ❌ INCORRECT - Correlation après
app.use(express.json());
app.use(correlationMiddleware); // Trop tard !
```

### 2. Remplacer console.log

```typescript
// ❌ Avant
console.log("Server started on port", PORT);
console.error("Error:", error);

// ✅ Après
logger.info("Server started", { port: PORT });
logger.error("Error occurred", { error: error.message });
```

### 3. Utiliser dans les routes

```typescript
app.get("/api/users", async (req, res) => {
  logger.info("Fetching users", {
    correlationId: req.correlationId,
  });

  try {
    const users = await User.find();
    logger.info("Users fetched successfully", {
      count: users.length,
      correlationId: req.correlationId,
    });
    res.json(users);
  } catch (error) {
    logger.error("Error fetching users", {
      error: error.message,
      correlationId: req.correlationId,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### 4. Child logger dans les services

```typescript
// src/services/userService.ts
import { logger } from "./loggerService";

const userLogger = logger.child({ service: "UserService" });

export async function createUser(data: any) {
  userLogger.info("Creating user", { email: data.email });

  try {
    // ... logique de création
    userLogger.info("User created successfully", { userId: user.id });
    return user;
  } catch (error) {
    userLogger.error("Error creating user", {
      error: error.message,
      email: data.email,
    });
    throw error;
  }
}
```

## 🔄 Migration progressive

### Étape 1: Ajouter le middleware

```typescript
app.use(correlationMiddleware);
```

### Étape 2: Remplacer Morgan

```typescript
// Avant
app.use(morgan("combined"));

// Après
import { httpLogFormat, httpLogStream } from "./services/loggerService";
app.use(morgan(httpLogFormat, { stream: httpLogStream }));
```

### Étape 3: Remplacer console.log progressivement

Rechercher et remplacer dans tout le projet :

- `console.log` → `logger.info`
- `console.warn` → `logger.warn`
- `console.error` → `logger.error`

### Étape 4: Ajouter des child loggers

Créer des child loggers pour chaque service/contrôleur.

## ✅ Checklist d'intégration

- [ ] ✅ Middleware correlationMiddleware ajouté en premier
- [ ] ✅ Morgan configuré avec httpLogStream
- [ ] ✅ Gestion des erreurs avec logger
- [ ] ✅ Gestion SIGTERM/SIGINT
- [ ] ✅ Gestion uncaughtException/unhandledRejection
- [ ] ✅ Remplacer console.log/warn/error
- [ ] ✅ Ajouter child loggers dans les services
- [ ] ✅ Tester en développement
- [ ] ✅ Tester en production
- [ ] ✅ Vérifier les fichiers de logs

## 🧪 Test de l'intégration

```bash
# Démarrer le serveur
npm run dev

# Dans un autre terminal, tester
curl http://localhost:3000/health

# Vérifier les logs
tail -f logs/app-$(date +%Y-%m-%d).log
```

## 📊 Exemple de sortie

### Console (développement)

```
2026-02-25 15:30:45 [info]: 🚀 Serveur démarré avec succès
{
  "port": 3000,
  "env": "development",
  "nodeVersion": "v20.0.0"
}
2026-02-25 15:30:50 [http]: GET /health 200 5 - 3.234 ms
2026-02-25 15:30:50 [info]: Health check endpoint called
{
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Fichier (production)

```json
{"level":"info","message":"🚀 Serveur démarré avec succès","metadata":{"port":3000,"env":"production","nodeVersion":"v20.0.0"},"timestamp":"2026-02-25 15:30:45"}
{"level":"http","message":"GET /health 200 5 - 3.234 ms","metadata":{"correlationId":"f47ac10b-58cc-4372-a567-0e02b2c3d479"},"timestamp":"2026-02-25 15:30:50"}
{"level":"info","message":"Health check endpoint called","metadata":{"correlationId":"f47ac10b-58cc-4372-a567-0e02b2c3d479"},"timestamp":"2026-02-25 15:30:50"}
```

---

**Prêt à l'intégration !** 🚀
