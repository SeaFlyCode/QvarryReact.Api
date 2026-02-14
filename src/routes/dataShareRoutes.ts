import express from "express";
import {
    handleShareData,
    handleGetSharedData,
    handleUpdateShareStatus,
    handleGetReceivedShares,
    handleGetSentShares
} from "../controllers/dataShareControllers";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// Partager des données
router.post("/", handleShareData);

// Lister les partages reçus
router.get("/received", handleGetReceivedShares);

// Lister les partages envoyés
router.get("/sent", handleGetSentShares);

// Récupérer un partage spécifique (déchiffrement)
router.get("/:shareId", handleGetSharedData);

// Accepter ou refuser un partage
router.patch("/:shareId/status", handleUpdateShareStatus);

export default router;

