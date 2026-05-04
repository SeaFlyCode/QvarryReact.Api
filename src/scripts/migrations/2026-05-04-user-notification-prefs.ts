import mongoose from "mongoose";
import UserModel from "../../models/users";
import { connectToDatabase } from "../../config/database";
import { logger } from "../../services/loggerService";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../services/notificationPreferencesService";

const migrationLogger = logger.child({
  service: "migration",
  name: "2026-05-04-user-notification-prefs",
});

/**
 * Idempotent : ne touche que les users sans champ `notificationPreferences`
 * (ou avec un objet vide). Mongoose applique de toute façon les défauts
 * à la lecture, mais persister le champ permet d'avoir un état stable
 * en BDD et de pouvoir indexer/auditer les valeurs si besoin plus tard.
 */
export async function run(): Promise<number> {
  migrationLogger.info("Démarrage migration notificationPreferences");

  const result = await UserModel.updateMany(
    {
      $or: [
        { notificationPreferences: { $exists: false } },
        { notificationPreferences: null },
      ],
    },
    {
      $set: {
        notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
      },
    },
  );

  migrationLogger.info("Migration terminée", {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });

  return result.modifiedCount ?? 0;
}

if (require.main === module) {
  (async () => {
    try {
      await connectToDatabase();
      const updated = await run();
      migrationLogger.info("Migration OK", { updated });
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      migrationLogger.error("Migration KO", {
        error: error instanceof Error ? error.message : String(error),
      });
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    }
  })();
}
