import { logger } from "./loggerService";
import { webSocketStateService } from "./webSocketStateService";
import { NotificationService } from "./notificationService";
import { userStatusService } from "./userStatusService";

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET RECONNECTION SERVICE - MONITORING DES CONNEXIONS PERDUES
// ═══════════════════════════════════════════════════════════════════════════
// Ce service surveille les clients qui devraient être connectés mais ne le sont pas,
// et peut déclencher des actions (notifications push, marking away, etc.)
// ═══════════════════════════════════════════════════════════════════════════

const reconnectionLogger = logger.child({ service: "websocket-reconnection" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const RECONNECTION_CHECK_INTERVAL = parseInt(
  process.env.WS_RECONNECTION_CHECK_INTERVAL || "300000",
  10,
); // 5 minutes
const STALE_CONNECTION_THRESHOLD = parseInt(
  process.env.WS_STALE_CONNECTION_THRESHOLD || "300000",
  10,
); // 5 minutes

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface StaleConnection {
  userId: string;
  deviceId: string;
  lastActivity: Date;
  minutesSinceActivity: number;
  pendingMessages: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET RECONNECTION SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class WebSocketReconnectionService {
  private checkInterval: NodeJS.Timeout | null = null;
  private staleConnectionsDetected = 0;
  private reconnectionsSuggested = 0;

  /**
   * Démarrer la surveillance des connexions perdues
   */
  start(): void {
    if (!webSocketStateService.isEnabled()) {
      reconnectionLogger.warn(
        "WebSocket State Service not enabled - reconnection monitoring disabled",
      );
      return;
    }

    if (this.checkInterval) {
      reconnectionLogger.warn(
        "Reconnection monitoring already started - skipping",
      );
      return;
    }

    this.checkInterval = setInterval(async () => {
      await this.checkStaleConnections();
    }, RECONNECTION_CHECK_INTERVAL);

    reconnectionLogger.info("Reconnection monitoring started", {
      checkInterval: `${RECONNECTION_CHECK_INTERVAL / 1000}s`,
      staleThreshold: `${STALE_CONNECTION_THRESHOLD / 1000}s`,
    });
  }

  /**
   * Arrêter la surveillance
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      reconnectionLogger.info("Reconnection monitoring stopped");
    }
  }

  /**
   * Vérifier les connexions obsolètes
   */
  private async checkStaleConnections(): Promise<void> {
    try {
      const stateKeys = await webSocketStateService.getAllStateKeys();
      const now = Date.now();
      const staleConnections: StaleConnection[] = [];

      for (const key of stateKeys) {
        // Extraire userId et deviceId de la clé (format: ws:state:userId:deviceId)
        const parts = key.split(":");
        if (parts.length < 4) continue;

        const userId = parts[2];
        const deviceId = parts[3];

        const state = await webSocketStateService.getClientState(
          userId,
          deviceId,
        );
        if (!state) continue;

        const lastActivity = new Date(state.lastActivityAt).getTime();
        const timeSinceActivity = now - lastActivity;

        if (timeSinceActivity > STALE_CONNECTION_THRESHOLD) {
          const minutesSinceActivity = Math.floor(timeSinceActivity / 60000);

          staleConnections.push({
            userId,
            deviceId,
            lastActivity: state.lastActivityAt,
            minutesSinceActivity,
            pendingMessages: state.pendingMessages.length,
          });

          this.staleConnectionsDetected++;
        }
      }

      if (staleConnections.length > 0) {
        reconnectionLogger.info("Stale connections detected", {
          count: staleConnections.length,
          connections: staleConnections.map((conn) => ({
            userId: conn.userId,
            deviceId: conn.deviceId.substring(0, 8) + "...",
            minutesAgo: conn.minutesSinceActivity,
            pendingMessages: conn.pendingMessages,
          })),
        });

        // Ici, on pourrait:
        // 1. Envoyer une notification push pour reconnecter
        // 2. Marquer l'utilisateur comme "away"
        // 3. Logger pour monitoring externe
        for (const conn of staleConnections) {
          await this.handleStaleConnection(conn);
        }
      } else {
        reconnectionLogger.debug("No stale connections found");
      }
    } catch (error) {
      reconnectionLogger.error("Error checking stale connections", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Gérer une connexion obsolète
   */
  private async handleStaleConnection(
    connection: StaleConnection,
  ): Promise<void> {
    reconnectionLogger.info("Handling stale connection", {
      userId: connection.userId,
      deviceId: connection.deviceId.substring(0, 8) + "...",
      minutesAgo: connection.minutesSinceActivity,
      pendingMessages: connection.pendingMessages,
    });

    // Option 1: Si des messages en attente, suggérer reconnexion
    if (connection.pendingMessages > 0) {
      reconnectionLogger.info("Stale connection has pending messages", {
        userId: connection.userId,
        pendingCount: connection.pendingMessages,
      });

      try {
        await NotificationService.sendPushNotification(
          connection.userId,
          "Messages en attente",
          `Vous avez ${connection.pendingMessages} message(s) en attente`,
          { type: "reconnection_needed", deviceId: connection.deviceId },
        );
        reconnectionLogger.info("Push notification sent for stale connection", {
          userId: connection.userId,
          pendingMessages: connection.pendingMessages,
        });
      } catch (error) {
        reconnectionLogger.error("Failed to send push notification", {
          userId: connection.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.reconnectionsSuggested++;
    }

    // Option 2: Si inactif > 30 minutes, marquer comme "away"
    if (connection.minutesSinceActivity > 30) {
      reconnectionLogger.debug("Connection marked as away", {
        userId: connection.userId,
        minutesAgo: connection.minutesSinceActivity,
      });

      try {
        await userStatusService.markAsAway(connection.userId);
        reconnectionLogger.debug("User marked as away", {
          userId: connection.userId,
          minutesAgo: connection.minutesSinceActivity,
        });
      } catch (error) {
        reconnectionLogger.error("Failed to mark user as away", {
          userId: connection.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Option 3: Si inactif > 7 jours, nettoyer l'état
    if (connection.minutesSinceActivity > 7 * 24 * 60) {
      reconnectionLogger.info("Cleaning very stale connection state", {
        userId: connection.userId,
        daysAgo: Math.floor(connection.minutesSinceActivity / (24 * 60)),
      });

      await webSocketStateService.deleteClientState(
        connection.userId,
        connection.deviceId,
      );
    }
  }

  /**
   * Forcer la vérification immédiate (pour tests/admin)
   */
  async checkNow(): Promise<void> {
    await this.checkStaleConnections();
  }

  /**
   * Obtenir les métriques
   */
  getMetrics() {
    return {
      enabled: this.checkInterval !== null,
      staleDetected: this.staleConnectionsDetected,
      reconnectionsSuggested: this.reconnectionsSuggested,
      checkInterval: RECONNECTION_CHECK_INTERVAL,
      staleThreshold: STALE_CONNECTION_THRESHOLD,
    };
  }

  /**
   * Réinitialiser les métriques
   */
  resetMetrics(): void {
    this.staleConnectionsDetected = 0;
    this.reconnectionsSuggested = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

export const webSocketReconnectionService = new WebSocketReconnectionService();

// Log de l'état au démarrage
reconnectionLogger.info("WebSocket Reconnection Service initialized", {
  enabled: webSocketStateService.isEnabled(),
  checkInterval: `${RECONNECTION_CHECK_INTERVAL / 1000}s`,
  staleThreshold: `${STALE_CONNECTION_THRESHOLD / 1000}s`,
});
