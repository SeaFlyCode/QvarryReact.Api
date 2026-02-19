/**
 * Utilitaires pour la gestion des erreurs de manière type-safe
 */

/**
 * Extrait le message d'erreur d'une erreur inconnue
 * @param error - L'erreur capturée (de type unknown)
 * @param defaultMessage - Message par défaut si l'erreur n'a pas de message
 * @returns Le message d'erreur
 */
export function getErrorMessage(
  error: unknown,
  defaultMessage = "Une erreur est survenue",
): string {
  // En production, masquer les détails internes et toujours logger l'erreur complète
  const isProduction = process.env.NODE_ENV === "production";

  // Logger l'erreur complète dans tous les cas pour le debugging
  if (isProduction) {
    console.error("[ERROR] Erreur interne masquée pour le client:", error);
  }

  // En production, retourner un message générique
  if (isProduction) {
    return "Une erreur interne est survenue";
  }

  // En développement, exposer les détails pour le debugging
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return defaultMessage;
}

/**
 * Vérifie si l'erreur est une erreur avec un nom spécifique (ex: TokenExpiredError)
 * @param error - L'erreur capturée
 * @param name - Le nom de l'erreur à vérifier
 * @returns true si l'erreur a ce nom
 */
export function isErrorWithName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}
