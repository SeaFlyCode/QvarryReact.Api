// src/utils/performanceLogger.ts
// Utilitaire pour mesurer et logger les performances des opérations

import { logger } from "../services/loggerService";
import { getRequestId } from "../middlewares/requestId";

/**
 * Seuils de performance par défaut (en millisecondes)
 */
export const PERFORMANCE_THRESHOLDS = {
  /** Seuil pour une opération rapide (vert) */
  FAST: 100,
  /** Seuil pour une opération normale (jaune) */
  NORMAL: 500,
  /** Seuil pour une opération lente (orange) - déclenche un warning */
  SLOW: 1000,
  /** Seuil pour une opération très lente (rouge) - déclenche une alerte */
  CRITICAL: 3000,
} as const;

/**
 * Résultat d'une opération avec mesure de performance
 */
export interface PerformanceResult<T> {
  /** Résultat de l'opération */
  result: T;
  /** Durée d'exécution en millisecondes */
  duration: number;
  /** Niveau de performance: 'fast' | 'normal' | 'slow' | 'critical' */
  performanceLevel: "fast" | "normal" | "slow" | "critical";
}

/**
 * Options pour le logger de performance
 */
export interface PerformanceLogOptions {
  /** Seuil personnalisé pour considérer l'opération comme lente (en ms) */
  slowThreshold?: number;
  /** Seuil personnalisé pour considérer l'opération comme critique (en ms) */
  criticalThreshold?: number;
  /** Contexte additionnel à inclure dans les logs */
  context?: Record<string, any>;
  /** Ne logger que si l'opération dépasse le slowThreshold */
  logOnlyIfSlow?: boolean;
  /** Niveau de log pour les opérations normales ('debug' | 'info') */
  normalLogLevel?: "debug" | "info";
}

/**
 * Détermine le niveau de performance en fonction de la durée
 */
function getPerformanceLevel(
  duration: number,
  slowThreshold: number,
  criticalThreshold: number,
): "fast" | "normal" | "slow" | "critical" {
  if (duration >= criticalThreshold) return "critical";
  if (duration >= slowThreshold) return "slow";
  if (duration >= PERFORMANCE_THRESHOLDS.NORMAL) return "normal";
  return "fast";
}

/**
 * Mesure le temps d'exécution d'une fonction et log les performances
 *
 * Cette fonction wraps une fonction synchrone ou asynchrone et mesure
 * son temps d'exécution. Si le temps dépasse le seuil configuré,
 * un warning ou une erreur est loggé.
 *
 * @param operation - Nom de l'opération (pour les logs)
 * @param fn - Fonction à exécuter (synchrone ou asynchrone)
 * @param options - Options de configuration
 * @returns Résultat avec durée d'exécution
 *
 * @example
 * // Opération synchrone
 * const { result, duration } = await logPerformance(
 *   "calculateComplexValue",
 *   () => complexCalculation(),
 *   { slowThreshold: 500 }
 * );
 *
 * @example
 * // Opération asynchrone
 * const { result, duration } = await logPerformance(
 *   "fetchUserData",
 *   async () => await User.findById(userId),
 *   {
 *     slowThreshold: 1000,
 *     context: { userId }
 *   }
 * );
 *
 * @example
 * // Logger uniquement si lent
 * const { result } = await logPerformance(
 *   "backgroundTask",
 *   async () => await processData(),
 *   {
 *     logOnlyIfSlow: true,
 *     slowThreshold: 2000
 *   }
 * );
 */
export async function logPerformance<T>(
  operation: string,
  fn: () => T | Promise<T>,
  options: PerformanceLogOptions = {},
): Promise<PerformanceResult<T>> {
  const {
    slowThreshold = PERFORMANCE_THRESHOLDS.SLOW,
    criticalThreshold = PERFORMANCE_THRESHOLDS.CRITICAL,
    context = {},
    logOnlyIfSlow = false,
    normalLogLevel = "debug",
  } = options;

  // Récupérer le requestId si disponible
  const requestId = getRequestId();

  // Mesurer le temps de début
  const startTime = performance.now();
  const startDate = new Date();

  let result: T;
  let error: Error | undefined;

  try {
    // Exécuter la fonction (sync ou async)
    result = await Promise.resolve(fn());
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err; // Re-throw pour ne pas changer le comportement
  } finally {
    // Mesurer le temps de fin
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    // Déterminer le niveau de performance
    const performanceLevel = getPerformanceLevel(
      duration,
      slowThreshold,
      criticalThreshold,
    );

    // Préparer les métadonnées de log
    const logMeta = {
      operation,
      duration: `${duration}ms`,
      durationMs: duration,
      performanceLevel,
      timestamp: startDate.toISOString(),
      ...(requestId && { requestId }),
      ...context,
    };

    // Logger selon le niveau de performance
    if (error) {
      // En cas d'erreur, toujours logger
      logger.error(`[PERF] ${operation} - FAILED`, {
        ...logMeta,
        error: error.message,
      });
    } else if (!logOnlyIfSlow || duration >= slowThreshold) {
      // Logger si demandé OU si l'opération est lente
      if (performanceLevel === "critical") {
        logger.error(`[PERF] ${operation} - CRITICAL SLOW`, logMeta);
      } else if (performanceLevel === "slow") {
        logger.warn(`[PERF] ${operation} - SLOW`, logMeta);
      } else if (performanceLevel === "normal") {
        logger[normalLogLevel](`[PERF] ${operation} - OK`, logMeta);
      } else {
        logger[normalLogLevel](`[PERF] ${operation} - FAST`, logMeta);
      }
    }
  }

  return {
    result: result!,
    duration: Math.round(performance.now() - startTime),
    performanceLevel: getPerformanceLevel(
      Math.round(performance.now() - startTime),
      slowThreshold,
      criticalThreshold,
    ),
  };
}

/**
 * Décorateur pour mesurer automatiquement les performances d'une méthode
 *
 * @param operation - Nom de l'opération (optionnel, utilise le nom de la méthode par défaut)
 * @param options - Options de configuration
 *
 * @example
 * class UserService {
 *   @measurePerformance("findUser", { slowThreshold: 500 })
 *   async findById(userId: string) {
 *     return await User.findById(userId);
 *   }
 * }
 */
export function measurePerformance(
  operation?: string,
  options?: PerformanceLogOptions,
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const operationName =
      operation || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const { result } = await logPerformance(
        operationName,
        () => originalMethod.apply(this, args),
        options,
      );
      return result;
    };

    return descriptor;
  };
}

/**
 * Mesure le temps d'exécution d'une fonction de manière simple
 * sans logging automatique (pour usage manuel)
 *
 * @param fn - Fonction à exécuter
 * @returns Résultat avec durée d'exécution
 *
 * @example
 * const { result, duration } = await measureTime(async () => {
 *   return await heavyOperation();
 * });
 * console.log(`Operation took ${duration}ms`);
 */
export async function measureTime<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; duration: number }> {
  const startTime = performance.now();
  const result = await Promise.resolve(fn());
  const duration = Math.round(performance.now() - startTime);

  return { result, duration };
}

/**
 * Crée un timer pour mesurer des opérations manuellement
 *
 * @param operation - Nom de l'opération
 * @returns Objet avec méthode stop() pour arrêter le timer
 *
 * @example
 * const timer = startTimer("complexOperation");
 * // ... opération longue ...
 * const duration = timer.stop(); // Retourne la durée ET log automatiquement
 */
export function startTimer(operation: string, context?: Record<string, any>) {
  const startTime = performance.now();
  const requestId = getRequestId();

  return {
    /**
     * Arrête le timer et log la durée
     * @returns Durée en millisecondes
     */
    stop: (additionalContext?: Record<string, any>): number => {
      const duration = Math.round(performance.now() - startTime);
      const performanceLevel = getPerformanceLevel(
        duration,
        PERFORMANCE_THRESHOLDS.SLOW,
        PERFORMANCE_THRESHOLDS.CRITICAL,
      );

      const logMeta = {
        operation,
        duration: `${duration}ms`,
        durationMs: duration,
        performanceLevel,
        ...(requestId && { requestId }),
        ...context,
        ...additionalContext,
      };

      // Logger selon le niveau
      if (performanceLevel === "critical") {
        logger.error(`[PERF] ${operation} - CRITICAL SLOW`, logMeta);
      } else if (performanceLevel === "slow") {
        logger.warn(`[PERF] ${operation} - SLOW`, logMeta);
      } else {
        logger.debug(`[PERF] ${operation} - OK`, logMeta);
      }

      return duration;
    },
  };
}

export default {
  logPerformance,
  measurePerformance,
  measureTime,
  startTimer,
  PERFORMANCE_THRESHOLDS,
};
