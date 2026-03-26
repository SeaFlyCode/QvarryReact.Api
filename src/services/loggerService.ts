// src/services/loggerService.ts
// Service de logging structuré avec Winston

import * as winston from "winston";
import DailyRotateFile = require("winston-daily-rotate-file");
import * as path from "path";
import * as fs from "fs";

// Import du correlation store (sera disponible après création du middleware)
// On utilise un try-catch pour éviter les erreurs si le middleware n'est pas encore créé
let getCorrelationId: (() => string | undefined) | undefined;
let getRequestContext: (() => any | undefined) | undefined;
try {
  const correlationModule = require("../middlewares/correlationMiddleware");
  getCorrelationId = correlationModule.getCorrelationId;
  getRequestContext = correlationModule.getRequestContext;
} catch {
  // Le middleware n'est pas encore disponible, on continue sans
  getCorrelationId = undefined;
  getRequestContext = undefined;
}

// ════════════════════════════════════════════════════════
// 🎨 Configuration et Niveaux
// ════════════════════════════════════════════════════════

/**
 * Niveaux de log personnalisés
 * critical = 0 (le plus important)
 * error = 1
 * warn = 2
 * info = 3
 * http = 4
 * debug = 5 (le moins important)
 */
const customLevels = {
  levels: {
    critical: 0,
    error: 1,
    warn: 2,
    info: 3,
    http: 4,
    debug: 5,
  },
  colors: {
    critical: "red bold",
    error: "red",
    warn: "yellow",
    info: "green",
    http: "magenta",
    debug: "blue",
  },
};

// Appliquer les couleurs
winston.addColors(customLevels.colors);

// ════════════════════════════════════════════════════════
// 🔒 Sanitisation des données sensibles
// ════════════════════════════════════════════════════════

/**
 * Liste des clés sensibles à masquer complètement
 * Ces champs seront remplacés par [REDACTED]
 */
const SENSITIVE_KEYS = [
  // Mots de passe et authentification
  "password",
  "passwd",
  "pwd",
  "oldpassword",
  "newpassword",
  "confirmpassword",

  // Tokens et clés d'API
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "apisecret",
  "api_secret",
  "secretkey",
  "secret_key",
  "privatekey",
  "private_key",
  "encryptionkey",
  "encryption_key",
  "jwt",
  "bearer",

  // Authentification et sessions
  "authorization",
  "auth",
  "credentials",
  "secret",
  "sessionid",
  "session_id",

  // Headers sensibles
  "cookie",
  "set-cookie",
  "setcookie",

  // Données personnelles sensibles
  "ssn",
  "socialsecuritynumber",
  "social_security_number",
  "creditcard",
  "credit_card",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "pin",
  "pincode",
  "pin_code",
];

/**
 * Liste des clés à masquer partiellement
 * Ces champs seront masqués mais garderont une partie visible
 */
const PARTIAL_MASK_KEYS = [
  "email",
  "mail",
  "e-mail",
  "username",
  "user_name",
  "ip",
  "ipaddress",
  "ip_address",
  "deviceid",
  "device_id",
];

/**
 * Masque partiellement une valeur selon son type
 * @param key - Nom de la clé
 * @param value - Valeur à masquer
 * @returns Valeur partiellement masquée
 */
function partialMask(key: string, value: any): string {
  if (typeof value !== "string") return "[MASKED]";

  const keyLower = key.toLowerCase();

  // Email: matheo@example.com → m***@example.com
  if (keyLower.includes("email") || keyLower.includes("mail")) {
    if (!value.includes("@")) return "***";
    const [local, domain] = value.split("@");
    const masked =
      local.length <= 2 ? local[0] + "***" : local.substring(0, 2) + "***";
    return `${masked}@${domain}`;
  }

  // IP: 192.168.1.42 → 192.168.1.*
  if (keyLower.includes("ip")) {
    if (value.includes(":")) {
      // IPv6: 2001:0db8:85a3::8a2e → 2001:0db8:***
      return value.split(":").slice(0, 2).join(":") + ":***";
    }
    // IPv4
    const parts = value.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
    }
  }

  // Device ID: ABC123XYZ → ABC123...
  if (keyLower.includes("device")) {
    if (value.length <= 8) return value;
    return value.substring(0, 6) + "...";
  }

  // Username (si seul, sans password): user123 → use***
  if (keyLower.includes("username") || keyLower.includes("user_name")) {
    if (value.length <= 3) return "***";
    return value.substring(0, 3) + "***";
  }

  // Par défaut: masquer la majorité
  if (value.length <= 4) return "***";
  return value.substring(0, 2) + "***";
}

/**
 * Sanitize les données sensibles dans les objets/tableaux
 *
 * Fonctionnalités:
 * - Masquage complet des données critiques (passwords, tokens, secrets)
 * - Masquage partiel des données personnelles (emails, IPs)
 * - Support récursif pour objets imbriqués et tableaux
 * - Gestion des types complexes (Date, Error, etc.)
 *
 * @param data - Données à sanitizer
 * @param depth - Profondeur actuelle (pour éviter les boucles infinies)
 * @returns Données sanitizées
 */
export function sanitizeLogData(data: any, depth: number = 0): any {
  // Protection contre les boucles infinies
  if (depth > 10) return "[MAX_DEPTH]";

  // Cas null ou undefined
  if (data === null || data === undefined) return data;

  // Si c'est une primitive, retourner telle quelle
  if (typeof data !== "object") return data;

  // Cas spéciaux: Date, Error, RegExp, etc.
  if (data instanceof Date) return data.toISOString();
  if (data instanceof Error)
    return {
      name: data.name,
      message: data.message,
      stack: data.stack ? sanitizeLogData(data.stack, depth + 1) : undefined,
    };
  if (data instanceof RegExp) return data.toString();

  // Si c'est un tableau
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, depth + 1));
  }

  // Si c'est un objet
  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    // Vérifier si la clé doit être masquée complètement
    const isFullyMasked = SENSITIVE_KEYS.some((sensitiveKey) =>
      keyLower.includes(sensitiveKey),
    );

    // Vérifier si la clé doit être masquée partiellement
    const isPartiallyMasked = PARTIAL_MASK_KEYS.some((partialKey) =>
      keyLower.includes(partialKey),
    );

    if (isFullyMasked) {
      sanitized[key] = "[REDACTED]";
    } else if (
      isPartiallyMasked &&
      (typeof value === "string" || typeof value === "number")
    ) {
      sanitized[key] = partialMask(key, value);
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ════════════════════════════════════════════════════════
// 📁 Configuration du dossier de logs
// ════════════════════════════════════════════════════════

const LOG_DIR = process.env.LOG_DIR || "logs";
const LOG_DIR_PATH = path.resolve(process.cwd(), LOG_DIR);

// Créer le dossier de logs s'il n'existe pas
if (!fs.existsSync(LOG_DIR_PATH)) {
  fs.mkdirSync(LOG_DIR_PATH, { recursive: true });
}

// ════════════════════════════════════════════════════════
// 🎨 Formats de logging
// ════════════════════════════════════════════════════════

/**
 * Format JSON pour la production
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ["message", "level", "timestamp", "label"],
  }),
  winston.format.json(),
);

/**
 * Format lisible pour le développement
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;

    let log = `${timestamp} [${level}]: ${message}`;

    // Ajouter les métadonnées si présentes
    if (Object.keys(meta).length > 0) {
      const sanitized = sanitizeLogData(meta);
      log += `\n${JSON.stringify(sanitized, null, 2)}`;
    }

    return log;
  }),
);

// ════════════════════════════════════════════════════════
// 🚀 Configuration des Transports
// ════════════════════════════════════════════════════════

const NODE_ENV = process.env.NODE_ENV || "development";
const isDevelopment = NODE_ENV === "development";

// LOG_LEVEL permet de contrôler le niveau de verbosité
// Valeurs possibles: debug, info, http, warn, error, critical
// Par défaut: debug en dev, info en prod
const LOG_LEVEL = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

/**
 * Transport Console - toujours actif
 */
const consoleTransport = new winston.transports.Console({
  level: LOG_LEVEL,
  format: isDevelopment ? consoleFormat : jsonFormat,
});

/**
 * Transport Fichier - Erreurs uniquement
 * Rotation quotidienne, rétention 30 jours, max 50MB
 */
const errorFileTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR_PATH, "error-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "error",
  format: jsonFormat,
  maxSize: "50m",
  maxFiles: "30d",
  zippedArchive: true,
});

/**
 * Transport Fichier - Tous les logs (info et plus)
 * Rotation quotidienne, rétention 14 jours, max 100MB
 */
const combinedFileTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR_PATH, "app-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "info",
  format: jsonFormat,
  maxSize: "100m",
  maxFiles: "14d",
  zippedArchive: true,
});

// ════════════════════════════════════════════════════════
// 🏗️ Création du Logger Winston
// ════════════════════════════════════════════════════════

const baseLogger = winston.createLogger({
  levels: customLevels.levels,
  level: LOG_LEVEL,
  transports: [consoleTransport, errorFileTransport, combinedFileTransport],
  exitOnError: false,
});

// ════════════════════════════════════════════════════════
// 🎯 Interface du Logger
// ════════════════════════════════════════════════════════

export interface LoggerInterface {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  http(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  critical(message: string, meta?: any): void;
  child(meta: any): LoggerInterface;
}

// ════════════════════════════════════════════════════════
// 📦 Logger avec sanitisation automatique
// ════════════════════════════════════════════════════════

class Logger implements LoggerInterface {
  private winstonLogger: winston.Logger;
  private defaultMeta: any;

  constructor(winstonLogger: winston.Logger, defaultMeta: any = {}) {
    this.winstonLogger = winstonLogger;
    this.defaultMeta = defaultMeta;
  }

  private log(level: string, message: string, meta?: any): void {
    const sanitizedMeta = meta ? sanitizeLogData(meta, 0) : {};

    // Ajouter automatiquement le correlation ID s'il est disponible
    const correlationId = getCorrelationId?.();
    if (correlationId) {
      sanitizedMeta.correlationId = correlationId;
    }

    // Ajouter automatiquement le contexte de la requête s'il est disponible
    const requestContext = getRequestContext?.();
    if (requestContext) {
      // Injecter userId, sessionId, clientType s'ils ne sont pas déjà présents dans les méta explicites
      if (requestContext.userId && !sanitizedMeta.userId) {
        sanitizedMeta.userId = requestContext.userId;
      }
      if (requestContext.sessionId && !sanitizedMeta.sessionId) {
        sanitizedMeta.sessionId = requestContext.sessionId;
      }
      if (requestContext.clientType && !sanitizedMeta.clientType) {
        sanitizedMeta.clientType = requestContext.clientType;
      }
    }

    const fullMeta = { ...this.defaultMeta, ...sanitizedMeta };

    this.winstonLogger.log(level, message, fullMeta);
  }

  debug(message: string, meta?: any): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: any): void {
    this.log("info", message, meta);
  }

  http(message: string, meta?: any): void {
    this.log("http", message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: any): void {
    this.log("error", message, meta);
  }

  critical(message: string, meta?: any): void {
    this.log("critical", message, meta);
  }

  child(meta: any): LoggerInterface {
    const childMeta = { ...this.defaultMeta, ...meta };
    return new Logger(this.winstonLogger, childMeta);
  }
}

// ════════════════════════════════════════════════════════
// 🌟 Export du Logger Singleton
// ════════════════════════════════════════════════════════

export const logger = new Logger(baseLogger);

// ════════════════════════════════════════════════════════
// 🔗 Format Morgan pour Express
// ════════════════════════════════════════════════════════

/**
 * Format Morgan compatible pour les requêtes HTTP
 * Utilisation: morgan(httpLogFormat, { stream: httpLogStream })
 */
export const httpLogFormat =
  ":method :url :status :res[content-length] - :response-time ms";

/**
 * Stream pour Morgan qui utilise notre logger
 */
export const httpLogStream = {
  write: (message: string) => {
    // Retire le \n final ajouté par morgan
    logger.http(message.trim());
  },
};

// ════════════════════════════════════════════════════════
// 📊 Log de démarrage
// ════════════════════════════════════════════════════════

logger.info("Logger service initialized", {
  environment: NODE_ENV,
  logDirectory: LOG_DIR_PATH,
  level: LOG_LEVEL,
});

export default logger;
