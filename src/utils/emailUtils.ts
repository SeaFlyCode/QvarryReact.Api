/**
 * Utilitaires email — source unique pour la validation de format.
 *
 * Phase H §5.x : centralisation de la regex email auparavant dupliquée dans
 * `emailUtils.ts`, `mobileAuthControllers.ts`, `loginController.ts`,
 * `unifiedAuthController.ts` (4 sites). Toute nouvelle validation doit
 * importer `EMAIL_REGEX` ou `isValidEmail` depuis ce module.
 *
 * Choix de regex : volontairement simple et pragmatique (1 `@`, présence d'un
 * TLD, pas d'espace). Une validation RFC-5322 complète est ingérable côté
 * client/UI, et la vraie vérification d'existence se fait ensuite via l'envoi
 * d'un code de confirmation par email.
 */

/**
 * Regex canonique pour valider le format d'une adresse email.
 *
 * Format accepté : `local@domain.tld` avec :
 *   - `local` : 1+ caractères non whitespace/non `@`
 *   - `domain` : 1+ caractères non whitespace/non `@`, contenant au moins un `.`
 *   - `tld` : 1+ caractères non whitespace/non `@` (la longueur ≥ 2 et autres
 *             contrôles plus stricts sont faits par `validateEmail` plus bas).
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vérifie si une adresse email respecte le format canonique.
 * Wrapper boolean autour de `EMAIL_REGEX.test(email)`.
 *
 * @param email - Chaîne à valider
 * @returns true si le format est valide, false sinon (y compris si null/undefined/non-string)
 */
export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_REGEX.test(email);
}

/**
 * Vérifie si une adresse email est valide, avec contrôles avancés
 * (TLD ≥ 2 caractères, blocage des domaines jetables).
 *
 * @param email L'adresse email à vérifier
 * @returns Un objet avec isValid (booléen) et message (string)
 */
export function validateEmail(email: string): {
  isValid: boolean;
  message: string;
} {
  // Vérifier le format de base de l'email avec la regex canonique
  if (!EMAIL_REGEX.test(email)) {
    return {
      isValid: false,
      message: "Format d'adresse email invalide.",
    };
  }

  // Vérifier que l'email contient un nom de domaine valide avec un TLD
  const parts = email.split("@");
  const domain = parts[1];

  // Vérifier le nom de domaine
  if (!domain.includes(".")) {
    return {
      isValid: false,
      message: "Le domaine de l'email est invalide.",
    };
  }

  // Vérifier la longueur du nom de domaine
  const domainParts = domain.split(".");
  if (domainParts[domainParts.length - 1].length < 2) {
    return {
      isValid: false,
      message: "L'extension du domaine est invalide.",
    };
  }

  // Vérifier les domaines jetables courants
  const disposableDomains = [
    "yopmail.com",
    "tempmail.com",
    "guerrillamail.com",
    "mailinator.com",
    "throwawaymail.com",
  ];

  if (disposableDomains.includes(domain.toLowerCase())) {
    return {
      isValid: false,
      message: "Les adresses email temporaires ne sont pas acceptées.",
    };
  }

  return { isValid: true, message: "Adresse email valide." };
}
