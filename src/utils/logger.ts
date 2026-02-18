/**
 * LOW-01: Logger structuré (winston)
 *
 * Ce logger est disponible pour une migration progressive depuis console.log/warn/error.
 * Le console-interceptor middleware existant continue de gérer le formatage des logs console.
 *
 * Usage:
 *   import logger from "../utils/logger";
 *   logger.info("Message");
 *   logger.warn("Attention", { context: "détail" });
 *   logger.error("Erreur critique", { error: err.message });
 *   logger.debug("Debug info"); // Ignoré en production (level=info)
 */
import winston from "winston";

const NODE_ENV = process.env.NODE_ENV || "development";

const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length
              ? ` ${JSON.stringify(meta)}`
              : "";
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          }),
        ),
  ),
  transports: [
    new winston.transports.Console(),
    // En production, ajouter un fichier de logs
    ...(NODE_ENV === "production"
      ? [
          new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
          }),
          new winston.transports.File({ filename: "logs/combined.log" }),
        ]
      : []),
  ],
});

export default logger;
