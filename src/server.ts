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

// ═══════════════════════════════════════════════════════════════════════════
// Validation des variables d'environnement APRÈS dotenv et AVANT tout autre
// import — cf. fix.md backend #5. En cas d'absence d'une variable critique
// (JWT_SECRET, DB_CONN_STRING, etc.), le serveur refuse de démarrer.
// ═══════════════════════════════════════════════════════════════════════════
import { assertValidEnv } from "./config/validateEnv";
assertValidEnv();

// ═══════════════════════════════════════════════════════════════════════════
// Sentry doit être initialisé avant tout autre import qui peut throw, pour
// que les exceptions lors du boot soient capturées (cf. fix.md backend #3a).
// No-op si SENTRY_DSN n'est pas défini.
// ═══════════════════════════════════════════════════════════════════════════
import { initSentry, captureException } from "./config/sentry";
initSentry();

// ═══════════════════════════════════════════════════════════════════════════
// Importer le logger APRÈS dotenv pour accéder à NODE_ENV
// ═══════════════════════════════════════════════════════════════════════════
import { logger, httpLogStream } from "./services/loggerService";
import { correlationMiddleware } from "./middlewares/correlationMiddleware";

const serverLogger = logger.child({ service: "server" });

// Log du fichier .env utilisé
serverLogger.info("Environnement chargé", { envFile });

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
  registerLimiter,
  verifyEmailLimiter,
  resendEmailLimiter,
  passwordResetLimiter,
  twoFactorLimiter,
  generalLimiter,
  highTrafficLimiter,
  socialLimiter,
  refreshTokenLimiter,
  adminLimiter,
  mobileAuthLimiter,
  authCheckLimiter,
  maintenanceLimiter,
  notificationsLimiter,
  // Configuration différenciée par niveau de sécurité
  strictAuthLimiter,
  moderateApiLimiter,
  permissiveMobileLimiter,
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
import sosRoutes from "./routes/sosRoutes";
import mobilePushTokenRoutes from "./routes/mobilePushTokenRoutes";
import mobileAppVersionRoutes from "./routes/mobileAppVersionRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import quickActionRoutes from "./routes/quickActionRoutes";
import { maintenanceMiddleware } from "./middlewares/maintenanceMiddleware";
import cookieParser from "cookie-parser";
// MED-004: Import CSRF middleware
import {
  getCsrfToken,
  csrfProtection,
  csrfErrorHandler,
} from "./middlewares/csrfMiddleware";
import {
  startDataShareCleanupJob,
  startPushTokenCleanupJob,
  startNotificationCleanupJob,
  startRefreshTokenCleanupJob,
  startPendingEmailRetryJob,
  startExpiringSharesNotifyJob,
  startExpiredSharesNotifyJob,
  startAdminDailyDigestJob,
  startAdminWeeklyDigestJob,
  startAdminSosUnresolvedCheckJob,
  startAdminMetricsAnomalyCheckJob,
} from "./services/cronJobs";
import {
  startSosEscalationJob,
  startSosCleanupJob,
} from "./services/sosCronJobs";
import { vonageService } from "./services/vonageService";
import { webSocketService } from "./services/webSocketService";
import { redisPubSubService } from "./services/redisPubSubService";
import { webSocketReconnectionService } from "./services/webSocketReconnectionService";

// Initialiser Express
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ═══════════════════════════════════════════════════════════════════════════
// CONF-005: Trust Proxy - Requis pour rate limiting derrière un proxy (nginx, cloudflare)
// ═══════════════════════════════════════════════════════════════════════════
if (NODE_ENV === "production") {
  // trust proxy 1 = on fait confiance au premier hop (Traefik/Dokploy).
  // Cela permet au rate limiter de lire la vraie IP cliente depuis X-Forwarded-For.
  app.set("trust proxy", 1);
  serverLogger.info("[SECURITY] Trust proxy activé (1 hop — Traefik/Dokploy)");
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

// Correlation ID pour tracer les requêtes
app.use(correlationMiddleware);

// Métriques Prometheus — durée + status par route (cf. fix.md backend #3b).
import { metricsMiddleware, metricsHandler } from "./config/metrics";
app.use(metricsMiddleware());

// MEDIUM-8: Compteur de requêtes pour le endpoint /metrics
// Note: Pas de race condition réelle en Node.js car le event loop est single-threaded
// L'incrémentation est atomique dans le contexte d'une requête synchrone
let requestCount = 0;
app.use((req, res, next) => {
  requestCount++;
  next();
});

serverLogger.info("[SECURITY] Rate limiter global activé", {
  limit: NODE_ENV === "production" ? 1000 : 5000,
});

// Log de l'environnement au démarrage
serverLogger.info("Express Server démarré", {
  env: NODE_ENV,
  port: PORT,
  envType,
});

const clientUrl = process.env.CLIENT_URL || "http://localhost:3001";

// V8 Phase 2: allowlist élargie en dev pour couvrir les ports Next.js auto-incrémentés
// (3000 conflit avec backend → Next bascule sur 3001, 3002, 3005...). Permet les
// E2E Playwright et le dev quotidien sans toucher à CLIENT_URL. En prod, seul
// CLIENT_URL est autorisé.
const allowedOrigins =
  NODE_ENV === "production"
    ? [clientUrl]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "https://localhost:3000",
        "https://localhost:3001",
        "https://localhost:3005",
        "https://dev.qvarry.fr",
        clientUrl,
      ];

app.use(
  cors({
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      // HIGH-02 FIX: Différencier les requêtes mobile (sans origin) des requêtes web suspectes
      if (!origin) {
        if (NODE_ENV !== "production") {
          // En développement, on permet pour faciliter les tests
          callback(null, true);
        } else {
          // En production, les requêtes sans origin sont :
          // - Les health checks Docker/Kubernetes
          // - Les requêtes mobile natives (validées ensuite par mobileSecurityMiddleware)
          // Pas de log pour éviter la pollution (health check toutes les 30s)
          callback(null, true);
        }
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        serverLogger.warn("[CORS] Origine refusée", { origin });
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
  }),
);

// Middleware pour parser le JSON
// HIGH-8: Limite explicite de taille de body pour éviter les attaques DoS
// P1 UX 2026-05-04 : aligné à 10mb par défaut pour couvrir les payloads form
// complexes (création de fiches avec listes imbriquées, sync mobile par batch).
// ⚠️ Les uploads de fichiers binaires (photos de points par ex.) doivent passer
// par des routes dédiées en multipart/form-data via `multer` —
// `express.json()` ne traite pas le multipart, seuls les bodies JSON.
// Paramétrable via env JSON_BODY_LIMIT (ex: "20mb" pour augmenter en prod).
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "10mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// ═══════════════════════════════════════════════════════════════════════════
// CONF-007: Morgan - Logging HTTP sans tokens sensibles
// ═══════════════════════════════════════════════════════════════════════════
// Format personnalisé qui exclut les headers sensibles (Authorization, Cookie)
morgan.token("sanitized-url", (req) => {
  // Masquer les tokens dans les query strings
  const url = req.url || "";
  return url.replace(/token=[^&]+/gi, "token=***");
});

// Token custom pour masquer les adresses IP (RGPD)
morgan.token("masked-ip", (req) => {
  const { anonymizeIp } = require("./utils/logUtils");
  // req est un IncomingMessage ici, pas Express.Request
  const ip =
    (req as any).ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown";
  return anonymizeIp(ip);
});

// En production, ne pas logger les headers sensibles
const morganFormat =
  NODE_ENV === "production"
    ? ':masked-ip - :remote-user [:date[clf]] ":method :sanitized-url HTTP/:http-version" :status :res[content-length]'
    : "dev";

// Déterminer le niveau de log actuel
const LOG_LEVEL =
  process.env.LOG_LEVEL || (NODE_ENV === "development" ? "debug" : "info");

app.use(
  morgan(morganFormat, {
    // Ne pas logger les health checks en production
    skip: (req) => {
      // Toujours skip les health checks en production
      if (NODE_ENV === "production" && req.url === "/health") {
        return true;
      }
      // Skip tous les logs HTTP si LOG_LEVEL est error ou critical
      if (LOG_LEVEL === "error" || LOG_LEVEL === "critical") {
        return true;
      }
      return false;
    },
    stream: httpLogStream,
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
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// METRICS - Endpoint Prometheus (cf. fix.md backend #3b)
// ═══════════════════════════════════════════════════════════════════════════
// Protection : token simple via env var. À durcir avec ACL IP en infra
// (firewall / reverse-proxy) plutôt qu'au niveau application.
// ═══════════════════════════════════════════════════════════════════════════

app.get("/metrics", healthLimiter, (req, res, next) => {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    // Si pas de token configuré, on n'expose pas les métriques.
    return res.status(404).end();
  }
  const provided = req.headers["x-metrics-token"];
  if (provided !== expected) {
    return res.status(401).end();
  }
  return metricsHandler(req, res).catch(next);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOS HEALTH CHECK - Surveillance du cron SOS (safety-critical)
// ═══════════════════════════════════════════════════════════════════════════
// Cette route permet de surveiller le bon fonctionnement du système SOS
// et de détecter rapidement toute défaillance du cron d'escalade
// ═══════════════════════════════════════════════════════════════════════════

app.get("/health/sos", healthLimiter, async (req, res) => {
  try {
    const { lastSosCronExecution } = await import("./services/sosCronJobs");
    const { default: SosSessionModel } = await import("./models/sosSession");

    // Compter les sessions SOS actives
    const activeSosSessions = await SosSessionModel.countDocuments({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    // Vérifier si le cron fonctionne correctement
    const now = new Date();
    let cronStatus: "ok" | "degraded" | "critical" = "ok";
    let cronRunning = true;

    if (!lastSosCronExecution) {
      // Le cron n'a jamais été exécuté (le serveur vient de démarrer)
      cronStatus = "degraded";
    } else {
      const timeSinceLastExecution =
        now.getTime() - lastSosCronExecution.getTime();
      const minutesSinceLastExecution = timeSinceLastExecution / (1000 * 60);

      if (minutesSinceLastExecution > 5) {
        // Plus de 5 minutes sans exécution → CRITIQUE
        cronStatus = "critical";
        cronRunning = false;
      } else if (minutesSinceLastExecution > 2) {
        // Plus de 2 minutes sans exécution → DÉGRADÉ
        cronStatus = "degraded";
      }
    }

    // Statut global du système SOS
    let overallStatus: "ok" | "degraded" | "critical" = cronStatus;
    if (activeSosSessions > 0 && cronStatus !== "ok") {
      // Si des sessions sont actives ET le cron ne fonctionne pas → CRITIQUE
      overallStatus = "critical";
    }

    res.status(200).json({
      status: overallStatus,
      cronRunning,
      lastCronRun: lastSosCronExecution,
      activeSosSessions,
      uptime: process.uptime(),
      timestamp: now.toISOString(),
    });
  } catch (error) {
    serverLogger.error("[SOS-HEALTH] Erreur lors de la vérification", {
      error: error instanceof Error ? error.message : error,
    });
    res.status(500).json({
      status: "critical",
      cronRunning: false,
      lastCronRun: null,
      activeSosSessions: 0,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      error: "Unable to check SOS health",
    });
  }
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
    crossOriginResourcePolicy: { policy: "cross-origin" },
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
          ...(NODE_ENV !== "production" ? ["ws:", "http:"] : []),
          "wss:", // WebSocket sécurisé (production)
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

serverLogger.info("[SECURITY] Helmet configuré", {
  csp: true,
  hsts: NODE_ENV === "production",
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSION GZIP - Réduction de la taille des réponses HTTP
// ═══════════════════════════════════════════════════════════════════════════
app.use(compression());
serverLogger.info("[PERF] Compression gzip activée");

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
// Configuration différenciée par niveau de sécurité :
// 🔴 STRICT (10 req/15min) - Routes d'authentification sensibles
// 🟡 MODERATE (100 req/15min) - Routes API standard
// 🟢 PERMISSIVE (150 req/15min) - Routes mobiles fonctionnelles
// ═══════════════════════════════════════════════════════════════════════════

// 🔴 STRICT - Routes d'authentification (très strictes - RISQUE ÉLEVÉ)
// Appliqués sur les deux préfixes : /api/ (rétrocompat) et /api/v1/ (direct)
app.use("/api/auth/login", strictAuthLimiter);
app.use("/api/auth/register", strictAuthLimiter);
app.use("/api/v1/auth/login", strictAuthLimiter);
app.use("/api/v1/auth/register", strictAuthLimiter);

// Routes de réinitialisation de mot de passe (RISQUE ÉLEVÉ)
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password", passwordResetLimiter);
app.use("/api/v1/auth/forgot-password", passwordResetLimiter);
app.use("/api/v1/auth/reset-password", passwordResetLimiter);

// Refresh token (RISQUE MOYEN - déjà authentifié mais peut être abusé)
app.use("/api/auth/refresh", refreshTokenLimiter);
app.use("/api/v1/auth/refresh", refreshTokenLimiter);

// Vérification d'auth (RISQUE FAIBLE - mais route publique)
app.use("/api/auth/check", authCheckLimiter);
app.use("/api/v1/auth/check", authCheckLimiter);

// Routes 2FA - TOUTES les routes 2FA doivent être limitées (RISQUE ÉLEVÉ - brute force TOTP)
app.use("/api/2fa", twoFactorLimiter);
app.use("/api/auth/complete-2fa-login", twoFactorLimiter);
app.use("/api/auth/complete-2fa", twoFactorLimiter); // P1 — endpoint unifié
app.use("/api/auth/complete-2fa-legacy", twoFactorLimiter);
app.use("/api/v1/2fa", twoFactorLimiter);
app.use("/api/v1/auth/complete-2fa-login", twoFactorLimiter);
app.use("/api/v1/auth/complete-2fa", twoFactorLimiter); // P1 — endpoint unifié
app.use("/api/v1/auth/complete-2fa-legacy", twoFactorLimiter);

// Routes de création de compte et vérification d'email
// registerLimiter uniquement pour POST (création de compte), pas GET/PUT
app.post("/api/users", registerLimiter);
app.post("/api/v1/users", registerLimiter);
app.use("/api/users/verify-email", verifyEmailLimiter); // Protection brute force
app.use("/api/v1/users/verify-email", verifyEmailLimiter);
app.use("/api/users/resend-verification", resendEmailLimiter); // Anti-spam emails
app.use("/api/v1/users/resend-verification", resendEmailLimiter);

// 🟡 MODERATE - SEC-044: Rate limiter pour toutes les autres routes /api/users
app.use("/api/users", moderateApiLimiter);
app.use("/api/v1/users", moderateApiLimiter);

// Routes de données à fort débit (lecture)
app.use("/api/points", highTrafficLimiter);
app.use("/api/v1/points", highTrafficLimiter);
app.use("/api/fiches", highTrafficLimiter);
app.use("/api/v1/fiches", highTrafficLimiter);
app.use("/api/lists", highTrafficLimiter);
app.use("/api/v1/lists", highTrafficLimiter);

// Routes sociales (contacts, messages, partages)
app.use("/api/contacts", socialLimiter);
app.use("/api/v1/contacts", socialLimiter);
app.use("/api/messages", socialLimiter);
app.use("/api/v1/messages", socialLimiter);
app.use("/api/share", socialLimiter);
app.use("/api/v1/share", socialLimiter);
app.use("/api/conversations", socialLimiter);
app.use("/api/v1/conversations", socialLimiter);

// 🟢 PERMISSIVE - Routes mobiles (fonctionnalités fréquentes)
// Préfixe /api/v1/mobile/ uniquement (pas de rétrocompat pour les routes mobiles)
app.use("/api/v1/mobile/auth", mobileAuthLimiter);
app.use("/api/v1/mobile/2fa", twoFactorLimiter);
app.use("/api/v1/mobile/sync", permissiveMobileLimiter);
app.use("/api/v1/mobile/sos", mobileAuthLimiter);
app.use("/api/v1/mobile/push-tokens", permissiveMobileLimiter);

// Routes SOS pour le web (alias vers les controllers mobile, sans App Check)
app.use("/api/v1/sos", moderateApiLimiter);

// Routes admin (RISQUE MOYEN - déjà protégées par authMiddleware + adminMiddleware)
app.use("/api/admin", adminLimiter);
app.use("/api/v1/admin", adminLimiter);

// 🟡 MODERATE - Routes de sécurité (sessions, events - RISQUE MOYEN)
app.use("/api/security", moderateApiLimiter);
app.use("/api/v1/security", moderateApiLimiter);

// Routes de maintenance
app.use("/api/maintenance", maintenanceLimiter);
app.use("/api/v1/maintenance", maintenanceLimiter);

// Routes de notifications (SEC-AUDIT: limiter dédié 60 req/min)
app.use("/api/notifications", notificationsLimiter);
app.use("/api/v1/notifications", notificationsLimiter);

// Rate limiter général pour toutes les autres routes /api (FALLBACK)
app.use("/api", generalLimiter);

// Connexion à la base de données obligatoire avant de démarrer le serveur
(async () => {
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // MED-005: INITIALISER LE SECRETS MANAGER EN PREMIER
    // ═══════════════════════════════════════════════════════════════════════════
    serverLogger.info("[MED-005] Initialisation du Secrets Manager...");
    const { secretsManager } = await import("./services/secretsManagerService");
    await secretsManager.initialize();

    // ═══════════════════════════════════════════════════════════════════════════
    // REDIS POOL: Initialiser si activé dans .env
    // ═══════════════════════════════════════════════════════════════════════════
    const redisEnabled = process.env.REDIS_ENABLED !== "false";

    if (redisEnabled) {
      try {
        serverLogger.info(
          "[REDIS-POOL] Initialisation du pool Redis partagé...",
        );
        const RedisConnectionPool = await import("./config/redisPool");
        await RedisConnectionPool.default.initialize();

        const poolStats = RedisConnectionPool.default.getStats();
        serverLogger.info("[REDIS-POOL] Pool Redis initialisé", poolStats);

        // ═══════════════════════════════════════════════════════════════════════════
        // WEBSOCKET STATE: Initialiser avec le pool Redis
        // ═══════════════════════════════════════════════════════════════════════════
        serverLogger.info(
          "[WS-STATE] Initialisation WebSocket State avec le pool...",
        );
        const { initializeRedisWithPool, startStateCleanup } =
          await import("./services/webSocketStateService");
        await initializeRedisWithPool();
        startStateCleanup();
        serverLogger.info("[WS-STATE] WebSocket State initialisé avec le pool");

        // ═══════════════════════════════════════════════════════════════════════════
        // PUBSUB: Initialiser après le pool Redis
        // ═══════════════════════════════════════════════════════════════════════════
        await redisPubSubService.initializeWithPool();
        serverLogger.info("[PUBSUB] Redis Pub/Sub initialisé avec le pool", {
          enabled: redisPubSubService.isEnabled(),
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // WS REDIS CACHE: Initialiser après le pool Redis
        // ═══════════════════════════════════════════════════════════════════════════
        const { initializeWebSocketRedisCache } =
          await import("./services/webSocketService");
        await initializeWebSocketRedisCache();
        serverLogger.info("[WS-CACHE] WebSocket Redis cache initialisé avec le pool");
      } catch (error) {
        serverLogger.error("[REDIS-POOL] Échec de l'initialisation Redis", {
          error: error instanceof Error ? error.message : error,
        });
        serverLogger.warn(
          "[REDIS-POOL] Continuing without Redis (fallback to memory)",
        );
      }
    } else {
      serverLogger.info(
        "[REDIS-POOL] Redis désactivé (REDIS_ENABLED=false) - Mode développement sans clustering",
      );
    }

    // Audit des secrets (DEV uniquement)
    if (NODE_ENV !== "production") {
      const audit = secretsManager.auditSecrets();
      serverLogger.info("[MED-005] Audit des secrets:", {
        strong: audit.strong.length,
        weak: audit.weak.length,
      });

      if (audit.weak.length > 0) {
        serverLogger.warn("[MED-005] ⚠️  Secrets faibles détectés:", {
          weakSecrets: audit.weak,
        });
        // Afficher le rapport complet en développement
        serverLogger.debug("[MED-005] Rapport d'audit des secrets:", {
          report: audit.report,
        });
      } else {
        serverLogger.info(
          "[MED-005] ✅ Tous les secrets respectent les critères de sécurité",
        );
      }

      // Statistiques du Secrets Manager
      const stats = secretsManager.getStats();
      serverLogger.info("[MED-005] Secrets Manager prêt", stats);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Connexion à MongoDB (après Secrets Manager)
    // ═══════════════════════════════════════════════════════════════════════════
    await connectToDatabase();

    // ═══════════════════════════════════════════════════════════════════════════
    // HIGH-08 FIX: Vérification TLS en production - Respect de la config .env
    // ═══════════════════════════════════════════════════════════════════════════
    if (NODE_ENV === "production") {
      const dbSSLEnabled = process.env.DB_SSL !== "false";
      const redisTLSEnabled = process.env.REDIS_TLS === "true";
      const redisEnabled = process.env.REDIS_ENABLED !== "false";

      if (!dbSSLEnabled) {
        serverLogger.warn(
          "[SECURITY] DB_SSL explicitement désactivé en production (DB_SSL=false)",
          { DB_SSL: process.env.DB_SSL },
        );
      }

      // Vérifier Redis TLS uniquement si Redis est activé
      if (redisEnabled && !redisTLSEnabled) {
        serverLogger.warn(
          "[SECURITY] REDIS_TLS n'est pas activé en production - Connexion non sécurisée",
          { REDIS_TLS: process.env.REDIS_TLS },
        );
      }

      if (dbSSLEnabled && (!redisEnabled || redisTLSEnabled)) {
        serverLogger.info("[SECURITY] TLS vérifié", {
          DB_SSL: true,
          REDIS_TLS: redisEnabled ? true : "disabled",
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SWAGGER - Documentation API
    // ═══════════════════════════════════════════════════════════════════════════
    // V8 Phase 1 : actif par défaut en dev (debug + ide tooling), opt-in en prod
    // via ENABLE_SWAGGER=true (à n'activer que pour staging/preview, JAMAIS en
    // prod publique sauf endpoint protégé par auth/IP allowlist).
    const swaggerEnabled =
      NODE_ENV !== "production" || process.env.ENABLE_SWAGGER === "true";
    if (swaggerEnabled) {
      const { setupSwagger } = await import("./config/swagger");
      setupSwagger(app);
      serverLogger.info("[SWAGGER] Documentation API activée", {
        url: `http://localhost:${PORT}/api-docs`,
        spec: `http://localhost:${PORT}/api-docs.json`,
      });
    }

    // Démarrer les jobs cron
    startDataShareCleanupJob();
    startPushTokenCleanupJob();
    startNotificationCleanupJob();
    startRefreshTokenCleanupJob();
    startPendingEmailRetryJob();
    startExpiringSharesNotifyJob();
    startExpiredSharesNotifyJob();
    startAdminDailyDigestJob();
    startAdminWeeklyDigestJob();
    startAdminSosUnresolvedCheckJob();
    startAdminMetricsAnomalyCheckJob();

    // Démarrer les services SOS Mode
    vonageService.initialize();

    // Vérifier si Vonage est prêt (safety-critical pour Stage 2 SMS)
    if (!vonageService.isReady()) {
      serverLogger.warn(
        "[SOS-CRITICAL] Vonage SMS service NOT configured. Stage 2 SOS escalation (emergency SMS) will NOT work!",
        {
          VONAGE_API_KEY: process.env.VONAGE_API_KEY ? "SET" : "MISSING",
          VONAGE_API_SECRET: process.env.VONAGE_API_SECRET ? "SET" : "MISSING",
          VONAGE_SMS_FROM: process.env.VONAGE_SMS_FROM || "Qvarry (default)",
        },
      );
    } else {
      serverLogger.info("[SOS] Vonage SMS service configured and ready", {
        VONAGE_SMS_FROM: process.env.VONAGE_SMS_FROM || "Qvarry (default)",
      });
    }

    // Initialiser le service d'attestation d'appareils
    const DeviceAttestationService =
      await import("./services/deviceAttestationService");
    DeviceAttestationService.default.initialize();
    serverLogger.info(
      "[SECURITY] Service d'attestation d'appareils initialisé",
      {
        enabled: DeviceAttestationService.default.isAttestationEnabled(),
      },
    );

    startSosEscalationJob();
    startSosCleanupJob();

    // Service down monitor (Mongo + Redis disconnect > 2 min → notif admin)
    const { startServiceDownMonitor } = await import(
      "./services/serviceDownMonitor"
    );
    startServiceDownMonitor();

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

    // ═══════════════════════════════════════════════════════════════════════════
    // ROUTES WEBHOOK - MONTER AVANT TOUT MIDDLEWARE D'AUTH
    // ═══════════════════════════════════════════════════════════════════════════
    // Ces routes sont appelées par des services externes (Vonage)
    // Pas d'authentification, pas de maintenance check
    // ═══════════════════════════════════════════════════════════════════════════
    app.use("/api/webhooks/vonage", webhookRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTHCHECK ENDPOINTS (publics, sans auth)
    // ═══════════════════════════════════════════════════════════════════════════
    // /api/health: liveness probe (le service répond) → 200 si app démarrée.
    // /api/health/ready: readiness probe (le service est prêt à servir du trafic)
    //   → 200 si DB connectée + Redis joignable (ou désactivé en dev) → 503 sinon.
    // Utilisés par load balancers, monitoring (Atlas, GCP, AWS ELB), uptime checks.
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * @swagger
     * /health:
     *   get:
     *     summary: Liveness probe (Vague 9)
     *     description: Endpoint public sans auth. Toujours 200 si le process Node tourne.
     *     tags: [Maintenance]
     *     responses:
     *       200:
     *         description: Service vivant
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status: { type: string, example: ok }
     *                 service: { type: string, example: qvarry-api }
     *                 timestamp: { type: string, format: date-time }
     *                 uptime: { type: number, description: secondes depuis boot }
     */
    const healthHandler = (_req: any, res: any) => {
      res.status(200).json({
        status: "ok",
        service: "qvarry-api",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    };
    app.get("/api/health", healthHandler);
    app.get("/api/v1/health", healthHandler);

    /**
     * @swagger
     * /health/ready:
     *   get:
     *     summary: Readiness probe (Vague 9)
     *     description: |
     *       Public sans auth. 200 si DB connectée + Redis joignable (ou désactivé en dev).
     *       503 si l'un des checks échoue. Utilisé par load balancers (K8s, AWS ELB).
     *     tags: [Maintenance]
     *     responses:
     *       200:
     *         description: Service prêt à servir du trafic
     *       503:
     *         description: Au moins un check critique en échec (DB ou Redis indispo)
     */
    app.get("/api/health/ready", async (_req, res) => {
      const mongooseModule = await import("mongoose");
      const dbReady = mongooseModule.default.connection.readyState === 1;
      const redisEnabled = process.env.REDIS_ENABLED !== "false";
      const redisReady = !redisEnabled || redisPubSubService.isEnabled();
      const ready = dbReady && redisReady;
      res.status(ready ? 200 : 503).json({
        status: ready ? "ok" : "degraded",
        service: "qvarry-api",
        timestamp: new Date().toISOString(),
        checks: {
          database: dbReady ? "ok" : "unavailable",
          redis: redisEnabled ? (redisReady ? "ok" : "unavailable") : "disabled",
        },
      });
    });

    // MED-09 FIX: API versioning — Middleware de rétrocompatibilité /api/ → /api/v1/
    // Les routes sont montées sur /api/v1/ et /api/ redirige pour rétrocompatibilité
    app.use("/api", (req, res, next) => {
      if (!req.path.startsWith("/v1/")) {
        // Réécrire le chemin pour pointer vers /api/v1/
        req.url = `/v1${req.url}`;
      }
      next();
    });

    // Route de maintenance (doit être avant le middleware de maintenance pour status public,
    // mais APRÈS le middleware de rétrocompatibilité pour que /api/maintenance → /api/v1/maintenance fonctionne)
    app.use("/api/v1/maintenance", maintenanceRoutes);

    // Routes d'authentification (doivent être AVANT le middleware de maintenance)
    // pour permettre aux admins de se connecter pendant la maintenance
    app.use("/api/v1/auth", authRoutes);
    app.use("/api/v1/2fa", twoFactorRoutes);

    // MED-004: Endpoint public pour obtenir le CSRF token (AVANT protection CSRF)
    app.get("/api/csrf-token", getCsrfToken);
    app.get("/api/v1/csrf-token", getCsrfToken);

    // LOW-002 + LOW-003: Headers de sécurité et vérification de version pour routes mobiles
    const { mobileSecurityHeaders, checkAppVersion } =
      await import("./middlewares/mobileSecurityMiddleware");
    app.use("/api/v1/mobile", mobileSecurityHeaders);
    // La route de check version doit être montée AVANT checkAppVersion pour ne pas être bloquée
    app.use("/api/v1/mobile/app-version", mobileAppVersionRoutes);
    app.use("/api/v1/mobile", checkAppVersion);

    // Routes d'authentification mobile (sans Turnstile, avec sécurité alternative)
    app.use("/api/v1/mobile/auth", mobileAuthRoutes);

    // Routes 2FA mobile (gestion 2FA depuis l'app mobile)
    app.use("/api/v1/mobile/2fa", mobileTwoFactorRoutes);

    // Routes de synchronisation mobile (offline-first)
    app.use("/api/v1/mobile/sync", mobileSyncRoutes);

    // Routes SOS Mode mobile (alertes d'urgence)
    app.use("/api/v1/mobile/sos", mobileSosRoutes);

    // Routes SOS Web (alias - réutilisent les controllers mobile sans App Check)
    app.use("/api/v1/sos", sosRoutes);

    // Routes Push Tokens mobile (enregistrement/suppression tokens FCM)
    app.use("/api/v1/mobile/push-tokens", mobilePushTokenRoutes);

    // Routes admin (doivent être AVANT le middleware de maintenance)
    // pour permettre aux admins de gérer la maintenance
    app.use("/api/v1/admin", adminRoutes);

    // Middleware de maintenance (après les routes exemptées)
    app.use("/api", maintenanceMiddleware);

    // MED-004: Protection CSRF sur les routes sensibles (POST/PUT/DELETE uniquement)
    // S'applique après authentification mais avant les handlers
    // Fix: exempter les méthodes sûres (GET/HEAD/OPTIONS) et les requêtes mobiles
    // Raison: le CSRF protège contre l'injection automatique de cookies par un navigateur.
    // Les clients mobiles utilisent un Bearer token dans Authorization header → pas de risque CSRF.
    const csrfProtectionWeb = (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
      const isMobile =
        req.headers["x-platform"] === "ios" ||
        req.headers["x-platform"] === "android";
      if (isSafeMethod || isMobile) {
        return next();
      }
      return csrfProtection(req, res, next);
    };

    app.use("/api/v1/users", csrfProtectionWeb);
    app.use("/api/v1/admin", csrfProtectionWeb);
    app.use("/api/v1/security", csrfProtectionWeb);
    app.use("/api/v1/fiches", csrfProtectionWeb);
    app.use("/api/v1/lists", csrfProtectionWeb);
    app.use("/api/v1/points", csrfProtectionWeb);
    app.use("/api/v1/conversations", csrfProtectionWeb);
    app.use("/api/v1/messages", csrfProtectionWeb);
    app.use("/api/v1/contacts", csrfProtectionWeb);
    app.use("/api/v1/data-share", csrfProtectionWeb);
    app.use("/api/v1/notifications", csrfProtectionWeb);
    app.use("/api/v1/sos", csrfProtectionWeb);

    app.use("/api/v1/fiches", fichesRoutes);
    app.use("/api/v1/users", userRoutes);
    app.use("/api/v1/points", pointsRoutes);
    app.use("/api/v1/lists", listsRoutes);
    app.use("/api/v1/conversations/", conversationsRoutes);
    app.use("/api/v1/messages/", messagesRoutes);
    app.use("/api/v1/contacts", contactRoutes);
    app.use("/api/v1/share", dataShareRoutes);
    app.use("/api/v1/notifications", notificationsRoutes);
    app.use("/api/v1/security", securityRoutes);
    // Quick actions depuis les notifications mobiles (UNNotificationCategory iOS,
    // Notifee actions Android). Idempotents, auth JWT standard.
    app.use("/api/v1/quick-actions", quickActionRoutes);

    // ═══════════════════════════════════════════════════════════════════════════
    // GESTIONNAIRE D'ERREURS GLOBAL
    // ═══════════════════════════════════════════════════════════════════════════
    // Doit être placé APRÈS toutes les routes
    // ═══════════════════════════════════════════════════════════════════════════

    // MED-004: CSRF error handler (AVANT le error handler général)
    app.use(csrfErrorHandler);

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

    // Gestionnaire 404 - Route non trouvée
    app.use((req: express.Request, res: express.Response) => {
      serverLogger.warn("[404] Route non trouvée", {
        method: req.method,
        path: req.path,
      });
      res.status(404).json({
        error: "Route non trouvée",
        code: "ROUTE_NOT_FOUND",
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
        // Logger l'erreur complète côté serveur (HIGH-001: pas de stack trace)
        const errorLog = {
          timestamp: new Date().toISOString(),
          path: req.path,
          method: req.method,
          error: err.message,
          errorName: err.name,
          userId: (req as any).user?.id || "anonymous",
        };

        serverLogger.error("[ERROR] Erreur globale", errorLog);

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

        // Réponse au client (sans détails sensibles, HIGH-001: pas de stack)
        res.status(statusCode).json({
          error: errorMessage,
          code: code,
          timestamp: new Date().toISOString(),
        });
      },
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // GESTION DES ERREURS NON CAPTURÉES
    // ═══════════════════════════════════════════════════════════════════════════

    // Promesses non gérées (HIGH-001: pas de stack trace)
    process.on("unhandledRejection", (reason: any, _promise: Promise<any>) => {
      serverLogger.critical("[UNHANDLED REJECTION]", {
        timestamp: new Date().toISOString(),
        reason: reason?.message || reason,
        errorName: reason?.name,
      });

      // Sentry — cf. fix.md backend #3a.
      captureException(reason, { source: "unhandledRejection" });

      import("./services/auditService").then(({ auditService }) => {
        auditService.log({
          action: "UNHANDLED_REJECTION",
          level: "critical",
          details: {
            error: reason?.message || String(reason),
          },
        });
      });
    });

    // Exceptions non capturées (HIGH-001: pas de stack trace)
    process.on("uncaughtException", (error: Error) => {
      serverLogger.critical("[UNCAUGHT EXCEPTION]", {
        timestamp: new Date().toISOString(),
        error: getErrorMessage(error),
        errorName: error.name,
      });

      // Sentry — cf. fix.md backend #3a.
      captureException(error, { source: "uncaughtException" });

      import("./services/auditService")
        .then(({ auditService }) => {
          auditService.log({
            action: "UNCAUGHT_EXCEPTION",
            level: "critical",
            details: {
              error: getErrorMessage(error),
            },
          });
        })
        .finally(() => {
          // Arrêt gracieux après une exception non capturée
          serverLogger.critical(
            "[FATAL] Arrêt du serveur suite à une exception non capturée",
          );
          process.exit(1);
        });
    });

    // Gestion de l'arrêt gracieux
    const gracefulShutdown = async (signal: string) => {
      serverLogger.warn("Signal reçu, arrêt gracieux...", { signal });

      // ═══════════════════════════════════════════════════════════════════════
      // PHASE 4: Graceful shutdown WebSocket - Sauvegarder états et notifier clients
      // ═══════════════════════════════════════════════════════════════════════
      try {
        serverLogger.info("Initiating WebSocket graceful shutdown...");
        await webSocketService.gracefulShutdown();
        serverLogger.info("WebSocket graceful shutdown complete");

        // Arrêter le service de monitoring des reconnexions
        webSocketReconnectionService.stop();
        serverLogger.info("WebSocket reconnection monitoring stopped");
      } catch (wsShutdownError) {
        serverLogger.error("Error during WebSocket graceful shutdown", {
          error:
            wsShutdownError instanceof Error
              ? wsShutdownError.message
              : wsShutdownError,
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SOS-CRITICAL: Vérifier les sessions SOS actives avant l'arrêt
      // ═══════════════════════════════════════════════════════════════════════
      try {
        const { default: SosSessionModel } =
          await import("./models/sosSession");

        const activeSosSessions = await SosSessionModel.find({
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
        })
          .select("_id userId participants.userId status currentStage")
          .lean();

        if (activeSosSessions.length > 0) {
          serverLogger.critical(
            `[SOS-CRITICAL] Server shutting down with ${activeSosSessions.length} active SOS sessions`,
            {
              count: activeSosSessions.length,
              signal,
            },
          );

          // Logger chaque session active
          for (const session of activeSosSessions) {
            serverLogger.critical("[SOS-CRITICAL] Active SOS session", {
              sessionId: session._id.toString(),
              userId: session.userId.toString(),
              status: session.status,
              currentStage: session.currentStage,
              participantCount: session.participants?.length || 0,
            });
          }

          // Tenter d'envoyer une notification WebSocket aux utilisateurs concernés
          try {
            const affectedUserIds = new Set<string>();

            // Collecter tous les IDs d'utilisateurs concernés (créateurs et participants)
            for (const session of activeSosSessions) {
              affectedUserIds.add(session.userId.toString());
              if (session.participants && session.participants.length > 0) {
                for (const participant of session.participants) {
                  affectedUserIds.add(participant.userId.toString());
                }
              }
            }

            // Envoyer une notification à tous les utilisateurs concernés
            for (const userId of affectedUserIds) {
              try {
                webSocketService.sendNotificationToUser(userId, {
                  type: "sos_server_restart",
                  message:
                    "Le serveur redémarre. Votre session SOS reste active mais les notifications peuvent être retardées.",
                  severity: "warning",
                  timestamp: new Date().toISOString(),
                });
              } catch (wsError) {
                serverLogger.error(
                  "[SOS-CRITICAL] Failed to send WebSocket notification",
                  {
                    userId,
                    error: wsError instanceof Error ? wsError.message : wsError,
                  },
                );
              }
            }

            serverLogger.warn(
              `[SOS-CRITICAL] Sent restart notifications to ${affectedUserIds.size} users`,
            );
          } catch (notifError) {
            serverLogger.error(
              "[SOS-CRITICAL] Failed to send WebSocket notifications",
              {
                error:
                  notifError instanceof Error ? notifError.message : notifError,
              },
            );
          }
        } else {
          serverLogger.info(
            "[SOS] No active SOS sessions during shutdown - safe to proceed",
          );
        }
      } catch (sosCheckError) {
        serverLogger.error(
          "[SOS-CRITICAL] Failed to check active SOS sessions during shutdown",
          {
            error:
              sosCheckError instanceof Error
                ? sosCheckError.message
                : sosCheckError,
          },
        );
      }

      // ═══════════════════════════════════════════════════════════════════════
      // Continuer avec l'arrêt normal
      // ═══════════════════════════════════════════════════════════════════════

      server.close(() => {
        serverLogger.info("Serveur HTTP fermé");

        // Note: WebSocket sera fermé automatiquement avec le serveur HTTP
        serverLogger.info("WebSocket fermé");

        // Fermer MongoDB et Redis pool
        Promise.all([
          import("mongoose").then((mongoose) =>
            mongoose.default.connection.close(false),
          ),
          import("./config/redisPool").then((RedisConnectionPool) =>
            RedisConnectionPool.default.close(),
          ),
        ]).then(() => {
          serverLogger.info("MongoDB et Redis pool fermés");
          process.exit(0);
        });
      });

      // Forcer l'arrêt après 10 secondes
      setTimeout(() => {
        serverLogger.error("Arrêt forcé après timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    const server = app.listen(PORT, () => {
      serverLogger.info("Server listening", {
        url: `http://localhost:${PORT}/api`,
        instanceId: redisPubSubService.getInstanceId(),
        pubSubEnabled: redisPubSubService.isEnabled(),
      });
    });

    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 65_000;
    server.timeout = 30_000;
    serverLogger.info("[SECURITY] HTTP timeouts configurés", {
      headersTimeout: server.headersTimeout,
      requestTimeout: server.requestTimeout,
      keepAliveTimeout: server.keepAliveTimeout,
      timeout: server.timeout,
    });

    // Initialiser le WebSocket
    webSocketService.initialize(server);
    serverLogger.info("WebSocket available", {
      notifications: `ws://localhost:${PORT}/ws/notifications`,
      messages: `ws://localhost:${PORT}/ws/messages`,
    });

    // PHASE 4: Démarrer le service de monitoring des reconnexions
    webSocketReconnectionService.start();
    serverLogger.info("WebSocket reconnection monitoring started");

    // Initialiser les notifications push (Firebase Cloud Messaging)
    const { NotificationService } =
      await import("./services/notificationService");
    NotificationService.initializePushNotifications();
    serverLogger.info("Service de notifications push initialisé");

    // Démarrer le service de retry des notifications en attente (persistant)
    // Cela permet de réessayer les notifications qui ont échoué même après un redémarrage
    await NotificationService.retryPendingNotifications();
    serverLogger.info(
      "Service de retry des notifications démarré (vérifie les notifications en attente au startup)",
    );

    // Démarrer le cron job de nettoyage des mutes expirés
    const { startCleanExpiredMutesJob } =
      await import("./jobs/cleanExpiredMutes");
    startCleanExpiredMutesJob();
    serverLogger.info("Cron job de nettoyage des mutes expirés démarré");
  } catch (err) {
    serverLogger.critical("Impossible de se connecter à la base de données", {
      error: getErrorMessage(err),
    });
    process.exit(1); // Arrêt du process si la connexion échoue
  }
})();
