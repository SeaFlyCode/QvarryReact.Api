import { logger } from "../services/loggerService";

const cbLogger = logger.child({ service: "circuit-breaker" });

/**
 * États du circuit breaker
 */
export enum CircuitState {
  CLOSED = "CLOSED", // Tout va bien, requêtes passent normalement
  OPEN = "OPEN", // Trop d'erreurs, requêtes sont rejetées immédiatement
  HALF_OPEN = "HALF_OPEN", // Test si le service est revenu, quelques requêtes passent
}

/**
 * Configuration du circuit breaker
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Nombre d'échecs avant ouverture
  successThreshold: number; // Nombre de succès pour fermer depuis HALF_OPEN
  timeout: number; // Temps avant de passer en HALF_OPEN (ms)
  name: string; // Nom du circuit pour logging
}

/**
 * PATTERN: Circuit Breaker pour éviter les retry storms
 *
 * États :
 * - CLOSED : Normal, toutes les requêtes passent
 * - OPEN : Trop d'échecs, rejette immédiatement (fail fast)
 * - HALF_OPEN : Test si le service est revenu
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt = Date.now();
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    cbLogger.info("[Circuit Breaker] Initialized", {
      name: config.name,
      failureThreshold: config.failureThreshold,
      successThreshold: config.successThreshold,
      timeout: config.timeout,
    });
  }

  /**
   * Exécute une fonction avec protection circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        // Circuit ouvert, rejeter immédiatement
        const error = new Error(
          `Circuit breaker OPEN for ${this.config.name}. Retry after ${new Date(this.nextAttempt).toISOString()}`,
        );
        cbLogger.warn("[Circuit Breaker] Request rejected (OPEN)", {
          name: this.config.name,
          nextAttempt: new Date(this.nextAttempt).toISOString(),
        });
        throw error;
      } else {
        // Temps écoulé, passer en HALF_OPEN
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        cbLogger.info("[Circuit Breaker] Transitioning to HALF_OPEN", {
          name: this.config.name,
        });
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Appelé lors d'un succès
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      cbLogger.debug("[Circuit Breaker] Success in HALF_OPEN", {
        name: this.config.name,
        successCount: this.successCount,
        threshold: this.config.successThreshold,
      });

      if (this.successCount >= this.config.successThreshold) {
        // Assez de succès, fermer le circuit
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        cbLogger.info("[Circuit Breaker] Transitioning to CLOSED", {
          name: this.config.name,
        });
      }
    }
  }

  /**
   * Appelé lors d'un échec
   */
  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    cbLogger.warn("[Circuit Breaker] Failure recorded", {
      name: this.config.name,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      state: this.state,
    });

    if (
      this.failureCount >= this.config.failureThreshold ||
      this.state === CircuitState.HALF_OPEN
    ) {
      // Ouvrir le circuit
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.timeout;
      cbLogger.error("[Circuit Breaker] Transitioning to OPEN", {
        name: this.config.name,
        failureCount: this.failureCount,
        nextAttempt: new Date(this.nextAttempt).toISOString(),
      });
    }
  }

  /**
   * Retourne l'état actuel du circuit
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Retourne les statistiques du circuit
   */
  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt:
        this.state === CircuitState.OPEN
          ? new Date(this.nextAttempt).toISOString()
          : null,
    };
  }

  /**
   * Force le circuit à se fermer (pour tests ou admin)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    cbLogger.info("[Circuit Breaker] Manual reset to CLOSED", {
      name: this.config.name,
    });
  }
}

/**
 * Factory pour créer des circuit breakers configurés
 */
export class CircuitBreakerFactory {
  private static breakers = new Map<string, CircuitBreaker>();

  /**
   * Récupère ou crée un circuit breaker
   */
  static getOrCreate(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const defaultConfig: CircuitBreakerConfig = {
        name,
        failureThreshold: 5, // 5 échecs
        successThreshold: 2, // 2 succès pour refermer
        timeout: 60000, // 1 minute
        ...config,
      };
      this.breakers.set(name, new CircuitBreaker(defaultConfig));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Retourne les stats de tous les circuit breakers
   */
  static getAllStats() {
    const stats: Record<string, ReturnType<CircuitBreaker["getStats"]>> = {};
    Array.from(this.breakers.entries()).forEach(([name, breaker]) => {
      stats[name] = breaker.getStats();
    });
    return stats;
  }

  /**
   * Reset tous les circuit breakers (admin/tests)
   */
  static resetAll(): void {
    Array.from(this.breakers.values()).forEach((breaker) => {
      breaker.reset();
    });
  }
}
