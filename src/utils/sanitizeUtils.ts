/**
 * Utilitaire de sanitization pour les données non typées (Schema.Types.Mixed)
 * MED-04 FIX: Protection contre l'injection NoSQL via opérateurs MongoDB
 */

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

  return JSON.parse(json, (key, value) => {
    if (typeof key === "string" && key.startsWith("$")) {
      return undefined; // Supprime les opérateurs MongoDB
    }
    return value;
  });
}
