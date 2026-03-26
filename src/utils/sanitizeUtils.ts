/**
 * Utilitaire de sanitization pour les données non typées (Schema.Types.Mixed)
 * MED-04 FIX: Protection contre l'injection NoSQL via opérateurs MongoDB
 * MED-007 FIX: Protection contre Prototype Pollution
 */

import { safeJsonParse } from "./secureJsonParser";

/**
 * Sanitise un objet en supprimant les clés commençant par $ (opérateurs MongoDB)
 * et en limitant la taille totale des données
 */
export function sanitizeMixed(data: any, maxSize: number = 10000): any {
  if (data === null || data === undefined) return data;

  const json = JSON.stringify(data);
  if (json.length > maxSize) {
    throw new Error(`Data too large: ${json.length} > ${maxSize}`);
  }

  // Parse avec protection Prototype Pollution
  const parsed = safeJsonParse(json, {
    context: "sanitize-mixed",
    maxDepth: 10,
  });

  // Appliquer le reviver manuellement pour supprimer les opérateurs MongoDB
  function removeMongoOperators(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map(removeMongoOperators);
    }

    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !key.startsWith("$")) {
        result[key] = removeMongoOperators(obj[key]);
      }
    }
    return result;
  }

  return removeMongoOperators(parsed);
}
