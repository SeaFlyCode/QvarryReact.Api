// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTION ROUTES
// ═══════════════════════════════════════════════════════════════════════════
// Routes appelées depuis les boutons d'action des notifications mobiles.
// L'app peut être killed : tant que le JWT en SecureStore est valide, ces
// endpoints fonctionnent. Si le token est expiré, le mobile fallback en
// ouvrant l'app (gestion côté mobile, hors scope backend).
// ═══════════════════════════════════════════════════════════════════════════

import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import {
  handleQuickActionSosConfirmSafe,
  handleQuickActionContactAccept,
  handleQuickActionContactRefuse,
  handleQuickActionShareAccept,
  handleQuickActionShareRefuse,
} from "../controllers/quickActionControllers";

const router = express.Router();

// Toutes les routes nécessitent une authentification standard JWT
router.use(authMiddleware);

// ─── SOS ─────────────────────────────────────────────────────────────────
router.post("/sos/confirm-safe", handleQuickActionSosConfirmSafe);

// ─── Contact ─────────────────────────────────────────────────────────────
router.post("/contact/accept", handleQuickActionContactAccept);
router.post("/contact/refuse", handleQuickActionContactRefuse);

// ─── Share ───────────────────────────────────────────────────────────────
router.post("/share/accept", handleQuickActionShareAccept);
router.post("/share/refuse", handleQuickActionShareRefuse);

export default router;
