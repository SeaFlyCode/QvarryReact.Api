// src/middlewares/correlationMiddleware.ts
// Middleware de corrélation pour tracer les requêtes HTTP

import { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

// ════════════════════════════════════════════════════════
// 🔄 AsyncLocalStorage pour la corrélation
// ════════════════════════════════════════════════════════

/**
 * Store pour maintenir le correlation ID à travers
 * les appels asynchrones dans le contexte d'une requête
 */
export const correlationStore = new AsyncLocalStorage<string>();

// ════════════════════════════════════════════════════════
// 🆔 Récupération du Correlation ID
// ════════════════════════════════════════════════════════

/**
 * Récupère le correlation ID actuel depuis l'AsyncLocalStorage
 * @returns Le correlation ID ou undefined s'il n'y en a pas
 */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore();
}

// ════════════════════════════════════════════════════════
// 🎯 Middleware de corrélation
// ════════════════════════════════════════════════════════

/**
 * Middleware Express qui gère les correlation IDs
 *
 * Fonctionnalités:
 * - Génère un UUID v4 comme correlation ID
 * - Utilise X-Correlation-ID du header si déjà présent
 * - Attache le correlation ID à req.correlationId
 * - Ajoute le correlation ID au header de réponse
 * - Le rend disponible via AsyncLocalStorage
 *
 * @param req - Request Express
 * @param res - Response Express
 * @param next - Fonction next
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Récupérer le correlation ID depuis le header ou en générer un nouveau
  const correlationId =
    (req.headers["x-correlation-id"] as string) || randomUUID();

  // Attacher le correlation ID à la requête
  req.correlationId = correlationId;

  // Ajouter le correlation ID au header de réponse
  res.setHeader("X-Correlation-ID", correlationId);

  // Exécuter le reste de la chaîne de middleware dans le contexte
  // de l'AsyncLocalStorage avec le correlation ID
  correlationStore.run(correlationId, () => {
    next();
  });
}

export default correlationMiddleware;
