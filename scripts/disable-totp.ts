#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT DE DÉSACTIVATION OTP POUR TOUS LES COMPTES
// ═══════════════════════════════════════════════════════════════════════════
// Désactive l'authentification à deux facteurs pour tous les utilisateurs
// Supprime tous les secrets TOTP et codes de récupération
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { UserModel } from "../src/models/users";
import { logger } from "../src/services/loggerService";

// Charger les variables d'environnement
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const disableLogger = logger.child({ service: "disable-totp-script" });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES ET INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface DisableStats {
  total: number;
  enabled: number;
  disabled: number;
}

interface DisableResult {
  total: number;
  disabled: number;
  failed: number;
  errors: Array<{ userId: string; email: string; error: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère les statistiques avant désactivation
 */
async function getDisableStats(): Promise<DisableStats> {
  const totalUsers = await UserModel.countDocuments({});
  const enabledUsers = await UserModel.countDocuments({
    two_factor_enabled: true,
  });
  const disabledUsers = totalUsers - enabledUsers;

  return {
    total: totalUsers,
    enabled: enabledUsers,
    disabled: disabledUsers,
  };
}

/**
 * Désactive l'OTP pour un utilisateur
 */
async function disableUserOTP(userId: string): Promise<void> {
  await UserModel.findByIdAndUpdate(userId, {
    two_factor_enabled: false,
    two_factor_secret: undefined,
    two_factor_algorithm: undefined,
    two_factor_confirmed_at: undefined,
    two_factor_recovery_codes: [],
  });
}

/**
 * Désactive l'OTP pour tous les utilisateurs par batch
 */
async function batchDisableOTP(
  dryRun: boolean = false,
): Promise<DisableResult> {
  const BATCH_SIZE = 50; // Traiter 50 utilisateurs à la fois
  let skip = 0;
  let totalProcessed = 0;
  let totalDisabled = 0;
  let totalFailed = 0;
  const errors: Array<{ userId: string; email: string; error: string }> = [];

  // Récupérer tous les utilisateurs avec 2FA activé
  const totalToProcess = await UserModel.countDocuments({
    two_factor_enabled: true,
  });

  disableLogger.info(`📋 ${totalToProcess} utilisateur(s) à traiter`);

  if (totalToProcess === 0) {
    return { total: 0, disabled: 0, failed: 0, errors: [] };
  }

  while (totalProcessed < totalToProcess) {
    // Récupérer un batch d'utilisateurs
    const users = await UserModel.find({ two_factor_enabled: true })
      .select("_id email two_factor_enabled")
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    if (users.length === 0) {
      break; // Plus d'utilisateurs à traiter
    }

    // Traiter chaque utilisateur du batch
    for (const user of users) {
      totalProcessed++;

      try {
        const userEmail = user.email || "email_inconnu";

        if (dryRun) {
          disableLogger.info(
            `[DRY-RUN] Désactivation simulée pour ${userEmail}`,
          );
        } else {
          // Désactiver l'OTP pour cet utilisateur
          await disableUserOTP(user._id.toString());
          disableLogger.info(`✅ Désactivé pour ${userEmail}`);
        }

        totalDisabled++;
      } catch (error) {
        totalFailed++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const userEmail = user.email || "email_inconnu";

        errors.push({
          userId: user._id.toString(),
          email: userEmail,
          error: errorMessage,
        });

        disableLogger.error(
          `❌ Erreur pour utilisateur ${user._id.toString()}`,
          {
            email: userEmail,
            error: errorMessage,
          },
        );
      }
    }

    // Log de progression
    const progress = ((totalProcessed / totalToProcess) * 100).toFixed(1);
    disableLogger.info(
      `📊 Progression : ${totalProcessed}/${totalToProcess} (${progress}%)`,
    );

    skip += BATCH_SIZE;
  }

  return {
    total: totalProcessed,
    disabled: totalDisabled,
    failed: totalFailed,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  disableLogger.info(
    "═══════════════════════════════════════════════════════════",
  );
  disableLogger.info("  DÉSACTIVATION OTP POUR TOUS LES COMPTES");
  disableLogger.info(
    "═══════════════════════════════════════════════════════════",
  );

  // Vérifier les arguments CLI
  const isDryRun = process.argv.includes("--dry-run");
  const isForced = process.argv.includes("--force");

  if (isDryRun) {
    disableLogger.warn(
      "\n⚠️  MODE DRY-RUN : Aucune modification ne sera effectuée\n",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 : Connexion à MongoDB
  // ═══════════════════════════════════════════════════════════════════════
  disableLogger.info("Connexion à MongoDB...");

  const dbConnString = process.env.DB_CONN_STRING;
  if (!dbConnString) {
    disableLogger.error("❌ DB_CONN_STRING non défini dans .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(dbConnString);
    disableLogger.info("✅ Connecté à MongoDB");
  } catch (error) {
    disableLogger.error("❌ Erreur de connexion à MongoDB", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 : Afficher les statistiques avant désactivation
  // ═══════════════════════════════════════════════════════════════════════
  disableLogger.info("\n📊 Statistiques AVANT désactivation :");

  let statsBefore: DisableStats;
  try {
    statsBefore = await getDisableStats();
    disableLogger.info("  - Total utilisateurs : " + statsBefore.total);
    disableLogger.info(
      "  - Avec 2FA activé : " +
        statsBefore.enabled +
        " (" +
        ((statsBefore.enabled / statsBefore.total) * 100).toFixed(1) +
        "%)",
    );
    disableLogger.info("  - Sans 2FA : " + statsBefore.disabled);

    if (statsBefore.enabled === 0) {
      disableLogger.info(
        "\n✅ Aucun utilisateur avec 2FA activé. Rien à faire.",
      );
      await mongoose.disconnect();
      process.exit(0);
    }
  } catch (error) {
    disableLogger.error("❌ Erreur lors de la récupération des stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    await mongoose.disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 : Confirmation avant désactivation
  // ═══════════════════════════════════════════════════════════════════════
  if (!isDryRun) {
    disableLogger.warn("\n⚠️  ATTENTION : Cette opération va :");
    disableLogger.warn(
      "   1. Désactiver l'authentification 2FA pour TOUS les utilisateurs",
    );
    disableLogger.warn("   2. Supprimer tous les secrets TOTP");
    disableLogger.warn("   3. Supprimer tous les codes de récupération");
    disableLogger.warn("   4. Les utilisateurs pourront se connecter sans 2FA");
    disableLogger.warn("\n   ⚠️  CETTE ACTION EST IRRÉVERSIBLE !");

    // En production, demander confirmation
    if (process.env.NODE_ENV === "production" && !isForced) {
      disableLogger.error(
        "\n❌ ANNULÉ : Ajoutez --force pour exécuter en production",
      );
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  disableLogger.info("\n🚀 Démarrage de la désactivation...\n");

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 : Exécuter la désactivation batch
  // ═══════════════════════════════════════════════════════════════════════
  let result: DisableResult;
  try {
    result = await batchDisableOTP(isDryRun);

    disableLogger.info(
      "\n═══════════════════════════════════════════════════════════",
    );
    disableLogger.info("  RÉSULTATS DE LA DÉSACTIVATION");
    disableLogger.info(
      "═══════════════════════════════════════════════════════════",
    );
    disableLogger.info("  - Total traités : " + result.total);
    disableLogger.info("  - ✅ Désactivés avec succès : " + result.disabled);
    disableLogger.info("  - ❌ Échecs : " + result.failed);

    if (result.errors.length > 0) {
      disableLogger.error("\n⚠️  ERREURS DÉTAILLÉES :");
      result.errors.forEach((err) => {
        disableLogger.error(
          "  - User " + err.userId + " (" + err.email + ") : " + err.error,
        );
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // ÉTAPE 5 : Afficher les statistiques après désactivation
    // ═════════════════════════════════════════════════════════════════════
    if (!isDryRun) {
      disableLogger.info("\n📊 Statistiques APRÈS désactivation :");
      const statsAfter = await getDisableStats();
      disableLogger.info("  - Total utilisateurs : " + statsAfter.total);
      disableLogger.info(
        "  - Avec 2FA activé : " +
          statsAfter.enabled +
          " (" +
          ((statsAfter.enabled / statsAfter.total) * 100).toFixed(1) +
          "%)",
      );
      disableLogger.info("  - Sans 2FA : " + statsAfter.disabled);

      if (statsAfter.enabled === 0) {
        disableLogger.info(
          "\n✅ 🎉 DÉSACTIVATION COMPLÈTE ! Tous les utilisateurs ont leur 2FA désactivée.",
        );
      } else {
        disableLogger.warn(
          "\n⚠️  Certains utilisateurs n'ont pas été traités. Vérifiez les erreurs.",
        );
      }
    } else {
      disableLogger.info(
        "\n✅ Simulation terminée. Aucune modification effectuée.",
      );
      disableLogger.info(
        "   Relancez sans --dry-run pour effectuer les modifications.",
      );
    }
  } catch (error) {
    disableLogger.error("❌ Erreur fatale durant la désactivation", {
      error: error instanceof Error ? error.message : String(error),
    });
    await mongoose.disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 6 : Déconnexion et fin
  // ═══════════════════════════════════════════════════════════════════════
  disableLogger.info("\n✅ Désactivation terminée. Déconnexion...");
  await mongoose.disconnect();
  disableLogger.info("✅ Script terminé.\n");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════

main().catch((error) => {
  disableLogger.error("❌ Erreur non gérée", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
