// src/middlewares/requestId.ts
// Middleware de Request ID pour tracer les requêtes de bout en bout
//
// Note: Ce middleware est un alias du correlationMiddleware existant
// pour faciliter l'utilisation dans différents contextes.
// Le terme "Request ID" est plus explicite pour les développeurs
// habitués à ce pattern.

import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { correlationStore, RequestContext } from "./correlationMiddleware";

/**
 * Middleware Express qui génère un Request ID unique pour chaque requête
 *
 * Fonctionnalités:
 * - Génère un UUID v4 unique pour chaque requête
 * - Utilise X-Request-ID du header si déjà présent (propagation entre services)
 * - Stocke dans req.id pour accès facile dans les contrôleurs
 * - Ajoute header X-Request-ID à la réponse pour le client
 * - Permet de tracer une requête de bout en bout dans les logs
 *
 * Utilisation:
 * ```typescript
 * import { requestIdMiddleware } from "./middlewares/requestId";
 * app.use(requestIdMiddleware);
 *
 * // Dans un contrôleur
 * const requestId = req.id;
 * logger.info("Action effectuée", { requestId });
 * ```
 *
 * @param req - Request Express
 * @param res - Response Express
 * @param next - Fonction next
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Récupérer le request ID depuis le header ou en générer un nouveau
  // Support des deux formats: X-Request-ID (standard) et X-Correlation-ID (legacy)
  const requestId =
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-correlation-id"] as string) ||
    randomUUID();

  // Attacher le request ID à la requête pour accès facile
  req.id = requestId;
  req.correlationId = requestId; // Rétrocompatibilité

  // Ajouter les headers de réponse
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", requestId); // Rétrocompatibilité

  // Créer le contexte initial de la requête pour AsyncLocalStorage
  const context: RequestContext = {
    correlationId: requestId,
  };

  // Exécuter le reste de la chaîne de middleware dans le contexte
  correlationStore.run(context, () => {
    next();
  });
}

/**
 * Récupère le Request ID actuel depuis la requête Express ou AsyncLocalStorage
 *
 * @param req - Request Express (optionnel)
 * @returns Le Request ID ou undefined
 *
 * @example
 * // Dans un contrôleur avec accès à req
 * const requestId = getRequestId(req);
 *
 * // Dans une fonction utilitaire sans accès à req
 * const requestId = getRequestId(); // Utilise AsyncLocalStorage
 */
export function getRequestId(req?: Request): string | undefined {
  // Si req est fourni, l'utiliser en priorité
  if (req?.id) {
    return req.id;
  }

  // Sinon, utiliser l'AsyncLocalStorage
  const context = correlationStore.getStore();
  return context?.correlationId;
}

/**
 * Alias pour la fonction getRequestId (pour cohérence avec les noms)
 */
export const getCurrentRequestId = getRequestId;

export default requestIdMiddleware;
