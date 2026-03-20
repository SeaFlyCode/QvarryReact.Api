#!/usr/bin/env ts-node
// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT DE TEST DES NOTIFICATIONS PUSH
// ═══════════════════════════════════════════════════════════════════════════
// Ce script permet de tester manuellement l'envoi de notifications push
// sans passer par toute l'infrastructure de l'API
// ═══════════════════════════════════════════════════════════════════════════

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import mongoose from "mongoose";

// Charger les variables d'environnement
const rootEnvLocalPath = path.resolve(__dirname, "../.env.local");
const rootEnvPath = path.resolve(__dirname, "../.env");
const envFile = fs.existsSync(rootEnvLocalPath)
  ? rootEnvLocalPath
  : rootEnvPath;
dotenv.config({ path: envFile });

console.log("📁 Environnement chargé :", envFile);

// Importer les services après le chargement de .env
import { NotificationService } from "../src/services/notificationService";
import PushTokenModel from "../src/models/pushToken";
import { logger } from "../src/services/loggerService";

const testLogger = logger.child({ service: "test-push" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION DU TEST
// ═══════════════════════════════════════════════════════════════════════════

const TEST_CONFIG = {
  // Modifier ces valeurs pour tester avec un utilisateur réel
  userId: process.env.TEST_USER_ID || "", // ID MongoDB de l'utilisateur test
  title: "🔔 Test Notification",
  body: "Ceci est une notification de test envoyée depuis le script",
  data: {
    type: "test",
    timestamp: new Date().toISOString(),
    source: "test-script",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifier la configuration Firebase
 */
function checkFirebaseConfig(): boolean {
  console.log("\n🔍 Vérification de la configuration Firebase...\n");

  const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
  const hasGoogleCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

  console.log(
    "✓ FIREBASE_SERVICE_ACCOUNT :",
    hasServiceAccount ? "✅ Présent" : "❌ Manquant",
  );
  console.log(
    "✓ GOOGLE_APPLICATION_CREDENTIALS :",
    hasGoogleCreds
      ? `✅ ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`
      : "❌ Manquant",
  );

  if (hasServiceAccount) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
      console.log("\n📋 Détails du Service Account :");
      console.log("  - Project ID :", serviceAccount.project_id);
      console.log("  - Client Email :", serviceAccount.client_email);
      console.log("  - Private Key ID :", serviceAccount.private_key_id);
      return true;
    } catch (error) {
      console.error("❌ Erreur parsing FIREBASE_SERVICE_ACCOUNT :", error);
      return false;
    }
  }

  if (!hasServiceAccount && !hasGoogleCreds) {
    console.error("\n❌ Aucune configuration Firebase trouvée !");
    console.log("\n💡 Pour configurer :");
    console.log("   1. Ajouter FIREBASE_SERVICE_ACCOUNT dans .env (JSON)");
    console.log("   OU");
    console.log(
      "   2. Définir GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase.json",
    );
    return false;
  }

  return true;
}

/**
 * Lister les tokens FCM enregistrés
 */
async function listPushTokens(): Promise<void> {
  console.log("\n📱 Tokens FCM enregistrés :\n");

  const tokens = await PushTokenModel.find().lean();

  if (tokens.length === 0) {
    console.log("❌ Aucun token FCM trouvé en base de données");
    console.log("\n💡 Pour enregistrer un token :");
    console.log("   1. Lancer l'app mobile Qvarry sur un appareil");
    console.log("   2. Se connecter avec un compte");
    console.log("   3. Le token sera automatiquement enregistré");
    return;
  }

  console.log(`✅ ${tokens.length} token(s) trouvé(s) :\n`);

  for (const token of tokens) {
    console.log(`┌─ Token ID: ${token._id}`);
    console.log(`│  User ID: ${token.userId}`);
    console.log(`│  Device ID: ${token.deviceId}`);
    console.log(`│  Platform: ${token.platform.toUpperCase()}`);
    console.log(`│  Token: ${token.token.substring(0, 30)}...`);
    console.log(`│  Created: ${token.createdAt}`);
    console.log(`│  Updated: ${token.updatedAt}`);
    console.log(`└─────────────────────────────────────────────────────────\n`);
  }
}

/**
 * Tester l'envoi d'une notification à un utilisateur
 */
async function testSendNotification(userId: string): Promise<void> {
  console.log("\n🚀 Envoi de la notification de test...\n");

  console.log("📋 Paramètres :");
  console.log(`  - User ID : ${userId}`);
  console.log(`  - Titre : ${TEST_CONFIG.title}`);
  console.log(`  - Corps : ${TEST_CONFIG.body}`);
  console.log(`  - Data :`, TEST_CONFIG.data);

  try {
    const result = await NotificationService.sendPushNotification(
      userId,
      TEST_CONFIG.title,
      TEST_CONFIG.body,
      Object.entries(TEST_CONFIG.data).reduce(
        (acc, [key, value]) => {
          acc[key] = String(value);
          return acc;
        },
        {} as Record<string, string>,
      ),
    );

    console.log("\n✅ Résultat :");
    console.log(`  - Envoyé : ${result.sent ? "✅ OUI" : "❌ NON"}`);
    console.log(`  - Méthode : ${result.method.toUpperCase()}`);
    if (result.error) {
      console.log(`  - Erreur : ${result.error}`);
    }

    if (result.sent) {
      console.log("\n🎉 Notification envoyée avec succès !");
      console.log(
        "\n💡 Vérifiez votre appareil mobile pour voir la notification.",
      );
    } else {
      console.log("\n⚠️ La notification n'a pas pu être envoyée.");
      console.log("\n🔍 Vérifiez :");
      console.log("  1. Firebase est bien initialisé (logs au démarrage)");
      console.log("  2. L'utilisateur a au moins un token FCM enregistré");
      console.log("  3. Les tokens FCM sont valides (pas expirés)");
      console.log("  4. APNs est configuré dans Firebase Console (pour iOS)");
    }
  } catch (error) {
    console.error("\n❌ Erreur lors de l'envoi :", error);
  }
}

/**
 * Afficher le menu interactif
 */
function showMenu(): void {
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗",
  );
  console.log("║         🔔 TEST DES NOTIFICATIONS PUSH                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("\nOptions disponibles :");
  console.log("  1. Vérifier la configuration Firebase");
  console.log("  2. Lister les tokens FCM enregistrés");
  console.log("  3. Envoyer une notification de test");
  console.log("  4. Quitter");
  console.log("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗",
  );
  console.log("║         🔔 SCRIPT DE TEST DES NOTIFICATIONS PUSH          ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n",
  );

  // Connexion à MongoDB
  console.log("🔌 Connexion à MongoDB...");
  const dbUri = process.env.DB_CONN_STRING;
  if (!dbUri) {
    console.error("❌ DB_CONN_STRING non défini dans .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(dbUri);
    console.log("✅ Connecté à MongoDB\n");
  } catch (error) {
    console.error("❌ Erreur de connexion à MongoDB :", error);
    process.exit(1);
  }

  // Initialiser Firebase
  console.log("🔥 Initialisation Firebase...");
  NotificationService.initializePushNotifications();
  console.log("✅ Firebase initialisé\n");

  // Récupérer les arguments de ligne de commande
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Mode interactif
    showMenu();

    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askChoice = () => {
      rl.question("Votre choix : ", async (choice: string) => {
        switch (choice.trim()) {
          case "1":
            checkFirebaseConfig();
            askChoice();
            break;

          case "2":
            await listPushTokens();
            askChoice();
            break;

          case "3":
            rl.question(
              "User ID (ObjectId MongoDB) : ",
              async (userId: string) => {
                if (!userId || userId.trim().length === 0) {
                  console.log("❌ User ID requis");
                  askChoice();
                  return;
                }
                await testSendNotification(userId.trim());
                askChoice();
              },
            );
            break;

          case "4":
            console.log("\n👋 Au revoir !\n");
            rl.close();
            await mongoose.connection.close();
            process.exit(0);
            break;

          default:
            console.log("❌ Choix invalide");
            askChoice();
        }
      });
    };

    askChoice();
  } else {
    // Mode ligne de commande
    const command = args[0];

    switch (command) {
      case "check":
        checkFirebaseConfig();
        break;

      case "list":
        await listPushTokens();
        break;

      case "send":
        if (args.length < 2) {
          console.error("❌ Usage: npm run test:push send <userId>");
          process.exit(1);
        }
        await testSendNotification(args[1]);
        break;

      case "help":
        console.log("\n📖 Usage :");
        console.log("  npm run test:push              # Mode interactif");
        console.log(
          "  npm run test:push check        # Vérifier config Firebase",
        );
        console.log("  npm run test:push list         # Lister les tokens FCM");
        console.log(
          "  npm run test:push send <userId> # Envoyer une notification",
        );
        console.log("");
        break;

      default:
        console.error(`❌ Commande inconnue : ${command}`);
        console.log(
          "💡 Utilisez 'npm run test:push help' pour voir les commandes",
        );
        process.exit(1);
    }

    await mongoose.connection.close();
    process.exit(0);
  }
}

// Lancer le script
main().catch((error) => {
  console.error("❌ Erreur fatale :", error);
  process.exit(1);
});
