import { Request, Response } from "express";
import { syncService } from "../services/syncService";
import { memoryStorage } from "../services/memoryStorageService";
import { logger } from "../services/loggerService";

const syncCtrlLogger = logger.child({ service: "sync-controller" });

export async function handleManualSync(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    const synced = await syncService.syncNow(userId);

    res.status(200).json({
      success: true,
      message: synced
        ? "Synchronisation réussie"
        : "Aucune donnée à synchroniser",
      synced,
    });
  } catch (error: unknown) {
    syncCtrlLogger.error("Manual sync error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors de la synchronisation",
      error: "Une erreur interne est survenue",
    });
  }
}

// Endpoint de refresh incrémental : permet au PC de récupérer les modifications
// faites par le mobile depuis le dernier refresh.
// Le front-end PC peut appeler cet endpoint en polling (toutes les 30-60s).
export async function handleSyncRefresh(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // Vérifier que la session existe
    if (!memoryStorage.hasSession(userId)) {
      return res.status(409).json({
        success: false,
        message: "Session mémoire non initialisée. Veuillez vous reconnecter.",
      });
    }

    // Import dynamique pour éviter les dépendances circulaires
    const { refreshFromDB } = await import("./auth/authHelpers");

    const result = await refreshFromDB(userId);
    const hasChanges = result.added + result.updated + result.deleted > 0;

    res.status(200).json({
      success: true,
      hasChanges,
      changes: result,
      message: hasChanges
        ? `${result.added} ajoutés, ${result.updated} mis à jour, ${result.deleted} supprimés`
        : "Aucun changement depuis le dernier refresh",
    });
  } catch (error: unknown) {
    syncCtrlLogger.error("Sync refresh error", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    res.status(500).json({
      success: false,
      message: "Erreur lors du refresh",
      error: "Une erreur interne est survenue",
    });
  }
}
