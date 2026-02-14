// server/src/controllers/sessionControllers.ts
import { Request, Response } from "express";
import { refreshTokenService } from "../services/refreshTokenService";

/**
 * Obtenir les sessions actives de l'utilisateur connecté
 */
export async function getUserSessions(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                error: "Non authentifié"
            });
        }

        const sessions = await refreshTokenService.getUserActiveSessions(userId);

        // Formater les sessions pour le client (masquer les tokens)
        const formattedSessions = sessions.map((session: any) => ({
            tokenId: session.tokenId,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt,
            expiresAt: session.expiresAt
        }));

        res.status(200).json({
            sessions: formattedSessions,
            count: formattedSessions.length
        });
    } catch (error) {
        console.error('❌ [SESSIONS] Erreur lors de la récupération des sessions:', error);
        res.status(500).json({
            error: "Erreur lors de la récupération des sessions"
        });
    }
}

/**
 * Révoquer toutes les sessions sauf la session actuelle
 */
export async function revokeAllOtherSessions(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                error: "Non authentifié"
            });
        }

        // Révoquer tous les tokens
        const count = await refreshTokenService.revokeAllUserTokens(userId, 'user_requested');

        console.log(`🔐 [SESSIONS] ${count} sessions révoquées pour userId: ${userId}`);

        res.status(200).json({
            success: true,
            message: `${count} session(s) révoquée(s)`,
            revokedCount: count
        });
    } catch (error) {
        console.error('❌ [SESSIONS] Erreur lors de la révocation des sessions:', error);
        res.status(500).json({
            error: "Erreur lors de la révocation des sessions"
        });
    }
}
