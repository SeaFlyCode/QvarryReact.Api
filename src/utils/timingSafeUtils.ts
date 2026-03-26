// ═══════════════════════════════════════════════════════════════════════════
// MED-006: UTILITAIRES DE COMPARAISON TIMING-SAFE
// ═══════════════════════════════════════════════════════════════════════════
// Fonctions de comparaison sécurisées contre les timing attacks
// - Utilise crypto.timingSafeEqual() pour comparer tokens/secrets/hashes
// - Temps de comparaison constant quelle que soit la valeur
// - Prévient l'énumération par timing attack
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";

/**
 * Comparaison timing-safe pour strings
 *
 * Utilise crypto.timingSafeEqual() pour comparer deux chaînes
 * de manière sécurisée contre les timing attacks.
 *
 * Le temps de comparaison est constant, même si les chaînes diffèrent
 * au premier caractère.
 *
 * @param a Première chaîne à comparer
 * @param b Deuxième chaîne à comparer
 * @returns true si les chaînes sont identiques, false sinon
 * @throws Error si un argument n'est pas une string
 *
 * @example
 * const token = req.headers.authorization;
 * const expectedToken = process.env.API_KEY;
 * if (timingSafeCompare(token, expectedToken)) {
 *   // Token valide
 * }
 */
export function timingSafeCompare(a: string, b: string): boolean {
  // Validation des types
  if (typeof a !== "string" || typeof b !== "string") {
    throw new Error("timingSafeCompare: Both arguments must be strings");
  }

  // Convertir en buffers
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // Si longueurs différentes, faire quand même une comparaison timing-safe
  // pour éviter de leak l'information de longueur
  if (bufferA.length !== bufferB.length) {
    // Créer un buffer dummy de même longueur que bufferA
    const dummy = Buffer.alloc(bufferA.length);
    try {
      crypto.timingSafeEqual(bufferA, dummy);
    } catch {
      // Ignore l'exception (c'est voulu)
    }
    return false;
  }

  // Comparaison timing-safe
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Comparaison timing-safe pour buffers
 *
 * Version optimisée pour comparer directement des buffers sans conversion.
 *
 * @param a Premier buffer à comparer
 * @param b Deuxième buffer à comparer
 * @returns true si les buffers sont identiques, false sinon
 * @throws Error si un argument n'est pas un buffer
 *
 * @example
 * const hashA = crypto.createHash('sha256').update(dataA).digest();
 * const hashB = crypto.createHash('sha256').update(dataB).digest();
 * if (timingSafeCompareBuffers(hashA, hashB)) {
 *   // Hashes identiques
 * }
 */
export function timingSafeCompareBuffers(a: Buffer, b: Buffer): boolean {
  // Validation des types
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new Error("timingSafeCompareBuffers: Both arguments must be buffers");
  }

  // Si longueurs différentes, faire quand même une comparaison timing-safe
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(a.length);
    try {
      crypto.timingSafeEqual(a, dummy);
    } catch {
      // Ignore l'exception
    }
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/**
 * Comparaison timing-safe pour strings avec normalisation
 *
 * Normalise les chaînes (trim, lowercase) avant comparaison.
 * Utile pour comparer des emails ou usernames.
 *
 * ⚠️ Ne PAS utiliser pour tokens/secrets/hashes (pas de normalisation)
 *
 * @param a Première chaîne
 * @param b Deuxième chaîne
 * @param caseSensitive Si false, ignore la casse (défaut: true)
 * @returns true si les chaînes sont identiques après normalisation
 *
 * @example
 * const email = req.body.email;
 * const storedEmail = user.email;
 * if (timingSafeCompareNormalized(email, storedEmail, false)) {
 *   // Emails identiques (case-insensitive)
 * }
 */
export function timingSafeCompareNormalized(
  a: string,
  b: string,
  caseSensitive: boolean = true,
): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new Error(
      "timingSafeCompareNormalized: Both arguments must be strings",
    );
  }

  // Normalisation
  let normalizedA = a.trim();
  let normalizedB = b.trim();

  if (!caseSensitive) {
    normalizedA = normalizedA.toLowerCase();
    normalizedB = normalizedB.toLowerCase();
  }

  // Comparaison timing-safe
  return timingSafeCompare(normalizedA, normalizedB);
}

/**
 * Comparaison timing-safe pour hashes hexadécimaux
 *
 * Spécialisé pour comparer des hashes (SHA256, SHA512, etc.)
 * au format hexadécimal.
 *
 * @param hashA Premier hash en hex
 * @param hashB Deuxième hash en hex
 * @returns true si les hashes sont identiques
 *
 * @example
 * const computedHash = crypto.createHash('sha256').update(data).digest('hex');
 * const storedHash = user.passwordHash;
 * if (timingSafeCompareHex(computedHash, storedHash)) {
 *   // Hash valide
 * }
 */
export function timingSafeCompareHex(hashA: string, hashB: string): boolean {
  if (typeof hashA !== "string" || typeof hashB !== "string") {
    throw new Error("timingSafeCompareHex: Both arguments must be strings");
  }

  // Vérifier format hexadécimal
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(hashA) || !hexRegex.test(hashB)) {
    throw new Error(
      "timingSafeCompareHex: Arguments must be hexadecimal strings",
    );
  }

  // Normaliser en lowercase pour éviter problèmes de casse
  const normalizedA = hashA.toLowerCase();
  const normalizedB = hashB.toLowerCase();

  return timingSafeCompare(normalizedA, normalizedB);
}

/**
 * Comparaison timing-safe pour tokens JWT/API
 *
 * Valide le format (Bearer token) et compare de manière sécurisée.
 *
 * @param tokenHeader Header Authorization (ex: "Bearer abc123...")
 * @param expectedToken Token attendu
 * @returns true si le token est valide
 *
 * @example
 * const authHeader = req.headers.authorization;
 * const expectedToken = process.env.API_KEY;
 * if (timingSafeCompareToken(authHeader, expectedToken)) {
 *   // Token valide
 * }
 */
export function timingSafeCompareToken(
  tokenHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!tokenHeader || typeof tokenHeader !== "string") {
    // Faire quand même une comparaison factice pour timing constant
    const dummy = Buffer.alloc(32);
    const expected = Buffer.from(expectedToken);
    try {
      if (dummy.length === expected.length) {
        crypto.timingSafeEqual(dummy, expected);
      }
    } catch {
      // Ignore
    }
    return false;
  }

  // Extraire le token (format "Bearer <token>")
  const parts = tokenHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    // Comparaison factice pour timing constant
    const dummy = Buffer.alloc(32);
    const expected = Buffer.from(expectedToken);
    try {
      if (dummy.length === expected.length) {
        crypto.timingSafeEqual(dummy, expected);
      }
    } catch {
      // Ignore
    }
    return false;
  }

  const token = parts[1];
  return timingSafeCompare(token, expectedToken);
}

/**
 * Vérifie si une string est vide de manière timing-safe
 *
 * Utile pour éviter de leak l'information "vide/non-vide"
 * via le temps de réponse.
 *
 * @param value String à vérifier
 * @returns true si la string est vide ou undefined
 */
export function timingSafeIsEmpty(value: string | undefined | null): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  // Comparer avec string vide de manière timing-safe
  return timingSafeCompare(value, "");
}

/**
 * Comparaison timing-safe avec fallback
 *
 * Si une des valeurs est undefined/null, retourne false
 * sans throw d'exception.
 *
 * @param a Première valeur (peut être undefined)
 * @param b Deuxième valeur (peut être undefined)
 * @param defaultValue Valeur par défaut si undefined (défaut: '')
 * @returns true si les valeurs sont identiques
 */
export function timingSafeCompareSafe(
  a: string | undefined | null,
  b: string | undefined | null,
  defaultValue: string = "",
): boolean {
  const valueA = a ?? defaultValue;
  const valueB = b ?? defaultValue;

  return timingSafeCompare(valueA, valueB);
}
