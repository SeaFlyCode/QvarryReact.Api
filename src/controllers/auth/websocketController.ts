import { getErrorMessage } from "../../utils/errorUtils";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

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
      console.error("❌ [SECURITY] JWT_SECRET non défini");
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

    console.log(
      `🔑 [AUTH] Token WebSocket généré pour userId: ${userId} (jti: ${tokenJti.substring(0, 8)}..., expire dans 5min)`,
    );

    return res.status(200).json({
      token: wsToken,
      expiresIn: 300, // 5 minutes en secondes
    });
  } catch (error: unknown) {
    console.error(
      "❌ [AUTH] Erreur lors de la génération du token WebSocket:",
      error,
    );
    return res.status(500).json({
      error: "Erreur lors de la génération du token",
      details: getErrorMessage(error),
    });
  }
};
