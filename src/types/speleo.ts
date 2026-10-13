// ═══════════════════════════════════════════════════════════════════════════
// TYPES — DONNÉES SPÉLÉO PAR BBOX (cavités + zonages réglementaires)
// ═══════════════════════════════════════════════════════════════════════════
// Sert, pour la bbox visible de la carte mobile, les cavités (BD Cavités / BRGM
// via API Géorisques) et les zonages réglementaires (SIC/ZPS/APB/ZNIEFF1 via
// WFS IGN Géoplateforme), en proxy + cache des API publiques. Permet l'affichage
// national sans tout embarquer dans l'app.
// ═══════════════════════════════════════════════════════════════════════════

/** Couches de zonage réglementaire servies. */
export type ZonageLayer = "sic" | "zps" | "apb" | "znieff1";

/** Identifiant de couche acceptable dans le paramètre `layers`. */
export type SpeleoLayer = "cavites" | ZonageLayer;

/** Toutes les couches connues (ordre = défaut quand `layers` absent). */
export const ALL_LAYERS: SpeleoLayer[] = [
  "cavites",
  "sic",
  "zps",
  "apb",
  "znieff1",
];

/** Les seules couches de zonage (sous-ensemble de ALL_LAYERS). */
export const ZONAGE_LAYERS: ZonageLayer[] = ["sic", "zps", "apb", "znieff1"];

/** Bounding box EPSG:4326, ordre lon/lat. */
export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Type d'une cavité. */
export type CaviteType = "naturelle" | "carrière";

/** Propriétés d'une feature cavité (Point). */
export interface CaviteProperties {
  id: string;
  nom: string;
  type: CaviteType;
  rep?: string;
  dep?: string;
  insee?: string;
}

/** Feature GeoJSON cavité (geometry Point [lon, lat]). */
export interface CaviteFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: CaviteProperties;
}

/** Propriétés d'une feature zonage. */
export interface ZonageProperties {
  name: string;
  code?: string;
  url?: string;
}

/** Géométrie surfacique d'un zonage (coords [lon, lat]). */
export interface PolygonGeometry {
  type: "Polygon";
  coordinates: number[][][];
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

/** Feature GeoJSON zonage (Polygon ou MultiPolygon). */
export interface ZonageFeature {
  type: "Feature";
  geometry: PolygonGeometry | MultiPolygonGeometry;
  properties: ZonageProperties;
}

/** FeatureCollection générique typée. */
export interface FeatureCollection<F> {
  type: "FeatureCollection";
  features: F[];
}

/** Réponse complète de GET /api/v1/speleo. */
export interface SpeleoResponse {
  /** true si le zoom est trop faible (< MIN_ZOOM) → toutes les couches vides. */
  zoomTooLow: boolean;
  cavites: FeatureCollection<CaviteFeature>;
  zonages: Record<ZonageLayer, FeatureCollection<ZonageFeature>>;
}

/** Paramètres validés de la requête. */
export interface SpeleoQuery {
  bbox: BBox;
  zoom: number;
  layers: SpeleoLayer[];
}
