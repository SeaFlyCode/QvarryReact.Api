import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION AES-256-GCM (AEAD - Authenticated Encryption)
// ═══════════════════════════════════════════════════════════════════════════
// Migration de AES-256-CBC vers AES-256-GCM pour une sécurité renforcée
// - Authentification intégrée (détection de modification)
// - Protection contre les attaques par manipulation
// - Norme moderne recommandée par le NIST
// ═══════════════════════════════════════════════════════════════════════════

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits (recommandé pour GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY_MASTER;
if (!ENCRYPTION_KEY) {
  throw new Error(
    "❌ ENCRYPTION_KEY_MASTER n'est pas défini dans les variables d'environnement. Vérifiez que le .env est bien chargé dans server.ts !",
  );
}
if (Buffer.from(ENCRYPTION_KEY, "hex").length !== 32) {
  throw new Error(
    "❌ La clé de chiffrement doit être une chaîne hexadécimale de 64 caractères (32 octets).",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION DE CHIFFREMENT (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════════════
// Format de sortie: iv:authTag:encrypted
// - iv: Vecteur d'initialisation unique (12 bytes)
// - authTag: Tag d'authentification (16 bytes)
// - encrypted: Données chiffrées
// ═══════════════════════════════════════════════════════════════════════════

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY!, "hex"),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );

  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION DE DÉCHIFFREMENT (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════════════
// Validation de l'intégrité automatique via le tag d'authentification
// Lève une exception si les données ont été modifiées ou corrompues
// ═══════════════════════════════════════════════════════════════════════════

export function decrypt(text: string): string {
  // Validation : vérifier que text n'est pas undefined ou null
  if (!text || typeof text !== "string") {
    throw new Error(
      `❌ Impossible de déchiffrer : la valeur fournie est invalide (${typeof text})`,
    );
  }

  const parts = text.split(":");

  if (parts.length !== 3) {
    throw new Error(
      `❌ Format de données chiffrées invalide : attendu "iv:authTag:encrypted"`,
    );
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY!, "hex"),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );

  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch (error) {
    throw new Error(
      "❌ Déchiffrement échoué : vérification d'intégrité des données échouée (données modifiées ou corrompues)",
    );
  }
}

export function hashEmail(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex");
}
