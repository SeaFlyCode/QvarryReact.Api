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

// Charger les variables d'environnement depuis la racine du monorepo
// On remonte d'un niveau car le serveur est dans /server
// Priorité : .env (dev) > .env (prod/déployé)
const rootEnvLocalPath = path.resolve(__dirname, '../../.env');
const rootEnvPath = path.resolve(__dirname, '../../.env');

let envFile = rootEnvPath;
let envType = 'deployed';
if (fs.existsSync(rootEnvLocalPath)) {
    envFile = rootEnvLocalPath;
    envType = 'local';
}

dotenv.config({ path: envFile });

// Log du fichier .env utilisé
console.log(`📝 Environnement chargé : ${envFile}`);

// ⚡ Intercepteur de console - Charger après .env mais avant les autres imports
import "./middlewares/console-interceptor";

// ═══════════════════════════════════════════════════════════════════════════
// Maintenant on peut importer les autres modules en toute sécurité
// ═══════════════════════════════════════════════════════════════════════════
import express from "express";
import { connectToDatabase } from "./config/database";
import userRoutes from './routes/userRoutes';
import authRoutes from './routes/authRoutes';
import conversationsRoutes from './routes/conversationsRoutes';
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import pointsRoutes from './routes/pointsRoutes';
import fichesRoutes from './routes/fichesRoutes';
import listsRoutes from './routes/listsRoutes';
import messagesRoutes from './routes/messagesRoutes';
import contactRoutes from './routes/contactRoutes';
import dataShareRoutes from './routes/dataShareRoutes';
import notificationsRoutes from './routes/notificationsRoutes';
import securityRoutes from './routes/securityRoutes';
import adminRoutes from './routes/adminRoutes';
import twoFactorRoutes from './routes/twoFactorRoutes';
import maintenanceRoutes from './routes/maintenanceRoutes';
import mobileAuthRoutes from './routes/mobileAuthRoutes';
import mobileSyncRoutes from './routes/mobileSyncRoutes';
import mobileTwoFactorRoutes from './routes/mobileTwoFactorRoutes';
import { maintenanceMiddleware } from './middlewares/maintenanceMiddleware';
import cookieParser from "cookie-parser";
import { startDataShareCleanupJob, startNotificationCleanupJob, startRefreshTokenCleanupJob } from './services/cronJobs';
import { webSocketService } from './services/webSocketService';

// Initialiser Express
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ═══════════════════════════════════════════════════════════════════════════
// CONF-005: Trust Proxy - Requis pour rate limiting derrière un proxy (nginx, cloudflare)
// ═══════════════════════════════════════════════════════════════════════════
if (NODE_ENV === 'production') {
    // 1 = faire confiance au premier proxy (nginx, cloudflare, etc.)
    app.set('trust proxy', 1);
    console.log('🔒 [SECURITY] Trust proxy activé (production)');
}

// Log de l'environnement au démarrage
const modeIcon = NODE_ENV === 'production' ? '🚀' : '🔧';
console.log(`\n${modeIcon} Express Server | ${NODE_ENV} | Port ${PORT} | ${envType}`);


const clientUrl = process.env.CLIENT_URL || 'http://localhost:3001';

const allowedOrigins = NODE_ENV === 'production'
    ? [clientUrl]
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://localhost:3000',
        'https://localhost:3001',
        'https://dev.qvarry.fr',
        clientUrl
    ];


app.use(cors({
    origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Les apps mobiles n'ont pas d'origine (ou origin = null/undefined)
        // On vérifie le header X-Platform pour les autoriser
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`[CORS] Origine refusée: ${origin}`);
            callback(new Error(`Not allowed by CORS: ${origin}`));
        }
    },
    credentials: true
}));

// Middleware pour parser le JSON
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════
// CONF-007: Morgan - Logging HTTP sans tokens sensibles
// ═══════════════════════════════════════════════════════════════════════════
// Format personnalisé qui exclut les headers sensibles (Authorization, Cookie)
morgan.token('sanitized-url', (req) => {
    // Masquer les tokens dans les query strings
    const url = req.url || '';
    return url.replace(/token=[^&]+/gi, 'token=***');
});

// En production, ne pas logger les headers sensibles
const morganFormat = NODE_ENV === 'production'
    ? ':remote-addr - :remote-user [:date[clf]] ":method :sanitized-url HTTP/:http-version" :status :res[content-length]'
    : 'dev';

app.use(morgan(morganFormat, {
    // Ne pas logger les health checks en production
    skip: (req) => NODE_ENV === 'production' && req.url === '/health'
}));

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ - VÉRIFICATION DES IPs BLOQUÉES
// ═══════════════════════════════════════════════════════════════════════════
// Ce middleware doit être placé tôt dans la chaîne pour bloquer immédiatement
// les IPs malveillantes avant tout traitement
// ═══════════════════════════════════════════════════════════════════════════
import { ipBlockCheckMiddleware } from "./middlewares/rateLimitMiddleware";

// Appliquer le middleware de blocage IP sur toutes les routes /api
app.use('/api', ipBlockCheckMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// HELMET - SÉCURITÉ DES HEADERS HTTP
// ═══════════════════════════════════════════════════════════════════════════
// Configuration stricte avec CSP, HSTS, et Permissions Policy
// ═══════════════════════════════════════════════════════════════════════════

app.use(helmet({
    // Content Security Policy - Protection XSS et injection de contenu
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'"  // Nécessaire pour Leaflet et styles dynamiques
            ],
            imgSrc: [
                "'self'",
                'data:',
                'blob:',
                'https://*.tile.openstreetmap.org',     // Tuiles OpenStreetMap
                'https://*.basemaps.cartocdn.com',      // Tuiles CartoDB
                'https://server.arcgisonline.com',      // Tuiles ArcGIS
                'https://*.opentopomap.org',            // Tuiles OpenTopoMap
                'https://data.geopf.fr',                // Tuiles IGN (Plan IGN, photos aériennes, etc.)
                'https://geoservices.brgm.fr',          // Tuiles BRGM (géologie)
                'https://*.google.com',                 // Tuiles Google Maps (satellite, terrain)
                'https://*.googleapis.com'              // Services Google Maps
            ],
            connectSrc: [
                "'self'",
                clientUrl,
                'wss:',   // WebSocket sécurisé (production)
                'ws:'     // WebSocket non sécurisé (développement)
            ],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            ...(NODE_ENV === 'production' && { upgradeInsecureRequests: [] })
        }
    },

    // HTTP Strict Transport Security - Force HTTPS
    hsts: {
        maxAge: 63072000,        // 2 ans (730 jours)
        includeSubDomains: true,
        preload: true            // Inclusion dans la liste HSTS preload des navigateurs
    },

    // Referrer Policy - Contrôle des informations de référence
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    },

    // X-Frame-Options - Protection clickjacking
    frameguard: {
        action: 'deny'
    },

    // X-Content-Type-Options - Empêche le MIME sniffing
    noSniff: true,

    // X-XSS-Protection - Protection XSS navigateurs anciens
    xssFilter: true,

    // X-Download-Options - IE8+ uniquement
    ieNoOpen: true,

    // X-DNS-Prefetch-Control
    dnsPrefetchControl: {
        allow: false
    }
}));

// Permissions Policy (header manuel car non supporté nativement par Helmet)
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', [
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
        "publickey-credentials-get=(self)"
    ].join(', '));
    next();
});

console.log(`🛡️ [SECURITY] Helmet configuré avec CSP stricte${NODE_ENV === 'production' ? ' + HSTS + Upgrade Insecure Requests' : ''}`);

app.use(cookieParser());

// Rate limiter pour les routes d'authentification (plus strict)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 tentatives de login par 15 min
    message: "Trop de tentatives de connexion, veuillez réessayer plus tard."
});

// Rate limiter pour la création de compte (anti-spam)
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 5, // Max 5 créations de compte par heure par IP
    message: "Trop de créations de compte, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour la vérification d'email (protection brute force code à 6 chiffres)
const verifyEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 tentatives par 15 min
    message: "Trop de tentatives de vérification, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour le renvoi d'emails (anti-spam)
const resendEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 3, // Max 3 renvois par heure
    message: "Trop de demandes de renvoi d'email, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour la réinitialisation de mot de passe
const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 tentatives par 15 min
    message: "Trop de tentatives de réinitialisation, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour la 2FA (strict pour éviter brute-force des codes TOTP)
// SEC-2FA: Réduit à 5 tentatives pour limiter les attaques par force brute
// Avec 5 essais / 5 min, un attaquant ne peut tester que 60 codes/heure
const twoFactorLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Max 5 tentatives par 5 min (sécurisé contre brute-force TOTP)
    message: "Trop de tentatives 2FA, veuillez réessayer dans 5 minutes.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter général (plus permissif)
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: NODE_ENV === 'production' ? 300 : 2000, // 2000 requêtes en dev, 300 en prod
    message: "Trop de requêtes, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour les routes à fort débit (fiches, listes, points en lecture)
const highTrafficLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: NODE_ENV === 'production' ? 500 : 2000, // 500 en prod, 2000 en dev
    message: "Trop de requêtes, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour les actions sociales (contacts, messages, partages)
const socialLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: NODE_ENV === 'production' ? 100 : 500, // 100 en prod, 500 en dev
    message: "Trop de requêtes, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter pour l'import de points (adapté aux imports massifs)
// CONF-006: Augmenté pour supporter les imports de 300+ points par batch
const importLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // 1000 requêtes par minute pour les imports (supports batch de 300+ points)
    message: "Trop de requêtes d'import, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST', // Seulement pour les POST
    keyGenerator: (req) => {
        // Utiliser l'ID utilisateur si disponible pour un rate limiting plus précis
        return (req as any).user?.id || req.ip || 'unknown';
    }
});

// Rate limiter pour les WebSocket (protection contre abus de connexions)
const wsConnectionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: NODE_ENV === 'production' ? 30 : 100, // 30 connexions/min en prod, 100 en dev
    message: "Trop de connexions WebSocket, veuillez réessayer plus tard.",
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false, // Compter même les connexions réussies
    handler: (req, res) => {
        console.warn(`⚠️ [WS RATE LIMIT] Trop de tentatives de connexion depuis ${req.ip}`);
        res.status(429).json({
            error: "Trop de connexions WebSocket",
            code: "WS_RATE_LIMIT_EXCEEDED",
            retryAfter: 60
        });
    }
});

// Appliquer les rate limiters
// Routes d'authentification (très strictes)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Routes de réinitialisation de mot de passe
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);

// Routes 2FA (plus souples car après login réussi)
app.use('/api/2fa/verify', twoFactorLimiter);
app.use('/api/auth/complete-2fa-login', twoFactorLimiter);

// Routes de création de compte et vérification d'email
// registerLimiter uniquement pour POST (création de compte), pas GET/PUT
app.post('/api/users', registerLimiter);
app.use('/api/users/verify-email', verifyEmailLimiter); // Protection brute force
app.use('/api/users/resend-verification', resendEmailLimiter); // Anti-spam emails

// Routes de données à fort débit (lecture)
app.use('/api/points', highTrafficLimiter);
app.use('/api/fiches', highTrafficLimiter);
app.use('/api/lists', highTrafficLimiter);

// Routes sociales (contacts, messages, partages)
app.use('/api/contacts', socialLimiter);
app.use('/api/messages', socialLimiter);
app.use('/api/share', socialLimiter);
app.use('/api/conversations', socialLimiter);

// WebSocket
app.use('/ws', wsConnectionLimiter);

// Rate limiter général pour toutes les autres routes /api
app.use('/api', generalLimiter);

// Connexion à la base de données obligatoire avant de démarrer le serveur
(async () => {
    try {
        await connectToDatabase();

        // Démarrer les jobs cron
        startDataShareCleanupJob();
        startNotificationCleanupJob();
        startRefreshTokenCleanupJob();

        // Monter les routes pour les utilisateurs
        // Route de maintenance (doit être avant le middleware de maintenance pour status public)
        app.use("/api/maintenance", maintenanceRoutes);

        // Routes d'authentification (doivent être AVANT le middleware de maintenance)
        // pour permettre aux admins de se connecter pendant la maintenance
        app.use("/api/auth", authRoutes);
        app.use("/api/2fa", twoFactorRoutes);

        // LOW-002 + LOW-003: Headers de sécurité et vérification de version pour routes mobiles
        const { mobileSecurityHeaders, checkAppVersion } = await import('./middlewares/mobileSecurityMiddleware');
        app.use("/api/mobile", mobileSecurityHeaders);
        app.use("/api/mobile", checkAppVersion);

        // Routes d'authentification mobile (sans Turnstile, avec sécurité alternative)
        app.use("/api/mobile/auth", mobileAuthRoutes);

        // Routes 2FA mobile (gestion 2FA depuis l'app mobile)
        app.use("/api/mobile/2fa", mobileTwoFactorRoutes);

        // Routes de synchronisation mobile (offline-first)
        app.use("/api/mobile/sync", mobileSyncRoutes);

        // Routes admin (doivent être AVANT le middleware de maintenance)
        // pour permettre aux admins de gérer la maintenance
        app.use("/api/admin", adminRoutes);

        // Middleware de maintenance (après les routes exemptées)
        app.use('/api', maintenanceMiddleware);

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
                public isOperational: boolean = true
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
                error: 'Route non trouvée',
                code: 'ROUTE_NOT_FOUND',
                path: req.path,
                method: req.method
            });
        });

        // Gestionnaire d'erreurs global
        app.use((err: Error | AppError, req: express.Request, res: express.Response, _next: express.NextFunction) => {
            // Logger l'erreur complète côté serveur
            const errorLog = {
                timestamp: new Date().toISOString(),
                path: req.path,
                method: req.method,
                error: err.message,
                stack: NODE_ENV === 'development' ? err.stack : undefined,
                userId: (req as any).user?.id || 'anonymous'
            };

            console.error('❌ [ERROR]', errorLog);

            // Audit des erreurs critiques
            if (err instanceof AppError && !err.isOperational) {
                import('./services/auditService').then(({ auditService }) => {
                    auditService.log({
                        action: 'CRITICAL_ERROR',
                        level: 'critical',
                        ipAddress: req.ip,
                        userAgent: req.headers['user-agent'],
                        details: {
                            path: req.path,
                            method: req.method,
                            error: err.message,
                            code: (err as AppError).code
                        }
                    });
                });
            }

            // Déterminer le code de statut et le code d'erreur
            const statusCode = err instanceof AppError ? err.statusCode : 500;
            const code = err instanceof AppError ? (err as AppError).code : 'INTERNAL_ERROR';

            // Message d'erreur sécurisé (ne pas exposer les détails en production)
            const errorMessage = statusCode === 500 && NODE_ENV === 'production'
                ? 'Une erreur interne est survenue'
                : err.message;

            // Réponse au client (sans détails sensibles)
            res.status(statusCode).json({
                error: errorMessage,
                code: code,
                timestamp: new Date().toISOString(),
                // Stack trace uniquement en développement
                ...(NODE_ENV === 'development' && { stack: err.stack })
            });
        });

        // ═══════════════════════════════════════════════════════════════════════════
        // GESTION DES ERREURS NON CAPTURÉES
        // ═══════════════════════════════════════════════════════════════════════════

        // Promesses non gérées
        process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
            console.error('🚨 [UNHANDLED REJECTION]', {
                timestamp: new Date().toISOString(),
                reason: reason?.message || reason,
                stack: reason?.stack
            });

            import('./services/auditService').then(({ auditService }) => {
                auditService.log({
                    action: 'UNHANDLED_REJECTION',
                    level: 'critical',
                    details: {
                        error: reason?.message || String(reason),
                        stack: reason?.stack
                    }
                });
            });
        });

        // Exceptions non capturées
        process.on('uncaughtException', (error: Error) => {
            console.error('🚨 [UNCAUGHT EXCEPTION]', {
                timestamp: new Date().toISOString(),
                error: getErrorMessage(error),
                stack: error.stack
            });

            import('./services/auditService').then(({ auditService }) => {
                auditService.log({
                    action: 'UNCAUGHT_EXCEPTION',
                    level: 'critical',
                    details: {
                        error: getErrorMessage(error),
                        stack: error.stack
                    }
                });
            }).finally(() => {
                // Arrêt gracieux après une exception non capturée
                console.error('💀 [FATAL] Arrêt du serveur suite à une exception non capturée');
                process.exit(1);
            });
        });

        // Gestion de l'arrêt gracieux
        const gracefulShutdown = (signal: string) => {
            console.log(`\n⚠️ [${signal}] Signal reçu, arrêt gracieux...`);

            server.close(() => {
                console.log('✅ Serveur HTTP fermé');

                // Note: WebSocket sera fermé automatiquement avec le serveur HTTP
                console.log('✅ WebSocket fermé');

                // Fermer MongoDB
                import('mongoose').then((mongoose) => {
                    mongoose.default.connection.close(false).then(() => {
                        console.log('✅ MongoDB déconnecté');
                        process.exit(0);
                    });
                });
            });

            // Forcer l'arrêt après 10 secondes
            setTimeout(() => {
                console.error('⚠️ Arrêt forcé après timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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