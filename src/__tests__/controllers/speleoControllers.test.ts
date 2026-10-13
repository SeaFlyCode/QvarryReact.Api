// ═══════════════════════════════════════════════════════════════════════════
// TESTS — speleoControllers (parsing/validation params + handler)
// ═══════════════════════════════════════════════════════════════════════════

import {
  parseBBox,
  parseZoom,
  parseLayers,
  handleGetSpeleo,
} from "../../controllers/speleoControllers";
import { ALL_LAYERS } from "../../types/speleo";

// Mock du service : le controller ne doit pas appeler les API externes.
jest.mock("../../services/speleoService", () => ({
  getSpeleoData: jest.fn(),
}));
import { getSpeleoData } from "../../services/speleoService";
const mockGetSpeleoData = getSpeleoData as jest.Mock;

function mockRes() {
  const res: { statusCode?: number; body?: unknown } & {
    status: jest.Mock;
    json: jest.Mock;
  } = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe("speleoControllers — parsing", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // parseBBox
  // ─────────────────────────────────────────────────────────────────────────
  describe("parseBBox", () => {
    it("parse une bbox valide lon,lat,lon,lat", () => {
      expect(parseBBox("4.3,44.3,4.6,44.5")).toEqual({
        minLon: 4.3,
        minLat: 44.3,
        maxLon: 4.6,
        maxLat: 44.5,
      });
    });

    it("tolère les espaces", () => {
      expect(parseBBox(" 4.3 , 44.3 , 4.6 , 44.5 ")).toEqual({
        minLon: 4.3,
        minLat: 44.3,
        maxLon: 4.6,
        maxLat: 44.5,
      });
    });

    it("rejette un nombre de composantes incorrect", () => {
      expect(parseBBox("4.3,44.3,4.6")).toBeNull();
      expect(parseBBox("4.3,44.3,4.6,44.5,extra")).toBeNull();
    });

    it("rejette les non-numériques", () => {
      expect(parseBBox("a,b,c,d")).toBeNull();
      expect(parseBBox("4.3,44.3,x,44.5")).toBeNull();
    });

    it("rejette min >= max (bbox dégénérée/inversée)", () => {
      expect(parseBBox("4.6,44.3,4.3,44.5")).toBeNull(); // minLon > maxLon
      expect(parseBBox("4.3,44.5,4.6,44.3")).toBeNull(); // minLat > maxLat
    });

    it("rejette les coordonnées hors bornes EPSG:4326", () => {
      expect(parseBBox("-200,44.3,4.6,44.5")).toBeNull();
      expect(parseBBox("4.3,-100,4.6,44.5")).toBeNull();
    });

    it("rejette une valeur non-string", () => {
      expect(parseBBox(undefined)).toBeNull();
      expect(parseBBox(123)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // parseZoom
  // ─────────────────────────────────────────────────────────────────────────
  describe("parseZoom", () => {
    it("parse un entier valide", () => {
      expect(parseZoom("10")).toBe(10);
      expect(parseZoom(8)).toBe(8);
    });
    it("rejette les non-entiers", () => {
      expect(parseZoom("10.5")).toBeNull();
      expect(parseZoom("abc")).toBeNull();
    });
    it("rejette hors bornes 0-22", () => {
      expect(parseZoom("-1")).toBeNull();
      expect(parseZoom("99")).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // parseLayers
  // ─────────────────────────────────────────────────────────────────────────
  describe("parseLayers", () => {
    it("absent → toutes les couches", () => {
      expect(parseLayers(undefined)).toEqual(ALL_LAYERS);
      expect(parseLayers(null)).toEqual(ALL_LAYERS);
      expect(parseLayers("")).toEqual(ALL_LAYERS);
    });

    it("parse un sous-ensemble valide", () => {
      expect(parseLayers("cavites,sic")).toEqual(["cavites", "sic"]);
    });

    it("ignore les couches inconnues mais garde les valides", () => {
      expect(parseLayers("cavites,foo,sic")).toEqual(["cavites", "sic"]);
    });

    it("dédoublonne en conservant l'ordre", () => {
      expect(parseLayers("sic,sic,cavites")).toEqual(["sic", "cavites"]);
    });

    it("insensible à la casse", () => {
      expect(parseLayers("CAVITES,Sic")).toEqual(["cavites", "sic"]);
    });

    it("null si toutes les valeurs sont invalides", () => {
      expect(parseLayers("foo,bar")).toBeNull();
    });
  });
});

describe("speleoControllers — handleGetSpeleo", () => {
  beforeEach(() => {
    mockGetSpeleoData.mockReset();
  });

  function reqWith(query: Record<string, unknown>, user: unknown = { id: "u1" }) {
    return { query, user } as never;
  }

  it("401 si non authentifié", async () => {
    const res = mockRes();
    await handleGetSpeleo(
      reqWith({ bbox: "4.3,44.3,4.6,44.5", zoom: "10" }, null),
      res as never,
    );
    expect(res.statusCode).toBe(401);
    expect(mockGetSpeleoData).not.toHaveBeenCalled();
  });

  it("400 INVALID_BBOX si bbox manquante/malformée", async () => {
    const res = mockRes();
    await handleGetSpeleo(reqWith({ zoom: "10" }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe("INVALID_BBOX");
  });

  it("400 INVALID_ZOOM si zoom manquant/non entier", async () => {
    const res = mockRes();
    await handleGetSpeleo(
      reqWith({ bbox: "4.3,44.3,4.6,44.5", zoom: "x" }),
      res as never,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe("INVALID_ZOOM");
  });

  it("400 INVALID_LAYERS si toutes les couches sont inconnues", async () => {
    const res = mockRes();
    await handleGetSpeleo(
      reqWith({ bbox: "4.3,44.3,4.6,44.5", zoom: "10", layers: "foo" }),
      res as never,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe("INVALID_LAYERS");
  });

  it("200 et délègue au service avec les params parsés", async () => {
    const fake = { zoomTooLow: false, cavites: {}, zonages: {} };
    mockGetSpeleoData.mockResolvedValue(fake);
    const res = mockRes();
    await handleGetSpeleo(
      reqWith({ bbox: "4.3,44.3,4.6,44.5", zoom: "10", layers: "cavites,sic" }),
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(fake);
    expect(mockGetSpeleoData).toHaveBeenCalledWith(
      { minLon: 4.3, minLat: 44.3, maxLon: 4.6, maxLat: 44.5 },
      10,
      ["cavites", "sic"],
    );
  });

  it("500 SPELEO_ERROR si le service throw", async () => {
    mockGetSpeleoData.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await handleGetSpeleo(
      reqWith({ bbox: "4.3,44.3,4.6,44.5", zoom: "10" }),
      res as never,
    );
    expect(res.statusCode).toBe(500);
    expect((res.body as { code: string }).code).toBe("SPELEO_ERROR");
  });
});
