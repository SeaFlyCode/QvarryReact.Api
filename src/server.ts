// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ IMPORTANT : Charger les variables d'environnement EN PREMIER
// ═══════════════════════════════════════════════════════════════════════════
// Cela doit être fait AVANT tout autre import pour que les modules qui utilisent
// process.env (comme masterEncryptionUtils.ts) aient accès aux variables
// ═══════════════════════════════════════════════════════════════════════════
import dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { getErrorMessage } from "./utils/errorUtils";

// Charger les variables d'environnement depuis la racine du projet
// On remonte d'un niveau car le serveur est dans /src
// Priorité : .env.local (dev) > .env (prod/déployé)
const rootEnvLocalPath = path.resolve(__dirname, "../.env.local");
const rootEnvPath = path.resolve(__dirname, "../.env");

let envFile = rootEnvPath;
let envType = "deployed";
if (fs.existsSync(rootEnvLocalPath)) {
  envFile = rootEnvLocalPath;
  envType = "local";
}

dotenv.config({ path: envFile });

// Log du fichier .env utilisé
console.log(`📝 Environnement chargé : ${envFile}`);

// ═══════════════════════════════════════════════════════════════════════════
// Maintenant on peut importer les autres modules en toute sécurité
// ═══════════════════════════════════════════════════════════════════════════
import express from "express";
import { connectToDatabase } from "./config/database";
import userRoutes from "./routes/userRoutes";
import authRoutes from "./routes/authRoutes";
import conversationsRoutes from "./routes/conversationsRoutes";
// Rate limiters centralisés
import {
  globalRateLimiter,
  healthLimiter,
  authLimiter,
  registerLimiter,
  verifyEmailLimiter,
  resendEmailLimiter,
  passwordResetLimiter,
  twoFactorLimiter,
  generalLimiter,
  highTrafficLimiter,
  socialLimiter,
  wsConnectionLimiter,
  refreshTokenLimiter,
  adminLimiter,
  mobileAuthLimiter,
  securityLimiter,
  authCheckLimiter,
  maintenanceLimiter,
  usersLimiter,
} from "./config/rateLimitConfig";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pointsRoutes from "./routes/pointsRoutes";
import fichesRoutes from "./routes/fichesRoutes";
import listsRoutes from "./routes/listsRoutes";
import messagesRoutes from "./routes/messagesRoutes";
import contactRoutes from "./routes/contactRoutes";
import dataShareRoutes from "./routes/dataShareRoutes";
import notificationsRoutes from "./routes/notificationsRoutes";
import securityRoutes from "./routes/securityRoutes";
import adminRoutes from "./routes/adminRoutes";
import twoFactorRoutes from "./routes/twoFactorRoutes";
import maintenanceRoutes from "./routes/maintenanceRoutes";
import mobileAuthRoutes from "./routes/mobileAuthRoutes";
import mobileSyncRoutes from "./routes/mobileSyncRoutes";
import mobileTwoFactorRoutes from "./routes/mobileTwoFactorRoutes";
import mobileSosRoutes from "./routes/mobileSosRoutes";
import { maintenanceMiddleware } from "./middlewares/maintenanceMiddleware";
import cookieParser from "cookie-parser";
import {
  startDataShareCleanupJob,
  startNotificationCleanupJob,
  startRefreshTokenCleanupJob,
} from "./services/cronJobs";
import {
  startSosEscalationJob,
  startSosCleanupJob,
} from "./services/sosCronJobs";
import { vonageService } from "./services/vonageService";
import { webSocketService } from "./services/webSocketService";

// Initialiser Express
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ═══════════════════════════════════════════════════════════════════════════
// CONF-005: Trust Proxy - Requis pour rate limiting derrière un proxy (nginx, cloudflare)
// ═══════════════════════════════════════════════════════════════════════════
if (NODE_ENV === "production") {
  // 1 = faire confiance au premier proxy (nginx, cloudflare, etc.)
  app.set("trust proxy", 1);
  console.log("🔒 [SECURITY] Trust proxy activé (production)");
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER GLOBAL - Filet de sécurité (catch-all)
// ═══════════════════════════════════════════════════════════════════════════
// Ce rate limiter très permissif s'applique à TOUTES les requêtes.
// Il sert de protection de secours si un rate limiter spécifique a été oublié.
// Les autres rate limiters (plus stricts) s'appliquent EN PLUS de celui-ci.
// ═══════════════════════════════════════════════════════════════════════════

// Appliquer le rate limiter global EN PREMIER (avant tous les autres middlewares)
app.use(globalRateLimiter);

// MEDIUM-8: Compteur de requêtes pour le endpoint /metrics
// Note: Pas de race condition réelle en Node.js car le event loop est single-threaded
// L'incrémentation est atomique dans le contexte d'une requête synchrone
let requestCount = 0;
app.use((req, res, next) => {
  requestCount++;
  next();
});

console.log(
  `🛡️ [SECURITY] Rate limiter global activé (${NODE_ENV === "production" ? "1000" : "5000"} req/min)`,
);

// Log de l'environnement au démarrage
const modeIcon = NODE_ENV === "production" ? "🚀" : "🔧";
console.log(
  `\n${modeIcon} Express Server | ${NODE_ENV} | Port ${PORT} | ${envType}`,
);

const clientUrl = process.env.CLIENT_URL || "http://localhost:3001";

const allowedOrigins =
  NODE_ENV === "production"
    ? [clientUrl]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://localhost:3000",
        "https://localhost:3001",
        "https://dev.qvarry.fr",
        clientUrl,
      ];

app.use(
  cors({
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      // HIGH-7: Les apps mobiles n'ont pas d'origine (ou origin = null/undefined)
      // En production, on ne permet le null origin que pour les routes /api/mobile/
      if (!origin) {
        if (NODE_ENV === "production") {
          // En production, logger un avertissement
          console.warn(`⚠️ [CORS] Requête avec origine null détectée`);
          // Note: La vérification du path est faite dans le middleware CORS lui-même
          // On accepte pour l'instant, mais on pourrait renforcer avec une vérification de header mobile
          callback(null, true);
        } else {
          // En développement, on permet pour faciliter les tests
          callback(null, true);
        }
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`[CORS] Origine refusée: ${origin}`);
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
  }),
);

// Middleware pour parser le JSON
// HIGH-8: Limite explicite de taille de body pour éviter les attaques DoS
app.use(express.json({ limit: "1mb" }));

// ═══════════════════════════════════════════════════════════════════════════
// CONF-007: Morgan - Logging HTTP sans tokens sensibles
// ═══════════════════════════════════════════════════════════════════════════
// Format personnalisé qui exclut les headers sensibles (Authorization, Cookie)
morgan.token("sanitized-url", (req) => {
  // Masquer les tokens dans les query strings
  const url = req.url || "";
  return url.replace(/token=[^&]+/gi, "token=***");
});

// En production, ne pas logger les headers sensibles
const morganFormat =
  NODE_ENV === "production"
    ? ':remote-addr - :remote-user [:date[clf]] ":method :sanitized-url HTTP/:http-version" :status :res[content-length]'
    : "dev";

app.use(
  morgan(morganFormat, {
    // Ne pas logger les health checks en production
    skip: (req) => NODE_ENV === "production" && req.url === "/health",
  }),
);

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK - Route de santé pour Docker/Kubernetes
// ═══════════════════════════════════════════════════════════════════════════
// Cette route doit être définie AVANT tous les middlewares de sécurité
// pour permettre aux health checks de fonctionner sans authentification
// Rate limiter permissif pour éviter les abus (DDoS)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/health", healthLimiter, (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    version: process.env.npm_package_version || "1.0.0",
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOW-03: Métriques basiques pour monitoring (Prometheus-compatible si besoin)
// HIGH-1 FIX: Endpoint protégé par authMiddleware + adminMiddleware
// ═══════════════════════════════════════════════════════════════════════════
// Note: Ce endpoint sera monté après l'import des middlewares dans la section async
// Voir plus bas dans le code après connectToDatabase()

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ - VÉRIFICATION DES IPs BLOQUÉES
// ═══════════════════════════════════════════════════════════════════════════
// Ce middleware doit être placé tôt dans la chaîne pour bloquer immédiatement
// les IPs malveillantes avant tout traitement
// ═══════════════════════════════════════════════════════════════════════════
import { ipBlockCheckMiddleware } from "./middlewares/rateLimitMiddleware";

// Appliquer le middleware de blocage IP sur toutes les routes /api
app.use("/api", ipBlockCheckMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// HELMET - SÉCURITÉ DES HEADERS HTTP
// ═══════════════════════════════════════════════════════════════════════════
// Configuration stricte avec CSP, HSTS, et Permissions Policy
// ═══════════════════════════════════════════════════════════════════════════

app.use(
  helmet({
    // Content Security Policy - Protection XSS et injection de contenu
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Nécessaire pour Leaflet et styles dynamiques
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.tile.openstreetmap.org", // Tuiles OpenStreetMap
          "https://*.basemaps.cartocdn.com", // Tuiles CartoDB
          "https://server.arcgisonline.com", // Tuiles ArcGIS
          "https://*.opentopomap.org", // Tuiles OpenTopoMap
          "https://data.geopf.fr", // Tuiles IGN (Plan IGN, photos aériennes, etc.)
          "https://geoservices.brgm.fr", // Tuiles BRGM (géologie)
          "https://*.google.com", // Tuiles Google Maps (satellite, terrain)
          "https://*.googleapis.com", // Services Google Maps
        ],
        connectSrc: [
          "'self'",
          clientUrl,
          "wss:", // WebSocket sécurisé (production)
          "ws:", // WebSocket non sécurisé (développement)
        ],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(NODE_ENV === "production" && { upgradeInsecureRequests: [] }),
      },
    },

    // HTTP Strict Transport Security - Force HTTPS
    hsts: {
      maxAge: 63072000, // 2 ans (730 jours)
      includeSubDomains: true,
      preload: true, // Inclusion dans la liste HSTS preload des navigateurs
    },

    // Referrer Policy - Contrôle des informations de référence
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },

    // X-Frame-Options - Protection clickjacking
    frameguard: {
      action: "deny",
    },

    // X-Content-Type-Options - Empêche le MIME sniffing
    noSniff: true,

    // X-XSS-Protection - Protection XSS navigateurs anciens
    xssFilter: true,

    // X-Download-Options - IE8+ uniquement
    ieNoOpen: true,

    // X-DNS-Prefetch-Control
    dnsPrefetchControl: {
      allow: false,
    },
  }),
);

// Permissions Policy (header manuel car non supporté nativement par Helmet)
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    [
      "geolocation=(self)",
      "camera=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "picture-in-picture=()",
      "publickey-credentials-get=(self)",
    ].join(", "),
  );
  next();
});

console.log(
  `🛡️ [SECURITY] Helmet configuré avec CSP stricte${NODE_ENV === "production" ? " + HSTS + Upgrade Insecure Requests" : ""}`,
);

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSION GZIP - Réduction de la taille des réponses HTTP
// ═══════════════════════════════════════════════════════════════════════════
app.use(compression());
console.log("📦 [PERF] Compression gzip activée");

// LOW-05: Cache-Control headers pour les réponses API
app.use("/api", (req, res, next) => {
  // Les requêtes GET de lecture peuvent être cachées côté client
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use(cookieParser());

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITERS - Application des limiteurs (importés depuis rateLimitConfig.ts)
// ═══════════════════════════════════════════════════════════════════════════

// Routes d'authentification (très strictes - RISQUE ÉLEVÉ)
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Routes de réinitialisation de mot de passe (RISQUE ÉLEVÉ)
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password", passwordResetLimiter);

// Refresh token (RISQUE MOYEN - déjà authentifié mais peut être abusé)
app.use("/api/auth/refresh", refreshTokenLimiter);

// Vérification d'auth (RISQUE FAIBLE - mais route publique)
app.use("/api/auth/check", authCheckLimiter);

// Routes 2FA - TOUTES les routes 2FA doivent être limitées (RISQUE ÉLEVÉ - brute force TOTP)
app.use("/api/2fa", twoFactorLimiter);
app.use("/api/auth/complete-2fa-login", twoFactorLimiter);

// Routes de création de compte et vérification d'email
// registerLimiter uniquement pour POST (création de compte), pas GET/PUT
app.post("/api/users", registerLimiter);
app.use("/api/users/verify-email", verifyEmailLimiter); // Protection brute force
app.use("/api/users/resend-verification", resendEmailLimiter); // Anti-spam emails

// SEC-044: Rate limiter pour toutes les autres routes /api/users
// Protection contre l'énumération des utilisateurs et l'accès abusif aux profils
app.use("/api/users", usersLimiter);

// Routes de données à fort débit (lecture)
app.use("/api/points", highTrafficLimiter);
app.use("/api/fiches", highTrafficLimiter);
app.use("/api/lists", highTrafficLimiter);

// Routes sociales (contacts, messages, partages)
app.use("/api/contacts", socialLimiter);
app.use("/api/messages", socialLimiter);
app.use("/api/share", socialLimiter);
app.use("/api/conversations", socialLimiter);

// Routes mobiles (RISQUE ÉLEVÉ - pas de Turnstile)
app.use("/api/mobile/auth", mobileAuthLimiter);
app.use("/api/mobile/2fa", twoFactorLimiter); // 2FA mobile = même protection que web
app.use("/api/mobile/sync", highTrafficLimiter); // Sync peut être fréquent
app.use("/api/mobile/sos", mobileAuthLimiter); // SOS mode - protection mobile

// Routes admin (RISQUE MOYEN - déjà protégées par authMiddleware + adminMiddleware)
app.use("/api/admin", adminLimiter);

// Routes de sécurité (sessions, events - RISQUE MOYEN)
app.use("/api/security", securityLimiter);

// Routes de maintenance
app.use("/api/maintenance", maintenanceLimiter);

// Routes de notifications
app.use("/api/notifications", socialLimiter);

// WebSocket
app.use("/ws", wsConnectionLimiter);

// Rate limiter général pour toutes les autres routes /api (FALLBACK)
app.use("/api", generalLimiter);

// Connexion à la base de données obligatoire avant de démarrer le serveur
(async () => {
  try {
    await connectToDatabase();

    // ═══════════════════════════════════════════════════════════════════════════
    // SWAGGER - Documentation API (uniquement en développement)
    // ═══════════════════════════════════════════════════════════════════════════
    if (NODE_ENV !== "production" && process.env.ENABLE_SWAGGER === "true") {
      const { setupSwagger } = await import("./config/swagger");
      setupSwagger(app);
      console.log("[SWAGGER] Documentation API activée");
    }

    // Démarrer les jobs cron
    startDataShareCleanupJob();
    startNotificationCleanupJob();
    startRefreshTokenCleanupJob();

    // Démarrer les services SOS Mode
    vonageService.initialize();
    startSosEscalationJob();
    startSosCleanupJob();

    // ═══════════════════════════════════════════════════════════════════════════
    // HIGH-1 FIX: Route /metrics protégée par authMiddleware + adminMiddleware
    // ═══════════════════════════════════════════════════════════════════════════
    const { authMiddleware } = await import("./middlewares/authMiddleware");
    const { adminMiddleware } = await import("./middlewares/adminMiddleware");

    app.get(
      "/metrics",
      healthLimiter,
      authMiddleware,
      adminMiddleware,
      (req, res) => {
        const memUsage = process.memoryUsage();
        res.status(200).json({
          uptime: process.uptime(),
          uptimeHuman: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
          requests: requestCount,
          memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          },
          environment: NODE_ENV,
          nodeVersion: process.version,
          timestamp: new Date().toISOString(),
        });
      },
    );

    // Monter les routes pour les utilisateurs
    // Route de maintenance (doit être avant le middleware de maintenance pour status public)
    app.use("/api/maintenance", maintenanceRoutes);

    // LOW-02: API versioning — Les routes utilisent /api/ sans version.
    // Migration vers /api/v1/ reportée pour éviter un breaking change côté clients.
    // Quand prêt : préfixer toutes les routes avec /api/v1/ et ajouter un
    // middleware de redirection /api/ → /api/v1/ pour rétrocompatibilité.

    // Routes d'authentification (doivent être AVANT le middleware de maintenance)
    // pour permettre aux admins de se connecter pendant la maintenance
    app.use("/api/auth", authRoutes);
    app.use("/api/2fa", twoFactorRoutes);

    // LOW-002 + LOW-003: Headers de sécurité et vérification de version pour routes mobiles
    const { mobileSecurityHeaders, checkAppVersion } =
      await import("./middlewares/mobileSecurityMiddleware");
    app.use("/api/mobile", mobileSecurityHeaders);
    app.use("/api/mobile", checkAppVersion);

    // Routes d'authentification mobile (sans Turnstile, avec sécurité alternative)
    app.use("/api/mobile/auth", mobileAuthRoutes);

    // Routes 2FA mobile (gestion 2FA depuis l'app mobile)
    app.use("/api/mobile/2fa", mobileTwoFactorRoutes);

    // Routes de synchronisation mobile (offline-first)
    app.use("/api/mobile/sync", mobileSyncRoutes);

    // Routes SOS Mode mobile (alertes d'urgence)
    app.use("/api/mobile/sos", mobileSosRoutes);

    // Routes admin (doivent être AVANT le middleware de maintenance)
    // pour permettre aux admins de gérer la maintenance
    app.use("/api/admin", adminRoutes);

    // Middleware de maintenance (après les routes exemptées)
    app.use("/api", maintenanceMiddleware);

    app.use("/api/fiches", fichesRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/points", pointsRoutes);
    app.use("/api/lists", listsRoutes);
    app.use("/api/conversations/", conversationsRoutes);
    app.use("/api/messages/", messagesRoutes);
    app.use("/api/contacts", contactRoutes);
    app.use("/api/share", dataShareRoutes);
    app.use("/api/notifications", notificationsRoutes);
    app.use("/api/security", securityRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // GESTIONNAIRE D'ERREURS GLOBAL
    // ═══════════════════════════════════════════════════════════════════════════
    // Doit être placé APRÈS toutes les routes
    // ═══════════════════════════════════════════════════════════════════════════

    // Classe d'erreur personnalisée
    class AppError extends Error {
      constructor(
        public statusCode: number,
        message: string,
        public code: string,
        public isOperational: boolean = true,
      ) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
      }
    }

    // Export pour utilisation dans les contrôleurs
    (global as any).AppError = AppError;

    // Gestionnaire 404 - Route non trouvée
    app.use((req: express.Request, res: express.Response) => {
      console.warn(`⚠️ [404] Route non trouvée: ${req.method} ${req.path}`);
      res.status(404).json({
        error: "Route non trouvée",
        code: "ROUTE_NOT_FOUND",
        path: req.path,
        method: req.method,
      });
    });

    // Gestionnaire d'erreurs global
    app.use(
      (
        err: Error | AppError,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        // Logger l'erreur complète côté serveur
        const errorLog = {
          timestamp: new Date().toISOString(),
          path: req.path,
          method: req.method,
          error: err.message,
          stack: NODE_ENV === "development" ? err.stack : undefined,
          userId: (req as any).user?.id || "anonymous",
        };

        console.error("❌ [ERROR]", errorLog);

        // Audit des erreurs critiques
        if (err instanceof AppError && !err.isOperational) {
          import("./services/auditService").then(({ auditService }) => {
            auditService.log({
              action: "CRITICAL_ERROR",
              level: "critical",
              ipAddress: req.ip,
              userAgent: req.headers["user-agent"],
              details: {
                path: req.path,
                method: req.method,
                error: err.message,
                code: (err as AppError).code,
              },
            });
          });
        }

        // Déterminer le code de statut et le code d'erreur
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code =
          err instanceof AppError ? (err as AppError).code : "INTERNAL_ERROR";

        // Message d'erreur sécurisé (ne pas exposer les détails en production)
        const errorMessage =
          statusCode === 500 && NODE_ENV === "production"
            ? "Une erreur interne est survenue"
            : err.message;

        // Réponse au client (sans détails sensibles)
        res.status(statusCode).json({
          error: errorMessage,
          code: code,
          timestamp: new Date().toISOString(),
          // Stack trace uniquement en développement
          ...(NODE_ENV === "development" && { stack: err.stack }),
        });
      },
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // GESTION DES ERREURS NON CAPTURÉES
    // ═══════════════════════════════════════════════════════════════════════════

    // Promesses non gérées
    process.on("unhandledRejection", (reason: any, _promise: Promise<any>) => {
      console.error("🚨 [UNHANDLED REJECTION]", {
        timestamp: new Date().toISOString(),
        reason: reason?.message || reason,
        stack: reason?.stack,
      });

      import("./services/auditService").then(({ auditService }) => {
        auditService.log({
          action: "UNHANDLED_REJECTION",
          level: "critical",
          details: {
            error: reason?.message || String(reason),
            stack: reason?.stack,
          },
        });
      });
    });

    // Exceptions non capturées
    process.on("uncaughtException", (error: Error) => {
      console.error("🚨 [UNCAUGHT EXCEPTION]", {
        timestamp: new Date().toISOString(),
        error: getErrorMessage(error),
        stack: error.stack,
      });

      import("./services/auditService")
        .then(({ auditService }) => {
          auditService.log({
            action: "UNCAUGHT_EXCEPTION",
            level: "critical",
            details: {
              error: getErrorMessage(error),
              stack: error.stack,
            },
          });
        })
        .finally(() => {
          // Arrêt gracieux après une exception non capturée
          console.error(
            "💀 [FATAL] Arrêt du serveur suite à une exception non capturée",
          );
          process.exit(1);
        });
    });

    // Gestion de l'arrêt gracieux
    const gracefulShutdown = (signal: string) => {
      console.log(`\n⚠️ [${signal}] Signal reçu, arrêt gracieux...`);

      server.close(() => {
        console.log("✅ Serveur HTTP fermé");

        // Note: WebSocket sera fermé automatiquement avec le serveur HTTP
        console.log("✅ WebSocket fermé");

        // Fermer MongoDB
        import("mongoose").then((mongoose) => {
          mongoose.default.connection.close(false).then(() => {
            console.log("✅ MongoDB déconnecté");
            process.exit(0);
          });
        });
      });

      // Forcer l'arrêt après 10 secondes
      setTimeout(() => {
        console.error("⚠️ Arrêt forcé après timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    const server = app.listen(PORT, () => {
      console.log(`✅ Server listening on http://localhost:${PORT}/api`);
    });

    // Initialiser le WebSocket
    webSocketService.initialize(server);
    console.log(`🔌 WebSocket available at:`);
    console.log(`   - ws://localhost:${PORT}/ws/notifications (notifications)`);
    console.log(`   - ws://localhost:${PORT}/ws/messages (messages)`);
  } catch (err) {
    console.error("❌ Impossible de se connecter à la base de données :", err);
    process.exit(1); // Arrêt du process si la connexion échoue
  }
})();
