/**
 * Secure JSON Parser - Protection contre Prototype Pollution (MED-007)
 *
 * Ce module fournit des fonctions sécurisées pour parser du JSON
 * en bloquant les tentatives de Prototype Pollution via __proto__, constructor, prototype.
 *
 * @module secureJsonParser
 * @security MED-007
 */

import secureJsonParse from "secure-json-parse";
import { logger } from "../services/loggerService";

/**
 * Erreur custom pour les tentatives de Prototype Pollution
 */
export class PrototypePollutionError extends Error {
  constructor(
    message: string,
    public readonly suspiciousKeys: string[] = [],
  ) {
    super(message);
    this.name = "PrototypePollutionError";
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Options de configuration pour safeJsonParse
 */
export interface SecureJsonParseOptions {
  /** Profondeur maximale autorisée pour les objets imbriqués (défaut: 10) */
  maxDepth?: number;

  /** Active le logging des tentatives d'attaque (défaut: true) */
  logAttacks?: boolean;

  /** Mode strict : rejette aussi les clés sensibles même en valeur (défaut: false) */
  strictMode?: boolean;

  /** Contexte de l'opération pour logging (ex: "login", "webhook", "redis") */
  context?: string;
}

/**
 * Patterns de clés dangereuses pour Prototype Pollution
 */
const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

/**
 * Regex pour détecter les clés dangereuses dans le JSON brut
 * Note: Détecte seulement __proto__ et constructor en regex (rapide)
 * "prototype" est plus commun légitimement, on le vérifiera après parsing
 */
const DANGEROUS_KEYS_REGEX = /"(__proto__|constructor)"\s*:/gi;

/**
 * Valide la profondeur d'un objet de manière récursive
 *
 * @param obj - Objet à valider
 * @param maxDepth - Profondeur maximale autorisée
 * @param currentDepth - Profondeur actuelle (usage interne)
 * @returns true si valide, false sinon
 */
function validateDepth(
  obj: any,
  maxDepth: number,
  currentDepth: number = 0,
): boolean {
  if (currentDepth > maxDepth) {
    return false;
  }

  if (obj === null || typeof obj !== "object") {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.every((item) => validateDepth(item, maxDepth, currentDepth + 1));
  }

  return Object.values(obj).every((value) =>
    validateDepth(value, maxDepth, currentDepth + 1),
  );
}

/**
 * Recherche récursivement des clés dangereuses dans un objet
 *
 * @param obj - Objet à analyser
 * @param path - Chemin actuel (usage interne)
 * @returns Liste des chemins vers les clés dangereuses
 */
function findDangerousKeys(obj: any, path: string = ""): string[] {
  const found: string[] = [];

  if (obj === null || typeof obj !== "object") {
    return found;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      found.push(...findDangerousKeys(item, `${path}[${index}]`));
    });
    return found;
  }

  for (const key of Object.keys(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Vérifier si la clé elle-même est dangereuse
    if (DANGEROUS_KEYS.includes(key.toLowerCase())) {
      found.push(currentPath);
    }

    // Vérifier récursivement les valeurs
    found.push(...findDangerousKeys(obj[key], currentPath));
  }

  return found;
}

/**
 * Parse de manière sécurisée une chaîne JSON en bloquant Prototype Pollution
 *
 * @template T - Type attendu du résultat
 * @param text - Chaîne JSON à parser
 * @param options - Options de configuration
 * @returns Objet parsé de type T
 * @throws {PrototypePollutionError} Si tentative de pollution détectée
 * @throws {SyntaxError} Si JSON invalide
 *
 * @example
 * ```typescript
 * // Usage normal
 * const data = safeJsonParse<User>('{"name":"John","email":"john@example.com"}');
 *
 * // Avec options
 * const data = safeJsonParse(jsonString, {
 *   maxDepth: 5,
 *   context: 'login',
 *   logAttacks: true
 * });
 *
 * // Tentative d'attaque (lève PrototypePollutionError)
 * const malicious = safeJsonParse('{"__proto__":{"isAdmin":true}}');
 * ```
 */
export function safeJsonParse<T = any>(
  text: string,
  options: SecureJsonParseOptions = {},
): T {
  const {
    maxDepth = 10,
    logAttacks = true,
    strictMode = false,
    context = "unknown",
  } = options;

  // Validation input
  if (typeof text !== "string") {
    throw new TypeError("Input must be a string");
  }

  if (text.trim() === "") {
    throw new SyntaxError("Empty JSON string");
  }

  // Détection préventive dans le JSON brut (plus rapide)
  const rawMatches = text.match(DANGEROUS_KEYS_REGEX);
  if (rawMatches) {
    const suspiciousKeys = rawMatches.map((match) =>
      match.replace(/["\s:]/g, ""),
    );

    if (logAttacks) {
      logger.warn("[SECURITY] Tentative de Prototype Pollution détectée", {
        context,
        suspiciousKeys,
        jsonPreview: text.substring(0, 200),
        timestamp: new Date().toISOString(),
      });
    }

    throw new PrototypePollutionError(
      `Prototype Pollution détecté : clés dangereuses trouvées (${suspiciousKeys.join(", ")})`,
      suspiciousKeys,
    );
  }

  // Parse avec secure-json-parse (protection supplémentaire)
  let parsed: any;
  try {
    parsed = secureJsonParse.parse(text);
  } catch (error) {
    // Vérifier si c'est une erreur de prototype pollution de secure-json-parse
    if (error instanceof Error && error.message.includes("proto")) {
      if (logAttacks) {
        logger.warn(
          "[SECURITY] secure-json-parse a bloqué une tentative de pollution",
          {
            context,
            error: error.message,
          },
        );
      }
      throw new PrototypePollutionError(
        "Prototype Pollution bloqué par secure-json-parse",
        ["__proto__"],
      );
    }
    // Autres erreurs de parsing (JSON invalide)
    throw error;
  }

  // Validation de la profondeur
  if (!validateDepth(parsed, maxDepth)) {
    if (logAttacks) {
      logger.warn("[SECURITY] Profondeur maximale dépassée", {
        context,
        maxDepth,
        jsonPreview: text.substring(0, 200),
      });
    }
    throw new PrototypePollutionError(
      `Profondeur maximale dépassée (max: ${maxDepth})`,
      ["maxDepth"],
    );
  }

  // Recherche de clés dangereuses dans l'objet parsé (toujours activé, pas seulement strictMode)
  const dangerousKeys = findDangerousKeys(parsed);
  if (dangerousKeys.length > 0) {
    if (logAttacks) {
      logger.warn("[SECURITY] Clés dangereuses trouvées dans objet parsé", {
        context,
        dangerousKeys,
        jsonPreview: text.substring(0, 200),
      });
    }
    throw new PrototypePollutionError(
      `Clés dangereuses détectées : ${dangerousKeys.join(", ")}`,
      dangerousKeys,
    );
  }

  return parsed as T;
}

/**
 * Stringify sécurisé avec protection contre les cycles infinis
 *
 * @param value - Valeur à convertir en JSON
 * @param space - Indentation (optionnel)
 * @returns Chaîne JSON
 * @throws {TypeError} Si cycles infinis détectés
 *
 * @example
 * ```typescript
 * const json = safeJsonStringify({ name: "John", age: 30 });
 * const jsonPretty = safeJsonStringify(data, 2); // Indenté
 * ```
 */
export function safeJsonStringify(value: any, space?: number | string): string {
  const seen = new WeakSet();

  return JSON.stringify(
    value,
    (key, val) => {
      // Bloquer les clés dangereuses à la stringify
      if (DANGEROUS_KEYS.includes(key.toLowerCase())) {
        return undefined; // Exclure cette propriété
      }

      // Détection cycles infinis
      if (val !== null && typeof val === "object") {
        if (seen.has(val)) {
          return "[Circular Reference]";
        }
        seen.add(val);
      }

      return val;
    },
    space,
  );
}

/**
 * Middleware Express pour sécuriser le body parsing JSON
 *
 * Remplace le body parser standard par une version sécurisée.
 * À utiliser avant les routes qui acceptent du JSON.
 *
 * @param options - Options de configuration
 * @returns Middleware Express
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { secureJsonBodyParser } from './utils/secureJsonParser';
 *
 * const app = express();
 *
 * // Remplace express.json()
 * app.use(secureJsonBodyParser({ maxDepth: 8, context: 'api' }));
 * ```
 */
export function secureJsonBodyParser(options: SecureJsonParseOptions = {}) {
  return (req: any, res: any, next: any) => {
    if (req.headers["content-type"]?.includes("application/json")) {
      let body = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          req.body = safeJsonParse(body, {
            ...options,
            context: options.context || `${req.method} ${req.path}`,
          });
          next();
        } catch (error) {
          if (error instanceof PrototypePollutionError) {
            res.status(400).json({
              error: "Bad Request",
              message: "Requête rejetée pour raisons de sécurité",
              code: "PROTOTYPE_POLLUTION_DETECTED",
            });
          } else {
            res.status(400).json({
              error: "Bad Request",
              message: "JSON invalide",
              code: "INVALID_JSON",
            });
          }
        }
      });

      req.on("error", (error: Error) => {
        res.status(500).json({
          error: "Internal Server Error",
          message: "Erreur lors du parsing du body",
        });
      });
    } else {
      next();
    }
  };
}

/**
 * Utilitaire pour vérifier si une chaîne contient des patterns suspects
 * (sans parser le JSON)
 *
 * @param text - Chaîne à vérifier
 * @returns true si suspect, false sinon
 *
 * @example
 * ```typescript
 * if (containsSuspiciousPatterns(jsonString)) {
 *   logger.warn('JSON suspect détecté avant parsing');
 * }
 * ```
 */
export function containsSuspiciousPatterns(text: string): boolean {
  // Créer nouvelle regex à chaque appel pour éviter problème avec flag 'g'
  return /"(__proto__|constructor)"\s*:/i.test(text);
}

// Export par défaut
export default {
  safeJsonParse,
  safeJsonStringify,
  secureJsonBodyParser,
  containsSuspiciousPatterns,
  PrototypePollutionError,
};
