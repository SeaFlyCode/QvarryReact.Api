import { planPlacementSchema, planUpdateSchema, planNameSchema } from "../../schemas/planSchemas";

const valid = {
  centerLat: 48.85,
  centerLng: 2.35,
  widthMeters: 120,
  aspectRatio: 1.5,
  rotationDeg: 45,
  opacity: 0.7,
  visible: true,
};

describe("planSchemas", () => {
  it("accepte un placement valide", () => {
    expect(planPlacementSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["centerLat", 90.1],
    ["centerLat", -91],
    ["centerLng", 180.5],
    ["centerLng", -181],
    ["widthMeters", 0],
    ["widthMeters", 100001],
    ["aspectRatio", 0],
    ["rotationDeg", 361],
    ["rotationDeg", -361],
    ["opacity", 1.1],
    ["opacity", -0.1],
    ["centerLat", NaN],
    ["visible", "yes"],
  ])("rejette %s = %p", (field, value) => {
    expect(planPlacementSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("accepte les bornes exactes", () => {
    const r = planPlacementSchema.safeParse({
      ...valid, centerLat: -90, centerLng: 180, widthMeters: 100000, rotationDeg: -360, opacity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejette un champ inconnu", () => {
    expect(planPlacementSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it("nom : 1..100 caractères, trim", () => {
    expect(planNameSchema.safeParse("  ").success).toBe(false);
    expect(planNameSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(planNameSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("PATCH : au moins un champ, placement null autorisé", () => {
    expect(planUpdateSchema.safeParse({}).success).toBe(false);
    expect(planUpdateSchema.safeParse({ placement: null }).success).toBe(true);
    expect(planUpdateSchema.safeParse({ name: "x" }).success).toBe(true);
    expect(planUpdateSchema.safeParse({ name: "x", foo: 1 }).success).toBe(false);
  });
});
