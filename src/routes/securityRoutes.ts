// server/src/routes/securityRoutes.ts
import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  getUserSessions,
  revokeSession,
  getSecurityEvents,
} from "../controllers/securityControllers";
import { revokeAllOtherSessions } from "../controllers/sessionControllers";

const router = express.Router();

// Toutes les routes de sécurité nécessitent une authentification
router.use(authMiddleware);

// GET /api/security/sessions - Obtenir les sessions actives
router.get("/sessions", getUserSessions);

// DELETE /api/security/sessions/:tokenId - Révoquer une session spécifique
router.delete(
  "/sessions/:tokenId",
  (req, res, next) => {
    const tokenId = req.params.tokenId;
    if (!tokenId || !/^[a-f0-9]{32}$/.test(tokenId)) {
      return res.status(400).json({ error: "ID de session invalide" });
    }
    next();
  },
  revokeSession,
);

// POST /api/security/sessions/revoke-all - Révoquer toutes les autres sessions
router.post("/sessions/revoke-all", revokeAllOtherSessions);

// GET /api/security/events - Obtenir les événements de sécurité récents
router.get("/events", getSecurityEvents);

export default router;
