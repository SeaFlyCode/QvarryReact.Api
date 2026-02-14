import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION AES-256-GCM (AEAD - Authenticated Encryption)
// ═══════════════════════════════════════════════════════════════════════════
// Chiffrement des communications avec authentification intégrée
// Protection contre les attaques Man-in-the-Middle et manipulation de données
// ═══════════════════════════════════════════════════════════════════════════

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;           // 96 bits (recommandé pour GCM)
const AUTH_TAG_LENGTH = 16;     // 128 bits

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY_COMMUNICATION;
if (!ENCRYPTION_KEY) {
    throw new Error("❌ ENCRYPTION_KEY_COMMUNICATION n'est pas défini dans les variables d'environnement. Vérifiez que le .env est bien chargé dans server.ts !");
}
if (Buffer.from(ENCRYPTION_KEY, "hex").length !== 32) {
    throw new Error("❌ La clé de chiffrement doit être une chaîne hexadécimale de 64 caractères (32 octets) pour ENCRYPTION_KEY_COMMUNICATION.");
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION DE CHIFFREMENT (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════════════

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(
        ALGORITHM,
        Buffer.from(ENCRYPTION_KEY!, "hex"),
        iv,
        { authTagLength: AUTH_TAG_LENGTH }
    );

    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION DE DÉCHIFFREMENT (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════════════

export function decrypt(text: string): string {
    if (!text || typeof text !== 'string') {
        throw new Error(`❌ Impossible de déchiffrer : la valeur fournie est invalide (${typeof text})`);
    }

    const parts = text.split(':');

    // Support du format legacy (CBC) et nouveau format (GCM)
    if (parts.length === 2) {
        // Format legacy AES-256-CBC
        console.warn('⚠️ [CRYPTO COMM] Format de chiffrement legacy détecté, migration recommandée vers AES-GCM');
        return decryptLegacyCBC(text);
    } else if (parts.length === 3) {
        // Format moderne AES-256-GCM
        return decryptGCM(parts);
    } else {
        throw new Error(`❌ Format de données chiffrées invalide`);
    }
}

// Déchiffrement GCM (nouveau format)
function decryptGCM(parts: string[]): string {
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        Buffer.from(ENCRYPTION_KEY!, "hex"),
        iv,
        { authTagLength: AUTH_TAG_LENGTH }
    );

    decipher.setAuthTag(authTag);

    try {
        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    } catch (error) {
        throw new Error('❌ Déchiffrement échoué : vérification d\'intégrité des données échouée');
    }
}

// Déchiffrement CBC legacy (rétrocompatibilité)
function decryptLegacyCBC(text: string): string {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts[0], "hex");
    const encryptedText = Buffer.from(textParts[1], "hex");

    const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(ENCRYPTION_KEY!, "hex"),
        iv
    );

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf-8");
}