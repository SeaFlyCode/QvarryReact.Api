// ═══════════════════════════════════════════════════════════════════════════
// TESTS — hydroRiskService + hydroRiskControllers
// ═══════════════════════════════════════════════════════════════════════════
// Couvre : calcul d'indice, fallback source manquante, arrondi coords (grille
// confidentialité), cache, et le batch (validation + erreurs partielles).
// Les appels externes (Open-Meteo / Hub'Eau) sont mockés via global.fetch.
// ═══════════════════════════════════════════════════════════════════════════

import {
  roundToGrid,
  combineScore,
  getRainComponent,
  getRiverComponent,
  getGroundwaterComponent,
  getVigicruesComponent,
  applyVigicruesFloor,
  computeHydroRisk,
  decryptPointLocation,
  _clearHydroCache,
  DISCLAIMER,
} from "../../services/hydroRiskService";
import { RainComponent, VigicruesComponent } from "../../types/hydroRisk";

// Construit une feature Vigicrues (tronçon) avec un code de vigilance et une
// géométrie LineString passant à proximité (ou non) de la coord testée.
function vigicruesFeature(
  niv: number,
  label: string,
  coords: [number, number][],
  dh?: string,
) {
  return {
    type: "Feature",
    properties: {
      lbentcru: label,
      NivInfViCr: niv,
      ...(dh ? { dhmentcru: dh } : {}),
    },
    geometry: { type: "LineString", coordinates: coords },
  };
}

// Mock du déchiffrement par clé utilisateur (évite la DB).
jest.mock("../../utils/userEncryptionUtils", () => ({
  decryptUserKeys: jest.fn(),
}));
import { decryptUserKeys } from "../../utils/userEncryptionUtils";
const mockDecryptUserKeys = decryptUserKeys as jest.Mock;

// Helper : construit une Response-like pour mock fetch.
function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("hydroRiskService", () => {
  beforeEach(() => {
    _clearHydroCache();
    jest.restoreAllMocks();
    mockDecryptUserKeys.mockReset();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ARRONDI COORDS (confidentialité ~1 km)
  // ─────────────────────────────────────────────────────────────────────────
  describe("roundToGrid", () => {
    it("arrondit à la grille 0.01° (~1 km)", () => {
      expect(roundToGrid({ lat: 44.12345, lng: 3.98765 })).toEqual({
        lat: 44.12,
        lng: 3.99,
      });
    });

    it("ne renvoie jamais la position exacte", () => {
      const exact = { lat: 45.123456, lng: 2.987654 };
      const grid = roundToGrid(exact);
      expect(grid.lat).not.toBe(exact.lat);
      expect(grid.lng).not.toBe(exact.lng);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DÉCHIFFREMENT LOCATION (côté serveur, format {coordinates:[lng,lat]})
  // ─────────────────────────────────────────────────────────────────────────
  describe("decryptPointLocation", () => {
    it("déchiffre et parse [lng, lat] → {lat, lng}", async () => {
      mockDecryptUserKeys.mockResolvedValue(
        JSON.stringify({ type: "Point", coordinates: [3.5, 44.2] }),
      );
      const res = await decryptPointLocation("user1", "iv:tag:enc");
      expect(res).toEqual({ lat: 44.2, lng: 3.5 });
    });

    it("renvoie null si déchiffrement échoue (pas de crash)", async () => {
      mockDecryptUserKeys.mockRejectedValue(new Error("bad key"));
      const res = await decryptPointLocation("user1", "iv:tag:enc");
      expect(res).toBeNull();
    });

    it("renvoie null si coords hors bornes", async () => {
      mockDecryptUserKeys.mockResolvedValue(
        JSON.stringify({ coordinates: [999, 999] }),
      );
      expect(await decryptPointLocation("u", "x")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNAL PLUIE (Open-Meteo) — cumul pondéré
  // ─────────────────────────────────────────────────────────────────────────
  describe("getRainComponent", () => {
    it("calcule un cumul pondéré et un niveau", async () => {
      const precip = Array(15).fill(2); // pluie régulière
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(
          jsonResponse({ daily: { precipitation_sum: precip } }),
        );

      const rain = await getRainComponent({ lat: 44, lng: 3 });
      expect(rain.days).toBe(15);
      expect(rain.cumulMm).toBeGreaterThan(0);
      expect(["favorable", "modere", "defavorable", "tres_defavorable"]).toContain(
        rain.level,
      );
    });

    it("fallback gracieux si Open-Meteo indisponible", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, false, 500));
      const rain = await getRainComponent({ lat: 44, lng: 3 });
      expect(rain.cumulMm).toBe(0);
      expect(rain.days).toBe(0);
      expect(rain.level).toBe("favorable");
    });

    it("met en cache (un seul appel pour la même grille)", async () => {
      const spy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(
          jsonResponse({ daily: { precipitation_sum: Array(15).fill(1) } }),
        );
      await getRainComponent({ lat: 44, lng: 3 });
      await getRainComponent({ lat: 44, lng: 3 });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNAL RIVIÈRE (Hub'Eau) — France only + fallback station manquante
  // ─────────────────────────────────────────────────────────────────────────
  describe("getRiverComponent", () => {
    it("renvoie null hors France (Hub'Eau FR)", async () => {
      const spy = jest.spyOn(global, "fetch");
      const res = await getRiverComponent({ lat: 51.5, lng: -100 }); // Amérique
      expect(res).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it("renvoie null si aucune station proche", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
      const res = await getRiverComponent({ lat: 44, lng: 3 });
      expect(res).toBeNull();
    });

    it("calcule hauteur + niveau relatif quand station + observations", async () => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({ data: [{ code_station: "X123" }] }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { resultat_obs: 1500 },
              { resultat_obs: 1400 },
              { resultat_obs: 1300 },
              { resultat_obs: 1200 },
            ],
          }),
        );
      const res = await getRiverComponent({ lat: 44, lng: 3 });
      expect(res).not.toBeNull();
      expect(res!.station).toBe("X123");
      expect(res!.heightM).toBeCloseTo(1.5, 3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNAL NAPPE (Hub'Eau Piézo)
  // ─────────────────────────────────────────────────────────────────────────
  describe("getGroundwaterComponent", () => {
    it("renvoie null hors France", async () => {
      expect(await getGroundwaterComponent({ lat: 0, lng: 0 })).toBeNull();
    });

    it("renvoie null si aucune station piézo proche", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
      expect(await getGroundwaterComponent({ lat: 44, lng: 3 })).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNAL VIGICRUES (vigilance crue officielle) — appariement géo + fallback
  // ─────────────────────────────────────────────────────────────────────────
  describe("getVigicruesComponent", () => {
    it("renvoie null hors France (pas d'appel externe)", async () => {
      const spy = jest.spyOn(global, "fetch");
      const res = await getVigicruesComponent({ lat: 51.5, lng: -100 });
      expect(res).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it("renvoie null si aucune feature exploitable", async () => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse({ features: [] }));
      const res = await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(res).toBeNull();
    });

    it("renvoie null si aucun tronçon assez proche (>15 km)", async () => {
      // Tronçon loin (Paris) alors qu'on interroge dans le Sud.
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse({
          features: [
            vigicruesFeature(3, "Seine Paris", [
              [2.35, 48.85],
              [2.36, 48.86],
            ]),
          ],
        }),
      );
      const res = await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(res).toBeNull();
    });

    it("apparie le tronçon le plus proche et mappe la couleur (orange)", async () => {
      // Tronçon passant juste à côté de (44, 3).
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse({
          features: [
            vigicruesFeature(
              3,
              "Cours d'eau test",
              [
                [3.0, 43.99],
                [3.0, 44.01],
              ],
              "2026/05/30 09:00:00.000",
            ),
          ],
        }),
      );
      const res = await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(res).not.toBeNull();
      expect(res!.color).toBe("orange");
      expect(res!.troncon).toBe("Cours d'eau test");
      expect(res!.updatedAt).toBe("2026/05/30 09:00:00.000");
      expect(res!.label).toContain("orange");
    });

    it("retient le tronçon le plus proche parmi plusieurs", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse({
          features: [
            // Plus proche : rouge, juste à côté.
            vigicruesFeature(4, "Proche", [
              [3.0, 43.999],
              [3.0, 44.001],
            ]),
            // Plus loin (~8 km) : vert.
            vigicruesFeature(1, "Loin", [
              [3.1, 43.999],
              [3.1, 44.001],
            ]),
          ],
        }),
      );
      const res = await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(res!.color).toBe("rouge");
      expect(res!.troncon).toBe("Proche");
    });

    it("ignore les codes de vigilance inconnus", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse({
          features: [
            vigicruesFeature(99, "Inconnu", [
              [3.0, 43.99],
              [3.0, 44.01],
            ]),
          ],
        }),
      );
      const res = await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(res).toBeNull();
    });

    it("n'envoie aucune coordonnée dans l'URL Vigicrues (confidentialité)", async () => {
      const spy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse({ features: [] }));
      await getVigicruesComponent({ lat: 44.12, lng: 3.99 });
      const url = String(spy.mock.calls[0][0]);
      expect(url).not.toContain("44.12");
      expect(url).not.toContain("3.99");
      expect(url).toContain("InfoVigiCru.geojson");
    });

    it("met en cache (un seul appel pour la même grille)", async () => {
      const spy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse({ features: [] }));
      await getVigicruesComponent({ lat: 44, lng: 3 });
      await getVigicruesComponent({ lat: 44, lng: 3 });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RELÈVEMENT DE NIVEAU PAR VIGICRUES (sécurité : monte seulement)
  // ─────────────────────────────────────────────────────────────────────────
  describe("applyVigicruesFloor", () => {
    const vc = (color: VigicruesComponent["color"]): VigicruesComponent => ({
      color,
      label: color,
      troncon: "t",
    });

    it("ne change rien si vigicrues null", () => {
      expect(applyVigicruesFloor("favorable", null)).toBe("favorable");
    });

    it("vert ne relève jamais", () => {
      expect(applyVigicruesFloor("favorable", vc("vert"))).toBe("favorable");
    });

    it("jaune force au moins modere", () => {
      expect(applyVigicruesFloor("favorable", vc("jaune"))).toBe("modere");
    });

    it("orange force au moins defavorable", () => {
      expect(applyVigicruesFloor("modere", vc("orange"))).toBe("defavorable");
    });

    it("rouge force tres_defavorable", () => {
      expect(applyVigicruesFloor("favorable", vc("rouge"))).toBe(
        "tres_defavorable",
      );
    });

    it("ne RABAISSE jamais un niveau mesuré plus sévère", () => {
      // Mesuré tres_defavorable, vigilance jaune → reste tres_defavorable.
      expect(applyVigicruesFloor("tres_defavorable", vc("jaune"))).toBe(
        "tres_defavorable",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // COMBINAISON SCORE — renormalisation sur signaux disponibles
  // ─────────────────────────────────────────────────────────────────────────
  describe("combineScore", () => {
    const rain = (level: RainComponent["level"]): RainComponent => ({
      cumulMm: 0,
      days: 15,
      level,
    });

    it("score bas quand tout est favorable", () => {
      const s = combineScore(rain("favorable"), null, null);
      expect(s).toBeLessThan(33);
    });

    it("score haut quand tout est très défavorable", () => {
      const s = combineScore(
        rain("tres_defavorable"),
        { station: "S", heightM: 2, trend: "up", level: "tres_defavorable" },
        { station: "G", trend: "up", level: "tres_defavorable" },
      );
      expect(s).toBeGreaterThanOrEqual(82);
    });

    it("calcule sur la pluie seule si river/groundwater null (fallback)", () => {
      // Avec uniquement la pluie modérée, le score reste celui de la pluie.
      const s = combineScore(rain("modere"), null, null);
      expect(s).toBe(45);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ORCHESTRATION — computeHydroRisk
  // ─────────────────────────────────────────────────────────────────────────
  describe("computeHydroRisk", () => {
    it("agrège les 4 signaux et renvoie le contrat complet", async () => {
      // Les 4 appels partent en parallèle (Promise.all) → on route par URL.
      jest.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("open-meteo")) {
          return Promise.resolve(
            jsonResponse({ daily: { precipitation_sum: Array(15).fill(3) } }),
          );
        }
        if (url.includes("InfoVigiCru")) {
          return Promise.resolve(jsonResponse({ features: [] }));
        }
        // Hub'Eau (river/groundwater) : aucune station.
        return Promise.resolve(jsonResponse({ data: [] }));
      });

      const result = await computeHydroRisk("pointA", { lat: 44.123, lng: 3.456 });

      expect(result.pointId).toBe("pointA");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.rain).toBeDefined();
      expect(result.river).toBeNull();
      expect(result.groundwater).toBeNull();
      expect(result.vigicrues).toBeNull();
      expect(result.disclaimer).toBe(DISCLAIMER);
      expect(typeof result.updatedAt).toBe("string");
    });

    it("relève le niveau global à tres_defavorable si Vigicrues rouge (score inchangé)", async () => {
      jest.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("open-meteo")) {
          // Pluie quasi nulle → score mesuré bas (favorable).
          return Promise.resolve(
            jsonResponse({ daily: { precipitation_sum: Array(15).fill(0) } }),
          );
        }
        if (url.includes("InfoVigiCru")) {
          return Promise.resolve(
            jsonResponse({
              features: [
                vigicruesFeature(4, "Crue majeure", [
                  [3.46, 44.119],
                  [3.46, 44.121],
                ]),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: [] }));
      });

      const result = await computeHydroRisk("pointR", { lat: 44.12, lng: 3.456 });

      // Score mesuré reste bas (pluie nulle, pas de station) …
      expect(result.score).toBeLessThan(33);
      // … mais le niveau FINAL est relevé par la vigilance rouge.
      expect(result.level).toBe("tres_defavorable");
      expect(result.vigicrues!.color).toBe("rouge");
    });

    it("n'envoie aux APIs que la position arrondie (confidentialité)", async () => {
      const spy = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(jsonResponse({ data: [] }));

      await computeHydroRisk("p", { lat: 44.987654, lng: 3.123456 });

      // Aucune URL ne doit contenir les coordonnées exactes (Vigicrues inclus).
      const calledUrls = spy.mock.calls.map((c) => String(c[0]));
      for (const url of calledUrls) {
        expect(url).not.toContain("44.987654");
        expect(url).not.toContain("3.123456");
      }
      // La grille (44.99 / 3.12) doit apparaître dans l'appel Open-Meteo.
      expect(calledUrls.some((u) => u.includes("44.99"))).toBe(true);
      // L'appel Vigicrues ne porte AUCUNE coordonnée (FeatureCollection nationale).
      const vigiUrl = calledUrls.find((u) => u.includes("InfoVigiCru"));
      expect(vigiUrl).toBeDefined();
      expect(vigiUrl).not.toMatch(/4[45]\.\d|3\.\d/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLER — batch & point
// ═══════════════════════════════════════════════════════════════════════════

jest.mock("../../models/points");
import PointModel from "../../models/points";
import {
  handleGetHydroRiskBatch,
  handleGetPointHydroRisk,
} from "../../controllers/hydroRiskControllers";

function mockRes() {
  const res: Partial<Response> & {
    statusCode?: number;
    body?: unknown;
  } = {};
  res.status = jest.fn().mockImplementation((code: number) => {
    (res as { statusCode?: number }).statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = jest.fn().mockImplementation((b: unknown) => {
    (res as { body?: unknown }).body = b;
    return res;
  }) as unknown as Response["json"];
  return res as Response & { statusCode: number; body: any };
}

describe("hydroRiskControllers", () => {
  const VALID_ID_A = "507f1f77bcf86cd799439011";
  const VALID_ID_B = "507f1f77bcf86cd799439012";

  beforeEach(() => {
    _clearHydroCache();
    jest.restoreAllMocks();
    mockDecryptUserKeys.mockReset();
    (PointModel.findOne as unknown as jest.Mock) = jest.fn();
  });

  function stubPointFound(coordsLngLat: [number, number]) {
    (PointModel.findOne as jest.Mock).mockReturnValue({
      select: () => ({
        lean: () => ({
          maxTimeMS: async () => ({ location_encrypted: "iv:tag:enc" }),
        }),
      }),
    });
    mockDecryptUserKeys.mockResolvedValue(
      JSON.stringify({ coordinates: coordsLngLat }),
    );
  }

  function stubPointNotFound() {
    (PointModel.findOne as jest.Mock).mockReturnValue({
      select: () => ({
        lean: () => ({ maxTimeMS: async () => null }),
      }),
    });
  }

  describe("handleGetPointHydroRisk", () => {
    it("401 si non authentifié", async () => {
      const res = mockRes();
      await handleGetPointHydroRisk(
        { user: undefined, params: { id: VALID_ID_A } } as any,
        res,
      );
      expect(res.statusCode).toBe(401);
    });

    it("400 si ID invalide", async () => {
      const res = mockRes();
      await handleGetPointHydroRisk(
        { user: { id: "u" }, params: { id: "not-an-id" } } as any,
        res,
      );
      expect(res.statusCode).toBe(400);
    });

    it("404 si point introuvable", async () => {
      stubPointNotFound();
      const res = mockRes();
      await handleGetPointHydroRisk(
        { user: { id: "u" }, params: { id: VALID_ID_A } } as any,
        res,
      );
      expect(res.statusCode).toBe(404);
    });

    it("200 avec indicateur si point trouvé", async () => {
      stubPointFound([3.4, 44.2]);
      jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
      const res = mockRes();
      await handleGetPointHydroRisk(
        { user: { id: "u" }, params: { id: VALID_ID_A } } as any,
        res,
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.pointId).toBe(VALID_ID_A);
      expect(res.body.disclaimer).toBe(DISCLAIMER);
    });
  });

  describe("handleGetHydroRiskBatch", () => {
    it("400 si pointIds manquant", async () => {
      const res = mockRes();
      await handleGetHydroRiskBatch(
        { user: { id: "u" }, query: {} } as any,
        res,
      );
      expect(res.statusCode).toBe(400);
    });

    it("400 si plus de 50 ids", async () => {
      const ids = Array(51).fill(VALID_ID_A).join(",");
      const res = mockRes();
      await handleGetHydroRiskBatch(
        { user: { id: "u" }, query: { pointIds: ids } } as any,
        res,
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("TOO_MANY_POINT_IDS");
    });

    it("retourne results + errors partielles", async () => {
      // A trouvé, B introuvable, id invalide ignoré en erreur.
      (PointModel.findOne as jest.Mock).mockImplementation(
        (q: { _id: string }) => ({
          select: () => ({
            lean: () => ({
              maxTimeMS: async () =>
                q._id === VALID_ID_A
                  ? { location_encrypted: "iv:tag:enc" }
                  : null,
            }),
          }),
        }),
      );
      mockDecryptUserKeys.mockResolvedValue(
        JSON.stringify({ coordinates: [3.4, 44.2] }),
      );
      jest.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ data: [] }));

      const res = mockRes();
      await handleGetHydroRiskBatch(
        {
          user: { id: "u" },
          query: { pointIds: `${VALID_ID_A},${VALID_ID_B},bad-id` },
        } as any,
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].pointId).toBe(VALID_ID_A);
      const errorIds = res.body.errors.map((e: { pointId: string }) => e.pointId);
      expect(errorIds).toContain(VALID_ID_B);
      expect(errorIds).toContain("bad-id");
    });
  });
});
