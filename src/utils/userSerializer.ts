// ═══════════════════════════════════════════════════════════════════════════
// SERIALIZER UTILISATEUR POUR LES RÉPONSES API
// ═══════════════════════════════════════════════════════════════════════════
// Always serialize via serializeUserForApi before returning user data
//
// Garantit qu'aucune donnée chiffrée (name, surname, email, ip_*) ne fuite vers
// le client. Tolère les documents Mongoose (avec .toObject()) ET les objets
// .lean(). Ignore silencieusement les valeurs déjà déchiffrées (rétrocompat).
//
// Champs sensibles automatiquement supprimés :
//   - password / password_history
//   - reset_password_token / reset_password_expires
//   - email_verification_*
//   - two_factor_secret / two_factor_recovery_codes
//   - emailHash (hash interne, pas pour le client)
// ═══════════════════════════════════════════════════════════════════════════

import { decrypt } from "./masterEncryptionUtils";

const SENSITIVE_FIELDS = [
  "password",
  "password_history",
  "reset_password_token",
  "reset_password_expires",
  "email_verification_token",
  "email_verification_code",
  "email_verification_expires",
  "two_factor_secret",
  "two_factor_recovery_codes",
  "emailHash",
] as const;

const ENCRYPTED_FIELDS = [
  "name",
  "surname",
  "pseudo",
  "email",
  "ip_creation",
  "ip_last_connection",
] as const;

export interface ApiUser {
  _id: string;
  name: string;
  surname?: string;
  pseudo?: string;
  email?: string;
  showPseudo?: boolean;
  contact_code?: number;
  is_admin?: boolean;
  is_verified?: boolean;
  is_admin_validated?: boolean;
  creation_date?: Date | string;
  last_connection?: Date | string;
  [key: string]: any;
}

/**
 * Tente de déchiffrer une valeur. Si la valeur n'est pas du format chiffré
 * attendu (iv:authTag:encrypted), retourne la valeur d'origine (utile quand
 * l'objet a déjà été déchiffré en amont par un controller existant).
 */
function safeDecrypt(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "") {
    return "";
  }
  // Format AES-256-GCM : 3 segments séparés par ':'.
  if (value.split(":").length !== 3) {
    return value;
  }
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

/**
 * Convertit n'importe quelle représentation utilisateur (IUser doc, lean
 * object, plain object) en objet API-safe avec champs déchiffrés.
 */
export function serializeUserForApi(user: any): ApiUser {
  if (!user) {
    return { _id: "", name: "" };
  }

  // Normaliser : doc Mongoose → plain object
  const raw =
    typeof user.toObject === "function" ? user.toObject() : { ...user };

  // Filtrer les champs sensibles
  for (const field of SENSITIVE_FIELDS) {
    delete raw[field];
  }

  // Déchiffrer les champs chiffrés (idempotent grâce à safeDecrypt)
  for (const field of ENCRYPTED_FIELDS) {
    if (raw[field] !== undefined) {
      const decrypted = safeDecrypt(raw[field]);
      if (decrypted === undefined) {
        delete raw[field];
      } else {
        raw[field] = decrypted;
      }
    }
  }

  // Normaliser _id en string
  if (raw._id && typeof raw._id !== "string") {
    raw._id = raw._id.toString();
  }

  // Garantir le contrat ApiUser
  if (typeof raw.name !== "string") {
    raw.name = "";
  }

  return raw as ApiUser;
}

/**
 * Variante batch pour mapper une liste d'utilisateurs.
 */
export function serializeUsersForApi(users: any[]): ApiUser[] {
  return users.map((u) => serializeUserForApi(u));
}
