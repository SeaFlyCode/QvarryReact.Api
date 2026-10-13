// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER — DONNÉES SPÉLÉO PAR BBOX
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/speleo?bbox=minLon,minLat,maxLon,maxLat&zoom=N&layers=cavites,sic,...
//
// Parse + valide les paramètres, délègue au service (proxy + cache des API
// publiques Géorisques / WFS IGN), renvoie la réponse au contrat. Auth JWT via
// authMiddleware (comme /api/v1/hydro-risk).
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { logger } from "../services/loggerService";
import { getErrorMessage } from "../utils/errorUtils";
import { getSpeleoData } from "../services/speleoService";
import { ALL_LAYERS, BBox, SpeleoLayer } from "../types/speleo";

const speleoLogger = logger.child({ service: "speleo-controller" });

/** Latitude valide en EPSG:4326. */
const isLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
/** Longitude valide en EPSG:4326. */
const isLon = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;

/** Zoom Leaflet plausible (garde-fou). */
const MIN_ZOOM_PARAM = 0;
const MAX_ZOOM_PARAM = 22;

/**
 * Parse "minLon,minLat,maxLon,maxLat" → BBox validée (ordre lon/lat, EPSG:4326).
 * Renvoie null si malformée ou incohérente (min > max, hors bornes).
 */
export function parseBBox(raw: unknown): BBox | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;

  const [minLon, minLat, maxLon, maxLat] = parts;
  if (!isLon(minLon) || !isLon(maxLon) || !isLat(minLat) || !isLat(maxLat)) {
    return null;
  }
  if (minLon >= maxLon || minLat >= maxLat) return null;

  return { minLon, minLat, maxLon, maxLat };
}

/** Parse le zoom entier (clampé aux bornes Leaflet plausibles). Null si invalide. */
export function parseZoom(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < MIN_ZOOM_PARAM || n > MAX_ZOOM_PARAM) return null;
  return n;
}

/**
 * Parse la liste CSV de couches → sous-ensemble valide de ALL_LAYERS.
 * Absent / vide → toutes les couches (défaut). Valeurs inconnues ignorées.
 * Renvoie null UNIQUEMENT si toutes les valeurs fournies sont invalides.
 */
export function parseLayers(raw: unknown): SpeleoLayer[] | null {
  if (raw === undefined || raw === null) return [...ALL_LAYERS];
  const str = Array.isArray(raw) ? raw.join(",") : String(raw);
  const trimmed = str.trim();
  if (trimmed.length === 0) return [...ALL_LAYERS];

  const requested = trimmed
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const valid = requested.filter((s): s is SpeleoLayer =>
    (ALL_LAYERS as string[]).includes(s),
  );
  // Dédoublonnage en conservant l'ordre.
  const unique = [...new Set(valid)];
  if (unique.length === 0) return null;
  return unique;
}

/**
 * GET /api/v1/speleo
 */
export async function handleGetSpeleo(req: Request, res: Response) {
  try {
    if (!req.user?.id) {
      return res
        .status(401)
        .json({ message: "Authentification requise", code: "UNAUTHORIZED" });
    }

    const bbox = parseBBox(req.query.bbox);
    if (!bbox) {
      return res.status(400).json({
        message:
          "Paramètre bbox invalide. Attendu : minLon,minLat,maxLon,maxLat (EPSG:4326).",
        code: "INVALID_BBOX",
      });
    }

    const zoom = parseZoom(req.query.zoom);
    if (zoom === null) {
      return res.status(400).json({
        message: "Paramètre zoom invalide (entier 0-22 attendu).",
        code: "INVALID_ZOOM",
      });
    }

    const layers = parseLayers(req.query.layers);
    if (layers === null) {
      return res.status(400).json({
        message:
          "Paramètre layers invalide. Sous-ensemble attendu : cavites,sic,zps,apb,znieff1.",
        code: "INVALID_LAYERS",
      });
    }

    const result = await getSpeleoData(bbox, zoom, layers);
    return res.status(200).json(result);
  } catch (error) {
    speleoLogger.error("Erreur récupération données spéléo", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: getErrorMessage(
        error,
        "Erreur lors de la récupération des données spéléo",
      ),
      code: "SPELEO_ERROR",
    });
  }
}
