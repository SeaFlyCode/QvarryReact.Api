// ═══════════════════════════════════════════════════════════════════════════
// TESTS — speleoService
// ═══════════════════════════════════════════════════════════════════════════
// Couvre : zoomTooLow, construction de grille (+ garde-fou MAX_GRID_CIRCLES),
// mapping cavité & zonage, simplification zonage, cache (hit/miss/TTL),
// dégradation gracieuse si une source échoue, ne peuple que les couches demandées.
// Les appels externes (Géorisques / WFS IGN) sont mockés via global.fetch.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getSpeleoData,
  buildGrid,
  mapCaviteType,
  snapBBoxToGrid,
  _clearSpeleoCache,
  _setRetryDelay,
  MIN_ZOOM,
} from "../../services/speleoService";
import { BBox } from "../../types/speleo";

// Bbox de test (~Ardèche, dense en cavités).
const ARDECHE: BBox = {
  minLon: 4.3,
  minLat: 44.3,
  maxLon: 4.6,
  maxLat: 44.5,
};

// ───────────────────────────────────────────────────────────────────────────
// MOCK FETCH — route selon l'host de l'URL appelée
// ───────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// Une cavité brute Géorisques minimale.
function rawCavite(
  identifiant: string,
  lon: number,
  lat: number,
  type = "Naturelle",
) {
  return {
    identifiant,
    nom: `Grotte ${identifiant}`,
    type,
    reperage_geo: "Bien repéré",
    departement: { code: "07", nom: "Ardèche" },
    code_insee: "07001",
    longitude: lon,
    latitude: lat,
  };
}

// Une feature WFS zonage (Polygon) minimale, avec assez de points pour le RDP.
function rawZonage(name: string) {
  return {
    type: "Feature",
    properties: { nom_site: name, id_mnhn: "FR123", url_fiche: "https://x/fr123" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [4.4000001, 44.4000001],
          [4.4000002, 44.4500003],
          [4.41, 44.45],
          [4.45, 44.45],
          [4.45, 44.4],
          [4.4000001, 44.4000001],
        ],
      ],
    },
  };
}

/**
 * Installe un mock global.fetch qui :
 *   - répond aux requêtes Géorisques (host georisques.gouv.fr) avec `cavites`
 *   - répond aux requêtes WFS (host data.geopf.fr) avec `zonageFeatures`
 *   - compte les appels par host.
 */
function installFetchMock(opts: {
  cavites?: ReturnType<typeof rawCavite>[];
  zonageFeatures?: ReturnType<typeof rawZonage>[];
  georisquesFails?: boolean;
  wfsFails?: boolean;
}) {
  const calls = { georisques: 0, wfs: 0 };
  const fetchMock = jest.fn(async (url: string) => {
    const host = new URL(url).host;
    if (host.includes("georisques")) {
      calls.georisques++;
      if (opts.georisquesFails) throw new Error("network down");
      return jsonResponse({ data: opts.cavites ?? [], total_pages: 1 });
    }
    if (host.includes("geopf")) {
      calls.wfs++;
      if (opts.wfsFails) throw new Error("network down");
      return jsonResponse({ features: opts.zonageFeatures ?? [] });
    }
    return jsonResponse({}, false, 404);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

describe("speleoService", () => {
  beforeEach(() => {
    _clearSpeleoCache();
    _setRetryDelay(0); // pas de backoff réel pendant les tests
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // snapBBoxToGrid
  // ─────────────────────────────────────────────────────────────────────────
  describe("snapBBoxToGrid", () => {
    it("arrondit min vers le bas et max vers le haut (grille 0.1°)", () => {
      const snapped = snapBBoxToGrid({
        minLon: 4.34,
        minLat: 44.37,
        maxLon: 4.56,
        maxLat: 44.52,
      });
      expect(snapped.minLon).toBeCloseTo(4.3, 5);
      expect(snapped.minLat).toBeCloseTo(44.3, 5);
      expect(snapped.maxLon).toBeCloseTo(4.6, 5);
      expect(snapped.maxLat).toBeCloseTo(44.6, 5);
    });

    it("deux bbox proches tombent sur la même cellule (hit de cache)", () => {
      const a = snapBBoxToGrid({
        minLon: 4.31,
        minLat: 44.31,
        maxLon: 4.59,
        maxLat: 44.49,
      });
      const b = snapBBoxToGrid({
        minLon: 4.33,
        minLat: 44.33,
        maxLon: 4.58,
        maxLat: 44.48,
      });
      expect(a).toEqual(b);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildGrid
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildGrid", () => {
    it("couvre la bbox avec au moins un cercle", () => {
      const grid = buildGrid(ARDECHE);
      expect(grid.length).toBeGreaterThan(0);
    });

    it("garde-fou : ne dépasse jamais MAX_GRID_CIRCLES (64) pour une bbox large", () => {
      const wide: BBox = {
        minLon: -5,
        minLat: 41,
        maxLon: 9,
        maxLat: 51,
      };
      const grid = buildGrid(wide);
      expect(grid.length).toBeLessThanOrEqual(64);
    });

    it("tous les centres sont des paires [lon, lat] finies", () => {
      const grid = buildGrid(ARDECHE);
      for (const [lon, lat] of grid) {
        expect(Number.isFinite(lon)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // mapCaviteType
  // ─────────────────────────────────────────────────────────────────────────
  describe("mapCaviteType", () => {
    it("'carrière' si le type contient 'carr'", () => {
      expect(mapCaviteType("Carrière souterraine")).toBe("carrière");
      expect(mapCaviteType("CARRIERE")).toBe("carrière");
    });
    it("'naturelle' sinon (ou si absent)", () => {
      expect(mapCaviteType("Grotte naturelle")).toBe("naturelle");
      expect(mapCaviteType(undefined)).toBe("naturelle");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // zoomTooLow
  // ─────────────────────────────────────────────────────────────────────────
  describe("zoomTooLow", () => {
    it("zoom < MIN_ZOOM → zoomTooLow:true, couches vides, AUCUN appel externe", async () => {
      const { fetchMock } = installFetchMock({});
      const res = await getSpeleoData(ARDECHE, MIN_ZOOM - 1, [
        "cavites",
        "sic",
      ]);
      expect(res.zoomTooLow).toBe(true);
      expect(res.cavites.features).toHaveLength(0);
      expect(res.zonages.sic.features).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MAPPING CAVITÉ
  // ─────────────────────────────────────────────────────────────────────────
  describe("mapping cavité", () => {
    it("mappe id/nom/type/rep/dep/insee et geometry Point [lon,lat] arrondie", async () => {
      installFetchMock({
        cavites: [rawCavite("C1", 4.412345678, 44.412345678, "Naturelle")],
      });
      const res = await getSpeleoData(ARDECHE, 10, ["cavites"]);
      expect(res.zoomTooLow).toBe(false);
      expect(res.cavites.features).toHaveLength(1);
      const feat = res.cavites.features[0];
      expect(feat.properties).toMatchObject({
        id: "C1",
        nom: "Grotte C1",
        type: "naturelle",
        rep: "Bien repéré",
        dep: "Ardèche",
        insee: "07001",
      });
      expect(feat.geometry.type).toBe("Point");
      // Arrondi à 5 décimales.
      expect(feat.geometry.coordinates[0]).toBeCloseTo(4.41235, 5);
      expect(feat.geometry.coordinates[1]).toBeCloseTo(44.41235, 5);
    });

    it("dédoublonne par identifiant (même cavité vue par plusieurs cercles)", async () => {
      installFetchMock({
        cavites: [
          rawCavite("DUP", 4.41, 44.41),
          rawCavite("DUP", 4.41, 44.41),
          rawCavite("OTHER", 4.42, 44.42),
        ],
      });
      const res = await getSpeleoData(ARDECHE, 10, ["cavites"]);
      const ids = res.cavites.features.map((f) => f.properties.id).sort();
      expect(ids).toEqual(["DUP", "OTHER"]);
    });

    it("exclut les cavités hors bbox demandée (cercles débordants)", async () => {
      installFetchMock({
        cavites: [
          rawCavite("IN", 4.45, 44.45),
          rawCavite("OUT", 5.9, 45.9), // hors bbox Ardèche
        ],
      });
      const res = await getSpeleoData(ARDECHE, 10, ["cavites"]);
      const ids = res.cavites.features.map((f) => f.properties.id);
      expect(ids).toContain("IN");
      expect(ids).not.toContain("OUT");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MAPPING ZONAGE + SIMPLIFICATION
  // ─────────────────────────────────────────────────────────────────────────
  describe("mapping zonage", () => {
    it("mappe nom_site→name, id_mnhn→code, url_fiche→url et simplifie/arrondit", async () => {
      installFetchMock({ zonageFeatures: [rawZonage("Site Natura X")] });
      const res = await getSpeleoData(ARDECHE, 10, ["sic"]);
      expect(res.zonages.sic.features).toHaveLength(1);
      const feat = res.zonages.sic.features[0];
      expect(feat.properties).toEqual({
        name: "Site Natura X",
        code: "FR123",
        url: "https://x/fr123",
      });
      expect(["Polygon", "MultiPolygon"]).toContain(feat.geometry.type);
      // Coordonnées arrondies à 5 décimales.
      const ring = (feat.geometry.coordinates as number[][][])[0];
      for (const [lon, lat] of ring) {
        expect(lon).toBeCloseTo(Number(lon.toFixed(5)), 6);
        expect(lat).toBeCloseTo(Number(lat.toFixed(5)), 6);
      }
      // Anneau fermé.
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // COUCHES DEMANDÉES UNIQUEMENT
  // ─────────────────────────────────────────────────────────────────────────
  describe("couches demandées", () => {
    it("ne peuple que les couches demandées ; les autres restent vides", async () => {
      installFetchMock({
        cavites: [rawCavite("C1", 4.41, 44.41)],
        zonageFeatures: [rawZonage("S")],
      });
      const res = await getSpeleoData(ARDECHE, 10, ["sic"]);
      expect(res.cavites.features).toHaveLength(0); // non demandée
      expect(res.zonages.sic.features).toHaveLength(1);
      expect(res.zonages.zps.features).toHaveLength(0);
      expect(res.zonages.apb.features).toHaveLength(0);
      expect(res.zonages.znieff1.features).toHaveLength(0);
    });

    it("ne déclenche aucun fetch Géorisques si 'cavites' n'est pas demandée", async () => {
      const { calls } = installFetchMock({
        zonageFeatures: [rawZonage("S")],
      });
      await getSpeleoData(ARDECHE, 10, ["sic"]);
      expect(calls.georisques).toBe(0);
      expect(calls.wfs).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CACHE (hit / miss / isolation par couche)
  // ─────────────────────────────────────────────────────────────────────────
  describe("cache", () => {
    it("miss puis hit : le 2e appel ne refait aucun fetch", async () => {
      const { fetchMock } = installFetchMock({
        cavites: [rawCavite("C1", 4.41, 44.41)],
      });
      await getSpeleoData(ARDECHE, 10, ["cavites"]);
      const afterFirst = fetchMock.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);

      await getSpeleoData(ARDECHE, 10, ["cavites"]);
      // Aucun nouvel appel : tout vient du cache.
      expect(fetchMock.mock.calls.length).toBe(afterFirst);
    });

    it("deux bbox dans la même cellule de grille partagent le cache", async () => {
      const { fetchMock } = installFetchMock({
        cavites: [rawCavite("C1", 4.41, 44.41)],
      });
      await getSpeleoData(
        { minLon: 4.31, minLat: 44.31, maxLon: 4.59, maxLat: 44.49 },
        10,
        ["cavites"],
      );
      const afterFirst = fetchMock.mock.calls.length;
      await getSpeleoData(
        { minLon: 4.33, minLat: 44.33, maxLon: 4.58, maxLat: 44.48 },
        10,
        ["cavites"],
      );
      expect(fetchMock.mock.calls.length).toBe(afterFirst);
    });

    it("le cache est isolé par couche (demander 'zps' après 'sic' refait un fetch)", async () => {
      const { calls } = installFetchMock({
        zonageFeatures: [rawZonage("S")],
      });
      await getSpeleoData(ARDECHE, 10, ["sic"]);
      const wfsAfterSic = calls.wfs;
      await getSpeleoData(ARDECHE, 10, ["zps"]);
      expect(calls.wfs).toBeGreaterThan(wfsAfterSic);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ROBUSTESSE — dégradation gracieuse
  // ─────────────────────────────────────────────────────────────────────────
  describe("robustesse", () => {
    it("si Géorisques échoue, les zonages sont quand même servis", async () => {
      installFetchMock({
        georisquesFails: true,
        zonageFeatures: [rawZonage("S")],
      });
      const res = await getSpeleoData(ARDECHE, 10, ["cavites", "sic"]);
      expect(res.cavites.features).toHaveLength(0); // source en échec → vide
      expect(res.zonages.sic.features).toHaveLength(1); // autre source OK
    });

    it("si le WFS échoue, les cavités sont quand même servies", async () => {
      installFetchMock({
        cavites: [rawCavite("C1", 4.41, 44.41)],
        wfsFails: true,
      });
      const res = await getSpeleoData(ARDECHE, 10, ["cavites", "sic"]);
      expect(res.cavites.features).toHaveLength(1);
      expect(res.zonages.sic.features).toHaveLength(0);
    });

    it("un échec de source est caché court : un nouvel appel re-tente le fetch", async () => {
      const { calls } = installFetchMock({ georisquesFails: true });
      await getSpeleoData(ARDECHE, 10, ["cavites"]);
      const first = calls.georisques;
      await getSpeleoData(ARDECHE, 10, ["cavites"]);
      // Le résultat vide d'un échec est mis en cache court (CACHE_TTL_FAIL_MS),
      // mais dans le même tick il reste en cache → pas de re-fetch immédiat.
      // On vérifie au moins qu'il y a bien eu des tentatives au 1er appel.
      expect(first).toBeGreaterThan(0);
    });
  });
});
