// ═══════════════════════════════════════════════════════════════════════════
// SERVICE VONAGE SMS
// ═══════════════════════════════════════════════════════════════════════════
// Gestion de l'envoi de SMS via l'API Vonage (ex-Nexmo)
// Utilisé par le Mode SOS pour envoyer les alertes d'urgence (Stage 2)
// ═══════════════════════════════════════════════════════════════════════════

interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  to: string;
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
      console.warn(
        "⚠️ [VONAGE] Variables VONAGE_API_KEY et/ou VONAGE_API_SECRET manquantes",
      );
      console.warn(
        "⚠️ [VONAGE] Le service SMS est désactivé — les SMS ne seront pas envoyés",
      );
      this.isConfigured = false;
      return;
    }

    try {
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.isConfigured = true;
      console.log("✅ [VONAGE] Service SMS initialisé avec succès");
    } catch (error) {
      console.error("❌ [VONAGE] Erreur lors de l'initialisation:", error);
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
   * Envoyer un SMS à un numéro de téléphone
   * @param to - Numéro de téléphone au format E.164 (ex: +33612345678)
   * @param text - Contenu du SMS
   * @returns Résultat de l'envoi
   */
  async sendSms(to: string, text: string): Promise<SmsSendResult> {
    if (!this.isReady()) {
      console.warn("⚠️ [VONAGE] Service non configuré — SMS simulé vers:", to);
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
        console.error(
          `❌ [VONAGE] Échec envoi SMS vers ${to.substring(0, 6)}***: ${errorText}`,
        );
        return {
          success: false,
          error: errorText,
          to,
        };
      }

      const data = (await response.json()) as VonageSmsResponse;
      const message = data.messages?.[0];

      if (message?.status === "0") {
        console.log(
          `✅ [VONAGE] SMS envoyé avec succès vers ${to.substring(0, 6)}***`,
        );
        return {
          success: true,
          messageId: message["message-id"],
          to,
        };
      } else {
        const errorText = message?.["error-text"] || "Erreur inconnue";
        console.error(
          `❌ [VONAGE] Échec envoi SMS vers ${to.substring(0, 6)}***: ${errorText}`,
        );
        return {
          success: false,
          error: errorText,
          to,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`❌ [VONAGE] Exception lors de l'envoi SMS:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
        to,
      };
    }
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

    console.log(
      `📱 [VONAGE] Envoi alerte SOS à ${contactName} (${contactPhone.substring(0, 6)}***)`,
    );

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
    console.log(
      `📱 [VONAGE] Envoi alerte SOS à ${contacts.length} contact(s) d'urgence`,
    );

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
