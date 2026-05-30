// ═══════════════════════════════════════════════════════════════════════════
// SERVICE — INDICATEUR DE RISQUE HYDRO (app spéléo, France)
// ═══════════════════════════════════════════════════════════════════════════
// Pour un point (cavité), calcule un indice de "conditions favorisant
// l'instabilité/effondrement" à partir de signaux open data (sans clé API) :
//   1. Pluie antécédente   — Open-Meteo (forecast + past_days)        [mesuré]
//   2. Niveau cours d'eau  — Hub'Eau Hydrométrie (FR)                 [mesuré]
//   3. Niveau nappe        — Hub'Eau Piézométrie (FR)                 [mesuré]
//   4. Vigilance crue      — Vigicrues (FR, officiel)                 [sécurité]
//
// Les signaux 1-3 produisent le SCORE 0-100. Le signal 4 (Vigicrues) ne participe
// PAS au score : c'est une garde de sécurité officielle qui ne peut que RELEVER
// le `level` qualitatif final (jaune→modere, orange→defavorable, rouge→
// tres_defavorable), jamais l'abaisser. Voir applyVigicruesFloor().
//
// ⚠️ C'EST UN INDICATEUR, PAS UNE PRÉDICTION. Voir DISCLAIMER plus bas.
//
// CONFIDENTIALITÉ (critique) :
//   - Les coordonnées des points sont chiffrées par clé utilisateur
//     (location_encrypted, déchiffré via decryptUserKeys — même mécanisme que
//     mobileSyncService/dataShareService).
//   - On ne déchiffre QUE côté serveur, et on n'envoie JAMAIS la position
//     exacte aux APIs tierces : les coords sont arrondies à une grille ~1 km
//     (GRID_DEG ≈ 0.01°) AVANT tout appel externe. Le cache est keyé sur la
//     coordonnée arrondie → plusieurs cavités proches mutualisent les appels.
//
// CACHE : par localisation arrondie. TTL pluie + nappe ≈ 24 h, cours d'eau ≈ 3 h.
//
// ROBUSTESSE : une source indisponible / sans station proche → composant à null,
//   l'indice est recalculé sur les signaux disponibles (jamais de crash).
//   Timeouts courts sur chaque appel externe.
// ═══════════════════════════════════════════════════════════════════════════

import { decryptUserKeys } from "../utils/userEncryptionUtils";
import { safeJsonParse } from "../utils/secureJsonParser";
import { logger } from "./loggerService";
import {
  HydroRiskLevel,
  HydroRiskResult,
  HydroTrend,
  LatLng,
  RainComponent,
  RiverComponent,
  GroundwaterComponent,
  VigicruesComponent,
  VigicruesColor,
} from "../types/hydroRisk";

const hydroLogger = logger.child({ service: "hydro-risk" });

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTES & PARAMÈTRES (documentés — choix d'implémentation)
// ───────────────────────────────────────────────────────────────────────────

export const DISCLAIMER =
  "Indicateur de conditions hydrométéorologiques uniquement — il ne constitue " +
  "PAS une prédiction d'effondrement ni un avis de sécurité. Vérifiez toujours " +
  "les conditions sur le terrain, la météo et les bulletins officiels avant " +
  "toute exploration. Données : Open-Meteo, Hub'Eau (eaufrance.fr), " +
  "Vigicrues (vigicrues.gouv.fr).";

/** Grille de confidentialité : ~0.01° ≈ 1.1 km. On n'appelle jamais les APIs avec la position exacte. */
const GRID_DEG = 0.01;

/** Fenêtre d'analyse de la pluie antécédente (jours). L'eau percole lentement. */
const RAIN_WINDOW_DAYS = 15;

/** Timeout court par appel externe (ms). */
const FETCH_TIMEOUT_MS = 4000;

/** TTL de cache par type de signal. Cours d'eau évolue vite → TTL court. */
const TTL_RAIN_MS = 24 * 60 * 60 * 1000; // 24 h
const TTL_GROUNDWATER_MS = 24 * 60 * 60 * 1000; // 24 h
const TTL_RIVER_MS = 3 * 60 * 60 * 1000; // 3 h
/** Vigilance crue : ça bouge vite en épisode, TTL court. */
const TTL_VIGICRUES_MS = 60 * 60 * 1000; // 1 h

/** Rayon de recherche d'une station Hub'Eau autour du point arrondi (mètres). */
const STATION_SEARCH_RADIUS_M = 30000; // 30 km

/**
 * Distance max (km) entre le point arrondi et un tronçon de vigilance Vigicrues
 * pour considérer qu'il s'applique. Au-delà, on estime que le point n'est pas
 * couvert par ce cours d'eau surveillé → vigicrues: null.
 */
const VIGICRUES_MATCH_RADIUS_KM = 15;

/**
 * Pondérations de combinaison des 3 signaux pour le score final.
 * Choix : la pluie antécédente est le moteur principal de l'apport d'eau dans
 * une cavité ; nappe et cours d'eau affinent le contexte hydrologique local.
 * Les poids sont renormalisés sur les seuls signaux disponibles (robustesse).
 */
const WEIGHTS = { rain: 0.5, river: 0.3, groundwater: 0.2 };

/** Bornes France métropolitaine (approx.) pour décider d'interroger Hub'Eau (FR only). */
const FRANCE_BBOX = { latMin: 41.0, latMax: 51.5, lngMin: -5.5, lngMax: 9.8 };

// Endpoints
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HUBEAU_HYDRO_STATIONS =
  "https://hubeau.eaufrance.fr/api/v1/hydrometrie/referentiel/stations";
const HUBEAU_HYDRO_OBS =
  "https://hubeau.eaufrance.fr/api/v1/hydrometrie/observations_tr";
const HUBEAU_PIEZO_STATIONS =
  "https://hubeau.eaufrance.fr/api/v1/niveaux_nappes/stations";
const HUBEAU_PIEZO_CHRONIQUES =
  "https://hubeau.eaufrance.fr/api/v1/niveaux_nappes/chroniques";
/**
 * FeatureCollection nationale des tronçons de vigilance crue (MultiLineString),
 * avec le niveau de vigilance courant (propriété NivInfViCr : 1=vert … 4=rouge).
 * Pas de paramètre de position : on filtre/apparie côté serveur sur la coord
 * ARRONDIE (la coord exacte ne quitte jamais le serveur).
 */
const VIGICRUES_INFO_GEOJSON =
  "https://www.vigicrues.gouv.fr/services/1/InfoVigiCru.geojson";

// ───────────────────────────────────────────────────────────────────────────
// CACHE MÉMOIRE SIMPLE À TTL (keyé sur coordonnée arrondie)
// ───────────────────────────────────────────────────────────────────────────
// Cache léger (volume borné par la grille 1 km). Pas de dépendance Redis :
// l'indicateur n'est ni critique ni cross-instance. Si besoin de partage
// multi-instances plus tard, brancher getRedisClient() ici.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Réinitialise le cache (utile pour les tests). */
export function _clearHydroCache(): void {
  cache.clear();
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS GÉO / CONFIDENTIALITÉ
// ───────────────────────────────────────────────────────────────────────────

/**
 * Arrondit des coordonnées exactes à la grille de confidentialité (~1 km).
 * À appeler AVANT tout appel externe — on n'expose jamais la position réelle.
 */
export function roundToGrid(coord: LatLng): LatLng {
  const snap = (v: number) => Math.round(v / GRID_DEG) * GRID_DEG;
  // toFixed(2) pour éviter les artefacts flottants (0.07000000001).
  return {
    lat: Number(snap(coord.lat).toFixed(2)),
    lng: Number(snap(coord.lng).toFixed(2)),
  };
}

function isInFrance(coord: LatLng): boolean {
  return (
    coord.lat >= FRANCE_BBOX.latMin &&
    coord.lat <= FRANCE_BBOX.latMax &&
    coord.lng >= FRANCE_BBOX.lngMin &&
    coord.lng <= FRANCE_BBOX.lngMax
  );
}

function gridKey(coord: LatLng): string {
  return `${coord.lat.toFixed(2)}:${coord.lng.toFixed(2)}`;
}

// ───────────────────────────────────────────────────────────────────────────
// FETCH ROBUSTE (timeout court, JSON sûr, jamais de throw vers l'appelant)
// ───────────────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      hydroLogger.warn("Réponse API externe non OK", {
        status: res.status,
        // On ne logge pas l'URL complète (contient des coords arrondies) → host seul.
        host: new URL(url).host,
      });
      return null;
    }
    const text = await res.text();
    return safeJsonParse(text, {
      context: "hydro-risk-external",
      maxDepth: 12,
    }) as T;
  } catch (error) {
    hydroLogger.warn("Échec appel API externe (timeout/réseau)", {
      host: (() => {
        try {
          return new URL(url).host;
        } catch {
          return "invalid-url";
        }
      })(),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SIGNAL 1 — PLUIE ANTÉCÉDENTE (Open-Meteo)
// ───────────────────────────────────────────────────────────────────────────
// Cumul PONDÉRÉ sur 15 jours, poids LINÉAIRE DÉCROISSANT : J-1 pèse le plus,
// J-15 le moins. Justification : la pluie récente sature les sols/cavités plus
// que la pluie ancienne (déjà drainée). Le cumul pondéré est ensuite comparé à
// des seuils en mm (absolus côté pluie : un volume d'eau reste un volume d'eau,
// contrairement aux niveaux de rivière/nappe qui sont relatifs à leur station).

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
  };
}

function weightedRainCumul(daily: number[]): number {
  // daily[0] = jour le plus ancien ... daily[n-1] = J-1 (Open-Meteo trie croissant).
  // Poids linéaire : le plus récent = n, le plus ancien = 1, normalisé.
  const n = daily.length;
  if (n === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < n; i++) {
    const weight = i + 1; // i croissant = plus récent = plus de poids
    weightedSum += (daily[i] ?? 0) * weight;
    weightTotal += weight;
  }
  // Re-échelonné sur le total de poids "plat" pour rester homogène à des mm cumulés.
  return (weightedSum / weightTotal) * n;
}

function rainLevel(cumulMm: number): HydroRiskLevel {
  // Seuils mm pondérés sur ~15 j (ordre de grandeur saison tempérée FR).
  if (cumulMm < 30) return "favorable";
  if (cumulMm < 70) return "modere";
  if (cumulMm < 120) return "defavorable";
  return "tres_defavorable";
}

export async function getRainComponent(coord: LatLng): Promise<RainComponent> {
  const key = `rain:${gridKey(coord)}`;
  const cached = cacheGet<RainComponent>(key);
  if (cached) return cached;

  const url =
    `${OPEN_METEO_URL}?latitude=${coord.lat}&longitude=${coord.lng}` +
    `&daily=precipitation_sum&past_days=${RAIN_WINDOW_DAYS}&forecast_days=1` +
    `&timezone=auto`;

  const data = await fetchJson<OpenMeteoResponse>(url);

  let cumulMm = 0;
  let days = 0;
  if (data?.daily?.precipitation_sum && data.daily.precipitation_sum.length) {
    const series = data.daily.precipitation_sum
      .slice(0, RAIN_WINDOW_DAYS)
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
    days = series.length;
    cumulMm = Math.round(weightedRainCumul(series) * 10) / 10;
  }

  const component: RainComponent = {
    cumulMm,
    days,
    level: rainLevel(cumulMm),
  };
  // Si days === 0, la source a échoué : on cache court (TTL river) pour retenter vite.
  cacheSet(key, component, days === 0 ? TTL_RIVER_MS : TTL_RAIN_MS);
  return component;
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS STATISTIQUES (seuils RELATIFS par percentile)
// ───────────────────────────────────────────────────────────────────────────

/** Percentile (0-100) d'une valeur dans une série. Renvoie 0-100. */
function percentileOf(value: number, series: number[]): number {
  const valid = series.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return 50;
  const below = valid.filter((v) => v < value).length;
  return Math.round((below / valid.length) * 100);
}

/** Niveau qualitatif à partir d'un percentile (signal relatif rivière/nappe). */
function levelFromPercentile(p: number): HydroRiskLevel {
  if (p < 40) return "favorable";
  if (p < 70) return "modere";
  if (p < 90) return "defavorable";
  return "tres_defavorable";
}

/** Tendance à partir des dernières valeurs d'une série chronologique. */
function trendFromSeries(values: number[]): HydroTrend {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length < 4) return "stable";
  const half = Math.floor(valid.length / 2);
  const older = valid.slice(0, half);
  const recent = valid.slice(half);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const oldAvg = avg(older);
  const recentAvg = avg(recent);
  if (oldAvg === 0) return "stable";
  const delta = (recentAvg - oldAvg) / Math.abs(oldAvg);
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "stable";
}

// ───────────────────────────────────────────────────────────────────────────
// SIGNAL 2 — NIVEAU COURS D'EAU (Hub'Eau Hydrométrie)
// ───────────────────────────────────────────────────────────────────────────

interface HubeauStationsResponse {
  data?: Array<{
    code_station?: string;
    code_bss?: string;
    latitude?: number;
    longitude?: number;
    longitude_station?: number;
    latitude_station?: number;
  }>;
}

interface HubeauHydroObsResponse {
  data?: Array<{ resultat_obs?: number; grandeur_hydro?: string }>;
}

export async function getRiverComponent(
  coord: LatLng,
): Promise<RiverComponent | null> {
  if (!isInFrance(coord)) return null;

  const key = `river:${gridKey(coord)}`;
  const cached = cacheGet<RiverComponent | null>(key);
  if (cached !== undefined) return cached;

  // 1. Station la plus proche (recherche par distance Hub'Eau).
  const stationsUrl =
    `${HUBEAU_HYDRO_STATIONS}?latitude=${coord.lat}&longitude=${coord.lng}` +
    `&distance=${STATION_SEARCH_RADIUS_M / 1000}&en_service=true&size=1&format=json`;
  const stations = await fetchJson<HubeauStationsResponse>(stationsUrl);
  const station = stations?.data?.[0];
  const stationCode = station?.code_station;

  if (!stationCode) {
    // Pas de station proche : composant absent, on cache pour ne pas re-spammer.
    cacheSet<RiverComponent | null>(key, null, TTL_RIVER_MS);
    return null;
  }

  // 2. Observations temps réel (hauteur H, en mm dans Hub'Eau → converti en m).
  const obsUrl =
    `${HUBEAU_HYDRO_OBS}?code_entite=${encodeURIComponent(stationCode)}` +
    `&grandeur_hydro=H&size=500&sort=desc`;
  const obs = await fetchJson<HubeauHydroObsResponse>(obsUrl);
  const rawSeries = (obs?.data ?? [])
    .map((o) => o.resultat_obs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (rawSeries.length === 0) {
    const component: RiverComponent = {
      station: stationCode,
      heightM: null,
      trend: "stable",
      level: "favorable",
    };
    cacheSet<RiverComponent | null>(key, component, TTL_RIVER_MS);
    return component;
  }

  // Hub'Eau renvoie sort=desc → series[0] = plus récent. On remet en ordre chrono.
  const chrono = [...rawSeries].reverse();
  const latestMm = rawSeries[0];
  const heightM = Math.round((latestMm / 1000) * 1000) / 1000;

  // Seuil RELATIF : percentile de la valeur courante dans l'historique récent dispo.
  const p = percentileOf(latestMm, rawSeries);

  const component: RiverComponent = {
    station: stationCode,
    heightM,
    trend: trendFromSeries(chrono.slice(-12)),
    level: levelFromPercentile(p),
  };
  cacheSet<RiverComponent | null>(key, component, TTL_RIVER_MS);
  return component;
}

// ───────────────────────────────────────────────────────────────────────────
// SIGNAL 3 — NIVEAU NAPPE (Hub'Eau Piézométrie)
// ───────────────────────────────────────────────────────────────────────────

interface HubeauPiezoChroniquesResponse {
  data?: Array<{ niveau_nappe_eau?: number; profondeur_nappe?: number }>;
}

export async function getGroundwaterComponent(
  coord: LatLng,
): Promise<GroundwaterComponent | null> {
  if (!isInFrance(coord)) return null;

  const key = `gw:${gridKey(coord)}`;
  const cached = cacheGet<GroundwaterComponent | null>(key);
  if (cached !== undefined) return cached;

  // 1. Station piézométrique la plus proche.
  const stationsUrl =
    `${HUBEAU_PIEZO_STATIONS}?latitude=${coord.lat}&longitude=${coord.lng}` +
    `&distance=${STATION_SEARCH_RADIUS_M / 1000}&size=1&format=json`;
  const stations = await fetchJson<HubeauStationsResponse>(stationsUrl);
  const stationCode = stations?.data?.[0]?.code_bss;

  if (!stationCode) {
    cacheSet<GroundwaterComponent | null>(key, null, TTL_GROUNDWATER_MS);
    return null;
  }

  // 2. Chronique récente du niveau de nappe.
  const chroniquesUrl =
    `${HUBEAU_PIEZO_CHRONIQUES}?code_bss=${encodeURIComponent(stationCode)}` +
    `&size=300&sort=desc`;
  const chroniques = await fetchJson<HubeauPiezoChroniquesResponse>(
    chroniquesUrl,
  );
  const rawSeries = (chroniques?.data ?? [])
    .map((c) => c.niveau_nappe_eau)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (rawSeries.length === 0) {
    const component: GroundwaterComponent = {
      station: stationCode,
      trend: "stable",
      level: "favorable",
    };
    cacheSet<GroundwaterComponent | null>(key, component, TTL_GROUNDWATER_MS);
    return component;
  }

  const chrono = [...rawSeries].reverse(); // ordre chronologique
  const p = percentileOf(rawSeries[0], rawSeries);

  const component: GroundwaterComponent = {
    station: stationCode,
    trend: trendFromSeries(chrono.slice(-12)),
    level: levelFromPercentile(p),
  };
  cacheSet<GroundwaterComponent | null>(key, component, TTL_GROUNDWATER_MS);
  return component;
}

// ───────────────────────────────────────────────────────────────────────────
// SIGNAL 4 — VIGILANCE CRUE OFFICIELLE (Vigicrues)
// ───────────────────────────────────────────────────────────────────────────
// SOURCE retenue : InfoVigiCru.geojson (vigicrues.gouv.fr) — FeatureCollection
//   nationale, mise à jour en continu, des tronçons de vigilance crue. Chaque
//   feature = un tronçon de cours d'eau surveillé (geometry MultiLineString) +
//   propriétés : lbentcru (libellé), NivInfViCr (1=vert,2=jaune,3=orange,4=rouge),
//   dhmentcru (date de dernière mise à jour).
//
// APPARIEMENT GÉO : les tronçons sont des LIGNES (pas des polygones de
//   département). On calcule donc la distance minimale entre la coordonnée
//   ARRONDIE et les segments de chaque tronçon, et on retient le tronçon le plus
//   proche s'il est à ≤ VIGICRUES_MATCH_RADIUS_KM (sinon le point n'est pas
//   couvert → vigicrues: null). Approche robuste, sans dépendance géo lourde.
//
// CONFIDENTIALITÉ : aucun paramètre de position dans l'URL (FeatureCollection
//   nationale), et l'appariement se fait localement sur la coord déjà arrondie.

interface VigicruesGeometry {
  type?: string;
  // MultiLineString: number[][][] ; LineString: number[][] (coords [lng,lat]).
  coordinates?: unknown;
}

interface VigicruesFeature {
  properties?: {
    lbentcru?: string;
    NivInfViCr?: number;
    dhmentcru?: string;
  };
  geometry?: VigicruesGeometry;
}

interface VigicruesGeoJson {
  features?: VigicruesFeature[];
}

/** Mappe le code NivInfViCr (1-4) Vigicrues → couleur. null si inconnu. */
function vigicruesColorFromCode(code: number | undefined): VigicruesColor | null {
  switch (code) {
    case 1:
      return "vert";
    case 2:
      return "jaune";
    case 3:
      return "orange";
    case 4:
      return "rouge";
    default:
      return null;
  }
}

const VIGICRUES_LABELS: Record<VigicruesColor, string> = {
  vert: "Vigilance verte (pas de vigilance particulière)",
  jaune: "Vigilance jaune",
  orange: "Vigilance orange",
  rouge: "Vigilance rouge",
};

/**
 * Plancher de niveau qualitatif imposé par une couleur de vigilance crue.
 * RÈGLE DE SÉCURITÉ : Vigicrues ne peut que RELEVER le niveau, jamais l'abaisser.
 *   vert   → aucun plancher (null, le calcul mesuré décide seul)
 *   jaune  → au moins "modere"
 *   orange → au moins "defavorable"
 *   rouge  → "tres_defavorable"
 */
function vigicruesFloorLevel(color: VigicruesColor): HydroRiskLevel | null {
  switch (color) {
    case "vert":
      return null;
    case "jaune":
      return "modere";
    case "orange":
      return "defavorable";
    case "rouge":
      return "tres_defavorable";
  }
}

/** Distance approx. (km) entre deux coords WGS84 (équirectangulaire, suffisant à cette échelle). */
function approxDistanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const latRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLng = (b.lng - a.lng) * (Math.PI / 180) * Math.cos(latRad);
  return R * Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Distance (km) d'un point au segment [s, e], en projetant sur le segment. */
function distancePointToSegmentKm(p: LatLng, s: LatLng, e: LatLng): number {
  // Projection en coordonnées planes locales (km) autour de p — ok à l'échelle ~10 km.
  const latRad = (p.lat * Math.PI) / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(latRad);
  const toXY = (c: LatLng) => ({
    x: (c.lng - p.lng) * kmPerDegLng,
    y: (c.lat - p.lat) * kmPerDegLat,
  });
  const P = { x: 0, y: 0 };
  const A = toXY(s);
  const B = toXY(e);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return Math.hypot(P.x - A.x, P.y - A.y);
  }
  let t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = A.x + t * abx;
  const projY = A.y + t * aby;
  return Math.hypot(P.x - projX, P.y - projY);
}

/** Convertit une position GeoJSON [lng, lat] en LatLng, ou null si invalide. */
function geoPosToLatLng(pos: unknown): LatLng | null {
  if (!Array.isArray(pos) || pos.length < 2) return null;
  const lng = Number(pos[0]);
  const lat = Number(pos[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Distance min (km) entre `coord` et une géométrie Vigicrues
 * (LineString ou MultiLineString). Renvoie Infinity si géométrie inexploitable.
 * Optimisation : si un sommet est déjà à ≤ VIGICRUES_MATCH_RADIUS_KM, on garde
 * le calcul segment-par-segment mais on borne par une pré-passe peu coûteuse.
 */
function minDistanceToGeometryKm(
  coord: LatLng,
  geometry: VigicruesGeometry | undefined,
): number {
  if (!geometry) return Infinity;
  // Normalise en liste de "lignes" (chacune = liste de positions).
  let lines: unknown[];
  if (geometry.type === "MultiLineString") {
    lines = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  } else if (geometry.type === "LineString") {
    lines = Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  } else {
    return Infinity;
  }

  let min = Infinity;
  for (const line of lines) {
    if (!Array.isArray(line) || line.length === 0) continue;
    let prev: LatLng | null = null;
    for (const pos of line) {
      const pt = geoPosToLatLng(pos);
      if (!pt) {
        prev = null;
        continue;
      }
      if (prev) {
        const d = distancePointToSegmentKm(coord, prev, pt);
        if (d < min) min = d;
      } else {
        // Premier sommet de la ligne : distance ponctuelle.
        const d = approxDistanceKm(coord, pt);
        if (d < min) min = d;
      }
      prev = pt;
      if (min === 0) return 0; // pile sur le tronçon
    }
  }
  return min;
}

/**
 * Récupère la vigilance crue officielle pour la coordonnée ARRONDIE.
 * Retourne :
 *   - VigicruesComponent du tronçon le plus proche (≤ VIGICRUES_MATCH_RADIUS_KM),
 *   - null hors France, sans donnée, ou si aucun tronçon assez proche.
 * Ne throw jamais. Cache TTL court keyé sur la grille.
 */
export async function getVigicruesComponent(
  coord: LatLng,
): Promise<VigicruesComponent | null> {
  if (!isInFrance(coord)) return null;

  const key = `vigicrues:${gridKey(coord)}`;
  const cached = cacheGet<VigicruesComponent | null>(key);
  if (cached !== undefined) return cached;

  // FeatureCollection nationale : URL sans aucune coordonnée (confidentialité).
  const data = await fetchJson<VigicruesGeoJson>(VIGICRUES_INFO_GEOJSON);
  const features = data?.features;

  if (!Array.isArray(features) || features.length === 0) {
    // Pas de donnée exploitable : cache court pour retenter vite.
    cacheSet<VigicruesComponent | null>(key, null, TTL_VIGICRUES_MS);
    return null;
  }

  let best: {
    distanceKm: number;
    color: VigicruesColor;
    troncon: string | null;
    updatedAt?: string;
  } | null = null;

  for (const feature of features) {
    const color = vigicruesColorFromCode(feature.properties?.NivInfViCr);
    if (!color) continue;
    const d = minDistanceToGeometryKm(coord, feature.geometry);
    if (d > VIGICRUES_MATCH_RADIUS_KM) continue;
    if (!best || d < best.distanceKm) {
      best = {
        distanceKm: d,
        color,
        troncon: feature.properties?.lbentcru ?? null,
        updatedAt: feature.properties?.dhmentcru,
      };
    }
  }

  if (!best) {
    // Aucun tronçon de vigilance assez proche : point non couvert.
    cacheSet<VigicruesComponent | null>(key, null, TTL_VIGICRUES_MS);
    return null;
  }

  const component: VigicruesComponent = {
    color: best.color,
    label: VIGICRUES_LABELS[best.color],
    troncon: best.troncon,
    ...(best.updatedAt ? { updatedAt: best.updatedAt } : {}),
  };
  cacheSet<VigicruesComponent | null>(key, component, TTL_VIGICRUES_MS);
  return component;
}

// ───────────────────────────────────────────────────────────────────────────
// COMBINAISON → SCORE 0-100 → NIVEAU
// ───────────────────────────────────────────────────────────────────────────

/** Score 0-100 d'un niveau qualitatif (échelle commune aux 3 signaux). */
function levelToScore(level: HydroRiskLevel): number {
  switch (level) {
    case "favorable":
      return 15;
    case "modere":
      return 45;
    case "defavorable":
      return 72;
    case "tres_defavorable":
      return 92;
  }
}

function scoreToLevel(score: number): HydroRiskLevel {
  if (score < 33) return "favorable";
  if (score < 60) return "modere";
  if (score < 82) return "defavorable";
  return "tres_defavorable";
}

/** Ordre des niveaux qualitatifs, pour comparer / prendre le max. */
const LEVEL_ORDER: HydroRiskLevel[] = [
  "favorable",
  "modere",
  "defavorable",
  "tres_defavorable",
];

/** Renvoie le plus sévère des deux niveaux. */
function maxLevel(a: HydroRiskLevel, b: HydroRiskLevel): HydroRiskLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * Applique le PLANCHER de vigilance crue Vigicrues au niveau calculé.
 * RÈGLE DE SÉCURITÉ : Vigicrues ne peut que RELEVER le niveau, jamais l'abaisser.
 *   level_final = max(level_mesuré, plancher imposé par la couleur Vigicrues).
 * Le `score` (signaux mesurés) n'est PAS modifié : seul le `level` est relevé.
 */
export function applyVigicruesFloor(
  measuredLevel: HydroRiskLevel,
  vigicrues: VigicruesComponent | null,
): HydroRiskLevel {
  if (!vigicrues) return measuredLevel;
  const floor = vigicruesFloorLevel(vigicrues.color);
  if (!floor) return measuredLevel; // vert : aucun relèvement
  return maxLevel(measuredLevel, floor);
}

/**
 * Combine les composants disponibles en un score 0-100.
 * Les poids sont renormalisés sur les seuls signaux présents (river/groundwater
 * peuvent être null hors zone couverte). La pluie est toujours présente.
 */
export function combineScore(
  rain: RainComponent,
  river: RiverComponent | null,
  groundwater: GroundwaterComponent | null,
): number {
  let weightedSum = 0;
  let weightTotal = 0;

  weightedSum += levelToScore(rain.level) * WEIGHTS.rain;
  weightTotal += WEIGHTS.rain;

  if (river) {
    weightedSum += levelToScore(river.level) * WEIGHTS.river;
    weightTotal += WEIGHTS.river;
  }
  if (groundwater) {
    weightedSum += levelToScore(groundwater.level) * WEIGHTS.groundwater;
    weightTotal += WEIGHTS.groundwater;
  }

  if (weightTotal === 0) return 0;
  return Math.round(weightedSum / weightTotal);
}

// ───────────────────────────────────────────────────────────────────────────
// DÉCHIFFREMENT COORDONNÉES (réutilise decryptUserKeys — clé par utilisateur)
// ───────────────────────────────────────────────────────────────────────────
// location_encrypted contient un JSON { type: "Point", coordinates: [lng, lat] }
// (cf. mobileSyncService.decryptPoint). Déchiffrement CÔTÉ SERVEUR uniquement.

export async function decryptPointLocation(
  userId: string,
  locationEncrypted: string,
): Promise<LatLng | null> {
  try {
    // decryptUserKeys typé pour IUser["_id"] mais fait .toString() en interne :
    // un userId string est accepté à l'exécution (même usage que dataShareService).
    const json = await decryptUserKeys(
      userId as unknown as Parameters<typeof decryptUserKeys>[0],
      locationEncrypted,
    );
    const parsed = safeJsonParse(json, {
      context: "hydro-risk-point-location",
      maxDepth: 3,
    }) as { coordinates?: [number, number] };
    const coords = parsed?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch (error) {
    hydroLogger.warn("Échec déchiffrement location point pour hydro-risk", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// ORCHESTRATION — INDICE POUR DES COORDONNÉES EXACTES
// ───────────────────────────────────────────────────────────────────────────

/**
 * Calcule l'indicateur pour des coordonnées EXACTES (déjà déchiffrées côté serveur).
 * Arrondit à la grille ~1 km avant tout appel externe (confidentialité), puis
 * agrège les 3 signaux disponibles. Ne throw jamais : une source absente → null.
 */
export async function computeHydroRisk(
  pointId: string,
  exactCoord: LatLng,
): Promise<HydroRiskResult> {
  // CONFIDENTIALITÉ : on travaille exclusivement sur la coordonnée arrondie.
  const grid = roundToGrid(exactCoord);

  const [rain, river, groundwater, vigicrues] = await Promise.all([
    getRainComponent(grid),
    getRiverComponent(grid),
    getGroundwaterComponent(grid),
    getVigicruesComponent(grid),
  ]);

  // Score = signaux MESURÉS uniquement (pluie/rivière/nappe). Vigicrues n'y entre pas.
  const score = combineScore(rain, river, groundwater);
  const measuredLevel = scoreToLevel(score);

  // SÉCURITÉ : la vigilance crue officielle ne peut que RELEVER le niveau final.
  const level = applyVigicruesFloor(measuredLevel, vigicrues);

  return {
    pointId,
    level,
    score,
    updatedAt: new Date().toISOString(),
    rain,
    river,
    groundwater,
    vigicrues,
    disclaimer: DISCLAIMER,
  };
}
