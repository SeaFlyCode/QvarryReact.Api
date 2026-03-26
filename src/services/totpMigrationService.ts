// ═══════════════════════════════════════════════════════════════════════════
// SERVICE DE MIGRATION TOTP SHA1 → SHA512
// ═══════════════════════════════════════════════════════════════════════════
// Migration progressive des utilisateurs existants vers SHA512
// Support des 2 algorithmes pendant la période de transition
// ═══════════════════════════════════════════════════════════════════════════

import { TOTP, Secret } from "otpauth";
import { logger } from "./loggerService";
import UserModel from "../models/users";
import { decrypt, encrypt } from "../utils/masterEncryptionUtils";

const migrationLogger = logger.child({ service: "totp-migration" });

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const APP_NAME = "Qvarry";
const NEW_ALGORITHM = "SHA512"; // ✅ Maximum security
const LEGACY_ALGORITHM = "SHA1"; // Pour compatibilité temporaire

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface TOTPConfig {
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRÉATION DE TOTP (NOUVEAUX UTILISATEURS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Génère un nouveau secret TOTP avec SHA512 (nouveaux utilisateurs)
 */
export function generateTOTPSecret(userEmail: string): {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
} {
  const secret = new Secret({ size: 32 }); // 256 bits de secret

  const totp = new TOTP({
    issuer: APP_NAME,
    label: userEmail,
    secret: secret,
    algorithm: NEW_ALGORITHM, // ✅ SHA512
    digits: 6,
    period: 30,
  });

  // Générer 10 codes de backup
  const backupCodes = Array.from({ length: 10 }, () => {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  });

  migrationLogger.info("TOTP secret generated with SHA512", {
    userEmail: userEmail.substring(0, 3) + "***",
    algorithm: NEW_ALGORITHM,
  });

  return {
    secret: secret.base32,
    qrCodeUrl: totp.toString(),
    backupCodes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFICATION DE CODE (SUPPORT DUAL ALGORITHM)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifie un code TOTP avec support des 2 algorithmes (SHA1 legacy + SHA512)
 * Effectue automatiquement la migration si code SHA1 valide
 */
export async function verifyTOTPCode(
  userId: string,
  userEmail: string,
  encryptedSecret: string,
  code: string,
  currentAlgorithm?: "SHA1" | "SHA512",
): Promise<{
  isValid: boolean;
  migrated?: boolean;
  newEncryptedSecret?: string;
}> {
  const decryptedSecret = decrypt(encryptedSecret);
  const secretObj = Secret.fromBase32(decryptedSecret);

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 : Essayer avec l'algorithme actuel (si connu)
  // ═══════════════════════════════════════════════════════════════════════
  if (currentAlgorithm) {
    const totp = new TOTP({
      issuer: APP_NAME,
      label: userEmail,
      secret: secretObj,
      algorithm: currentAlgorithm,
      digits: 6,
      period: 30,
    });

    const isValid = totp.validate({ token: code, window: 1 }) !== null;

    if (isValid && currentAlgorithm === NEW_ALGORITHM) {
      // Déjà migré et code valide
      return { isValid: true };
    }

    if (isValid && currentAlgorithm === LEGACY_ALGORITHM) {
      // Code valide avec SHA1 → MIGRER VERS SHA512
      migrationLogger.info("Auto-migration triggered (SHA1 → SHA512)", {
        userId,
        userEmail: userEmail.substring(0, 3) + "***",
      });

      // Générer nouveau secret SHA512
      const newTOTPData = generateTOTPSecret(userEmail);
      const newEncryptedSecret = encrypt(newTOTPData.secret);

      return {
        isValid: true,
        migrated: true,
        newEncryptedSecret,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 : Essayer SHA512 (algorithme cible)
  // ═══════════════════════════════════════════════════════════════════════
  const totpSHA512 = new TOTP({
    issuer: APP_NAME,
    label: userEmail,
    secret: secretObj,
    algorithm: NEW_ALGORITHM,
    digits: 6,
    period: 30,
  });

  const isValidSHA512 =
    totpSHA512.validate({ token: code, window: 1 }) !== null;

  if (isValidSHA512) {
    return { isValid: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 : Essayer SHA1 (fallback legacy) + AUTO-MIGRATION
  // ═══════════════════════════════════════════════════════════════════════
  const totpSHA1 = new TOTP({
    issuer: APP_NAME,
    label: userEmail,
    secret: secretObj,
    algorithm: LEGACY_ALGORITHM,
    digits: 6,
    period: 30,
  });

  const isValidSHA1 = totpSHA1.validate({ token: code, window: 1 }) !== null;

  if (isValidSHA1) {
    // ⚠️ Code valide avec SHA1 → MIGRATION IMMÉDIATE
    migrationLogger.warn("Legacy SHA1 TOTP detected - migrating to SHA512", {
      userId,
      userEmail: userEmail.substring(0, 3) + "***",
    });

    // Générer nouveau secret SHA512
    const newTOTPData = generateTOTPSecret(userEmail);
    const newEncryptedSecret = encrypt(newTOTPData.secret);

    return {
      isValid: true,
      migrated: true,
      newEncryptedSecret,
    };
  }

  // Aucun algorithme ne valide le code
  return { isValid: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION BATCH (ADMIN SCRIPT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Migration batch de tous les utilisateurs SHA1 → SHA512
 * À exécuter via script admin
 */
export async function batchMigrateUsers(): Promise<{
  total: number;
  migrated: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}> {
  migrationLogger.info("Starting batch TOTP migration (SHA1 → SHA512)");

  const usersWithTOTP = await UserModel.find({
    two_factor_enabled: true,
    two_factor_secret: { $exists: true, $ne: "" },
  }).lean();

  const stats = {
    total: usersWithTOTP.length,
    migrated: 0,
    failed: 0,
    errors: [] as Array<{ userId: string; error: string }>,
  };

  migrationLogger.info("Users to migrate", { count: stats.total });

  for (const user of usersWithTOTP) {
    try {
      const userId = user._id.toString();
      const userEmail = decrypt(user.email);

      // Générer nouveau secret SHA512
      const { secret: newSecret, backupCodes } = generateTOTPSecret(userEmail);
      const newEncryptedSecret = encrypt(newSecret);

      // Mettre à jour en base
      await UserModel.findByIdAndUpdate(userId, {
        two_factor_secret: newEncryptedSecret,
        two_factor_algorithm: NEW_ALGORITHM, // Nouveau champ
        // Note: Les codes de récupération doivent être re-hashés
        two_factor_recovery_codes: backupCodes.map((code) =>
          require("bcrypt").hashSync(code, 12),
        ),
      });

      stats.migrated++;

      migrationLogger.info("User migrated successfully", {
        userId,
        userEmail: userEmail.substring(0, 3) + "***",
      });

      // TODO: Envoyer email à l'utilisateur pour le notifier
      // TODO: Fournir les nouveaux codes de backup de manière sécurisée
    } catch (error) {
      stats.failed++;
      stats.errors.push({
        userId: user._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });

      migrationLogger.error("Migration failed for user", {
        userId: user._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  migrationLogger.info("Batch migration completed", stats);

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFICATION DE L'ÉTAT DE MIGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retourne les statistiques de migration
 */
export async function getMigrationStats(): Promise<{
  total: number;
  sha512: number;
  sha1: number;
  unknown: number;
  percentage: number;
}> {
  const total = await UserModel.countDocuments({
    two_factor_enabled: true,
  });

  const sha512 = await UserModel.countDocuments({
    two_factor_enabled: true,
    two_factor_algorithm: NEW_ALGORITHM,
  });

  const sha1 = await UserModel.countDocuments({
    two_factor_enabled: true,
    two_factor_algorithm: LEGACY_ALGORITHM,
  });

  const unknown = total - sha512 - sha1;
  const percentage = total > 0 ? (sha512 / total) * 100 : 0;

  return {
    total,
    sha512,
    sha1,
    unknown,
    percentage: Math.round(percentage * 100) / 100,
  };
}
