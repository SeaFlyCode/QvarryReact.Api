import { Request, Response } from "express";
import AppVersionModel from "../models/appVersion";
import { logger } from "../services/loggerService";
import { compareVersions, isValidSemver } from "../utils/versionUtils";

const appVersionLogger = logger.child({ service: "mobile-app-version-controller" });

const DEFAULT_MESSAGE = "Une nouvelle version est disponible, mettez à jour l'application.";

export async function checkMobileAppVersion(req: Request, res: Response) {
  try {
    const platform = (req.headers["x-platform"] as string)?.toLowerCase();
    const currentVersion = req.headers["x-app-version"] as string;

    if (!currentVersion || !platform || (platform !== "ios" && platform !== "android")) {
      return res.json({ updateRequired: false });
    }

    if (!isValidSemver(currentVersion)) {
      appVersionLogger.warn("Invalid semver ignored in version check", {
        currentVersion,
        platform,
      });
      return res.json({ updateRequired: false });
    }

    const dbConfig = await AppVersionModel.findOne().lean();

    let minVersion: string;
    let popupMessage: string;
    let forceUpdate: boolean;

    if (dbConfig) {
      const platformConfig = dbConfig[platform as "ios" | "android"];
      minVersion = platformConfig.minVersion;
      popupMessage = platformConfig.popupMessage;
      forceUpdate = platformConfig.forceUpdate;
    } else {
      minVersion =
        platform === "ios"
          ? process.env.MIN_IOS_VERSION || "1.0.0"
          : process.env.MIN_ANDROID_VERSION || "1.0.0";
      popupMessage = DEFAULT_MESSAGE;
      forceUpdate = true;
    }

    if (compareVersions(currentVersion, minVersion) < 0) {
      appVersionLogger.info("Outdated app version detected", {
        platform,
        currentVersion,
        minVersion,
        forceUpdate,
      });

      return res.json({
        updateRequired: true,
        forceUpdate,
        message: popupMessage,
        minVersion,
        currentVersion,
        platform,
      });
    }

    return res.json({
      updateRequired: false,
      currentVersion,
      platform,
    });
  } catch (error) {
    appVersionLogger.error("Error checking app version", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: "Erreur lors de la vérification de la version" });
  }
}
