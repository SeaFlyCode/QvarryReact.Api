/**
 * MIGRATION: Ajout des nouvelles options de gestion des conversations
 * Date: 2026-03-20
 *
 * Cette migration ajoute les champs suivants au modèle Conversation :
 * - mutedBy: Array<{ userId, mutedAt, mutedUntil, notifyOnMention }>
 * - archivedBy: Array<{ userId, archivedAt }>
 * - pinnedBy: Array<{ userId, pinnedAt, order }>
 * - markedUnreadBy: Array<ObjectId>
 * - blockedBy: Array<{ userId, blockedAt, reason }>
 *
 * IMPORTANT: Cette migration est automatique grâce à Mongoose.
 * Les nouveaux champs ont des valeurs par défaut (tableaux vides).
 * Les conversations existantes ne nécessitent pas de transformation.
 */

import mongoose from "mongoose";
import Conversation from "../models/conversations";
import { logger } from "../services/loggerService";

const migrationLogger = logger.child({ service: "migration" });

export async function migrateConversationFeatures(): Promise<void> {
  try {
    migrationLogger.info("Démarrage de la migration des conversations");

    // Compter le nombre total de conversations
    const totalConversations = await Conversation.countDocuments();
    migrationLogger.info("Nombre de conversations à migrer", {
      total: totalConversations,
    });

    // Vérifier si les nouveaux champs existent déjà
    const sampleConversation = await Conversation.findOne().lean();

    if (sampleConversation) {
      const hasNewFields =
        "mutedBy" in sampleConversation ||
        "archivedBy" in sampleConversation ||
        "pinnedBy" in sampleConversation ||
        "markedUnreadBy" in sampleConversation ||
        "blockedBy" in sampleConversation;

      if (hasNewFields) {
        migrationLogger.info("Migration déjà effectuée (champs déjà présents)");
        return;
      }
    }

    // Mongoose ajoutera automatiquement les champs avec les valeurs par défaut
    // lors de la prochaine sauvegarde. Nous allons forcer une mise à jour de toutes
    // les conversations pour s'assurer que les champs sont initialisés.

    const result = await Conversation.updateMany(
      {},
      {
        $set: {
          mutedBy: [],
          archivedBy: [],
          pinnedBy: [],
          markedUnreadBy: [],
          blockedBy: [],
        },
      },
    );

    migrationLogger.info("Migration des conversations terminée", {
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });

    // Créer les index si pas déjà créés
    migrationLogger.info("Création des index...");

    await Conversation.collection.createIndex({ "mutedBy.userId": 1 });
    await Conversation.collection.createIndex({ "archivedBy.userId": 1 });
    await Conversation.collection.createIndex({
      "pinnedBy.userId": 1,
      "pinnedBy.order": 1,
    });
    await Conversation.collection.createIndex({ markedUnreadBy: 1 });
    await Conversation.collection.createIndex({ "blockedBy.userId": 1 });

    migrationLogger.info("Index créés avec succès");

    migrationLogger.info("✅ Migration complète des conversations réussie");
  } catch (error) {
    migrationLogger.error("❌ Erreur lors de la migration des conversations", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    throw error;
  }
}

/**
 * Rollback de la migration (en cas de problème)
 * ATTENTION : Cela supprimera toutes les données des nouveaux champs !
 */
export async function rollbackConversationFeatures(): Promise<void> {
  try {
    migrationLogger.warn(
      "⚠️  ROLLBACK : Suppression des nouveaux champs de conversation",
    );

    const result = await Conversation.updateMany(
      {},
      {
        $unset: {
          mutedBy: "",
          archivedBy: "",
          pinnedBy: "",
          markedUnreadBy: "",
          blockedBy: "",
        },
      },
    );

    migrationLogger.info("Rollback terminé", {
      modifiedCount: result.modifiedCount,
    });

    // Supprimer les index
    try {
      await Conversation.collection.dropIndex("mutedBy.userId_1");
    } catch (e) {
      // Index n'existe peut-être pas
    }

    try {
      await Conversation.collection.dropIndex("archivedBy.userId_1");
    } catch (e) {
      // Index n'existe peut-être pas
    }

    try {
      await Conversation.collection.dropIndex(
        "pinnedBy.userId_1_pinnedBy.order_1",
      );
    } catch (e) {
      // Index n'existe peut-être pas
    }

    try {
      await Conversation.collection.dropIndex("markedUnreadBy_1");
    } catch (e) {
      // Index n'existe peut-être pas
    }

    try {
      await Conversation.collection.dropIndex("blockedBy.userId_1");
    } catch (e) {
      // Index n'existe peut-être pas
    }

    migrationLogger.info("✅ Rollback terminé");
  } catch (error) {
    migrationLogger.error("❌ Erreur lors du rollback", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Script CLI pour exécuter la migration manuellement
 * Usage: npx ts-node src/migrations/conversationFeatures.ts
 */
if (require.main === module) {
  (async () => {
    try {
      // Se connecter à MongoDB
      const MONGODB_URI =
        process.env.MONGODB_URI || "mongodb://localhost:27017/qvarry";
      await mongoose.connect(MONGODB_URI);

      migrationLogger.info("✅ Connecté à MongoDB");

      // Exécuter la migration
      await migrateConversationFeatures();

      migrationLogger.info("✅ Migration terminée avec succès");

      // Se déconnecter
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      migrationLogger.error("❌ Erreur:", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  })();
}
