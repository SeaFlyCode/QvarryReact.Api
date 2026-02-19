import bcrypt from "bcrypt";

/**
 * Vérifie si un mot de passe est suffisamment robuste
 * @param password Le mot de passe à vérifier
 * @returns Un objet avec isValid (booléen) et message (string)
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  message: string;
} {
  // Vérifier la longueur minimale
  if (password.length < 12) {
    return {
      isValid: false,
      message: "Le mot de passe doit contenir au moins 12 caractères.",
    };
  }

  // Vérifier la présence d'au moins une lettre majuscule
  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      message: "Le mot de passe doit contenir au moins une lettre majuscule.",
    };
  }

  // Vérifier la présence d'au moins une lettre minuscule
  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      message: "Le mot de passe doit contenir au moins une lettre minuscule.",
    };
  }

  // Vérifier la présence d'au moins un chiffre
  if (!/\d/.test(password)) {
    return {
      isValid: false,
      message: "Le mot de passe doit contenir au moins un chiffre.",
    };
  }

  // Vérifier la présence d'au moins un caractère spécial
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return {
      isValid: false,
      message: "Le mot de passe doit contenir au moins un caractère spécial.",
    };
  }

  return { isValid: true, message: "Mot de passe valide." };
}

// ═══════════════════════════════════════════════════════════════════════════
// REM-006: HISTORIQUE DES MOTS DE PASSE
// ═══════════════════════════════════════════════════════════════════════════
// Bloquer la réutilisation des 5 derniers mots de passe

const PASSWORD_HISTORY_SIZE = 5;

/**
 * Vérifie si le nouveau mot de passe est dans l'historique des anciens mots de passe
 * @param newPassword Le nouveau mot de passe en clair
 * @param passwordHistory Tableau des anciens mots de passe hashés
 * @returns true si le mot de passe est dans l'historique (interdit), false sinon
 */
export async function isPasswordInHistory(
  newPassword: string,
  passwordHistory: string[],
): Promise<boolean> {
  if (!passwordHistory || passwordHistory.length === 0) {
    return false;
  }

  // Vérifier contre chaque ancien mot de passe hashé
  for (const oldPasswordHash of passwordHistory) {
    const match = await bcrypt.compare(newPassword, oldPasswordHash);
    if (match) {
      return true;
    }
  }

  return false;
}

/**
 * Ajoute le mot de passe actuel à l'historique et maintient la limite de 5
 * @param currentPasswordHash Le hash du mot de passe actuel
 * @param passwordHistory L'historique existant
 * @returns Le nouvel historique (max 5 entrées)
 */
export function addToPasswordHistory(
  currentPasswordHash: string,
  passwordHistory: string[] = [],
): string[] {
  const newHistory = [currentPasswordHash, ...passwordHistory];
  // Garder seulement les 5 derniers
  return newHistory.slice(0, PASSWORD_HISTORY_SIZE);
}
