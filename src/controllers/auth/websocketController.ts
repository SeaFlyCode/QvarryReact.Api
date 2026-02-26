import { getErrorMessage } from "../../utils/errorUtils";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { logger } from "../../services/loggerService";

const wsAuthLogger = logger.child({ service: "ws-auth" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: OBTENIR UN TOKEN TEMPORAIRE POUR WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

export const getWebSocketToken = (req: Request, res: Response) => {
  try {
    // Récupérer l'utilisateur authentifié (via le middleware authMiddleware)
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Non authentifié",
      });
    }

    // Générer un token JWT temporaire spécifique pour WebSocket
    // Durée de vie courte : 5 minutes
    if (!process.env.JWT_SECRET) {
      wsAuthLogger.error("JWT_SECRET not defined");
      throw new Error("Configuration de sécurité manquante");
    }

    // AUTH-004 CORRIGÉ: Ajout d'un JTI unique pour token à usage unique
    const tokenJti = crypto.randomBytes(16).toString("hex");

    const wsToken = jwt.sign(
      {
        id: userId,
        type: "websocket",
        isAdmin: req.user?.isAdmin || false,
        jti: tokenJti, // JTI unique pour validation à usage unique
      },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }, // Token valide 5 minutes
    );

    wsAuthLogger.info("WebSocket token generated", {
      userId,
      jti: tokenJti.substring(0, 8),
      expiresIn: "5m",
    });

    return res.status(200).json({
      token: wsToken,
      expiresIn: 300, // 5 minutes en secondes
    });
  } catch (error: unknown) {
    wsAuthLogger.error("WebSocket token generation error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      error: "Erreur lors de la génération du token",
    });
  }
};
