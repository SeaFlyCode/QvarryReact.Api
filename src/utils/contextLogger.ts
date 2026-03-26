// src/utils/contextLogger.ts
// Utilitaire pour créer des loggers avec contexte pré-rempli

import { logger, LoggerInterface } from "../services/loggerService";
import { getRequestId } from "../middlewares/requestId";
import { getRequestContext } from "../middlewares/correlationMiddleware";
import { Request } from "express";

/**
 * Contexte de base pour le logger
 */
export interface LoggerContext {
  /** Request ID / Correlation ID */
  requestId?: string;
  /** User ID */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Type de client (web, mobile) */
  clientType?: "web" | "mobile";
  /** Service ou module appelant */
  service?: string;
  /** Contrôleur appelant */
  controller?: string;
  /** Action ou méthode appelante */
  action?: string;
  /** Contexte custom additionnel */
  [key: string]: any;
}

/**
 * Crée un logger avec un contexte pré-rempli
 *
 * Le contexte fourni sera automatiquement inclus dans tous les logs
 * effectués avec ce logger. Cela évite de répéter les mêmes informations
 * contextuelles à chaque appel de log.
 *
 * @param baseContext - Contexte de base à inclure dans tous les logs
 * @returns Logger avec contexte pré-rempli
 *
 * @example
 * // Dans un contrôleur
 * export async function createUser(req: Request, res: Response) {
 *   const log = createContextLogger({
 *     controller: "UserController",
 *     action: "createUser",
 *     userId: req.user?.id,
 *     requestId: req.id
 *   });
 *
 *   log.info("Creating new user");
 *   // Log: { controller: "UserController", action: "createUser", userId: "123", requestId: "abc", message: "Creating new user" }
 *
 *   log.debug("Validating user data", { email: user.email });
 *   // Log: { controller: "UserController", action: "createUser", userId: "123", requestId: "abc", email: "user@example.com", message: "Validating user data" }
 * }
 *
 * @example
 * // Dans un service
 * export class EmailService {
 *   private log = createContextLogger({ service: "EmailService" });
 *
 *   async sendWelcomeEmail(userId: string, email: string) {
 *     this.log.info("Sending welcome email", { userId, email });
 *   }
 * }
 */
export function createContextLogger(
  baseContext: LoggerContext = {},
): LoggerInterface {
  // Utiliser la méthode child du logger Winston
  return logger.child(baseContext);
}

/**
 * Crée un logger à partir d'une requête Express
 *
 * Extrait automatiquement le contexte de la requête (requestId, userId, etc.)
 * et crée un logger avec ce contexte pré-rempli.
 *
 * @param req - Request Express
 * @param additionalContext - Contexte additionnel (ex: controller, action)
 * @returns Logger avec contexte de requête pré-rempli
 *
 * @example
 * export async function getUser(req: Request, res: Response) {
 *   const log = createRequestLogger(req, {
 *     controller: "UserController",
 *     action: "getUser"
 *   });
 *
 *   log.info("Fetching user");
 *   // Log: { requestId: "abc", userId: "123", clientType: "web", controller: "UserController", action: "getUser", message: "Fetching user" }
 * }
 */
export function createRequestLogger(
  req: Request,
  additionalContext?: Partial<LoggerContext>,
): LoggerInterface {
  // Extraire le contexte de la requête
  const context: LoggerContext = {
    requestId: req.id || req.correlationId,
    userId: req.user?.id,
    clientType: req.user?.clientType,
    ...additionalContext,
  };

  return createContextLogger(context);
}

/**
 * Crée un logger pour un service avec auto-enrichissement du contexte
 *
 * Ce logger enrichit automatiquement les logs avec le requestId et userId
 * depuis l'AsyncLocalStorage si disponibles.
 *
 * @param serviceName - Nom du service
 * @param additionalContext - Contexte additionnel
 * @returns Logger pour le service
 *
 * @example
 * export class UserService {
 *   private log = createServiceLogger("UserService");
 *
 *   async findById(userId: string) {
 *     this.log.info("Finding user by ID", { userId });
 *     // Le requestId sera automatiquement ajouté si disponible
 *   }
 * }
 */
export function createServiceLogger(
  serviceName: string,
  additionalContext?: Partial<LoggerContext>,
): LoggerInterface {
  const baseContext: LoggerContext = {
    service: serviceName,
    ...additionalContext,
  };

  return createContextLogger(baseContext);
}

/**
 * Crée un logger pour un contrôleur avec auto-enrichissement du contexte
 *
 * @param controllerName - Nom du contrôleur
 * @param additionalContext - Contexte additionnel
 * @returns Logger pour le contrôleur
 *
 * @example
 * export class UserController {
 *   private log = createControllerLogger("UserController");
 *
 *   async createUser(req: Request, res: Response) {
 *     const actionLog = this.log.child({ action: "createUser", requestId: req.id });
 *     actionLog.info("Creating new user");
 *   }
 * }
 */
export function createControllerLogger(
  controllerName: string,
  additionalContext?: Partial<LoggerContext>,
): LoggerInterface {
  const baseContext: LoggerContext = {
    controller: controllerName,
    ...additionalContext,
  };

  return createContextLogger(baseContext);
}

/**
 * Crée un logger pour une opération spécifique avec enrichissement automatique
 *
 * Enrichit automatiquement avec requestId, userId depuis AsyncLocalStorage
 *
 * @param operation - Nom de l'opération
 * @param context - Contexte additionnel
 * @returns Logger pour l'opération
 *
 * @example
 * async function processPayment(orderId: string) {
 *   const log = createOperationLogger("processPayment", { orderId });
 *
 *   log.info("Starting payment processing");
 *   // ... traitement ...
 *   log.info("Payment processed successfully");
 * }
 */
export function createOperationLogger(
  operation: string,
  context?: Partial<LoggerContext>,
): LoggerInterface {
  // Récupérer le contexte de requête depuis AsyncLocalStorage
  const requestContext = getRequestContext();

  const enrichedContext: LoggerContext = {
    operation,
    ...(requestContext?.correlationId && {
      requestId: requestContext.correlationId,
    }),
    ...(requestContext?.userId && { userId: requestContext.userId }),
    ...(requestContext?.sessionId && { sessionId: requestContext.sessionId }),
    ...(requestContext?.clientType && {
      clientType: requestContext.clientType,
    }),
    ...context,
  };

  return createContextLogger(enrichedContext);
}

/**
 * Crée un logger enrichi automatiquement avec le contexte actuel
 *
 * Utilise AsyncLocalStorage pour enrichir automatiquement le logger
 * avec toutes les informations de contexte disponibles
 * (requestId, userId, sessionId, clientType).
 *
 * Idéal pour les fonctions utilitaires appelées depuis différents endroits.
 *
 * @param additionalContext - Contexte additionnel
 * @returns Logger enrichi
 *
 * @example
 * async function sendNotification(userId: string, message: string) {
 *   const log = createEnrichedLogger({ function: "sendNotification" });
 *
 *   log.info("Sending notification", { userId, message });
 *   // Sera automatiquement enrichi avec requestId si disponible
 * }
 */
export function createEnrichedLogger(
  additionalContext?: Partial<LoggerContext>,
): LoggerInterface {
  // Récupérer le contexte de requête depuis AsyncLocalStorage
  const requestContext = getRequestContext();

  const enrichedContext: LoggerContext = {
    ...(requestContext?.correlationId && {
      requestId: requestContext.correlationId,
    }),
    ...(requestContext?.userId && { userId: requestContext.userId }),
    ...(requestContext?.sessionId && { sessionId: requestContext.sessionId }),
    ...(requestContext?.clientType && {
      clientType: requestContext.clientType,
    }),
    ...additionalContext,
  };

  return createContextLogger(enrichedContext);
}

/**
 * Décorateur de classe pour injecter automatiquement un logger avec contexte
 *
 * @param contextOrName - Contexte ou nom du service/contrôleur
 *
 * @example
 * @WithLogger("UserService")
 * export class UserService {
 *   // Le logger sera automatiquement injecté comme propriété 'log'
 *   async findUser(userId: string) {
 *     this.log.info("Finding user", { userId });
 *   }
 * }
 */
export function WithLogger(contextOrName: string | LoggerContext) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    return class extends constructor {
      public log: LoggerInterface;

      constructor(...args: any[]) {
        super(...args);
        const context =
          typeof contextOrName === "string"
            ? { service: contextOrName }
            : contextOrName;
        this.log = createContextLogger(context);
      }
    };
  };
}

export default {
  createContextLogger,
  createRequestLogger,
  createServiceLogger,
  createControllerLogger,
  createOperationLogger,
  createEnrichedLogger,
  WithLogger,
};
