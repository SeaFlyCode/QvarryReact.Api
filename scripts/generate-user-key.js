#!/usr/bin/env node
// Script rapide : Générer une clé pour un utilisateur spécifique
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const crypto = require("crypto");

const DB_CONN_STRING = process.env.DB_CONN_STRING;
const ENCRYPTION_KEY_MASTER = process.env.ENCRYPTION_KEY_MASTER;

if (!ENCRYPTION_KEY_MASTER || ENCRYPTION_KEY_MASTER.length !== 64) {
  console.error(
    "❌ ENCRYPTION_KEY_MASTER invalide dans .env (doit faire 64 caractères hex)",
  );
  process.exit(1);
}

// Fonction encrypt simplifiée (copie de masterEncryptionUtils)
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
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars = 32 bytes
}

async function createKey(userId) {
  try {
    console.log("🔄 Connexion à MongoDB...");
    await mongoose.connect(DB_CONN_STRING);
    console.log("✅ Connecté\n");

    const KeysModel = mongoose.model(
      "Keys",
      new mongoose.Schema({
        userId: mongoose.Schema.Types.ObjectId,
        key: String,
        type: String,
        date: Date,
      }),
    );

    // Vérifier si la clé existe déjà
    const existing = await KeysModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (existing) {
      console.log(`⚠️  L'utilisateur ${userId} a déjà une clé`);
      console.log(`   Type: ${existing.type || "non défini"}`);
      console.log(`   Date: ${existing.date}`);
      console.log("\n✅ Rien à faire !");
      await mongoose.disconnect();
      return;
    }

    // Générer une nouvelle clé AES-256
    const userKey = generateUserKey();
    console.log(`🔑 Nouvelle clé générée (${userKey.length} caractères hex)`);

    // Chiffrer avec la clé maître
    const encryptedKey = encrypt(userKey);
    console.log("🔒 Clé chiffrée avec la clé maître");

    // Sauvegarder
    await KeysModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      key: encryptedKey,
      type: "user",
      date: new Date(),
    });

    console.log(`\n✅ Clé créée avec succès pour l'utilisateur ${userId} !`);

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    process.exit(1);
  }
}

const userId = process.argv[2] || "697270fbc3b1bad900e59d33";
console.log(`\n📦 Génération de clé pour l'utilisateur : ${userId}\n`);
createKey(userId);
