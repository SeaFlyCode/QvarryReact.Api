/**
 * EXEMPLE D'UTILISATION - Redis Batch Publish
 *
 * Ce fichier montre comment utiliser les nouvelles méthodes de batch publish
 * pour optimiser les performances des broadcasts Redis.
 */

import { redisPubSubService } from "../services/redisPubSubService";

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE 1: Broadcast à plusieurs conversations
// ═══════════════════════════════════════════════════════════════════════════

export async function broadcastTypingIndicatorToMultipleConversations(
  userId: string,
  userName: string,
  conversationIds: string[],
) {
  console.log(
    `📤 Broadcasting typing indicator for ${userName} to ${conversationIds.length} conversations`,
  );

  const messages = conversationIds.map((conversationId) => ({
    conversationId,
    message: {
      type: "typing",
      userId,
      userName,
      timestamp: Date.now(),
    },
  }));

  const startTime = Date.now();
  const results = await redisPubSubService.batchPublishMessages(messages);
  const duration = Date.now() - startTime;

  const successCount = results.filter((r) => r).length;
  console.log(
    `✅ Sent to ${successCount}/${messages.length} conversations in ${duration}ms`,
  );

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE 2: Notifications en masse
// ═══════════════════════════════════════════════════════════════════════════

export async function sendBulkNotifications(
  userIds: string[],
  notificationTemplate: {
    type: string;
    title: string;
    body: string;
  },
) {
  console.log(`📤 Sending bulk notifications to ${userIds.length} users`);

  const notifications = userIds.map((userId) => ({
    userId,
    notification: {
      ...notificationTemplate,
      timestamp: Date.now(),
      id: `notif-${userId}-${Date.now()}`,
    },
  }));

  const startTime = Date.now();
  const results =
    await redisPubSubService.batchPublishNotifications(notifications);
  const duration = Date.now() - startTime;

  const successCount = results.filter((r) => r).length;
  console.log(
    `✅ Sent to ${successCount}/${notifications.length} users in ${duration}ms`,
  );

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE 3: Mise à jour système cross-cluster
// ═══════════════════════════════════════════════════════════════════════════

export async function broadcastSystemUpdate(
  version: string,
  features: string[],
) {
  console.log(`📤 Broadcasting system update v${version} to all instances`);

  const messages = [
    {
      channel: "websocket:broadcast",
      payload: {
        event: "system_update",
        data: { version, features },
      },
    },
    {
      channel: "websocket:broadcast",
      payload: {
        event: "cache_invalidate",
        data: { reason: "system_update", version },
      },
    },
  ];

  const startTime = Date.now();
  const results = await redisPubSubService.batchPublish(messages);
  const duration = Date.now() - startTime;

  console.log(`✅ System update broadcasted in ${duration}ms`);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE 4: Notification de fin de conversation à tous les participants
// ═══════════════════════════════════════════════════════════════════════════

export async function notifyConversationEnded(
  conversationId: string,
  participantIds: string[],
  reason: string,
) {
  console.log(
    `📤 Notifying ${participantIds.length} participants that conversation ${conversationId} ended`,
  );

  // Créer un message pour la conversation + des notifications individuelles
  const messages = [
    // Message dans la conversation
    {
      conversationId,
      message: {
        type: "conversation_ended",
        reason,
        timestamp: Date.now(),
      },
    },
  ];

  // Notifications individuelles
  const notifications = participantIds.map((userId) => ({
    userId,
    notification: {
      type: "conversation_ended",
      conversationId,
      reason,
      timestamp: Date.now(),
    },
  }));

  const startTime = Date.now();

  // Utiliser Promise.all pour envoyer en parallèle
  const [messageResults, notificationResults] = await Promise.all([
    redisPubSubService.batchPublishMessages(messages),
    redisPubSubService.batchPublishNotifications(notifications),
  ]);

  const duration = Date.now() - startTime;

  console.log(`✅ Conversation ended notification sent in ${duration}ms`);

  return {
    messageResults,
    notificationResults,
    duration,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE 5: Pattern d'accumulation avec timeout
// ═══════════════════════════════════════════════════════════════════════════

class BatchMessageAccumulator {
  private messages: Array<{
    conversationId: string;
    message: any;
  }> = [];

  private timer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly TIMEOUT_MS = 100;

  /**
   * Ajouter un message au batch
   * Auto-flush si la taille max est atteinte ou après timeout
   */
  async addMessage(conversationId: string, message: any) {
    this.messages.push({ conversationId, message });

    // Flush immédiat si batch plein
    if (this.messages.length >= this.BATCH_SIZE) {
      await this.flush();
      return;
    }

    // Sinon, programmer un flush après timeout
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.TIMEOUT_MS);
    }
  }

  /**
   * Envoyer tous les messages accumulés
   */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.messages.length === 0) {
      return;
    }

    console.log(`📤 Flushing batch of ${this.messages.length} messages`);

    const messagesToSend = [...this.messages];
    this.messages = [];

    const startTime = Date.now();
    const results =
      await redisPubSubService.batchPublishMessages(messagesToSend);
    const duration = Date.now() - startTime;

    const successCount = results.filter((r) => r).length;
    console.log(
      `✅ Batch sent: ${successCount}/${messagesToSend.length} in ${duration}ms`,
    );

    return results;
  }
}

// Export de l'accumulateur pour usage global
export const messageAccumulator = new BatchMessageAccumulator();

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLE D'UTILISATION COMPLÈTE
// ═══════════════════════════════════════════════════════════════════════════

export async function demonstrateBatchPublish() {
  console.log("\n🚀 Démonstration des batch publish Redis\n");

  // Exemple 1
  console.log("--- Exemple 1: Typing indicators ---");
  await broadcastTypingIndicatorToMultipleConversations(
    "user-123",
    "John Doe",
    ["conv-1", "conv-2", "conv-3", "conv-4", "conv-5"],
  );

  // Exemple 2
  console.log("\n--- Exemple 2: Bulk notifications ---");
  await sendBulkNotifications(
    ["user-1", "user-2", "user-3", "user-4", "user-5"],
    {
      type: "announcement",
      title: "Nouvelle fonctionnalité",
      body: "Découvrez les batch operations!",
    },
  );

  // Exemple 3
  console.log("\n--- Exemple 3: System update ---");
  await broadcastSystemUpdate("2.0.0", [
    "batch-publish",
    "pipelines",
    "performance",
  ]);

  // Exemple 4
  console.log("\n--- Exemple 4: Conversation ended ---");
  await notifyConversationEnded(
    "conv-789",
    ["user-1", "user-2", "user-3"],
    "Inactivity timeout",
  );

  // Exemple 5
  console.log("\n--- Exemple 5: Accumulator pattern ---");
  for (let i = 0; i < 15; i++) {
    await messageAccumulator.addMessage(`conv-${i}`, {
      type: "test",
      index: i,
      timestamp: Date.now(),
    });
    // Simule un petit délai entre les messages
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Force le flush final
  await messageAccumulator.flush();

  console.log("\n✅ Démonstration terminée!\n");
}

// Lancer la démo si exécuté directement
if (require.main === module) {
  demonstrateBatchPublish()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Error:", error);
      process.exit(1);
    });
}
