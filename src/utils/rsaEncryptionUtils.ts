import crypto from "crypto";
import { encrypt, decrypt } from "./masterEncryptionUtils";

// Configuration RSA - 4096 bits pour maximum de sécurité
const RSA_KEY_SIZE = 4096;
const RSA_PADDING = crypto.constants.RSA_PKCS1_OAEP_PADDING;
const HASH_ALGORITHM = "sha256";

/**
 * Génère une paire de clés RSA 4096 bits
 * @returns { publicKey, privateKey } - Clés au format PEM
 */
export function generateRSAKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: RSA_KEY_SIZE,
        publicKeyEncoding: {
            type: "spki",
            format: "pem"
        },
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem"
        }
    });

    return { publicKey, privateKey };
}

/**
 * Chiffre la clé privée RSA avec la master key
 * @param privateKey - Clé privée RSA en PEM
 * @returns Clé privée chiffrée
 */
export function encryptPrivateKey(privateKey: string): string {
    return encrypt(privateKey);
}

/**
 * Déchiffre la clé privée RSA avec la master key
 * @param encryptedPrivateKey - Clé privée chiffrée
 * @returns Clé privée RSA en PEM
 */
export function decryptPrivateKey(encryptedPrivateKey: string): string {
    return decrypt(encryptedPrivateKey);
}

/**
 * Chiffre des données avec une clé publique RSA
 * Pour les données volumineuses, on utilise un système hybride :
 * 1. Génère une clé AES-256 aléatoire
 * 2. Chiffre les données avec cette clé AES-GCM (authentifié)
 * 3. Chiffre la clé AES avec la clé publique RSA
 *
 * @param data - Données à chiffrer (string)
 * @param publicKey - Clé publique RSA au format PEM
 * @returns Données chiffrées au format : encryptedAESKey:iv:authTag:encryptedData
 */
export function encryptWithPublicKey(data: string, publicKey: string): string {
    // Génération d'une clé AES-256 aléatoire pour ce chiffrement
    const aesKey = crypto.randomBytes(32); // 256 bits
    const iv = crypto.randomBytes(12);     // 96 bits (recommandé pour GCM)

    // Chiffrement des données avec AES-256-GCM (authentifié)
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
    let encryptedData = cipher.update(data, "utf-8", "hex");
    encryptedData += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    // Chiffrement de la clé AES avec la clé publique RSA
    const encryptedAESKey = crypto.publicEncrypt(
        {
            key: publicKey,
            padding: RSA_PADDING,
            oaepHash: HASH_ALGORITHM
        },
        aesKey
    );

    // Format : encryptedAESKey:iv:authTag:encryptedData (tout en hex)
    return `${encryptedAESKey.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}:${encryptedData}`;
}

/**
 * Déchiffre des données avec une clé privée RSA
 * Système hybride inverse :
 * 1. Déchiffre la clé AES avec la clé privée RSA
 * 2. Déchiffre les données avec la clé AES-GCM
 *
 * @param encryptedData - Données chiffrées au format : encryptedAESKey:iv:authTag:encryptedData
 * @param privateKey - Clé privée RSA au format PEM
 * @returns Données déchiffrées (string)
 */
export function decryptWithPrivateKey(encryptedData: string, privateKey: string): string {
    const parts = encryptedData.split(":");

    if (parts.length !== 4) {
        throw new Error("Format de données chiffrées invalide : attendu encryptedAESKey:iv:authTag:encryptedData");
    }

    const encryptedAESKey = Buffer.from(parts[0], "hex");
    const iv = Buffer.from(parts[1], "hex");
    const authTag = Buffer.from(parts[2], "hex");
    const dataToDecrypt = parts[3];

    // Déchiffrement de la clé AES avec la clé privée RSA
    const aesKey = crypto.privateDecrypt(
        {
            key: privateKey,
            padding: RSA_PADDING,
            oaepHash: HASH_ALGORITHM
        },
        encryptedAESKey
    );

    // Déchiffrement des données avec la clé AES-GCM
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    try {
        let decrypted = decipher.update(dataToDecrypt, "hex", "utf-8");
        decrypted += decipher.final("utf-8");
        return decrypted;
    } catch (error) {
        throw new Error("❌ Déchiffrement échoué : vérification d'intégrité des données échouée (données modifiées ou corrompues)");
    }
}


/**
 * Crée un hash SHA-256 des données
 * @param data - Données à hasher
 * @returns Hash en hexadécimal
 */
export function createDataHash(data: string): string {
    return crypto.createHash(HASH_ALGORITHM).update(data).digest("hex");
}

/**
 * Valide le format des données chiffrées hybrides
 * @param encryptedData - Données chiffrées au format encryptedAESKey:iv:authTag:encryptedData
 * @returns true si le format est valide, false sinon
 */
export function validateHybridEncryptedFormat(encryptedData: string): boolean {
    if (!encryptedData || typeof encryptedData !== 'string') {
        return false;
    }

    const parts = encryptedData.split(":");
    if (parts.length !== 4) {
        return false;
    }

    const [encryptedAESKey, iv, authTag, data] = parts;

    // Vérifier que toutes les parties sont en hex valide
    const hexRegex = /^[a-fA-F0-9]+$/;

    // encryptedAESKey RSA-4096 = 512 bytes = 1024 caractères hex
    if (!hexRegex.test(encryptedAESKey) || encryptedAESKey.length !== 1024) {
        return false;
    }

    // IV pour GCM = 12 bytes = 24 caractères hex
    if (!hexRegex.test(iv) || iv.length !== 24) {
        return false;
    }

    // authTag = 16 bytes = 32 caractères hex
    if (!hexRegex.test(authTag) || authTag.length !== 32) {
        return false;
    }

    // Les données chiffrées doivent être en hex et non vides
    if (!hexRegex.test(data) || data.length === 0) {
        return false;
    }

    return true;
}

// Durée de validité des signatures (5 minutes par défaut)
const SIGNATURE_VALIDITY_MS = 5 * 60 * 1000;

/**
 * Signe des données avec une clé privée RSA (avec horodatage anti-replay)
 * @param data - Données à signer (string)
 * @param privateKey - Clé privée RSA au format PEM
 * @returns Signature avec timestamp au format: signature:timestamp
 */
export function signData(data: string, privateKey: string): string {
    const timestamp = Date.now().toString();
    const dataWithTimestamp = `${data}|${timestamp}`;

    const sign = crypto.createSign(HASH_ALGORITHM);
    sign.update(dataWithTimestamp);
    sign.end();

    const signature = sign.sign(privateKey);
    return `${signature.toString("hex")}:${timestamp}`;
}

/**
 * Vérifie la signature de données avec une clé publique RSA (avec validation anti-replay)
 * @param data - Données originales (string)
 * @param signatureWithTimestamp - Signature au format signature:timestamp
 * @param publicKey - Clé publique RSA au format PEM
 * @param maxAgeMs - Durée maximale de validité de la signature (défaut: 5 min)
 * @returns true si la signature est valide et non expirée, false sinon
 */
export function verifySignature(
    data: string,
    signatureWithTimestamp: string,
    publicKey: string,
    maxAgeMs: number = SIGNATURE_VALIDITY_MS
): boolean {
    try {
        const parts = signatureWithTimestamp.split(":");
        if (parts.length !== 2) {
            console.error("❌ Format de signature invalide : attendu signature:timestamp");
            return false;
        }

        const [signatureHex, timestamp] = parts;
        const signatureTime = parseInt(timestamp, 10);

        // Vérifier que le timestamp est valide
        if (isNaN(signatureTime)) {
            console.error("❌ Timestamp de signature invalide");
            return false;
        }

        // Vérifier que la signature n'est pas expirée (anti-replay)
        const now = Date.now();
        if (now - signatureTime > maxAgeMs) {
            console.error("❌ Signature expirée (replay attack prévenue)");
            return false;
        }

        // Vérifier que le timestamp n'est pas dans le futur (tolérance de 30s)
        if (signatureTime > now + 30000) {
            console.error("❌ Timestamp de signature dans le futur");
            return false;
        }

        // Reconstruire les données signées avec le timestamp
        const dataWithTimestamp = `${data}|${timestamp}`;

        const verify = crypto.createVerify(HASH_ALGORITHM);
        verify.update(dataWithTimestamp);
        verify.end();

        const signatureBuffer = Buffer.from(signatureHex, "hex");
        return verify.verify(publicKey, signatureBuffer);
    } catch (error) {
        console.error("❌ Erreur lors de la vérification de signature:", error);
        return false;
    }
}

/**
 * Utilitaire pour tester si une clé publique RSA est valide
 * Vérifie que la clé est valide ET d'une taille minimale de 4096 bits
 * @param publicKey - Clé publique RSA au format PEM
 * @returns true si valide et >= 4096 bits, false sinon
 */
export function isValidPublicKey(publicKey: string): boolean {
    try {
        // Créer un objet clé pour accéder aux détails
        const keyObject = crypto.createPublicKey(publicKey);
        const keyDetails = keyObject.asymmetricKeyDetails;

        // Vérifier que la clé est RSA et de taille suffisante (>= 4096 bits)
        if (!keyDetails || !keyDetails.modulusLength || keyDetails.modulusLength < RSA_KEY_SIZE) {
            console.warn(`⚠️ Clé RSA rejetée: taille ${keyDetails?.modulusLength || 'inconnue'} bits < ${RSA_KEY_SIZE} bits requis`);
            return false;
        }

        // Test fonctionnel de chiffrement
        const testData = "test";
        const encrypted = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: RSA_PADDING,
                oaepHash: HASH_ALGORITHM
            },
            Buffer.from(testData)
        );
        return encrypted.length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Utilitaire pour tester si une clé privée RSA est valide
 * Vérifie que la clé est valide ET d'une taille minimale de 4096 bits
 * @param privateKey - Clé privée RSA au format PEM
 * @returns true si valide et >= 4096 bits, false sinon
 */
export function isValidPrivateKey(privateKey: string): boolean {
    try {
        // Créer un objet clé pour accéder aux détails
        const keyObject = crypto.createPrivateKey(privateKey);
        const keyDetails = keyObject.asymmetricKeyDetails;

        // Vérifier que la clé est RSA et de taille suffisante (>= 4096 bits)
        if (!keyDetails || !keyDetails.modulusLength || keyDetails.modulusLength < RSA_KEY_SIZE) {
            console.warn(`⚠️ Clé privée RSA rejetée: taille ${keyDetails?.modulusLength || 'inconnue'} bits < ${RSA_KEY_SIZE} bits requis`);
            return false;
        }

        // Test fonctionnel : générer une signature
        const sign = crypto.createSign(HASH_ALGORITHM);
        sign.update("test");
        sign.end();
        const signature = sign.sign(privateKey);

        return signature.length > 0;
    } catch (error) {
        return false;
    }
}

