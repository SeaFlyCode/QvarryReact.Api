// src/migrations/addPhotoStorageFields.ts
// Migration pour ajouter les champs storage_quota et storage_used aux utilisateurs

import mongoose from "mongoose";
import dotenv from "dotenv";
import UserModel from "../models/users";
import { logger } from "../services/loggerService";

// Charger les variables d'environnement
dotenv.config();

const STORAGE_QUOTA_DEFAULT = 2 * 1024 * 1024 * 1024; // 2 Go

/**
 * Migration : Ajoute les champs de stockage aux utilisateurs
 */
async function migrateUp(): Promise<void> {
  try {
    logger.info("Début de la migration : ajout des champs de stockage");

    // Connecter à MongoDB
    const dbConnString = process.env.DB_CONN_STRING;
    if (!dbConnString) {
      throw new Error("DB_CONN_STRING non définie dans .env");
    }

    await mongoose.connect(dbConnString);
    logger.info("Connecté à MongoDB");

    // Compter les utilisateurs sans les champs de stockage
    const usersWithoutStorageFields = await UserModel.countDocuments({
      $or: [
        { storage_quota: { $exists: false } },
        { storage_used: { $exists: false } },
      ],
    });

    logger.info(`Utilisateurs à migrer : ${usersWithoutStorageFields}`);

    if (usersWithoutStorageFields === 0) {
      logger.info("Aucun utilisateur à migrer");
      return;
    }

    // Mettre à jour tous les utilisateurs
    const result = await UserModel.updateMany(
      {
        $or: [
          { storage_quota: { $exists: false } },
          { storage_used: { $exists: false } },
        ],
      },
      {
        $set: {
          storage_quota: STORAGE_QUOTA_DEFAULT,
          storage_used: 0,
        },
      },
    );

    logger.info("Migration réussie", {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    // Vérifier que tous les utilisateurs ont maintenant les champs
    const totalUsers = await UserModel.countDocuments({});
    const usersWithStorageFields = await UserModel.countDocuments({
      storage_quota: { $exists: true },
      storage_used: { $exists: true },
    });

    logger.info("Vérification post-migration", {
      totalUsers,
      usersWithStorageFields,
      allMigrated: totalUsers === usersWithStorageFields,
    });

    if (totalUsers !== usersWithStorageFields) {
      logger.error("Certains utilisateurs n'ont pas été migrés correctement");
    } else {
      logger.info("✅ Tous les utilisateurs ont été migrés avec succès");
    }
  } catch (error) {
    logger.error("Erreur lors de la migration", { error });
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info("Connexion MongoDB fermée");
  }
}

/**
 * Rollback : Supprime les champs de stockage des utilisateurs
 */
async function migrateDown(): Promise<void> {
  try {
    logger.info("Début du rollback : suppression des champs de stockage");

    // Connecter à MongoDB
    const dbConnString = process.env.DB_CONN_STRING;
    if (!dbConnString) {
      throw new Error("DB_CONN_STRING non définie dans .env");
    }

    await mongoose.connect(dbConnString);
    logger.info("Connecté à MongoDB");

    // Supprimer les champs de tous les utilisateurs
    const result = await UserModel.updateMany(
      {},
      {
        $unset: {
          storage_quota: "",
          storage_used: "",
        },
      },
    );

    logger.info("Rollback réussi", {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    // Vérifier que tous les champs ont été supprimés
    const usersWithStorageFields = await UserModel.countDocuments({
      $or: [
        { storage_quota: { $exists: true } },
        { storage_used: { $exists: true } },
      ],
    });

    if (usersWithStorageFields > 0) {
      logger.warn(
        `${usersWithStorageFields} utilisateurs ont encore les champs de stockage`,
      );
    } else {
      logger.info("✅ Tous les champs de stockage ont été supprimés");
    }
  } catch (error) {
    logger.error("Erreur lors du rollback", { error });
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info("Connexion MongoDB fermée");
  }
}

/**
 * Script principal
 */
async function main() {
  const command = process.argv[2];

  try {
    if (command === "up") {
      await migrateUp();
    } else if (command === "down") {
      await migrateDown();
    } else {
      logger.info("Usage:");
      logger.info("  npm run migrate:storage up   - Appliquer la migration");
      logger.info("  npm run migrate:storage down - Annuler la migration");
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error("Erreur fatale:", { error });
    process.exit(1);
  }
}

// Exécuter si appelé directement
if (require.main === module) {
  main();
}

export { migrateUp, migrateDown };
