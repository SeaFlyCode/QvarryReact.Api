#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// SCRIPT DE DIAGNOSTIC OTP POUR UN UTILISATEUR SPÉCIFIQUE
// ═══════════════════════════════════════════════════════════════════════════
// Vérifie l'état de l'authentification à deux facteurs pour un utilisateur
// Affiche tous les champs 2FA et permet de désactiver l'OTP avec --fix
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { UserModel, IUser } from "../src/models/users";
import { logger } from "../src/services/loggerService";
import * as readline from "readline";

// Charger les variables d'environnement
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

const diagnosticLogger = logger.child({ service: "check-user-otp-script" });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES ET INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface UserOTPInfo {
  // Informations de base
  id: string;
  email: string;
  name: string;
  surname: string;
  is_admin: boolean;

  // Informations 2FA
  two_factor_enabled: boolean;
  two_factor_secret_present: boolean;
  two_factor_algorithm?: string;
  two_factor_confirmed_at?: Date;
  two_factor_recovery_codes_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse les arguments de la ligne de commande
 */
function parseArguments(): {
  email: string | null;
  fix: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let email: string | null = null;
  let fix = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--email" && i + 1 < args.length) {
      email = args[i + 1];
      i++; // Skip next arg
    } else if (arg === "--fix") {
      fix = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return { email, fix, help };
}

/**
 * Affiche l'aide
 */
function displayHelp() {
  console.log(`
═══════════════════════════════════════════════════════════════════════════
  DIAGNOSTIC OTP - Vérificateur d'état 2FA
═══════════════════════════════════════════════════════════════════════════

Usage:
  ts-node scripts/check-user-otp.ts --email <email> [--fix]

Options:
  --email <email>    Email de l'utilisateur à diagnostiquer (OBLIGATOIRE)
  --fix              Désactive l'OTP pour cet utilisateur (nécessite confirmation)
  --help, -h         Affiche cette aide

Exemples:
  # Vérifier l'état 2FA d'un utilisateur
  ts-node scripts/check-user-otp.ts --email user@example.com

  # Désactiver l'OTP pour un utilisateur spécifique
  ts-node scripts/check-user-otp.ts --email user@example.com --fix

═══════════════════════════════════════════════════════════════════════════
  `);
}

/**
 * Récupère les informations OTP d'un utilisateur
 */
async function getUserOTPInfo(email: string): Promise<UserOTPInfo | null> {
  const user = await UserModel.findOne({ email })
    .select(
      "_id email name surname is_admin two_factor_enabled two_factor_secret two_factor_algorithm two_factor_confirmed_at two_factor_recovery_codes",
    )
    .lean<IUser>();

  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    surname: user.surname,
    is_admin: user.is_admin,
    two_factor_enabled: user.two_factor_enabled,
    two_factor_secret_present: Boolean(user.two_factor_secret),
    two_factor_algorithm: user.two_factor_algorithm,
    two_factor_confirmed_at: user.two_factor_confirmed_at,
    two_factor_recovery_codes_count:
      user.two_factor_recovery_codes?.length || 0,
  };
}

/**
 * Affiche les informations OTP d'un utilisateur de manière formatée
 */
function displayUserOTPInfo(info: UserOTPInfo) {
  console.log("\n═══════════════════════════════════════════════");
  console.log(`  DIAGNOSTIC OTP - ${info.email}`);
  console.log("═══════════════════════════════════════════════\n");

  console.log(`📧 Email : ${info.email}`);
  console.log(`👤 Nom : ${info.name} ${info.surname}`);
  console.log(`🔑 Admin : ${info.is_admin ? "Oui" : "Non"}`);
  console.log(`\n🔐 État 2FA :`);
  console.log(`  • two_factor_enabled : ${info.two_factor_enabled}`);
  console.log(
    `  • two_factor_secret : ${info.two_factor_secret_present ? "[PRÉSENT - chiffré]" : "[ABSENT]"}`,
  );
  console.log(
    `  • two_factor_algorithm : ${info.two_factor_algorithm || "[NON DÉFINI]"}`,
  );
  console.log(
    `  • two_factor_confirmed_at : ${info.two_factor_confirmed_at ? info.two_factor_confirmed_at.toISOString() : "[NON CONFIRMÉ]"}`,
  );
  console.log(
    `  • two_factor_recovery_codes : ${info.two_factor_recovery_codes_count} codes`,
  );

  if (info.two_factor_enabled) {
    console.log(`\n⚠️  L'authentification 2FA est ACTIVE pour ce compte`);
  } else {
    console.log(`\n✅ L'authentification 2FA est INACTIVE pour ce compte`);
  }

  console.log("\n═══════════════════════════════════════════════\n");
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
 * Demande une confirmation à l'utilisateur
 */
async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "oui" || answer.toLowerCase() === "o");
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Parse arguments
  const { email, fix, help } = parseArguments();

  // Afficher l'aide si demandée
  if (help) {
    displayHelp();
    process.exit(0);
  }

  // Vérifier que l'email est fourni
  if (!email) {
    console.error("❌ Erreur : L'argument --email est obligatoire\n");
    displayHelp();
    process.exit(1);
  }

  diagnosticLogger.info("═══════════════════════════════════════════════");
  diagnosticLogger.info("  DIAGNOSTIC OTP UTILISATEUR");
  diagnosticLogger.info("═══════════════════════════════════════════════");
  diagnosticLogger.info(`Email cible : ${email}`);
  diagnosticLogger.info(`Mode fix : ${fix ? "OUI" : "NON"}`);

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 : Connexion à MongoDB
  // ═══════════════════════════════════════════════════════════════════════
  diagnosticLogger.info("\nConnexion à MongoDB...");

  const dbConnString = process.env.DB_CONN_STRING;
  if (!dbConnString) {
    diagnosticLogger.error("❌ DB_CONN_STRING non défini dans .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(dbConnString);
    diagnosticLogger.info("✅ Connecté à MongoDB");
  } catch (error) {
    diagnosticLogger.error("❌ Erreur de connexion à MongoDB", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 : Récupérer les informations OTP de l'utilisateur
  // ═══════════════════════════════════════════════════════════════════════
  diagnosticLogger.info(`\nRecherche de l'utilisateur : ${email}`);

  let userInfo: UserOTPInfo | null;
  try {
    userInfo = await getUserOTPInfo(email);

    if (!userInfo) {
      diagnosticLogger.error(`❌ Utilisateur introuvable : ${email}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    diagnosticLogger.info(
      `✅ Utilisateur trouvé : ${userInfo.name} ${userInfo.surname} (ID: ${userInfo.id})`,
    );
  } catch (error) {
    diagnosticLogger.error(
      "❌ Erreur lors de la récupération des informations",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 : Afficher les informations OTP (AVANT)
  // ═══════════════════════════════════════════════════════════════════════
  displayUserOTPInfo(userInfo);

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 : Mode --fix : Désactiver l'OTP
  // ═══════════════════════════════════════════════════════════════════════
  if (fix) {
    if (!userInfo.two_factor_enabled) {
      diagnosticLogger.info(
        "ℹ️  L'OTP est déjà désactivé pour cet utilisateur. Rien à faire.",
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    diagnosticLogger.warn("\n⚠️  ATTENTION : Mode --fix activé");
    diagnosticLogger.warn("   Cette opération va :");
    diagnosticLogger.warn(
      "   1. Désactiver l'authentification 2FA pour cet utilisateur",
    );
    diagnosticLogger.warn("   2. Supprimer le secret TOTP");
    diagnosticLogger.warn("   3. Supprimer tous les codes de récupération");
    diagnosticLogger.warn("   4. L'utilisateur pourra se connecter sans 2FA");
    diagnosticLogger.warn("\n   ⚠️  CETTE ACTION EST IRRÉVERSIBLE !");

    // Demander confirmation
    const confirmed = await askConfirmation(
      "\n❓ Êtes-vous sûr de vouloir désactiver l'OTP pour cet utilisateur ? (oui/non) : ",
    );

    if (!confirmed) {
      diagnosticLogger.info("\n❌ Opération annulée par l'utilisateur");
      await mongoose.disconnect();
      process.exit(0);
    }

    diagnosticLogger.info("\n🚀 Désactivation de l'OTP en cours...");

    try {
      await disableUserOTP(userInfo.id);
      diagnosticLogger.info(`✅ OTP désactivé avec succès pour ${email}`);

      // Récupérer et afficher les nouvelles informations
      const updatedInfo = await getUserOTPInfo(email);
      if (updatedInfo) {
        diagnosticLogger.info("\n📊 État APRÈS désactivation :");
        displayUserOTPInfo(updatedInfo);
      }
    } catch (error) {
      diagnosticLogger.error("❌ Erreur lors de la désactivation de l'OTP", {
        error: error instanceof Error ? error.message : String(error),
      });
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÉTAPE 5 : Déconnexion et fin
  // ═══════════════════════════════════════════════════════════════════════
  diagnosticLogger.info("\n✅ Diagnostic terminé. Déconnexion...");
  await mongoose.disconnect();
  diagnosticLogger.info("✅ Script terminé.\n");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXÉCUTION
// ═══════════════════════════════════════════════════════════════════════════

main().catch((error) => {
  diagnosticLogger.error("❌ Erreur non gérée", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
