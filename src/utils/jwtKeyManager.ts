// ═══════════════════════════════════════════════════════════════════════════
// REM-003: JWT KEY VERSIONING - ROTATION DE CLÉS JWT
// ═══════════════════════════════════════════════════════════════════════════
// Permet la rotation sécurisée des clés JWT sans invalider les tokens existants
// - Les anciens tokens restent valides jusqu'à leur expiration
// - Les nouveaux tokens utilisent la dernière clé
// - Support multi-clés pour transition en douceur

import crypto from "crypto";
import { logger } from "../services/loggerService";

const jwtKeyLogger = logger.child({ service: "jwt-key-manager" });

interface JWTKeyVersion {
  version: string;
  secret: string;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

class JWTKeyManager {
  private keys: Map<string, JWTKeyVersion> = new Map();
  private currentVersion: string = "1";
  private readonly KEY_PREFIX = "JWT_SECRET";

  constructor() {
    this.loadKeys();
  }

  /**
   * Charge les clés JWT depuis les variables d'environnement
   * Supporte: JWT_SECRET (v1) et JWT_SECRET_V2, JWT_SECRET_V3, etc.
   */
  private loadKeys(): void {
    // Charger la clé principale (v1)
    const mainSecret = process.env.JWT_SECRET;
    if (mainSecret) {
      this.keys.set("1", {
        version: "1",
        secret: mainSecret,
        createdAt: new Date(),
        isActive: true,
      });
    }

    // Charger les clés versionnées (v2, v3, etc.)
    for (let i = 2; i <= 10; i++) {
      const envKey = `JWT_SECRET_V${i}`;
      const secret = process.env[envKey];
      if (secret) {
        // La version la plus haute est la plus récente
        const isActive = !process.env[`JWT_SECRET_V${i + 1}`];
        this.keys.set(i.toString(), {
          version: i.toString(),
          secret,
          createdAt: new Date(),
          isActive,
        });
        if (isActive) {
          this.currentVersion = i.toString();
        }
      }
    }

    jwtKeyLogger.info("JWT keys loaded", {
      totalKeys: this.keys.size,
      activeVersion: this.currentVersion,
    });
  }

  /**
   * Obtient la clé actuelle pour signer de nouveaux tokens
   */
  getCurrentKey(): { secret: string; version: string } {
    const key = this.keys.get(this.currentVersion);
    if (!key) {
      throw new Error("Aucune clé JWT active disponible");
    }
    return {
      secret: key.secret,
      version: key.version,
    };
  }

  /**
   * Obtient la clé pour une version spécifique (pour vérification)
   */
  getKeyByVersion(version: string): string | null {
    const key = this.keys.get(version);
    return key?.secret || null;
  }

  /**
   * Obtient la version actuelle de la clé
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Vérifie si une version de clé existe
   */
  hasVersion(version: string): boolean {
    return this.keys.has(version);
  }

  /**
   * Obtient toutes les versions disponibles
   */
  getAllVersions(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Statistiques des clés
   */
  getStats(): {
    totalKeys: number;
    currentVersion: string;
    versions: string[];
  } {
    return {
      totalKeys: this.keys.size,
      currentVersion: this.currentVersion,
      versions: this.getAllVersions(),
    };
  }

  /**
   * Génère une nouvelle clé JWT (pour usage administratif)
   * Note: Cette clé doit être ajoutée manuellement aux variables d'environnement
   * SÉCURITÉ: La clé n'est PAS loguée, elle est retournée uniquement
   */
  generateNewKey(): { key: string; version: number } {
    const nextVersion =
      Math.max(...Array.from(this.keys.keys()).map(Number)) + 1;
    const newKey = crypto.randomBytes(64).toString("base64");

    jwtKeyLogger.info("New JWT key generated", { version: nextVersion });
    jwtKeyLogger.warn(
      "SECURITY: Add JWT_SECRET_V" + nextVersion + " to environment variables",
    );

    return {
      key: newKey,
      version: nextVersion,
    };
  }
}

// Singleton
export const jwtKeyManager = new JWTKeyManager();

// Export pour compatibilité
export default jwtKeyManager;
