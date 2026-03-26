#!/usr/bin/env node
// Script : Lister tous les utilisateurs sans clé de chiffrement
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

const DB_CONN_STRING = process.env.DB_CONN_STRING;

async function checkAllUsers() {
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
      }),
    );

    const users = await UserModel.find({}).select("_id email name surname");
    console.log(`📊 Total d'utilisateurs : ${users.length}\n`);

    const usersWithoutKeys = [];

    for (const user of users) {
      const key = await KeysModel.findOne({ userId: user._id });
      if (!key) {
        usersWithoutKeys.push(user);
        console.log(
          `❌ ${user.email} (${user.name} ${user.surname}) - ID: ${user._id}`,
        );
      }
    }

    console.log("\n" + "=".repeat(60));
    if (usersWithoutKeys.length === 0) {
      console.log("✅ Tous les utilisateurs ont une clé de chiffrement !");
    } else {
      console.log(
        `⚠️  ${usersWithoutKeys.length} utilisateur(s) sans clé de chiffrement`,
      );
      console.log("\n💡 Pour générer les clés manquantes :");
      console.log("   npm run generate-missing-keys");
      console.log("\n   Ou pour un utilisateur spécifique :");
      console.log("   node scripts/generate-user-key.js <userId>");
    }
    console.log("=".repeat(60));

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    process.exit(1);
  }
}

checkAllUsers();
