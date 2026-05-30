// ═══════════════════════════════════════════════════════════════════════════
// TYPES — INDICATEUR DE RISQUE HYDRO (conditions favorisant l'instabilité)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ INDICATEUR, PAS UNE PRÉDICTION. Cf. champ `disclaimer` dans la réponse.
// Combine 3 signaux open data MESURÉS (pluie antécédente, niveau cours d'eau,
// nappe) → score 0-100, + 1 signal OFFICIEL (vigilance crue Vigicrues) qui ne
// peut que RELEVER le niveau qualitatif final (sécurité), jamais l'abaisser.
// ═══════════════════════════════════════════════════════════════════════════

/** Niveau qualitatif global de l'indicateur. */
export type HydroRiskLevel =
  | "favorable"
  | "modere"
  | "defavorable"
  | "tres_defavorable";

/** Tendance d'évolution d'un signal mesuré. */
export type HydroTrend = "up" | "down" | "stable";

/** Composant pluie antécédente (Open-Meteo). Toujours disponible (monde entier). */
export interface RainComponent {
  /** Cumul pondéré de pluie sur la fenêtre (mm). Poids décroissant J-1 → J-15. */
  cumulMm: number;
  /** Nombre de jours de la fenêtre d'analyse. */
  days: number;
  /** Niveau qualitatif du composant pluie. */
  level: HydroRiskLevel;
}

/** Composant cours d'eau (Hub'Eau Hydrométrie). `null` si pas de station proche (hors FR / zone non couverte). */
export interface RiverComponent {
  /** Code station Hub'Eau, ou null si indisponible. */
  station: string | null;
  /** Dernière hauteur mesurée en mètres, ou null. */
  heightM: number | null;
  /** Tendance récente. */
  trend: HydroTrend;
  /** Niveau qualitatif relatif (percentile vs historique récent de la station). */
  level: HydroRiskLevel;
}

/** Composant nappe (Hub'Eau Piézométrie). `null` si pas de station proche. */
export interface GroundwaterComponent {
  /** Code BSS de la station piézométrique, ou null. */
  station: string | null;
  /** Tendance récente du niveau de nappe. */
  trend: HydroTrend;
  /** Niveau qualitatif relatif vs historique récent de la station. */
  level: HydroRiskLevel;
}

/** Couleur de vigilance crue officielle (Vigicrues). */
export type VigicruesColor = "vert" | "jaune" | "orange" | "rouge";

/**
 * Composant vigilance crue officielle (Vigicrues). `null` hors France ou si
 * aucun tronçon de vigilance n'est trouvé à proximité.
 *
 * Source : InfoVigiCru.geojson (vigicrues.gouv.fr) — FeatureCollection nationale
 * des tronçons de vigilance crue (MultiLineString), appariement par tronçon le
 * plus proche de la coordonnée ARRONDIE.
 *
 * RÔLE SÉCURITÉ : ce signal ne peut que RELEVER le niveau qualitatif global,
 * jamais l'abaisser. Il n'entre pas dans le `score` mesuré.
 */
export interface VigicruesComponent {
  /** Couleur de vigilance du tronçon le plus proche. */
  color: VigicruesColor;
  /** Libellé humain de la couleur (ex: "Vigilance orange"). */
  label: string;
  /** Libellé du tronçon de vigilance apparié, ou null. */
  troncon: string | null;
  /** Date ISO de dernière mise à jour de la vigilance du tronçon, si dispo. */
  updatedAt?: string;
}

/** Réponse API complète pour un point. */
export interface HydroRiskResult {
  pointId: string;
  /**
   * Niveau qualitatif global FINAL = max(niveau des signaux mesurés,
   * niveau imposé par la vigilance crue Vigicrues). Voir VigicruesComponent.
   */
  level: HydroRiskLevel;
  /**
   * Score combiné 0 (favorable) → 100 (très défavorable) des 3 signaux MESURÉS
   * (pluie/rivière/nappe). N'inclut PAS Vigicrues : seul `level` peut être relevé.
   */
  score: number;
  /** Date ISO de calcul de l'indicateur. */
  updatedAt: string;
  rain: RainComponent;
  river: RiverComponent | null;
  groundwater: GroundwaterComponent | null;
  /** Vigilance crue officielle (peut relever `level`). `null` hors FR / sans tronçon. */
  vigicrues: VigicruesComponent | null;
  disclaimer: string;
}

/** Coordonnées géographiques décimales (WGS84). */
export interface LatLng {
  lat: number;
  lng: number;
}
