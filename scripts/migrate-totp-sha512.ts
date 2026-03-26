#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT DE MIGRATION BATCH TOTP SHA1 → SHA512
// ═══════════════════════════════════════════════════════════════════════════
// Migration de tous les utilisateurs ayant 2FA activé vers SHA512
// Utilise le service totpMigrationService pour garantir la sécurité
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import {
  batchMigrateUsers,
  getMigrationStats,
} from "../src/services/totpMigrationService";
import { logger } from "../src/services/loggerService";

// Charger les variables d'environnement
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const migrationLogger = logger.child({ service: "totp-migration-script" });

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  migrationLogger.info(
    "═══════════════════════════════════════════════════════════",
  );
  migrationLogger.info("  MIGRATION BATCH TOTP SHA1 → SHA512");
  migrationLogger.info(
    "═══════════════════════════════════════════════════════════",
  );

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 : Connexion à MongoDB
  // ═══════════════════════════════════════════════════════════════════════
  migrationLogger.info("Connexion à MongoDB...");

  const dbConnString = process.env.DB_CONN_STRING;
  if (!dbConnString) {
    migrationLogger.error("❌ DB_CONN_STRING non défini dans .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(dbConnString);
    migrationLogger.info("✅ Connecté à MongoDB");
  } catch (error) {
    migrationLogger.error("❌ Erreur de connexion à MongoDB", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 : Afficher les statistiques avant migration
  // ═══════════════════════════════════════════════════════════════════════
  migrationLogger.info("\n📊 Statistiques AVANT migration :");

  try {
    const statsBefore = await getMigrationStats();
    migrationLogger.info("  - Total utilisateurs 2FA : " + statsBefore.total);
    migrationLogger.info(
      "  - Déjà sur SHA512 : " +
        statsBefore.sha512 +
        " (" +
        statsBefore.percentage +
        "%)",
    );
    migrationLogger.info("  - Encore sur SHA1 : " + statsBefore.sha1);
    migrationLogger.info("  - Algorithme inconnu : " + statsBefore.unknown);

    if (statsBefore.total === 0) {
      migrationLogger.info("\n✅ Aucun utilisateur 2FA trouvé. Rien à faire.");
      await mongoose.disconnect();
      process.exit(0);
    }

    if (statsBefore.sha512 === statsBefore.total) {
      migrationLogger.info("\n✅ Tous les utilisateurs sont déjà sur SHA512 !");
      await mongoose.disconnect();
      process.exit(0);
    }
  } catch (error) {
    migrationLogger.error("❌ Erreur lors de la récupération des stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    await mongoose.disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 : Confirmation avant migration
  // ═══════════════════════════════════════════════════════════════════════
  migrationLogger.warn("\n⚠️  ATTENTION : Cette migration va :");
  migrationLogger.warn(
    "   1. Régénérer les secrets TOTP de TOUS les utilisateurs SHA1",
  );
  migrationLogger.warn("   2. Changer l'algorithme vers SHA512");
  migrationLogger.warn("   3. Régénérer les codes de récupération");
  migrationLogger.warn(
    "   4. Les utilisateurs devront RE-SCANNER le QR code 2FA",
  );
  migrationLogger.warn("\n   Assurez-vous d'avoir un plan de communication !");

  // En production, demander confirmation
  if (
    process.env.NODE_ENV === "production" &&
    !process.argv.includes("--force")
  ) {
    migrationLogger.error(
      "\n❌ ANNULÉ : Ajoutez --force pour exécuter en production",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  migrationLogger.info("\n🚀 Démarrage de la migration...\n");

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 : Exécuter la migration batch
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const result = await batchMigrateUsers();

    migrationLogger.info(
      "\n═══════════════════════════════════════════════════════════",
    );
    migrationLogger.info("  RÉSULTATS DE LA MIGRATION");
    migrationLogger.info(
      "═══════════════════════════════════════════════════════════",
    );
    migrationLogger.info("  - Total traités : " + result.total);
    migrationLogger.info("  - ✅ Migrés avec succès : " + result.migrated);
    migrationLogger.info("  - ❌ Échecs : " + result.failed);

    if (result.errors.length > 0) {
      migrationLogger.error("\n⚠️  ERREURS DÉTAILLÉES :");
      result.errors.forEach((err) => {
        migrationLogger.error("  - User " + err.userId + " : " + err.error);
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // ÉTAPE 5 : Afficher les statistiques après migration
    // ═════════════════════════════════════════════════════════════════════
    migrationLogger.info("\n📊 Statistiques APRÈS migration :");
    const statsAfter = await getMigrationStats();
    migrationLogger.info("  - Total utilisateurs 2FA : " + statsAfter.total);
    migrationLogger.info(
      "  - Déjà sur SHA512 : " +
        statsAfter.sha512 +
        " (" +
        statsAfter.percentage +
        "%)",
    );
    migrationLogger.info("  - Encore sur SHA1 : " + statsAfter.sha1);
    migrationLogger.info("  - Algorithme inconnu : " + statsAfter.unknown);

    if (statsAfter.percentage === 100) {
      migrationLogger.info(
        "\n✅ 🎉 MIGRATION COMPLÈTE ! Tous les utilisateurs sont sur SHA512.",
      );
    } else {
      migrationLogger.warn(
        "\n⚠️  Certains utilisateurs n'ont pas été migrés. Vérifiez les erreurs.",
      );
    }
  } catch (error) {
    migrationLogger.error("❌ Erreur fatale durant la migration", {
      error: error instanceof Error ? error.message : String(error),
    });
    await mongoose.disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 6 : Déconnexion et fin
  // ═══════════════════════════════════════════════════════════════════════
  migrationLogger.info("\n✅ Migration terminée. Déconnexion...");
  await mongoose.disconnect();
  migrationLogger.info("✅ Script terminé.\n");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════

main().catch((error) => {
  migrationLogger.error("❌ Erreur non gérée", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
