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

    // Générer deux JTI distincts — un par connexion WS
    const notificationsJti = crypto.randomBytes(16).toString("hex");
    const messagesJti = crypto.randomBytes(16).toString("hex");

    const commonPayload = {
      id: userId,
      type: "websocket",
      isAdmin: req.user?.isAdmin || false,
    };

    // Token pour /ws/notifications
    const notificationsToken = jwt.sign(
      { ...commonPayload, jti: notificationsJti, wsType: "notifications" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );

    // Token pour /ws/messages
    const messagesToken = jwt.sign(
      { ...commonPayload, jti: messagesJti, wsType: "messages" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );

    wsAuthLogger.info("WebSocket tokens generated", {
      userId,
      notificationsJti: notificationsJti.substring(0, 8),
      messagesJti: messagesJti.substring(0, 8),
      expiresIn: "5m",
    });

    return res.status(200).json({
      notificationsToken,
      messagesToken,
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
