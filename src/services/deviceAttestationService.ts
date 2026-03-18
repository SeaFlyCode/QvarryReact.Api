// ═══════════════════════════════════════════════════════════════════════════
// SERVICE D'ATTESTATION D'APPAREIL (DEVICE ATTESTATION)
// ═══════════════════════════════════════════════════════════════════════════
// Vérification des attestations d'appareils mobiles via :
// - Apple App Attest API (iOS)
// - Google Play Integrity API (Android)
//
// Phase 1: Architecture avec mode bypass (ATTESTATION_ENABLED=false par défaut)
// Phase 2: Implémentation des appels aux APIs Apple/Google (à venir)
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from "./loggerService";

const attestationLogger = logger.child({ service: "device-attestation" });

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface AttestationResult {
  verified: boolean; // true si l'attestation est validée
  bypassed: boolean; // true si le service est désactivé ou non implémenté
  reason?: string; // Raison en cas d'échec
  trustBoost?: number; // Points de trust score à ajouter (ex: 25 si verified)
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE DEVICE ATTESTATION SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class DeviceAttestationService {
  private static isEnabled: boolean = false;

  // Configuration Apple App Attest
  private static appleAppId: string = "";
  private static appleTeamId: string = "";

  // Configuration Google Play Integrity
  private static googlePackageName: string = "";
  private static googleProjectNumber: string = "";

  /**
   * Initialisation du service au startup
   * Lit les variables d'environnement et configure le service
   */
  static initialize(): void {
    // Lire la variable d'activation (par défaut: false)
    const enabledEnv = process.env.ATTESTATION_ENABLED || "false";
    this.isEnabled = enabledEnv.toLowerCase() === "true";

    // Lire les configurations Apple
    this.appleAppId = process.env.APPLE_APP_ID || "";
    this.appleTeamId = process.env.APPLE_TEAM_ID || "";

    // Lire les configurations Google
    this.googlePackageName = process.env.GOOGLE_PACKAGE_NAME || "";
    this.googleProjectNumber = process.env.GOOGLE_PROJECT_NUMBER || "";

    // Log du statut du service
    if (this.isEnabled) {
      attestationLogger.info("Service d'attestation activé", {
        appleConfigured:
          this.appleAppId !== "" && this.appleTeamId !== "" ? "YES" : "NO",
        googleConfigured:
          this.googlePackageName !== "" && this.googleProjectNumber !== ""
            ? "YES"
            : "NO",
      });

      // Warnings si les configs sont manquantes
      if (this.appleAppId === "" || this.appleTeamId === "") {
        attestationLogger.warn(
          "Configuration Apple App Attest manquante (APPLE_APP_ID et/ou APPLE_TEAM_ID)",
        );
      }
      if (this.googlePackageName === "" || this.googleProjectNumber === "") {
        attestationLogger.warn(
          "Configuration Google Play Integrity manquante (GOOGLE_PACKAGE_NAME et/ou GOOGLE_PROJECT_NUMBER)",
        );
      }
    } else {
      attestationLogger.info(
        "Service d'attestation désactivé (mode bypass) — ATTESTATION_ENABLED=false",
        {
          note: "Les attestations device seront acceptées sans vérification serveur",
        },
      );
    }
  }

  /**
   * Vérification principale de l'attestation
   * Dispatche vers la méthode appropriée selon la plateforme
   *
   * @param platform - Plateforme de l'appareil ("ios" ou "android")
   * @param attestationToken - Token d'attestation fourni par l'app mobile
   * @param deviceId - Identifiant unique de l'appareil
   * @returns Résultat de la vérification
   */
  static async verifyAttestation(
    platform: "ios" | "android",
    attestationToken: string,
    deviceId: string,
  ): Promise<AttestationResult> {
    // Si le service est désactivé → bypass
    if (!this.isEnabled) {
      attestationLogger.debug("Attestation bypassée (service désactivé)", {
        platform,
        deviceId: this.maskDeviceId(deviceId),
      });
      return {
        verified: false,
        bypassed: true,
        reason: "Attestation disabled",
        trustBoost: 0,
      };
    }

    // Dispatcher selon la plateforme
    if (platform === "ios") {
      return this.verifyAppleAttestation(attestationToken, deviceId);
    } else if (platform === "android") {
      return this.verifyGoogleAttestation(attestationToken, deviceId);
    } else {
      attestationLogger.warn("Plateforme invalide", { platform });
      return {
        verified: false,
        bypassed: false,
        reason: "Invalid platform",
        trustBoost: 0,
      };
    }
  }

  /**
   * [PHASE 2] Vérification Apple App Attest
   * Stub pour Phase 1 — Implémentation complète à venir
   *
   * Documentation: https://developer.apple.com/documentation/devicecheck/validating_apps_that_connect_to_your_server
   *
   * @param token - Token d'attestation Apple
   * @param deviceId - Device ID
   * @returns Résultat de la vérification
   */
  private static async verifyAppleAttestation(
    token: string,
    deviceId: string,
  ): Promise<AttestationResult> {
    attestationLogger.info(
      "[PHASE 2] Apple App Attest verification not yet implemented",
      {
        deviceId: this.maskDeviceId(deviceId),
        tokenLength: token.length,
      },
    );

    // TODO PHASE 2:
    // 1. Décoder le token d'attestation
    // 2. Vérifier la signature avec la clé publique Apple
    // 3. Valider le challenge/nonce
    // 4. Vérifier le Team ID et App ID
    // 5. Retourner verified: true si tout est OK

    return {
      verified: false,
      bypassed: true,
      reason: "Apple verification not implemented (Phase 2)",
      trustBoost: 0,
    };
  }

  /**
   * [PHASE 2] Vérification Google Play Integrity API
   * Stub pour Phase 1 — Implémentation complète à venir
   *
   * Documentation: https://developer.android.com/google/play/integrity
   *
   * @param token - Token d'intégrité Google Play
   * @param deviceId - Device ID
   * @returns Résultat de la vérification
   */
  private static async verifyGoogleAttestation(
    token: string,
    deviceId: string,
  ): Promise<AttestationResult> {
    attestationLogger.info(
      "[PHASE 2] Google Play Integrity verification not yet implemented",
      {
        deviceId: this.maskDeviceId(deviceId),
        tokenLength: token.length,
      },
    );

    // TODO PHASE 2:
    // 1. Envoyer le token à l'API Google Play Integrity
    // 2. Vérifier le verdicts (MEETS_DEVICE_INTEGRITY, MEETS_BASIC_INTEGRITY, etc.)
    // 3. Valider le package name et les certificats
    // 4. Vérifier le verdict d'application (PLAY_RECOGNIZED, etc.)
    // 5. Retourner verified: true si tout est OK

    return {
      verified: false,
      bypassed: true,
      reason: "Google verification not implemented (Phase 2)",
      trustBoost: 0,
    };
  }

  /**
   * Méthode utilitaire pour vérifier si l'attestation est activée
   */
  static isAttestationEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Masque un Device ID pour les logs (RGPD)
   * Garde les 4 premiers et 4 derniers caractères
   */
  private static maskDeviceId(deviceId: string): string {
    if (deviceId.length <= 8) {
      return "***";
    }
    return `${deviceId.substring(0, 4)}...${deviceId.substring(deviceId.length - 4)}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default DeviceAttestationService;
