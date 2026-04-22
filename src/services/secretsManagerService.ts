import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { logger } from "./loggerService";

const secretsLogger = logger.child({ service: "secrets-manager" });

interface Secret {
  name: string;
  value: string;
  lastRotated?: Date;
  category?: "jwt" | "encryption" | "database" | "api" | "other";
}

const CRITICAL_SECRETS: Array<{ name: string; category: Secret["category"] }> =
  [
    { name: "JWT_SECRET", category: "jwt" },
    { name: "JWT_REFRESH_SECRET", category: "jwt" },
    { name: "ENCRYPTION_KEY_MASTER", category: "encryption" },
    { name: "ENCRYPTION_KEY_COMMUNICATION", category: "encryption" },
    { name: "MASTER_ENCRYPTION_KEY", category: "encryption" },
    { name: "EMAIL_HMAC_KEY", category: "encryption" },
    { name: "IP_HASH_SECRET", category: "encryption" },
    { name: "DB_CONN_STRING", category: "database" },
    { name: "MONGODB_URI", category: "database" },
    { name: "REDIS_PASSWORD", category: "database" },
    { name: "VONAGE_API_SECRET", category: "api" },
    { name: "VONAGE_SIGNATURE_SECRET", category: "api" },
    { name: "TURNSTILE_SECRET_KEY", category: "api" },
    { name: "SMTP_PASS", category: "api" },
    { name: "AWS_SECRET_ACCESS_KEY", category: "api" },
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
  private awsClient: SecretsManagerClient | null = null;
  private awsSecretId: string | null = null;

  async initialize() {
    if (this.initialized) {
      secretsLogger.warn("Secrets Manager déjà initialisé");
      return;
    }

    try {
      secretsLogger.info("Initialisation du Secrets Manager...");

      const awsSecretId = process.env.AWS_SECRETS_MANAGER_SECRET_ID;

      if (awsSecretId) {
        this.awsSecretId = awsSecretId;
        this.awsClient = new SecretsManagerClient({
          region: process.env.AWS_REGION ?? "eu-west-3",
        });
        secretsLogger.info("Mode AWS Secrets Manager activé", {
          secretId: awsSecretId,
        });
        await this.reloadFromAwsSM();
      } else {
        this.loadFromEnv();
      }

      this.initialized = true;
      secretsLogger.info("Secrets Manager initialisé avec succès", {
        secretsCount: this.secrets.size,
        backend: awsSecretId ? "aws-secrets-manager" : "env",
      });
    } catch (error) {
      secretsLogger.error("Échec initialisation Secrets Manager", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async reloadFromAwsSM(): Promise<void> {
    if (!this.awsClient || !this.awsSecretId) {
      throw new Error("AWS Secrets Manager non configuré");
    }

    secretsLogger.info("Chargement des secrets depuis AWS Secrets Manager", {
      secretId: this.awsSecretId,
    });

    const response = await this.awsClient.send(
      new GetSecretValueCommand({ SecretId: this.awsSecretId }),
    );

    if (!response.SecretString) {
      throw new Error(
        "AWS Secrets Manager a retourné un secret binaire non supporté",
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.SecretString) as Record<string, unknown>;
    } catch {
      throw new Error(
        "Le secret AWS Secrets Manager n'est pas un JSON valide",
      );
    }

    this.secrets.clear();

    const categoryMap = new Map<string, Secret["category"]>(
      CRITICAL_SECRETS.map(({ name, category }) => [name, category]),
    );

    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== "string") continue;
      this.secrets.set(key, {
        name: key,
        value: val,
        lastRotated: new Date(),
        category: categoryMap.get(key) ?? "other",
      });
    }

    secretsLogger.info("Secrets rechargés depuis AWS Secrets Manager", {
      total: this.secrets.size,
    });

    const missing = REQUIRED_SECRETS.filter(
      (name) => !this.secrets.has(name) || !this.secrets.get(name),
    );
    if (missing.length > 0) {
      throw new Error(`Secrets manquants au démarrage : ${missing.join(", ")}`);
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

      this.secrets.set(name, {
        name,
        value,
        lastRotated: new Date(),
        category,
      });

      secretsLogger.debug(`Secret ${name} chargé`, {
        category,
        valueLength: value.length,
      });
    });

    secretsLogger.info("Secrets chargés depuis l'environnement", {
      total: this.secrets.size,
      jwt: Array.from(this.secrets.values()).filter((s) => s.category === "jwt")
        .length,
      encryption: Array.from(this.secrets.values()).filter(
        (s) => s.category === "encryption",
      ).length,
      database: Array.from(this.secrets.values()).filter(
        (s) => s.category === "database",
      ).length,
      api: Array.from(this.secrets.values()).filter((s) => s.category === "api")
        .length,
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
      throw new Error(
        "Secrets Manager non initialisé. Appelez initialize() d'abord.",
      );
    }

    const secret = this.secrets.get(name);
    if (!secret) {
      secretsLogger.error(`Secret ${name} introuvable`, {
        availableSecrets: Array.from(this.secrets.keys()),
      });
      throw new Error(`Secret ${name} non trouvé dans Secrets Manager`);
    }

    return secret.value;
  }

  hasSecret(name: string): boolean {
    return this.secrets.has(name);
  }

  getSecretSafe(
    name: string,
    fallbackToEnv: boolean = true,
  ): string | undefined {
    if (!this.initialized) {
      secretsLogger.warn(
        "Secrets Manager non initialisé, utilisation de process.env",
      );
      return process.env[name];
    }

    const secret = this.secrets.get(name);
    if (secret) {
      return secret.value;
    }

    if (fallbackToEnv) {
      secretsLogger.debug(`Fallback vers process.env pour ${name}`);
      return process.env[name];
    }

    return undefined;
  }

  async rotateSecret(name: string, newValue: string): Promise<void> {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new Error(`Secret ${name} non trouvé pour rotation`);
    }

    if (this.awsClient && this.awsSecretId) {
      secretsLogger.info(`Rotation du secret ${name} dans AWS Secrets Manager`, {
        secretId: this.awsSecretId,
      });

      const currentRaw = await this.awsClient.send(
        new GetSecretValueCommand({ SecretId: this.awsSecretId }),
      );

      if (!currentRaw.SecretString) {
        throw new Error("Impossible de lire le secret courant depuis AWS SM");
      }

      const currentPayload = JSON.parse(currentRaw.SecretString) as Record<
        string,
        string
      >;
      const updatedPayload = { ...currentPayload, [name]: newValue };

      await this.awsClient.send(
        new PutSecretValueCommand({
          SecretId: this.awsSecretId,
          SecretString: JSON.stringify(updatedPayload),
        }),
      );

      secretsLogger.info(`Secret ${name} persisté dans AWS Secrets Manager`, {
        category: secret.category,
      });

      await this.reloadFromAwsSM();
    } else {
      secret.value = newValue;
      secret.lastRotated = new Date();

      secretsLogger.info(`Secret ${name} rotated successfully (env mode)`, {
        category: secret.category,
        rotatedAt: secret.lastRotated,
      });
    }
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
        secretsLogger.warn(`Secret faible détecté: ${name}`, {
          length: value.length,
          hasLower: /[a-z]/.test(value),
          hasUpper: /[A-Z]/.test(value),
          hasDigit: /[0-9]/.test(value),
          hasSymbol: /[^a-zA-Z0-9]/.test(value),
        });
      }
    });

    const report = `
AUDIT SECRETS MANAGER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Secrets forts    : ${strong.length}/${this.secrets.size}
Secrets faibles  : ${weak.length}/${this.secrets.size}

${weak.length > 0 ? `SECRETS FAIBLES DETECTES:\n${weak.map((s) => `   - ${s}`).join("\n")}` : "Tous les secrets respectent les criteres de securite"}

RECOMMANDATIONS:
   - Longueur minimale: 32 caracteres
   - Doit contenir: minuscules, MAJUSCULES, chiffres, symboles
   - Generer avec: openssl rand -base64 64
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return { weak, strong, report };
  }

  listSecrets(): Array<{
    name: string;
    category?: string;
    lastRotated?: Date;
  }> {
    return Array.from(this.secrets.values()).map((secret) => ({
      name: secret.name,
      category: secret.category,
      lastRotated: secret.lastRotated,
    }));
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
      backend: this.awsSecretId ? "aws-secrets-manager" : "env",
    };
  }

  _resetForTesting() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Reset interdit en production");
    }
    this.secrets.clear();
    this.initialized = false;
    this.awsClient = null;
    this.awsSecretId = null;
    secretsLogger.warn("Secrets Manager réinitialisé (mode test)");
  }
}

export const secretsManager = new SecretsManagerService();
export default secretsManager;
