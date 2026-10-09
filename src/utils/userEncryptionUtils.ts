import crypto from "crypto";
import dotenv from "dotenv";
import { decrypt } from "./masterEncryptionUtils";
import KeysModel from "../models/keys";
import { IUser } from "../models/users";

// Importer dotenv pour charger les variables d'environnement
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION AES-256-GCM (AEAD - Authenticated Encryption)
// ═══════════════════════════════════════════════════════════════════════════
// Migration de AES-256-CBC vers AES-256-GCM pour une sécurité renforcée
// - Authentification intégrée (détection de modification)
// - Protection contre les attaques par manipulation
// - Cohérence avec masterEncryptionUtils.ts
// ═══════════════════════════════════════════════════════════════════════════

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits (recommandé pour GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits

// ═══════════════════════════════════════════════════════════════════════════
// CACHE DES CLÉS AVEC TTL (SÉCURITÉ RENFORCÉE)
// ═══════════════════════════════════════════════════════════════════════════
// Les clés déchiffrées sont stockées temporairement avec un TTL de 15 minutes
// pour éviter une exposition prolongée en mémoire (CRYPT-009)
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CachedKey {
  key: string;
  expiresAt: number;
}

const userKeysCache = new Map<string, CachedKey>();

// Nettoyage automatique des clés expirées toutes les 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [userId, cached] of userKeysCache.entries()) {
      if (now >= cached.expiresAt) {
        userKeysCache.delete(userId);
      }
    }
  },
  5 * 60 * 1000,
);

// Fonction pour récupérer la clé utilisateur (avec cache TTL)
async function getUserKey(userId: IUser["_id"]): Promise<string> {
  const userIdStr = (userId as any).toString();
  const now = Date.now();

  // Vérifier le cache d'abord (avec validation TTL)
  const cached = userKeysCache.get(userIdStr);
  if (cached && now < cached.expiresAt) {
    return cached.key;
  }

  // Supprimer l'entrée expirée si elle existe
  if (cached) {
    userKeysCache.delete(userIdStr);
  }

  // Si pas en cache, récupérer de la DB
  // IMPORTANT: Spécifier type: "user" pour récupérer la clé AES et non la clé RSA
  const userKeysCrypted = await KeysModel.findOne({
    userId: userId,
    type: "user", // Clé AES pour le chiffrement des données
  });

  if (!userKeysCrypted) {
    throw new Error(
      `Clé AES de chiffrement non trouvée pour l'utilisateur ${userIdStr}`,
    );
  }

  // Vérifier que ce n'est pas une clé RSA (sécurité supplémentaire)
  if (userKeysCrypted.key.includes("-----BEGIN")) {
    throw new Error(
      `Erreur: La clé récupérée est une clé RSA, pas une clé AES utilisateur`,
    );
  }

  const userKeys = decrypt(userKeysCrypted.key);

  if (!userKeys) {
    throw new Error("Erreur lors du déchiffrement de la clé de chiffrement");
  }

  // Mettre en cache avec TTL
  userKeysCache.set(userIdStr, {
    key: userKeys,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return userKeys;
}

// Fonction pour nettoyer le cache (à appeler lors du logout)
export function clearUserKeyCache(userId: string): void {
  userKeysCache.delete(userId);
}

// Versions optimisées avec clé fournie directement (AES-256-GCM)
export function encryptWithKey(text: string, userKey: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(userKey, "hex"),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );

  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted (cohérent avec masterEncryptionUtils)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptWithKey(text: string, userKey: string): string {
  const textParts = text.split(":");

  if (textParts.length !== 3) {
    throw new Error(
      `❌ Format de données chiffrées invalide : attendu "iv:authTag:encrypted"`,
    );
  }

  const [ivHex, authTagHex, encrypted] = textParts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(userKey, "hex"),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );

  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch (_error) {
    throw new Error(
      "❌ Déchiffrement échoué : vérification d'intégrité des données échouée (données modifiées ou corrompues)",
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHIFFREMENT DE BUFFERS (fichiers binaires) — AES-256-GCM
// Format binaire : iv (12 o) | authTag (16 o) | ciphertext
// ═══════════════════════════════════════════════════════════════════════════

export function encryptBufferWithKey(data: Buffer, userKey: string): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(userKey, "hex"),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptBufferWithKey(data: Buffer, userKey: string): Buffer {
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("❌ Format de buffer chiffré invalide : données trop courtes");
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(userKey, "hex"),
      iv,
      { authTagLength: AUTH_TAG_LENGTH },
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (_error) {
    throw new Error(
      "❌ Déchiffrement échoué : vérification d'intégrité des données échouée (données modifiées ou corrompues)",
    );
  }
}

/**
 * Renvoie la clé AES (hex) de l'utilisateur (avec cache TTL).
 * À utiliser avec encryptBufferWithKey / decryptBufferWithKey pour éviter
 * de relire la clé à chaque appel.
 */
export async function getUserEncryptionKey(
  userId: IUser["_id"] | string,
): Promise<string> {
  return getUserKey(userId as IUser["_id"]);
}

// Fonctions originales maintenues pour compatibilité (mais optimisées avec cache)
export async function encryptUserKeys(
  userId: IUser["_id"],
  text: string,
): Promise<string> {
  const userKeys = await getUserKey(userId);
  return encryptWithKey(text, userKeys);
}

export async function decryptUserKeys(
  userId: IUser["_id"],
  text: string,
): Promise<string> {
  const userKeys = await getUserKey(userId);
  return decryptWithKey(text, userKeys);
}
