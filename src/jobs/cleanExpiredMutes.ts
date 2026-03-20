import cron from "node-cron";
import Conversation from "../models/conversations";
import { logger } from "../services/loggerService";
import { cleanExpiredMutes } from "../utils/conversationHelpers";

const jobLogger = logger.child({ service: "cron-mutes" });

/**
 * Cron job qui nettoie les mutes expirés toutes les heures
 * Format cron : "0 * * * *" = à la minute 0 de chaque heure
 */
export function startCleanExpiredMutesJob(): void {
  // Exécuter toutes les heures
  cron.schedule("0 * * * *", async () => {
    try {
      jobLogger.info("Démarrage du nettoyage des mutes expirés");

      const now = new Date();

      // Trouver toutes les conversations avec des mutes potentiellement expirés
      const conversations = await Conversation.find({
        "mutedBy.mutedUntil": { $exists: true, $ne: null, $lt: now },
      });

      if (conversations.length === 0) {
        jobLogger.info("Aucun mute expiré trouvé");
        return;
      }

      let totalCleaned = 0;
      const cleanedUsers: string[] = [];

      // Nettoyer chaque conversation
      for (const conversation of conversations) {
        const expiredUserIds = cleanExpiredMutes(conversation);

        if (expiredUserIds.length > 0) {
          await conversation.save();
          totalCleaned += expiredUserIds.length;
          cleanedUsers.push(...expiredUserIds);

          jobLogger.debug("Mutes expirés nettoyés pour conversation", {
            conversationId: conversation._id.toString(),
            expiredUsers: expiredUserIds,
          });
        }
      }

      jobLogger.info("Nettoyage des mutes expirés terminé", {
        conversationsProcessed: conversations.length,
        totalMutesCleaned: totalCleaned,
        uniqueUsers: new Set(cleanedUsers).size,
      });

      // Optionnel : Envoyer une notification aux utilisateurs
      // que leur conversation a été réactivée
      // (Décommenter si souhaité)
      /*
      for (const userId of new Set(cleanedUsers)) {
        try {
          await createNotification(
            new Types.ObjectId(userId),
            "conversation_unmuted",
            "Conversation réactivée",
            "Une de vos conversations a été automatiquement réactivée",
            {},
          );
        } catch (err) {
          jobLogger.error("Erreur envoi notification réactivation", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      */
    } catch (error) {
      jobLogger.error("Erreur lors du nettoyage des mutes expirés", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  jobLogger.info(
    "Cron job de nettoyage des mutes expirés démarré (toutes les heures)",
  );
}

/**
 * Fonction manuelle pour nettoyer les mutes expirés
 * (utile pour les tests ou exécution manuelle)
 */
export async function cleanExpiredMutesManually(): Promise<{
  conversationsProcessed: number;
  totalMutesCleaned: number;
  uniqueUsers: number;
}> {
  try {
    const now = new Date();

    const conversations = await Conversation.find({
      "mutedBy.mutedUntil": { $exists: true, $ne: null, $lt: now },
    });

    let totalCleaned = 0;
    const cleanedUsers: string[] = [];

    for (const conversation of conversations) {
      const expiredUserIds = cleanExpiredMutes(conversation);

      if (expiredUserIds.length > 0) {
        await conversation.save();
        totalCleaned += expiredUserIds.length;
        cleanedUsers.push(...expiredUserIds);
      }
    }

    return {
      conversationsProcessed: conversations.length,
      totalMutesCleaned: totalCleaned,
      uniqueUsers: new Set(cleanedUsers).size,
    };
  } catch (error) {
    jobLogger.error("Erreur lors du nettoyage manuel des mutes expirés", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
