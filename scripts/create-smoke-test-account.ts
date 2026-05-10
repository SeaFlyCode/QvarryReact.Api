/**
 * scripts/create-smoke-test-account.ts
 *
 * Crée (ou récupère) un compte dédié aux smoke tests E2E.
 *
 * - Email fixe : smoke-test@qvarry.local
 * - Password : aléatoire fort à chaque création, stocké dans .smoke-test-creds (gitignored)
 * - Idempotent : si le compte existe déjà, retourne les creds depuis le fichier
 * - Flags : is_verified + is_admin_validated forcés à true (bypass des validations
 *   admin / email pour permettre login direct par le script)
 *
 * Usage:
 *   npx ts-node scripts/create-smoke-test-account.ts
 *
 * Output: .smoke-test-creds (format `EMAIL\nPASSWORD\n`) lu par smoke-test.sh.
 */

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import UserModel from "../src/models/users";
import { encrypt, hashEmail } from "../src/utils/masterEncryptionUtils";
import { generateRSAKeyPair } from "../src/utils/rsaEncryptionUtils";
import KeyModel from "../src/models/keys";

const SMOKE_EMAIL = process.env.SMOKE_EMAIL || "smoke-test@qvarry.local";
const CREDS_FILE = path.resolve(process.cwd(), ".smoke-test-creds");

// ─────────────────────────────────────────────────────────────────────────────
// Génère un password aléatoire fort respectant la policy backend (12+ chars,
// majuscule, minuscule, chiffre, caractère spécial — cf. validatePasswordStrength).
// ─────────────────────────────────────────────────────────────────────────────
function generateStrongPassword(): string {
  // Charset volontairement réduit aux caractères safe en bash/JSON/curl
  // (pas de & * $ ` " ' \\ qui demandent escape ailleurs).
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const special = "!@#%-_+=";
  const all = lower + upper + digits + special;

  // Au moins 1 de chaque + 12 chars random total
  const pick = (set: string) => set[crypto.randomInt(0, set.length)];
  const required = [pick(lower), pick(upper), pick(digits), pick(special)];
  const rest = Array.from({ length: 12 }, () => pick(all));
  // Mélanger
  return [...required, ...rest].sort(() => crypto.randomInt(-1, 2)).join("");
}

async function main() {
  if (!process.env.DB_CONN_STRING) {
    console.error("[smoke] DB_CONN_STRING manquant dans .env");
    process.exit(2);
  }
  if (!process.env.ENCRYPTION_KEY_MASTER) {
    console.error("[smoke] ENCRYPTION_KEY_MASTER manquant dans .env");
    process.exit(2);
  }

  console.log(`[smoke] Connexion MongoDB...`);
  // FIX: spécifier dbName=QvarryStorage (sinon connecte à la DB "test" default
  // Atlas et le user créé n'est jamais vu par le backend qui cible QvarryStorage).
  const dbName = process.env.DB_NAME || "QvarryStorage";
  await mongoose.connect(process.env.DB_CONN_STRING, {
    dbName,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  console.log(`[smoke] Connecté à DB: ${dbName}`);

  const emailHash = hashEmail(SMOKE_EMAIL);
  const existing = await UserModel.findOne({ emailHash }).select("+_id");

  if (existing) {
    console.log(`[smoke] Compte existant: ${SMOKE_EMAIL} (${existing._id})`);

    // Si le fichier de creds existe, on le retourne tel quel (l'utilisateur a
    // déjà les credentials).
    if (fs.existsSync(CREDS_FILE)) {
      console.log(`[smoke] Credentials disponibles dans ${CREDS_FILE}`);
    } else {
      console.log(
        `[smoke] ⚠ Compte existe mais ${CREDS_FILE} absent — réinitialisation du password`,
      );
      const newPassword = generateStrongPassword();
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      await UserModel.updateOne(
        { _id: existing._id },
        {
          password: hashedPassword,
          is_verified: true,
          is_admin_validated: true,
          two_factor_enabled: false,
          is_blocked: false,
          // Reset attempts/lockouts s'il y a en a
          $unset: {
            failed_login_attempts: 1,
            locked_until: 1,
            reset_password_token: 1,
            reset_password_expires: 1,
          },
        },
      );

      fs.writeFileSync(CREDS_FILE, `${SMOKE_EMAIL}\n${newPassword}\n`, {
        mode: 0o600,
      });
      console.log(`[smoke] Password réinitialisé. Creds → ${CREDS_FILE}`);
    }
    await mongoose.disconnect();
    return;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Création nouveau compte
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`[smoke] Création nouveau compte ${SMOKE_EMAIL}...`);
  const password = generateStrongPassword();
  const hashedPassword = await bcrypt.hash(password, 12);

  // Encrypted fields
  const encName = encrypt("Smoke");
  const encSurname = encrypt("Test");
  const encEmail = encrypt(SMOKE_EMAIL);
  const encIp = encrypt("127.0.0.1");

  const newUser = await UserModel.create({
    name: encName,
    surname: encSurname,
    email: encEmail,
    emailHash,
    password: hashedPassword,
    ip_creation: encIp,
    ip_last_connection: encIp,
    is_admin: false,
    is_blocked: false,
    is_verified: true, // Bypass email verification pour smoke test
    is_admin_validated: true, // Bypass admin validation pour smoke test
    two_factor_enabled: false,
    contact_code: 100000 + crypto.randomInt(0, 900000),
    creation_date: new Date(),
    last_connection: new Date(),
  });

  // Générer + stocker la clé AES + les clés RSA (cf. createUser flow standard)
  const aesKey = crypto.randomBytes(32).toString("hex");
  const encryptedAESKey = encrypt(aesKey);
  const { publicKey, privateKey } = generateRSAKeyPair();
  const encryptedPrivateKey = encrypt(privateKey);

  await KeyModel.create([
    { userId: newUser._id, type: "user", key: encryptedAESKey },
    { userId: newUser._id, type: "rsa-public", key: publicKey },
    { userId: newUser._id, type: "rsa-private", key: encryptedPrivateKey },
  ]);

  fs.writeFileSync(CREDS_FILE, `${SMOKE_EMAIL}\n${password}\n`, { mode: 0o600 });
  console.log(`[smoke] ✓ Compte créé: ${newUser._id}`);
  console.log(`[smoke] Credentials sauvegardés → ${CREDS_FILE}`);
  console.log(``);
  console.log(`  Email   : ${SMOKE_EMAIL}`);
  console.log(`  Password: ${password}`);
  console.log(``);
  console.log(
    `[smoke] Lancer le smoke test: ./scripts/smoke-test.sh \"$(head -1 ${CREDS_FILE})\" \"$(tail -1 ${CREDS_FILE})\"`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[smoke] Erreur:", err.message);
  process.exit(1);
});
