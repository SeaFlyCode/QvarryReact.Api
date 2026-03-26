// Migration : Générer des clés de chiffrement pour les utilisateurs existants
import mongoose from "mongoose";
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";

// Charger le .env AVANT les imports qui en dépendent
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import UserModel from "../models/users";
import KeysModel from "../models/keys";
import { encrypt } from "../utils/masterEncryptionUtils";
import logger from "../services/loggerService";

const DB_CONN_STRING = process.env.DB_CONN_STRING;
const DB_SSL = process.env.DB_SSL === "true";

// Logger pour cette migration
const migrationLogger = logger.child({ migration: "generateUserKeys" });

// Générer une clé AES-256 aléatoire (32 bytes = 64 hex chars)
function generateUserKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function migrateUserKeys() {
  try {
    migrationLogger.info("🔄 Connexion à MongoDB...");
    await mongoose.connect(DB_CONN_STRING!, {
      tls: DB_SSL,
    });
    migrationLogger.info("✅ Connecté à MongoDB");

    // Récupérer tous les utilisateurs
    const users = await UserModel.find({}).select("_id email name surname");
    migrationLogger.info(`📊 Total d'utilisateurs : ${users.length}`, {
      totalUsers: users.length,
    });

    let createdKeys = 0;
    let existingKeys = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Vérifier si l'utilisateur a déjà une clé
        const existingKey = await KeysModel.findOne({ userId: user._id });

        if (existingKey) {
          existingKeys++;
          migrationLogger.info(
            `✓ Utilisateur ${user.email} : clé déjà existante`,
            {
              userEmail: user.email,
              userId: user._id,
            },
          );
          continue;
        }

        // Générer une nouvelle clé AES-256
        const userKey = generateUserKey();

        // Chiffrer la clé avec la clé maître
        const encryptedKey = encrypt(userKey);

        // Sauvegarder en base
        await KeysModel.create({
          userId: user._id,
          key: encryptedKey,
          type: "user",
          date: new Date(),
        });

        createdKeys++;
        migrationLogger.info(
          `✅ Utilisateur ${user.email} : nouvelle clé générée`,
          {
            userEmail: user.email,
            userId: user._id,
          },
        );
      } catch (error: any) {
        errors++;
        migrationLogger.error(`❌ Erreur pour ${user.email}`, {
          userEmail: user.email,
          userId: user._id,
          error: error.message,
        });
      }
    }

    migrationLogger.info("📊 RÉSUMÉ DE LA MIGRATION", {
      totalUsers: users.length,
      existingKeys,
      createdKeys,
      errors,
    });

    await mongoose.disconnect();
    migrationLogger.info("✅ Migration terminée avec succès !");
    process.exit(0);
  } catch (error: any) {
    migrationLogger.error("❌ Erreur fatale", { error: error.message });
    process.exit(1);
  }
}

migrateUserKeys();
