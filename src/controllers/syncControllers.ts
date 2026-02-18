import { getErrorMessage } from '../utils/errorUtils';
import { Request, Response } from "express";
import { syncService } from "../services/syncService";

export async function handleManualSync(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ message: "Utilisateur non authentifié" });
        }
        
        const synced = await syncService.syncNow(userId);
        
        res.status(200).json({
            success: true,
            message: synced ? "Synchronisation réussie" : "Aucune donnée à synchroniser",
            synced
        });
    } catch (error: unknown) {
        console.error("Erreur lors de la synchronisation manuelle:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la synchronisation",
            error: getErrorMessage(error)
        });
    }
}