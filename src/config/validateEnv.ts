/**
 * QVARRY API — Validation des variables d'environnement au démarrage.
 *
 * Cf. fix.md backend #5 — fail-fast plutôt que démarrer avec des defaults
 * permissifs qui peuvent fuir en prod.
 *
 * À appeler tout en haut de `server.ts`, après `dotenv.config()` et avant
 * tout autre import qui utilise process.env.
 */

interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

/** Variables requises dans tous les environnements. */
const REQUIRED_ALWAYS = [
  "DB_CONN_STRING",
  "JWT_SECRET",
  "ENCRYPTION_KEY_MASTER",
  "ENCRYPTION_KEY_COMMUNICATION",
];

/** Variables requises uniquement en production. */
const REQUIRED_PROD = [
  "CLIENT_URL",
  "TURNSTILE_SECRET_KEY",
];

/**
 * Valide les variables d'environnement.
 *
 * @returns Résultat de validation (ok, missing, warnings).
 *          Le caller décide de throw ou de continuer selon le résultat.
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const env = process.env.NODE_ENV ?? "development";

  for (const key of REQUIRED_ALWAYS) {
    if (!process.env[key] || process.env[key]?.trim().length === 0) {
      missing.push(key);
    }
  }

  if (env === "production") {
    for (const key of REQUIRED_PROD) {
      if (!process.env[key] || process.env[key]?.trim().length === 0) {
        missing.push(key);
      }
    }

    // Vérifications spécifiques prod : forcer les défauts sécurisés.
    if (process.env.COOKIE_SECURE !== "true") {
      missing.push('COOKIE_SECURE doit être "true" en production');
    }
    if (process.env.BYPASS_CAPTCHA === "true") {
      missing.push("BYPASS_CAPTCHA=true interdit en production");
    }

    // Avertissements non bloquants mais à surveiller.
    if (process.env.DB_SSL === "false") {
      warnings.push("DB_SSL=false en production : connexion Mongo non chiffrée.");
    }
    if (
      process.env.REDIS_ENABLED !== "false" &&
      !process.env.REDIS_TLS &&
      !process.env.REDIS_URL?.startsWith("rediss://")
    ) {
      warnings.push("REDIS_TLS non défini en production : trafic Redis non chiffré.");
    }
    if (
      process.env.JWT_SECRET &&
      process.env.JWT_SECRET.length < 32
    ) {
      warnings.push(
        "JWT_SECRET de moins de 32 caractères : entropie insuffisante (recommandé 64+).",
      );
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Variante stricte : throw immédiatement si la validation échoue.
 * Utilise console.error directement (le logger n'est pas encore prêt si on
 * échoue très tôt).
 */
export function assertValidEnv(): void {
  const result = validateEnv();

  for (const w of result.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  [validateEnv] ${w}`);
  }

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(
      "❌ [validateEnv] Variables d'environnement manquantes ou invalides :\n" +
        result.missing.map((m) => `  - ${m}`).join("\n"),
    );
    throw new Error(
      `Configuration invalide au démarrage : ${result.missing.join(", ")}`,
    );
  }
}
