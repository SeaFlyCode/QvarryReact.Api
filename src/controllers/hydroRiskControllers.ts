// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER — INDICATEUR DE RISQUE HYDRO
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/points/:id/hydro-risk          → indicateur d'un point
// GET /api/v1/hydro-risk/batch?pointIds=a,b,c → indicateurs de plusieurs points
//
// Ownership : on ne calcule l'indicateur que pour les points appartenant à
// l'utilisateur authentifié (req.user.id). Le déchiffrement des coordonnées se
// fait CÔTÉ SERVEUR uniquement, via le service (decryptPointLocation).
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import mongoose from "mongoose";
import PointModel from "../models/points";
import { logger } from "../services/loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import {
  computeHydroRisk,
  decryptPointLocation,
} from "../services/hydroRiskService";
import { HydroRiskResult } from "../types/hydroRisk";

const hydroLogger = logger.child({ service: "hydro-risk-controller" });

/** Nombre max d'IDs acceptés en batch. */
const MAX_BATCH_IDS = 50;

/**
 * Charge un point appartenant à l'utilisateur, déchiffre ses coordonnées
 * (côté serveur) et calcule l'indicateur. Renvoie null si introuvable / non
 * autorisé / coordonnées indéchiffrables.
 */
async function buildRiskForPoint(
  pointId: string,
  userId: string,
): Promise<HydroRiskResult | null> {
  const point = await PointModel.findOne({
    _id: pointId,
    userId,
  })
    .select("location_encrypted")
    .lean()
    .maxTimeMS(5000);

  if (!point || !point.location_encrypted) return null;

  const coord = await decryptPointLocation(userId, point.location_encrypted);
  if (!coord) return null;

  return computeHydroRisk(pointId, coord);
}

/**
 * GET /api/v1/points/:id/hydro-risk
 */
export async function handleGetPointHydroRisk(req: Request, res: Response) {
  try {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ message: "Authentification requise", code: "UNAUTHORIZED" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ message: "ID de point invalide", code: "INVALID_POINT_ID" });
    }

    const result = await buildRiskForPoint(id, req.user.id);
    if (!result) {
      return res.status(404).json({
        message: "Point introuvable ou coordonnées indisponibles",
        code: "POINT_NOT_FOUND",
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    hydroLogger.error("Erreur calcul hydro-risk point", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: getErrorMessage(error, "Erreur lors du calcul de l'indicateur"),
      code: "HYDRO_RISK_ERROR",
    });
  }
}

/**
 * GET /api/v1/hydro-risk/batch?pointIds=a,b,c
 * Renvoie { results: HydroRiskResult[], errors: { pointId, reason }[] }.
 */
export async function handleGetHydroRiskBatch(req: Request, res: Response) {
  try {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ message: "Authentification requise", code: "UNAUTHORIZED" });
    }

    const raw = req.query.pointIds;
    const rawStr = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
    const ids = rawStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (ids.length === 0) {
      return res.status(400).json({
        message: "Paramètre pointIds requis (liste séparée par des virgules)",
        code: "MISSING_POINT_IDS",
      });
    }

    if (ids.length > MAX_BATCH_IDS) {
      return res.status(400).json({
        message: `Trop d'identifiants (max ${MAX_BATCH_IDS})`,
        code: "TOO_MANY_POINT_IDS",
      });
    }

    // Dédoublonnage pour éviter le travail redondant.
    const uniqueIds = [...new Set(ids)];
    const userId = req.user.id;

    const settled = await Promise.allSettled(
      uniqueIds.map(async (id) => {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          throw new Error("INVALID_ID");
        }
        const result = await buildRiskForPoint(id, userId);
        if (!result) throw new Error("NOT_FOUND");
        return result;
      }),
    );

    const results: HydroRiskResult[] = [];
    const errors: Array<{ pointId: string; reason: string }> = [];

    settled.forEach((outcome, i) => {
      const pointId = uniqueIds[i];
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        const reason =
          outcome.reason instanceof Error ? outcome.reason.message : "ERROR";
        errors.push({
          pointId,
          reason: reason === "INVALID_ID" ? "INVALID_ID" : "NOT_FOUND",
        });
      }
    });

    return res.status(200).json({ results, errors });
  } catch (error) {
    hydroLogger.error("Erreur calcul hydro-risk batch", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: getErrorMessage(error, "Erreur lors du calcul des indicateurs"),
      code: "HYDRO_RISK_BATCH_ERROR",
    });
  }
}
