// src/services/loggerService.ts
// Service de logging structuré avec Winston

import * as winston from "winston";
import DailyRotateFile = require("winston-daily-rotate-file");
import * as path from "path";
import * as fs from "fs";

// Import du correlation store (sera disponible après création du middleware)
// On utilise un try-catch pour éviter les erreurs si le middleware n'est pas encore créé
let getCorrelationId: (() => string | undefined) | undefined;
try {
  const correlationModule = require("../middlewares/correlationMiddleware");
  getCorrelationId = correlationModule.getCorrelationId;
} catch {
  // Le middleware n'est pas encore disponible, on continue sans
  getCorrelationId = undefined;
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
 * Liste des clés sensibles à filtrer
 */
const SENSITIVE_KEYS = [
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "jwt",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "bearer",
  "credentials",
  "auth",
  "sessionid",
  "session_id",
  "privatekey",
  "private_key",
  "secretkey",
  "secret_key",
];

/**
 * Sanitize les données sensibles dans les objets/tableaux
 * @param data - Données à sanitizer
 * @returns Données sanitizées
 */
export function sanitizeLogData(data: any): any {
  if (!data) return data;

  // Si c'est une primitive, retourner telle quelle
  if (typeof data !== "object") return data;

  // Si c'est un tableau
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  // Si c'est un objet
  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();

    // Vérifier si la clé est sensible
    const isSensitive = SENSITIVE_KEYS.some((sensitiveKey) =>
      keyLower.includes(sensitiveKey),
    );

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value);
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

/**
 * Transport Console - toujours actif
 */
const consoleTransport = new winston.transports.Console({
  level: isDevelopment ? "debug" : "info",
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
  level: isDevelopment ? "debug" : "info",
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
    const sanitizedMeta = meta ? sanitizeLogData(meta) : {};

    // Ajouter automatiquement le correlation ID s'il est disponible
    const correlationId = getCorrelationId?.();
    if (correlationId) {
      sanitizedMeta.correlationId = correlationId;
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
  level: isDevelopment ? "debug" : "info",
});

export default logger;
