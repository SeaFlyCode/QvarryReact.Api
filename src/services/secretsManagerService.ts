// ═══════════════════════════════════════════════════════════════════════════
// MED-005: SECRETS MANAGER SERVICE
// ═══════════════════════════════════════════════════════════════════════════
// Service de gestion centralisée des secrets
// - Actuellement : Charge depuis .env (fallback pour transition)
// - Future : Migration vers AWS Secrets Manager / HashiCorp Vault
// - Fonctionnalités : Rotation automatique, audit de force, cache sécurisé
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from "./loggerService";

const secretsLogger = logger.child({ service: "secrets-manager" });

interface Secret {
  name: string;
  value: string;
  lastRotated?: Date;
  category?: "jwt" | "encryption" | "database" | "api" | "other";
}

class SecretsManagerService {
  private secrets: Map<string, Secret> = new Map();
  private initialized: boolean = false;

  /**
   * Initialise le Secrets Manager
   * À appeler au démarrage du serveur AVANT toute autre opération
   */
  async initialize() {
    if (this.initialized) {
      secretsLogger.warn("Secrets Manager déjà initialisé");
      return;
    }

    try {
      secretsLogger.info("Initialisation du Secrets Manager...");

      // MED-005: Pour l'instant, charger depuis .env (fallback)
      // TODO: Remplacer par AWS Secrets Manager / Vault en production
      this.loadFromEnv();

      this.initialized = true;
      secretsLogger.info("Secrets Manager initialisé avec succès", {
        secretsCount: this.secrets.size,
      });
    } catch (error) {
      secretsLogger.error("Échec initialisation Secrets Manager", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Charge les secrets depuis les variables d'environnement
   * Méthode de transition avant migration vers AWS/Vault
   */
  private loadFromEnv() {
    // Liste des secrets critiques à gérer
    const criticalSecrets: Array<{
      name: string;
      category: Secret["category"];
    }> = [
      // Secrets JWT
      { name: "JWT_SECRET", category: "jwt" },
      { name: "JWT_REFRESH_SECRET", category: "jwt" },

      // Clés de chiffrement
      { name: "ENCRYPTION_KEY_MASTER", category: "encryption" },
      { name: "ENCRYPTION_KEY_COMMUNICATION", category: "encryption" },
      { name: "MASTER_ENCRYPTION_KEY", category: "encryption" },
      { name: "EMAIL_HMAC_KEY", category: "encryption" },
      { name: "IP_HASH_SECRET", category: "encryption" },

      // Base de données
      { name: "DB_CONN_STRING", category: "database" },
      { name: "MONGODB_URI", category: "database" },
      { name: "REDIS_PASSWORD", category: "database" },

      // API externes
      { name: "VONAGE_API_SECRET", category: "api" },
      { name: "VONAGE_SIGNATURE_SECRET", category: "api" },
      { name: "TURNSTILE_SECRET_KEY", category: "api" },
      { name: "SMTP_PASS", category: "api" },

      // AWS (si utilisé)
      { name: "AWS_SECRET_ACCESS_KEY", category: "api" },
    ];

    criticalSecrets.forEach(({ name, category }) => {
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
  }

  /**
   * Récupère un secret par son nom
   * @param name Nom du secret (ex: 'JWT_SECRET')
   * @returns Valeur du secret
   * @throws Error si le secret n'existe pas ou le service n'est pas initialisé
   */
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

  /**
   * Vérifie si un secret existe
   * @param name Nom du secret
   * @returns true si le secret existe
   */
  hasSecret(name: string): boolean {
    return this.secrets.has(name);
  }

  /**
   * Récupère un secret avec fallback vers process.env
   * Utile pour la transition progressive
   * @param name Nom du secret
   * @param fallbackToEnv Si true, utilise process.env si secret absent
   * @returns Valeur du secret ou undefined
   */
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

  /**
   * Rotation d'un secret (préparation pour AWS/Vault)
   * @param name Nom du secret
   * @param newValue Nouvelle valeur
   */
  async rotateSecret(name: string, newValue: string): Promise<void> {
    const secret = this.secrets.get(name);
    if (!secret) {
      throw new Error(`Secret ${name} non trouvé pour rotation`);
    }

    // TODO: MED-005 - Implémenter rotation dans AWS Secrets Manager / Vault
    // Pour l'instant, mise à jour en mémoire uniquement
    secret.value = newValue;
    secret.lastRotated = new Date();

    secretsLogger.info(`Secret ${name} rotated successfully`, {
      category: secret.category,
      rotatedAt: secret.lastRotated,
    });

    // TODO: Notifier les systèmes dépendants de la rotation
  }

  /**
   * Audit de sécurité des secrets
   * Vérifie la force des secrets selon les critères de sécurité
   * @returns Rapport d'audit avec secrets faibles et forts
   */
  auditSecrets(): { weak: string[]; strong: string[]; report: string } {
    const weak: string[] = [];
    const strong: string[] = [];

    this.secrets.forEach((secret, name) => {
      const value = secret.value;

      // Critères de force (niveau militaire/bancaire):
      // - Longueur >= 32 caractères
      // - Contient au moins une minuscule
      // - Contient au moins une majuscule
      // - Contient au moins un chiffre
      // - Contient au moins un symbole
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
🔐 AUDIT SECRETS MANAGER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Secrets forts    : ${strong.length}/${this.secrets.size}
⚠️  Secrets faibles  : ${weak.length}/${this.secrets.size}

${weak.length > 0 ? `⚠️  SECRETS FAIBLES DÉTECTÉS:\n${weak.map((s) => `   - ${s}`).join("\n")}` : "✅ Tous les secrets respectent les critères de sécurité"}

📋 RECOMMANDATIONS:
   - Longueur minimale: 32 caractères
   - Doit contenir: minuscules, MAJUSCULES, chiffres, symboles
   - Générer avec: openssl rand -base64 64
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    return { weak, strong, report };
  }

  /**
   * Liste tous les secrets disponibles (noms uniquement, pas de valeurs)
   * @returns Liste des noms de secrets
   */
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

  /**
   * Statistiques du Secrets Manager
   */
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
    };
  }

  /**
   * Réinitialise le service (pour tests uniquement)
   * ⚠️ NE JAMAIS UTILISER EN PRODUCTION
   */
  _resetForTesting() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Reset interdit en production");
    }
    this.secrets.clear();
    this.initialized = false;
    secretsLogger.warn("Secrets Manager réinitialisé (mode test)");
  }
}

// Export singleton
export const secretsManager = new SecretsManagerService();
export default secretsManager;
