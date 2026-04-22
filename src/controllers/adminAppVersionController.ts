import { Request, Response } from "express";
import { Types } from "mongoose";
import AppVersionModel from "../models/appVersion";
import { logger } from "../services/loggerService";
import { isValidSemver } from "../utils/versionUtils";

const appVersionLogger = logger.child({ service: "admin-app-version-controller" });

const DEFAULT_CONFIG = {
  ios: {
    minVersion: process.env.MIN_IOS_VERSION || "1.0.0",
    popupMessage: "Une nouvelle version est disponible, mettez à jour l'application.",
    forceUpdate: true,
  },
  android: {
    minVersion: process.env.MIN_ANDROID_VERSION || "1.0.0",
    popupMessage: "Une nouvelle version est disponible, mettez à jour l'application.",
    forceUpdate: true,
  },
};

export async function getAppVersionConfig(req: Request, res: Response) {
  try {
    const config = await AppVersionModel.findOne().lean();

    if (!config) {
      return res.json({ success: true, data: DEFAULT_CONFIG });
    }

    return res.json({
      success: true,
      data: {
        ios: config.ios,
        android: config.android,
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    appVersionLogger.error("Error fetching app version config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: "Erreur lors de la récupération de la configuration" });
  }
}

export async function updateAppVersionConfig(req: Request, res: Response) {
  try {
    let userId: string | undefined;
    if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as { id: string }).id;
    }

    const { ios, android } = req.body as {
      ios?: { minVersion?: string; popupMessage?: string; forceUpdate?: boolean };
      android?: { minVersion?: string; popupMessage?: string; forceUpdate?: boolean };
    };

    if (!ios && !android) {
      return res.status(400).json({ success: false, error: "Au moins une plateforme (ios ou android) doit être fournie" });
    }

    const errors: string[] = [];

    if (ios) {
      if (ios.minVersion !== undefined && !isValidSemver(ios.minVersion)) {
        errors.push("ios.minVersion doit être au format x.y.z (ex: 1.2.3)");
      }
      if (ios.popupMessage !== undefined) {
        if (typeof ios.popupMessage !== "string") {
          errors.push("ios.popupMessage doit être une chaîne de caractères");
        } else if (ios.popupMessage.length > 500) {
          errors.push("ios.popupMessage ne peut pas dépasser 500 caractères");
        }
      }
      if (ios.forceUpdate !== undefined && typeof ios.forceUpdate !== "boolean") {
        errors.push("ios.forceUpdate doit être un booléen");
      }
    }

    if (android) {
      if (android.minVersion !== undefined && !isValidSemver(android.minVersion)) {
        errors.push("android.minVersion doit être au format x.y.z (ex: 1.2.3)");
      }
      if (android.popupMessage !== undefined) {
        if (typeof android.popupMessage !== "string") {
          errors.push("android.popupMessage doit être une chaîne de caractères");
        } else if (android.popupMessage.length > 500) {
          errors.push("android.popupMessage ne peut pas dépasser 500 caractères");
        }
      }
      if (android.forceUpdate !== undefined && typeof android.forceUpdate !== "boolean") {
        errors.push("android.forceUpdate doit être un booléen");
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({ success: false, error: errors.join("; ") });
    }

    let config = await AppVersionModel.findOne();

    if (!config) {
      config = new AppVersionModel({
        ios: { ...DEFAULT_CONFIG.ios, ...ios },
        android: { ...DEFAULT_CONFIG.android, ...android },
        updatedBy: userId ? new Types.ObjectId(userId) : undefined,
      });
    } else {
      if (ios) {
        if (ios.minVersion !== undefined) config.ios.minVersion = ios.minVersion;
        if (ios.popupMessage !== undefined) config.ios.popupMessage = ios.popupMessage;
        if (ios.forceUpdate !== undefined) config.ios.forceUpdate = ios.forceUpdate;
      }
      if (android) {
        if (android.minVersion !== undefined) config.android.minVersion = android.minVersion;
        if (android.popupMessage !== undefined) config.android.popupMessage = android.popupMessage;
        if (android.forceUpdate !== undefined) config.android.forceUpdate = android.forceUpdate;
      }
      if (userId) config.updatedBy = new Types.ObjectId(userId);
    }

    await config.save();

    appVersionLogger.info("App version config updated", {
      userId,
      ios: ios ? { minVersion: config.ios.minVersion, forceUpdate: config.ios.forceUpdate } : undefined,
      android: android ? { minVersion: config.android.minVersion, forceUpdate: config.android.forceUpdate } : undefined,
    });

    return res.json({
      success: true,
      data: {
        ios: config.ios,
        android: config.android,
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    appVersionLogger.error("Error updating app version config", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: "Erreur lors de la mise à jour de la configuration" });
  }
}
