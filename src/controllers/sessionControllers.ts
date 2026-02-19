// server/src/controllers/sessionControllers.ts
// Note: getUserSessions a été supprimé (dead code - doublon de securityControllers.getUserSessions
// qui est la version canonique avec isCurrent + tri). Utilisé dans authRoutes et securityRoutes
// via securityControllers.
import { Request, Response } from "express";
import { refreshTokenService } from "../services/refreshTokenService";
import { auditService } from "../services/auditService";

/**
 * Révoquer toutes les sessions sauf la session actuelle
 */
export async function revokeAllOtherSessions(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const currentTokenId = req.user?.tokenId;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
      });
    }

    const sessions = await refreshTokenService.getUserActiveSessions(userId);
    let revokedCount = 0;

    for (const session of sessions) {
      if (session.tokenId !== currentTokenId) {
        await refreshTokenService.revokeToken(
          session.tokenId,
          "user_revoked_all",
        );
        revokedCount++;
      }
    }

    await auditService.log({
      userId,
      action: "ALL_OTHER_SESSIONS_REVOKED",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { revokedCount, keptTokenId: currentTokenId },
    });

    console.log(
      `🔐 [SESSIONS] ${revokedCount} sessions révoquées pour userId: ${userId} (session actuelle préservée)`,
    );

    res.status(200).json({
      success: true,
      message: `${revokedCount} session(s) révoquée(s)`,
      revokedCount,
    });
  } catch (error) {
    console.error(
      "❌ [SESSIONS] Erreur lors de la révocation des sessions:",
      error,
    );
    res.status(500).json({
      error: "Erreur lors de la révocation des sessions",
    });
  }
}
