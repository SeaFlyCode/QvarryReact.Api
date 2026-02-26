// ═══════════════════════════════════════════════════════════════════════════
// SERVICE VONAGE SMS
// ═══════════════════════════════════════════════════════════════════════════
// Gestion de l'envoi de SMS via l'API Vonage (ex-Nexmo)
// Utilisé par le Mode SOS pour envoyer les alertes d'urgence (Stage 2)
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from "./loggerService";

const vonageLogger = logger.child({ service: "vonage" });

// Configuration du mécanisme de retry
const SMS_MAX_RETRIES = 3;
const SMS_RETRY_BASE_DELAY_MS = 2000;

interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  to: string;
  attempts?: number;
}

interface VonageSmsResponse {
  "message-count": string;
  messages: Array<{
    status: string;
    "message-id": string;
    to: string;
    "error-text": string;
    "remaining-balance": string;
    "message-price": string;
    network: string;
  }>;
}

class VonageService {
  private apiKey: string = "";
  private apiSecret: string = "";
  private smsFrom: string = "Qvarry";
  private isConfigured: boolean = false;

  /**
   * Initialiser le client Vonage avec les variables d'environnement
   * Appelé au démarrage du serveur
   */
  initialize(): void {
    const apiKey = process.env.VONAGE_API_KEY;
    const apiSecret = process.env.VONAGE_API_SECRET;
    this.smsFrom = process.env.VONAGE_SMS_FROM || "Qvarry";

    if (!apiKey || !apiSecret) {
      vonageLogger.warn(
        "Variables VONAGE_API_KEY et/ou VONAGE_API_SECRET manquantes",
      );
      vonageLogger.warn(
        "Le service SMS est désactivé — les SMS ne seront pas envoyés",
      );
      this.isConfigured = false;
      return;
    }

    try {
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.isConfigured = true;
      vonageLogger.info("Service SMS initialisé avec succès");
    } catch (error) {
      vonageLogger.error("Erreur lors de l'initialisation", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.isConfigured = false;
    }
  }

  /**
   * Vérifier si le service est correctement configuré
   */
  isReady(): boolean {
    return this.isConfigured && this.apiKey !== "" && this.apiSecret !== "";
  }

  /**
   * Envoyer un SMS à un numéro de téléphone (avec retry automatique)
   * @param to - Numéro de téléphone au format E.164 (ex: +33612345678)
   * @param text - Contenu du SMS
   * @returns Résultat de l'envoi
   */
  async sendSms(to: string, text: string): Promise<SmsSendResult> {
    return this.sendSmsWithRetry(to, text, SMS_MAX_RETRIES);
  }

  /**
   * Envoyer un SMS avec mécanisme de retry et backoff exponentiel
   * @param to - Numéro de téléphone au format E.164
   * @param text - Contenu du SMS
   * @param maxRetries - Nombre maximum de tentatives (défaut: 3)
   * @returns Résultat de l'envoi avec le nombre de tentatives
   */
  private async sendSmsWithRetry(
    to: string,
    text: string,
    maxRetries: number = SMS_MAX_RETRIES,
  ): Promise<SmsSendResult> {
    let lastResult: SmsSendResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Tentative d'envoi
      lastResult = await this.sendSmsOnce(to, text);

      // Si succès ou service non configuré, on arrête immédiatement
      if (
        lastResult.success ||
        lastResult.error === "Service Vonage non configuré"
      ) {
        return { ...lastResult, attempts: attempt };
      }

      // Si échec et qu'il reste des tentatives, on attend avant de retry
      if (attempt < maxRetries) {
        const delay = SMS_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        vonageLogger.warn("Retry SMS après délai", {
          attempt,
          maxRetries,
          to: to.substring(0, 6) + "***",
          delayMs: delay,
        });
        await this.sleep(delay);
      }
    }

    // Toutes les tentatives ont échoué
    return { ...lastResult!, attempts: maxRetries };
  }

  /**
   * Envoyer un SMS (une seule tentative, sans retry)
   * @param to - Numéro de téléphone au format E.164
   * @param text - Contenu du SMS
   * @returns Résultat de l'envoi
   */
  private async sendSmsOnce(to: string, text: string): Promise<SmsSendResult> {
    if (!this.isReady()) {
      vonageLogger.warn("Service non configuré — SMS simulé", {
        to: to.substring(0, 6) + "***",
      });
      return {
        success: false,
        error: "Service Vonage non configuré",
        to,
      };
    }

    try {
      // Vonage attend le numéro sans le "+" pour certains formats
      const cleanNumber = to.startsWith("+") ? to.substring(1) : to;

      const response = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          from: this.smsFrom,
          to: cleanNumber,
          text,
        }),
      });

      if (!response.ok) {
        const errorText = `HTTP ${response.status} ${response.statusText}`;
        vonageLogger.error("Échec envoi SMS", {
          to: to.substring(0, 6) + "***",
          error: errorText,
        });
        return {
          success: false,
          error: errorText,
          to,
        };
      }

      const data = (await response.json()) as VonageSmsResponse;
      const message = data.messages?.[0];

      if (message?.status === "0") {
        vonageLogger.info("SMS envoyé avec succès", {
          to: to.substring(0, 6) + "***",
          messageId: message["message-id"],
        });
        return {
          success: true,
          messageId: message["message-id"],
          to,
        };
      } else {
        const errorText = message?.["error-text"] || "Erreur inconnue";
        vonageLogger.error("Échec envoi SMS", {
          to: to.substring(0, 6) + "***",
          error: errorText,
        });
        return {
          success: false,
          error: errorText,
          to,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vonageLogger.error("Exception lors de l'envoi SMS", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        error: errorMessage,
        to,
      };
    }
  }

  /**
   * Attendre un délai (helper pour le retry)
   * @param ms - Délai en millisecondes
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Envoyer un SMS d'alerte SOS à un contact d'urgence
   * @param contactName - Nom du contact d'urgence
   * @param contactPhone - Numéro du contact (format E.164)
   * @param userName - Nom de l'utilisateur en danger
   * @param sessionNote - Note optionnelle de la session SOS
   * @param location - Coordonnées GPS optionnelles
   * @returns Résultat de l'envoi
   */
  async sendSosAlert(
    contactName: string,
    contactPhone: string,
    userName: string,
    sessionNote?: string,
    location?: { lat: number; lng: number },
  ): Promise<SmsSendResult> {
    let text = `🆘 ALERTE QVARRY - ${userName} n'a pas donné signe de vie après son exploration souterraine.`;

    if (sessionNote) {
      text += ` Note: "${sessionNote}"`;
    }

    if (location) {
      text += ` Position: https://maps.google.com/?q=${location.lat},${location.lng}`;
    }

    text += ` Essayez de le/la contacter immédiatement. Si impossible, contactez les secours.`;

    vonageLogger.info("Envoi alerte SOS", {
      contactName,
      contactPhone: contactPhone.substring(0, 6) + "***",
    });

    return this.sendSms(contactPhone, text);
  }

  /**
   * Envoyer des SMS d'alerte SOS à plusieurs contacts
   * @param contacts - Liste des contacts avec nom et téléphone
   * @param userName - Nom de l'utilisateur en danger
   * @param sessionNote - Note optionnelle
   * @param location - Coordonnées GPS optionnelles
   * @returns Résultats d'envoi pour chaque contact
   */
  async sendSosAlertToMultiple(
    contacts: Array<{ name: string; phone: string }>,
    userName: string,
    sessionNote?: string,
    location?: { lat: number; lng: number },
  ): Promise<SmsSendResult[]> {
    vonageLogger.info("Envoi alerte SOS à plusieurs contacts", {
      contactCount: contacts.length,
    });

    const results = await Promise.allSettled(
      contacts.map((contact) =>
        this.sendSosAlert(
          contact.name,
          contact.phone,
          userName,
          sessionNote,
          location,
        ),
      ),
    );

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        success: false,
        error: result.reason?.message || "Erreur inconnue",
        to: contacts[index].phone,
      };
    });
  }
}

// Export singleton
export const vonageService = new VonageService();
