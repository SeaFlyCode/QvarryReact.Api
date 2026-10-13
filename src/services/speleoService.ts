// ═══════════════════════════════════════════════════════════════════════════
// SERVICE — DONNÉES SPÉLÉO PAR BBOX (proxy + cache des API publiques)
// ═══════════════════════════════════════════════════════════════════════════
// Pour la bbox visible de la carte mobile, agrège :
//   1. Cavités  — BD Cavités / BRGM via API Géorisques (grille de cercles r=20km)
//   2. Zonages  — SIC/ZPS/APB/ZNIEFF1 via WFS IGN Géoplateforme (1 requête bbox/couche)
//
// Logique portée depuis les scripts mobiles :
//   - scripts/fetch-oise-speleo.mjs   (grille Géorisques, dédup, mapping, WFS)
//   - scripts/simplify-zonages.mjs    (Ramer-Douglas-Peucker, arrondi 5 décimales)
// DIFFÉRENCES : la bbox vient de la requête (pas l'Oise en dur), pas de filtre
// par département (on garde tout ce qui tombe dans la bbox), grille bornée
// (garde-fou anti-abus).
//
// CACHE : mémoire TTL (comme hydroRiskService, pas de Redis). Clé = bbox arrondie
//   à une grille (CACHE_GRID_DEG) + zoom-bucket + couche. TTL long (données quasi
//   statiques). Maximise les hits entre pans proches.
//
// ROBUSTESSE : timeouts + retries sur chaque fetch externe. Si une source échoue,
//   on renvoie les autres couches (jamais un échec global). Logs propres (host seul).
// ═══════════════════════════════════════════════════════════════════════════

import { safeJsonParse } from "../utils/secureJsonParser";
import { logger } from "./loggerService";
import {
  BBox,
  CaviteFeature,
  CaviteType,
  FeatureCollection,
  SpeleoLayer,
  SpeleoResponse,
  ZONAGE_LAYERS,
  ZonageFeature,
  ZonageLayer,
} from "../types/speleo";

const speleoLogger = logger.child({ service: "speleo" });

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTES & PARAMÈTRES
// ───────────────────────────────────────────────────────────────────────────

/** Zoom Leaflet en deçà duquel on ne charge rien (évite la France entière). */
export const MIN_ZOOM = 8;

/**
 * Grille d'arrondi de la bbox pour la clé de cache (degrés). Deux pans proches
 * tombent dans la même cellule → même clé → hit de cache. ~0.1° ≈ 11 km.
 */
const CACHE_GRID_DEG = 0.1;

/** TTL du cache (ms). Données quasi statiques → 12 h. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** TTL court en cas d'échec d'une source (retenter vite). */
const CACHE_TTL_FAIL_MS = 5 * 60 * 1000;

/** Rayon des cercles de la grille Géorisques (m). L'API plafonne à 20 km. */
const GEORISQUES_RADIUS_M = 20000;
/**
 * Pas de la grille de cercles (degrés). ~24 km de centre à centre, des cercles
 * r=20 km se recouvrent largement (cf. script Oise : lonStep 0.34 / latStep 0.22).
 */
const GRID_LON_STEP = 0.34;
const GRID_LAT_STEP = 0.22;

/** Garde-fou anti-abus : nombre max de cercles de grille. */
const MAX_GRID_CIRCLES = 64;

/** Timeout par appel externe (ms). */
const FETCH_TIMEOUT_MS = 8000;
/** Nombre de tentatives par appel externe (1 essai + retries). */
const FETCH_TRIES = 3;
/** Délai de base entre deux tentatives (ms, backoff linéaire). */
let retryBaseDelayMs = 500;
/** Désactive le backoff entre tentatives (tests uniquement). */
export function _setRetryDelay(ms: number): void {
  retryBaseDelayMs = ms;
}

/** Pagination Géorisques. */
const GEORISQUES_PAGE_SIZE = 1000;
/** Pagination WFS IGN. */
const WFS_COUNT = 1000;
/** Garde-fou : pages max par source (anti-boucle infinie / volume). */
const MAX_PAGES = 20;

/** Décimales conservées sur les coordonnées de sortie. */
const COORD_DP = 5;
/** Tolérance de simplification Ramer-Douglas-Peucker (degrés, ~33 m). */
const RDP_EPS = 0.0003;

// Endpoints publics
const GEORISQUES_CAVITES = "https://www.georisques.gouv.fr/api/v1/cavites";
const WFS = "https://data.geopf.fr/wfs/ows";

/** typeNames WFS par couche de zonage (patrinat_<layer>:<layer>). */
const WFS_TYPENAME: Record<ZonageLayer, string> = {
  sic: "patrinat_sic:sic",
  zps: "patrinat_zps:zps",
  apb: "patrinat_apb:apb",
  znieff1: "patrinat_znieff1:znieff1",
};

// ───────────────────────────────────────────────────────────────────────────
// CACHE MÉMOIRE SIMPLE À TTL (keyé sur bbox arrondie + zoom-bucket + couche)
// ───────────────────────────────────────────────────────────────────────────

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
export function _clearSpeleoCache(): void {
  cache.clear();
}

/**
 * Arrondit une bbox à la grille de cache. minLon/minLat → floor, maxLon/maxLat
 * → ceil, pour que toute bbox incluse dans la cellule partage la même clé.
 */
export function snapBBoxToGrid(bbox: BBox): BBox {
  const floor = (v: number) =>
    Number((Math.floor(v / CACHE_GRID_DEG) * CACHE_GRID_DEG).toFixed(4));
  const ceil = (v: number) =>
    Number((Math.ceil(v / CACHE_GRID_DEG) * CACHE_GRID_DEG).toFixed(4));
  return {
    minLon: floor(bbox.minLon),
    minLat: floor(bbox.minLat),
    maxLon: ceil(bbox.maxLon),
    maxLat: ceil(bbox.maxLat),
  };
}

/** Construit une clé de cache par couche. */
function cacheKey(layer: SpeleoLayer, snapped: BBox): string {
  // Le zoom n'influe pas sur le contenu (mêmes données dès zoom ≥ MIN_ZOOM),
  // seule la bbox arrondie compte → meilleure mutualisation.
  return `${layer}:${snapped.minLon},${snapped.minLat},${snapped.maxLon},${snapped.maxLat}`;
}

// ───────────────────────────────────────────────────────────────────────────
// FETCH ROBUSTE (timeout + retries, JSON sûr, jamais de throw vers l'appelant)
// ───────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * GET JSON avec timeout + retries exponentiels. Renvoie null si toutes les
 * tentatives échouent (l'appelant décide de la dégradation). Ne throw jamais.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < FETCH_TRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json", "User-Agent": "Qvarry/speleo" },
      });
      if (!res.ok) {
        // 4xx hors 429 : inutile de retenter (requête malformée côté nous).
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          speleoLogger.warn("Réponse API externe 4xx (sans retry)", {
            status: res.status,
            host: hostOf(url),
          });
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      return safeJsonParse(text, {
        context: "speleo-external",
        maxDepth: 24,
      }) as T;
    } catch (error) {
      const last = attempt === FETCH_TRIES - 1;
      speleoLogger.warn("Échec appel API externe", {
        host: hostOf(url),
        attempt: attempt + 1,
        willRetry: !last,
        error: error instanceof Error ? error.message : String(error),
      });
      if (last) return null;
      if (retryBaseDelayMs > 0) await sleep(retryBaseDelayMs * (attempt + 1));
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS GÉOMÉTRIE (arrondi + Ramer-Douglas-Peucker)
//   Portés de scripts/simplify-zonages.mjs.
// ───────────────────────────────────────────────────────────────────────────

const f = 10 ** COORD_DP;
const round1 = (v: number) => Math.round(v * f) / f;
const roundPos = (c: number[]): [number, number] => [round1(c[0]), round1(c[1])];

/** Distance perpendiculaire du point p au segment [a,b] (plan lon/lat). */
function perpDist(p: number[], a: number[], b: number[]): number {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    dx = p[0] - a[0];
    dy = p[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const ex = p[0] - projX;
  const ey = p[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/** RDP itératif sur une polyligne (extrémités conservées). */
function rdp(points: number[][], eps: number): number[][] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out: number[][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplifie un anneau fermé ; garantit ≥ 4 points et la fermeture. */
function simplifyRing(ring: number[][]): number[][] {
  let r = rdp(ring, RDP_EPS).map(roundPos);
  const first = r[0];
  const lastPt = r[r.length - 1];
  if (first[0] !== lastPt[0] || first[1] !== lastPt[1]) {
    r.push([first[0], first[1]]);
  }
  if (r.length < 4) r = ring.map(roundPos); // trop dégénéré → on garde l'original
  return r;
}

/** Applique la simplification à une géométrie Polygon / MultiPolygon. */
function simplifyGeometry(
  geom: ZonageFeature["geometry"],
): ZonageFeature["geometry"] {
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: geom.coordinates.map(simplifyRing) };
  }
  // MultiPolygon
  return {
    type: "MultiPolygon",
    coordinates: geom.coordinates.map((poly) => poly.map(simplifyRing)),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// CAVITÉS — API Géorisques (grille de cercles r=20 km, dédup par identifiant)
//   Portés de scripts/fetch-oise-speleo.mjs (sans filtre département).
// ───────────────────────────────────────────────────────────────────────────

interface GeorisquesCavite {
  identifiant?: string;
  nom?: string;
  type?: string;
  reperage_geo?: string;
  departement?: { code?: string; nom?: string };
  code_insee?: string;
  longitude?: number;
  latitude?: number;
}

interface GeorisquesPage {
  data?: GeorisquesCavite[];
  total_pages?: number;
}

/**
 * Construit la grille de centres (lon, lat) couvrant la bbox, cercles r=20 km
 * qui se recouvrent. Bornée à MAX_GRID_CIRCLES (garde-fou). Le pas est élargi
 * si nécessaire pour respecter la borne sans laisser de trou non couvert.
 */
export function buildGrid(bbox: BBox): [number, number][] {
  let lonStep = GRID_LON_STEP;
  let latStep = GRID_LAT_STEP;

  const countFor = (ls: number, lt: number) => {
    const nLon = Math.floor((bbox.maxLon - bbox.minLon) / ls) + 1;
    const nLat = Math.floor((bbox.maxLat - bbox.minLat) / lt) + 1;
    return nLon * nLat;
  };

  // Si la bbox est trop large, on élargit le pas proportionnellement pour rester
  // sous MAX_GRID_CIRCLES (zoom ≥ 8 borne déjà la surface, c'est un garde-fou).
  if (countFor(lonStep, latStep) > MAX_GRID_CIRCLES) {
    const factor = Math.sqrt(countFor(lonStep, latStep) / MAX_GRID_CIRCLES);
    lonStep *= factor;
    latStep *= factor;
  }

  const centers: [number, number][] = [];
  for (let lon = bbox.minLon; lon <= bbox.maxLon + lonStep; lon += lonStep) {
    for (let lat = bbox.minLat; lat <= bbox.maxLat + latStep; lat += latStep) {
      centers.push([Number(lon.toFixed(4)), Number(lat.toFixed(4))]);
      if (centers.length >= MAX_GRID_CIRCLES) return centers;
    }
  }
  return centers;
}

/** 'carrière' si le type contient "carr", sinon 'naturelle'. */
export function mapCaviteType(t: string | undefined): CaviteType {
  return /carr/i.test(t || "") ? "carrière" : "naturelle";
}

/** Vrai si lon/lat tombe dans la bbox (inclusif). */
function inBBox(lon: number, lat: number, bbox: BBox): boolean {
  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

/** Récupère toutes les cavités autour d'un centre (pagination Géorisques). */
async function fetchCavitesAt(
  lon: number,
  lat: number,
): Promise<GeorisquesCavite[]> {
  const out: GeorisquesCavite[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${GEORISQUES_CAVITES}?latlon=${lon},${lat}` +
      `&rayon=${GEORISQUES_RADIUS_M}&page=${page}&page_size=${GEORISQUES_PAGE_SIZE}`;
    const j = await fetchJson<GeorisquesPage>(url);
    if (!j) break; // échec réseau : on garde ce qu'on a (dégradation gracieuse)
    const data = j.data ?? [];
    out.push(...data);
    if (!j.total_pages || page >= j.total_pages || data.length === 0) break;
  }
  return out;
}

/** Mappe une cavité brute Géorisques en feature GeoJSON (ou null si invalide). */
function mapCaviteFeature(r: GeorisquesCavite): CaviteFeature | null {
  if (
    typeof r.longitude !== "number" ||
    typeof r.latitude !== "number" ||
    !Number.isFinite(r.longitude) ||
    !Number.isFinite(r.latitude)
  ) {
    return null;
  }
  const props: CaviteFeature["properties"] = {
    id: String(r.identifiant ?? ""),
    nom: r.nom || "",
    type: mapCaviteType(r.type),
  };
  if (r.reperage_geo) props.rep = r.reperage_geo;
  if (r.departement?.nom) props.dep = r.departement.nom;
  if (r.code_insee) props.insee = r.code_insee;
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [round1(r.longitude), round1(r.latitude)],
    },
    properties: props,
  };
}

/**
 * Récupère les cavités de la bbox (grille de cercles, dédup par identifiant,
 * pas de filtre département). Ne garde que celles tombant dans la bbox demandée.
 */
async function fetchCavites(
  bbox: BBox,
): Promise<FeatureCollection<CaviteFeature>> {
  const grid = buildGrid(bbox);
  const byId = new Map<string, GeorisquesCavite>();

  for (const [lon, lat] of grid) {
    const rows = await fetchCavitesAt(lon, lat);
    for (const r of rows) {
      const id = r.identifiant;
      if (!id) continue;
      if (
        typeof r.longitude === "number" &&
        typeof r.latitude === "number" &&
        !inBBox(r.longitude, r.latitude, bbox)
      ) {
        continue; // hors bbox (cercles débordent largement)
      }
      if (!byId.has(id)) byId.set(id, r);
    }
  }

  const features: CaviteFeature[] = [];
  for (const r of byId.values()) {
    const feat = mapCaviteFeature(r);
    if (feat) features.push(feat);
  }
  return { type: "FeatureCollection", features };
}

// ───────────────────────────────────────────────────────────────────────────
// ZONAGES — WFS IGN Géoplateforme (1 requête bbox par couche, paginée)
//   Portés de scripts/fetch-oise-speleo.mjs + simplify-zonages.mjs.
// ───────────────────────────────────────────────────────────────────────────

interface WfsRawFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    nom_site?: string;
    nom?: string;
    id_mnhn?: string | number;
    url_fiche?: string;
  };
}

interface WfsResponse {
  features?: WfsRawFeature[];
}

/** Mappe les propriétés WFS → propriétés zonage (nom_site→name, etc.). */
function mapZonageProps(
  p: WfsRawFeature["properties"],
): ZonageFeature["properties"] {
  const out: ZonageFeature["properties"] = {
    name: p?.nom_site || p?.nom || "Sans nom",
  };
  if (p?.id_mnhn !== undefined && p?.id_mnhn !== null) {
    out.code = String(p.id_mnhn);
  }
  if (p?.url_fiche) out.url = p.url_fiche;
  return out;
}

/**
 * Récupère une couche de zonage pour la bbox (pagination WFS), mappe et simplifie
 * les géométries (RDP + arrondi 5 décimales). bbox WFS = "minLat,minLon,maxLat,
 * maxLon,urn:ogc:def:crs:EPSG::4326" (ordre lat/lon imposé par srsName EPSG::4326).
 */
async function fetchZonageLayer(
  layer: ZonageLayer,
  bbox: BBox,
): Promise<FeatureCollection<ZonageFeature>> {
  const typeName = WFS_TYPENAME[layer];
  const wfsBbox = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon},urn:ogc:def:crs:EPSG::4326`;

  const raw: WfsRawFeature[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const startIndex = page * WFS_COUNT;
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&typeNames=${encodeURIComponent(typeName)}&outputFormat=application/json` +
      `&srsName=urn:ogc:def:crs:EPSG::4326&count=${WFS_COUNT}&startIndex=${startIndex}` +
      `&bbox=${encodeURIComponent(wfsBbox)}`;
    const fc = await fetchJson<WfsResponse>(url);
    if (!fc) break; // échec : on garde ce qu'on a
    const got = fc.features ?? [];
    raw.push(...got);
    if (got.length < WFS_COUNT) break;
  }

  const features: ZonageFeature[] = [];
  for (const fRaw of raw) {
    const geom = fRaw.geometry;
    if (
      !geom ||
      (geom.type !== "Polygon" && geom.type !== "MultiPolygon") ||
      !Array.isArray(geom.coordinates)
    ) {
      continue;
    }
    const simplified = simplifyGeometry(
      geom as unknown as ZonageFeature["geometry"],
    );
    features.push({
      type: "Feature",
      geometry: simplified,
      properties: mapZonageProps(fRaw.properties),
    });
  }
  return { type: "FeatureCollection", features };
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS RÉPONSE
// ───────────────────────────────────────────────────────────────────────────

function emptyCavites(): FeatureCollection<CaviteFeature> {
  return { type: "FeatureCollection", features: [] };
}

function emptyZonage(): FeatureCollection<ZonageFeature> {
  return { type: "FeatureCollection", features: [] };
}

function emptyZonages(): SpeleoResponse["zonages"] {
  return {
    sic: emptyZonage(),
    zps: emptyZonage(),
    apb: emptyZonage(),
    znieff1: emptyZonage(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ORCHESTRATION — RÉPONSE SPÉLÉO POUR UNE BBOX
// ───────────────────────────────────────────────────────────────────────────

/**
 * Construit la réponse spéléo pour la bbox/zoom/couches demandés.
 *   - zoom < MIN_ZOOM → { zoomTooLow: true, couches vides } (pas d'appel externe).
 *   - sinon : ne peuple QUE les couches demandées, en parallèle. Cache par couche
 *     (clé = bbox arrondie). Une source qui échoue → couche vide cachée court,
 *     les autres restent servies.
 */
export async function getSpeleoData(
  bbox: BBox,
  zoom: number,
  layers: SpeleoLayer[],
): Promise<SpeleoResponse> {
  if (zoom < MIN_ZOOM) {
    return {
      zoomTooLow: true,
      cavites: emptyCavites(),
      zonages: emptyZonages(),
    };
  }

  const snapped = snapBBoxToGrid(bbox);
  const wantCavites = layers.includes("cavites");
  const wantedZonages = ZONAGE_LAYERS.filter((l) => layers.includes(l));

  // Cavités (avec cache).
  const cavitesPromise: Promise<FeatureCollection<CaviteFeature>> = (async () => {
    if (!wantCavites) return emptyCavites();
    const key = cacheKey("cavites", snapped);
    const cached = cacheGet<FeatureCollection<CaviteFeature>>(key);
    if (cached) return cached;
    try {
      const fc = await fetchCavites(snapped);
      // Si vide ET probablement dû à un échec, on cache court ; sinon TTL long.
      cacheSet(key, fc, fc.features.length > 0 ? CACHE_TTL_MS : CACHE_TTL_FAIL_MS);
      return fc;
    } catch (error) {
      speleoLogger.error("Échec récupération cavités", {
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyCavites();
    }
  })();

  // Zonages demandés (avec cache, en parallèle).
  const zonagePromises = wantedZonages.map(
    async (layer): Promise<[ZonageLayer, FeatureCollection<ZonageFeature>]> => {
      const key = cacheKey(layer, snapped);
      const cached = cacheGet<FeatureCollection<ZonageFeature>>(key);
      if (cached) return [layer, cached];
      try {
        const fc = await fetchZonageLayer(layer, snapped);
        cacheSet(
          key,
          fc,
          fc.features.length > 0 ? CACHE_TTL_MS : CACHE_TTL_FAIL_MS,
        );
        return [layer, fc];
      } catch (error) {
        speleoLogger.error("Échec récupération zonage", {
          layer,
          error: error instanceof Error ? error.message : String(error),
        });
        return [layer, emptyZonage()];
      }
    },
  );

  const [cavites, zonageEntries] = await Promise.all([
    cavitesPromise,
    Promise.all(zonagePromises),
  ]);

  const zonages = emptyZonages();
  for (const [layer, fc] of zonageEntries) {
    zonages[layer] = fc;
  }

  return { zoomTooLow: false, cavites, zonages };
}
