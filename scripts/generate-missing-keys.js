#!/usr/bin/env node
// Script : Générer les clés manquantes pour TOUS les utilisateurs
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const crypto = require("crypto");

const DB_CONN_STRING = process.env.DB_CONN_STRING;
const ENCRYPTION_KEY_MASTER = process.env.ENCRYPTION_KEY_MASTER;

if (!ENCRYPTION_KEY_MASTER || ENCRYPTION_KEY_MASTER.length !== 64) {
  console.error("❌ ENCRYPTION_KEY_MASTER invalide");
  process.exit(1);
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY_MASTER, "hex"),
    iv,
    { authTagLength: 16 },
  );

  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function generateUserKey() {
  return crypto.randomBytes(32).toString("hex");
}

async function generateMissingKeys() {
  try {
    console.log("🔄 Connexion à MongoDB...\n");
    await mongoose.connect(DB_CONN_STRING);

    const UserModel = mongoose.model(
      "User",
      new mongoose.Schema({
        email: String,
        name: String,
        surname: String,
      }),
    );

    const KeysModel = mongoose.model(
      "Keys",
      new mongoose.Schema({
        userId: mongoose.Schema.Types.ObjectId,
        key: String,
        type: String,
        date: Date,
      }),
    );

    const users = await UserModel.find({}).select("_id email name surname");
    console.log(`📊 Total d'utilisateurs : ${users.length}\n`);

    let created = 0;
    let existing = 0;

    for (const user of users) {
      const key = await KeysModel.findOne({ userId: user._id });

      if (key) {
        existing++;
        console.log(`✓ ${user.email} : clé déjà existante`);
        continue;
      }

      // Générer et chiffrer
      const userKey = generateUserKey();
      const encryptedKey = encrypt(userKey);

      await KeysModel.create({
        userId: user._id,
        key: encryptedKey,
        type: "user",
        date: new Date(),
      });

      created++;
      console.log(`✅ ${user.email} : nouvelle clé générée`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 RÉSUMÉ");
    console.log("=".repeat(60));
    console.log(`Total utilisateurs         : ${users.length}`);
    console.log(`Clés déjà existantes       : ${existing}`);
    console.log(`Nouvelles clés créées      : ${created}`);
    console.log("=".repeat(60));
    console.log("\n✅ Migration terminée avec succès !");

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    process.exit(1);
  }
}

generateMissingKeys();
