// src/middlewares/correlationMiddleware.ts
// Middleware de corrélation pour tracer les requêtes HTTP

import { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

// ════════════════════════════════════════════════════════
// 📦 Types et Interfaces
// ════════════════════════════════════════════════════════

/**
 * Contexte de la requête contenant les informations de traçage
 * et d'authentification
 */
export interface RequestContext {
  correlationId: string;
  userId?: string;
  sessionId?: string;
  clientType?: "web" | "mobile";
}

// ════════════════════════════════════════════════════════
// 🔄 AsyncLocalStorage pour la corrélation
// ════════════════════════════════════════════════════════

/**
 * Store pour maintenir le contexte de requête à travers
 * les appels asynchrones dans le contexte d'une requête
 */
export const correlationStore = new AsyncLocalStorage<RequestContext>();

// ════════════════════════════════════════════════════════
// 🆔 Récupération du Correlation ID
// ════════════════════════════════════════════════════════

/**
 * Récupère le correlation ID actuel depuis l'AsyncLocalStorage
 * @returns Le correlation ID ou undefined s'il n'y en a pas
 */
export function getCorrelationId(): string | undefined {
  const context = correlationStore.getStore();
  return context?.correlationId;
}

// ════════════════════════════════════════════════════════
// 📋 Récupération du contexte complet
// ════════════════════════════════════════════════════════

/**
 * Récupère le contexte de requête complet depuis l'AsyncLocalStorage
 * @returns Le contexte de requête ou undefined s'il n'y en a pas
 */
export function getRequestContext(): RequestContext | undefined {
  return correlationStore.getStore();
}

// ════════════════════════════════════════════════════════
// ✏️ Enrichissement du contexte
// ════════════════════════════════════════════════════════

/**
 * Met à jour le contexte de requête actuel avec de nouvelles informations
 * (ex: userId et sessionId après authentification)
 *
 * @param updates - Propriétés partielles à fusionner avec le contexte existant
 *
 * @example
 * // Dans un middleware d'authentification
 * setRequestContext({ userId: "user-123", sessionId: "session-456" });
 */
export function setRequestContext(updates: Partial<RequestContext>): void {
  const currentContext = correlationStore.getStore();
  if (!currentContext) {
    console.warn(
      "[correlationMiddleware] Tentative de mise à jour du contexte en dehors d'une requête",
    );
    return;
  }

  // Fusionner les mises à jour avec le contexte existant
  Object.assign(currentContext, updates);
}

// ════════════════════════════════════════════════════════
// 🎯 Middleware de corrélation
// ════════════════════════════════════════════════════════

/**
 * Middleware Express qui gère les correlation IDs et le contexte de requête
 *
 * Fonctionnalités:
 * - Génère un UUID v4 comme correlation ID
 * - Utilise X-Correlation-ID du header si déjà présent
 * - Attache le correlation ID à req.correlationId
 * - Ajoute le correlation ID au header de réponse
 * - Initialise un contexte de requête dans l'AsyncLocalStorage
 * - Le contexte peut être enrichi par d'autres middlewares
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

  // Créer le contexte initial de la requête
  const context: RequestContext = {
    correlationId,
  };

  // Exécuter le reste de la chaîne de middleware dans le contexte
  // de l'AsyncLocalStorage avec le contexte de requête
  correlationStore.run(context, () => {
    next();
  });
}

export default correlationMiddleware;
