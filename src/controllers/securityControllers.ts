// server/src/controllers/securityControllers.ts
import { Request, Response } from "express";
import { refreshTokenService } from "../services/refreshTokenService";
import { auditService } from "../services/auditService";


/**
 * Obtenir les sessions actives de l'utilisateur connecté
 */
export async function getUserSessions(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        const currentTokenId = req.user?.tokenId;

        if (!userId) {
            return res.status(401).json({ error: "Non authentifié" });
        }

        const sessions = await refreshTokenService.getUserActiveSessions(userId);

        const formattedSessions = sessions.map((session: any) => ({
            tokenId: session.tokenId,
            ipAddress: session.ipAddress || 'Inconnue',
            userAgent: session.userAgent || 'Inconnu',
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt,
            expiresAt: session.expiresAt,
            isCurrent: session.tokenId === currentTokenId
        }));

        formattedSessions.sort((a: any, b: any) => {
            if (a.isCurrent) return -1;
            if (b.isCurrent) return 1;
            return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
        });

        res.status(200).json({ sessions: formattedSessions, count: formattedSessions.length });
    } catch (error) {
        console.error('❌ [SECURITY] Erreur sessions:', error);
        res.status(500).json({ error: "Erreur lors de la récupération des sessions" });
    }
}

/**
 * Révoquer une session spécifique
 */
export async function revokeSession(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        const { tokenId } = req.params;
        const currentTokenId = req.user?.tokenId;

        if (!userId) return res.status(401).json({ error: "Non authentifié" });
        if (!tokenId) return res.status(400).json({ error: "ID de session manquant" });
        if (tokenId === currentTokenId) {
            return res.status(400).json({ error: "Utilisez la déconnexion pour terminer votre session actuelle" });
        }

        await refreshTokenService.revokeToken(tokenId, 'user_revoked');

        await auditService.log({
            userId, action: 'SESSION_REVOKED_BY_USER', level: 'info',
            ipAddress: req.ip, userAgent: req.get('user-agent'),
            details: { revokedTokenId: tokenId }
        });

        res.status(200).json({ success: true, message: "Session révoquée avec succès" });
    } catch (error) {
        console.error('❌ [SECURITY] Erreur révocation:', error);
        res.status(500).json({ error: "Erreur lors de la révocation de la session" });
    }
}

/**
 * Révoquer toutes les sessions sauf la session actuelle
 */
export async function revokeAllOtherSessions(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        const currentTokenId = req.user?.tokenId;

        if (!userId) return res.status(401).json({ error: "Non authentifié" });

        const sessions = await refreshTokenService.getUserActiveSessions(userId);
        let revokedCount = 0;

        for (const session of sessions) {
            if (session.tokenId !== currentTokenId) {
                await refreshTokenService.revokeToken(session.tokenId, 'user_revoked_all');
                revokedCount++;
            }
        }

        await auditService.log({
            userId, action: 'ALL_OTHER_SESSIONS_REVOKED', level: 'warning',
            ipAddress: req.ip, userAgent: req.get('user-agent'),
            details: { revokedCount, keptTokenId: currentTokenId }
        });

        res.status(200).json({ success: true, message: `${revokedCount} session(s) révoquée(s)`, revokedCount });
    } catch (error) {
        console.error('❌ [SECURITY] Erreur révocation all:', error);
        res.status(500).json({ error: "Erreur lors de la révocation des sessions" });
    }
}

/**
 * Obtenir les événements de sécurité récents
 */
export async function getSecurityEvents(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "Non authentifié" });

        const events = await auditService.getUserLogs(userId, 50);

        const securityActions = [
            'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED',
            'REFRESH_TOKEN_CREATED', 'REFRESH_TOKEN_REVOKED', 'ALL_TOKENS_REVOKED',
            'TOKEN_THEFT_DETECTED', 'EMAIL_VERIFIED', 'PROFILE_UPDATED',
            'SESSION_REVOKED_BY_USER', 'ALL_OTHER_SESSIONS_REVOKED'
        ];

        const filteredEvents = events.filter(event => securityActions.includes(event.action));

        res.status(200).json({ events: filteredEvents, count: filteredEvents.length });
    } catch (error) {
        console.error('❌ [SECURITY] Erreur events:', error);
        res.status(500).json({ error: "Erreur lors de la récupération des événements" });
    }
}
