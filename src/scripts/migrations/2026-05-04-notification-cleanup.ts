import mongoose from "mongoose";
import NotificationModel from "../../models/notifications";
import { connectToDatabase } from "../../config/database";
import { logger } from "../../services/loggerService";

const migrationLogger = logger.child({
  service: "migration",
  name: "2026-05-04-notification-cleanup",
});

const OBSOLETE_TYPES = ["sos_resolved", "sos_stage2_sms", "data_share"] as const;

export async function run(): Promise<number> {
  migrationLogger.info("Démarrage cleanup notifications obsolètes", {
    types: OBSOLETE_TYPES,
  });

  const result = await NotificationModel.deleteMany({
    type: { $in: OBSOLETE_TYPES as unknown as string[] },
  });

  migrationLogger.info("Cleanup terminé", {
    deletedCount: result.deletedCount,
  });

  return result.deletedCount ?? 0;
}

if (require.main === module) {
  (async () => {
    try {
      await connectToDatabase();
      const deleted = await run();
      migrationLogger.info("Migration OK", { deleted });
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
