// src/utils/requestLogger.ts
// Utilitaire pour logger les requêtes HTTP entrantes de manière structurée

import type { NextFunction, Request, Response } from "express";
import { logger } from "../services/loggerService";
import { anonymizeIp } from "./logUtils";

/**
 * Options pour le logging de requête
 */
export interface RequestLogOptions {
  /** Inclure le body de la requête (sanitisé automatiquement) */
  includeBody?: boolean;
  /** Inclure les query parameters */
  includeQuery?: boolean;
  /** Inclure les headers (sanitisés automatiquement) */
  includeHeaders?: boolean;
  /** Niveau de log ('debug' | 'info' | 'http') */
  level?: "debug" | "info" | "http";
  /** Message custom (par défaut: "Incoming request") */
  message?: string;
  /** Contexte additionnel */
  context?: Record<string, unknown>;
}

/**
 * Métadonnées extraites d'une requête HTTP
 */
export interface RequestMetadata {
  /** Méthode HTTP (GET, POST, etc.) */
  method: string;
  /** URL de la requête */
  url: string;
  /** Path de la requête (sans query string) */
  path: string;
  /** Request ID / Correlation ID */
  requestId?: string;
  /** User ID (si authentifié) */
  userId?: string;
  /** Session ID (si disponible) */
  sessionId?: string;
  /** Type de client (web, mobile) */
  clientType?: "web" | "mobile";
  /** IP du client (anonymisée) */
  ip: string;
  /** User Agent du client */
  userAgent?: string;
  /** Origin du client */
  origin?: string;
  /** Query parameters (si includeQuery = true) */
  query?: Record<string, unknown>;
  /** Body de la requête (si includeBody = true, sanitisé) */
  body?: Record<string, unknown>;
  /** Headers sélectionnés (si includeHeaders = true) */
  headers?: Record<string, string>;
}

/**
 * Headers à inclure dans les logs (liste blanche)
 * Les headers sensibles sont exclus par défaut
 */
const SAFE_HEADERS = [
  "content-type",
  "content-length",
  "accept",
  "accept-language",
  "cache-control",
  "x-request-id",
  "x-correlation-id",
  "x-client-version",
  "x-app-version",
] as const;

/**
 * Extrait les métadonnées d'une requête Express de manière sécurisée
 *
 * @param req - Request Express
 * @param options - Options de configuration
 * @returns Métadonnées structurées et sanitisées
 */
export function extractRequestMetadata(
  req: Request,
  options: RequestLogOptions = {},
): RequestMetadata {
  const {
    includeBody = false,
    includeQuery = true,
    includeHeaders = false,
  } = options;

  // Extraire les données de base
  const metadata: RequestMetadata = {
    method: req.method,
    url: req.url,
    path: req.path,
    requestId: req.id || req.correlationId,
    ip: anonymizeIp(req.ip || req.socket.remoteAddress || "unknown"),
    userAgent: req.headers["user-agent"],
    origin: req.headers.origin,
  };

  // Ajouter les données d'authentification si disponibles
  if (req.user) {
    metadata.userId = req.user.id;
    metadata.clientType = req.user.clientType;
  }

  // Ajouter les query parameters si demandé
  if (includeQuery && req.query && Object.keys(req.query).length > 0) {
    metadata.query = req.query as Record<string, unknown>;
  }

  // Ajouter le body si demandé (sera sanitisé automatiquement par le logger)
  if (includeBody && req.body && Object.keys(req.body).length > 0) {
    metadata.body = req.body;
  }

  // Ajouter les headers sécurisés si demandé
  if (includeHeaders) {
    const safeHeaders: Record<string, string> = {};
    for (const header of SAFE_HEADERS) {
      const value = req.headers[header];
      if (value) {
        safeHeaders[header] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
    metadata.headers = safeHeaders;
  }

  return metadata;
}

/**
 * Logue une requête HTTP entrante avec toutes les métadonnées pertinentes
 *
 * Cette fonction extrait automatiquement les informations importantes
 * d'une requête Express et les logue de manière structurée et sécurisée.
 *
 * Les données sensibles (passwords, tokens, etc.) sont automatiquement
 * sanitisées par le logger.
 *
 * @param req - Request Express
 * @param options - Options de configuration
 *
 * @example
 * // Usage dans un middleware ou contrôleur
 * logRequest(req, {
 *   level: "info",
 *   includeBody: true,
 *   context: { controller: "UserController" }
 * });
 *
 * @example
 * // Usage minimal (logs essentiels uniquement)
 * logRequest(req);
 */
export function logRequest(
  req: Request,
  options: RequestLogOptions = {},
): void {
  const {
    level = "http",
    message = "Incoming request",
    context = {},
  } = options;

  // Extraire les métadonnées
  const metadata = extractRequestMetadata(req, options);

  // Fusionner avec le contexte additionnel
  const logData = {
    ...metadata,
    ...context,
  };

  // Logger au niveau approprié
  logger[level](message, logData);
}

/**
 * Logue une réponse HTTP avec les métriques de performance
 *
 * @param req - Request Express
 * @param statusCode - Code de statut HTTP
 * @param duration - Durée de traitement en ms (optionnel)
 * @param context - Contexte additionnel
 *
 * @example
 * const startTime = Date.now();
 * // ... traitement de la requête ...
 * logResponse(req, 200, Date.now() - startTime, { itemsReturned: 42 });
 */
export function logResponse(
  req: Request,
  statusCode: number,
  duration?: number,
  context?: Record<string, unknown>,
): void {
  const metadata: Record<string, unknown> = {
    method: req.method,
    url: req.url,
    requestId: req.id || req.correlationId,
    statusCode,
    ...(req.user && { userId: req.user.id }),
    ...(duration && { duration: `${duration}ms`, durationMs: duration }),
    ...context,
  };

  // Niveau de log selon le code de statut
  if (statusCode >= 500) {
    logger.error("Response sent - Server Error", metadata);
  } else if (statusCode >= 400) {
    logger.warn("Response sent - Client Error", metadata);
  } else {
    logger.http("Response sent", metadata);
  }
}

/**
 * Crée un middleware Express qui logue automatiquement les requêtes
 *
 * @param options - Options de configuration
 * @returns Middleware Express
 *
 * @example
 * // Dans server.ts
 * import { createRequestLoggerMiddleware } from "./utils/requestLogger";
 *
 * app.use(createRequestLoggerMiddleware({
 *   level: "info",
 *   includeQuery: true
 * }));
 */
export function createRequestLoggerMiddleware(options: RequestLogOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Logger la requête entrante
    logRequest(req, options);

    // Mesurer le temps de traitement
    const startTime = Date.now();

    // Intercepter la réponse pour logger à la fin
    const originalSend = res.send;
    res.send = function (body: unknown) {
      const duration = Date.now() - startTime;
      logResponse(req, res.statusCode, duration);
      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Logue une erreur de requête avec le contexte complet
 *
 * @param req - Request Express
 * @param error - Erreur survenue
 * @param context - Contexte additionnel
 *
 * @example
 * try {
 *   // ... traitement ...
 * } catch (error) {
 *   logRequestError(req, error, { action: "createUser" });
 *   throw error;
 * }
 */
export function logRequestError(
  req: Request,
  error: Error | unknown,
  context?: Record<string, unknown>,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "UnknownError";

  const metadata = {
    method: req.method,
    url: req.url,
    requestId: req.id || req.correlationId,
    userId: req.user?.id,
    error: errorMessage,
    errorName,
    ...context,
  };

  logger.error("Request processing error", metadata);
}

export default {
  logRequest,
  logResponse,
  logRequestError,
  extractRequestMetadata,
  createRequestLoggerMiddleware,
};
