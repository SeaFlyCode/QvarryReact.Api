import { logger } from "./loggerService";

const secretsLogger = logger.child({ service: "secrets-manager" });

interface Secret {
  name: string;
  value: string;
  category?: "jwt" | "encryption" | "database" | "api" | "other";
}

const CRITICAL_SECRETS: Array<{ name: string; category: Secret["category"] }> =
  [
    { name: "JWT_SECRET", category: "jwt" },
    { name: "JWT_REFRESH_SECRET", category: "jwt" },
    { name: "ENCRYPTION_KEY_MASTER", category: "encryption" },
    { name: "ENCRYPTION_KEY_COMMUNICATION", category: "encryption" },
    { name: "EMAIL_HMAC_KEY", category: "encryption" },
    { name: "IP_HASH_SECRET", category: "encryption" },
    { name: "DB_CONN_STRING", category: "database" },
    { name: "REDIS_PASSWORD", category: "database" },
    { name: "VONAGE_API_SECRET", category: "api" },
    { name: "VONAGE_SIGNATURE_SECRET", category: "api" },
    { name: "TURNSTILE_SECRET_KEY", category: "api" },
    { name: "SMTP_PASS", category: "api" },
  ];

const REQUIRED_SECRETS = [
  "JWT_SECRET",
  "ENCRYPTION_KEY_MASTER",
  "ENCRYPTION_KEY_COMMUNICATION",
  "DB_CONN_STRING",
  "EMAIL_HMAC_KEY",
];

class SecretsManagerService {
  private secrets: Map<string, Secret> = new Map();
  private initialized: boolean = false;

  async initialize() {
    if (this.initialized) {
      secretsLogger.warn("Secrets Manager déjà initialisé");
      return;
    }

    try {
      secretsLogger.info("Initialisation du Secrets Manager...");
      this.loadFromEnv();
      this.initialized = true;
      secretsLogger.info("Secrets Manager initialisé avec succès", {
        secretsCount: this.secrets.size,
        backend: "env",
      });
    } catch (error) {
      secretsLogger.error("Échec initialisation Secrets Manager", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private loadFromEnv() {
    CRITICAL_SECRETS.forEach(({ name, category }) => {
      const value = process.env[name];

      if (!value) {
        secretsLogger.warn(`Secret ${name} non trouvé dans l'environnement`, {
          category,
        });
        return;
      }

      this.secrets.set(name, { name, value, category });
    });

    secretsLogger.info("Secrets chargés depuis l'environnement", {
      total: this.secrets.size,
      jwt: Array.from(this.secrets.values()).filter((s) => s.category === "jwt").length,
      encryption: Array.from(this.secrets.values()).filter((s) => s.category === "encryption").length,
      database: Array.from(this.secrets.values()).filter((s) => s.category === "database").length,
      api: Array.from(this.secrets.values()).filter((s) => s.category === "api").length,
    });

    const missing = REQUIRED_SECRETS.filter(
      (name) => !this.secrets.has(name) || !this.secrets.get(name),
    );
    if (missing.length > 0) {
      throw new Error(`Secrets manquants au démarrage : ${missing.join(", ")}`);
    }
  }

  getSecret(name: string): string {
    if (!this.initialized) {
      throw new Error("Secrets Manager non initialisé. Appelez initialize() d'abord.");
    }
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new Error(`Secret ${name} non trouvé dans Secrets Manager`);
    }
    return secret.value;
  }

  hasSecret(name: string): boolean {
    return this.secrets.has(name);
  }

  getSecretSafe(name: string, fallbackToEnv: boolean = true): string | undefined {
    if (!this.initialized) {
      return process.env[name];
    }
    const secret = this.secrets.get(name);
    if (secret) return secret.value;
    if (fallbackToEnv) return process.env[name];
    return undefined;
  }

  auditSecrets(): { weak: string[]; strong: string[]; report: string } {
    const weak: string[] = [];
    const strong: string[] = [];

    this.secrets.forEach((secret, name) => {
      const value = secret.value;
      const isStrong =
        value.length >= 32 &&
        /[a-z]/.test(value) &&
        /[A-Z]/.test(value) &&
        /[0-9]/.test(value) &&
        /[^a-zA-Z0-9]/.test(value);

      if (isStrong) {
        strong.push(name);
      } else {
        weak.push(name);
      }
    });

    const report = `
AUDIT SECRETS MANAGER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Secrets forts    : ${strong.length}/${this.secrets.size}
Secrets faibles  : ${weak.length}/${this.secrets.size}

${weak.length > 0 ? `SECRETS FAIBLES DETECTES:\n${weak.map((s) => `   - ${s}`).join("\n")}` : "Tous les secrets respectent les criteres de securite"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return { weak, strong, report };
  }

  getStats() {
    const secrets = Array.from(this.secrets.values());
    return {
      total: secrets.length,
      byCategory: {
        jwt: secrets.filter((s) => s.category === "jwt").length,
        encryption: secrets.filter((s) => s.category === "encryption").length,
        database: secrets.filter((s) => s.category === "database").length,
        api: secrets.filter((s) => s.category === "api").length,
        other: secrets.filter((s) => s.category === "other").length,
      },
      initialized: this.initialized,
      backend: "env",
    };
  }

  _resetForTesting() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Reset interdit en production");
    }
    this.secrets.clear();
    this.initialized = false;
    secretsLogger.warn("Secrets Manager réinitialisé (mode test)");
  }
}

export const secretsManager = new SecretsManagerService();
export default secretsManager;
