// server/src/controllers/sessionControllers.ts
// Note: getUserSessions a été supprimé (dead code - doublon de securityControllers.getUserSessions
// qui est la version canonique avec isCurrent + tri). Utilisé dans authRoutes et securityRoutes
// via securityControllers.
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { refreshTokenService } from "../services/refreshTokenService";
import { auditService } from "../services/auditService";
import { logger } from "../services/loggerService";
import { UserModel } from "../models/users";

const sessionLogger = logger.child({ service: "session" });

/**
 * Révoquer toutes les sessions sauf la session actuelle
 */
export async function revokeAllOtherSessions(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const currentTokenId = req.user?.tokenId;
    const { password } = req.body;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
      });
    }

    // Vérification de la présence du mot de passe
    if (!password) {
      return res.status(400).json({
        error: "Le mot de passe est requis pour cette opération",
      });
    }

    // Récupération de l'utilisateur avec le mot de passe
    const user = await UserModel.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({
        error: "Utilisateur non trouvé",
      });
    }

    // Vérification du mot de passe
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: "Mot de passe incorrect",
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

    sessionLogger.info("All other sessions revoked", {
      revokedCount,
      userId,
    });

    res.status(200).json({
      success: true,
      message: `${revokedCount} session(s) révoquée(s)`,
      revokedCount,
    });
  } catch (error) {
    sessionLogger.error("Revoke all other sessions error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: "Erreur lors de la révocation des sessions",
    });
  }
}
