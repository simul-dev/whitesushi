import { describe, expect, it } from "vitest";
import source from "../floorplan.json";
import { patchEntity, validatePlan } from "./model";
describe("review document invariants", () => {
  it("loads the real plan, preserves zero-height zones and dimension references", () => {
    const p = validatePlan(source);
    expect(p.bounds).toEqual({ width: 8800, depth: 21200 });
    expect(p.objects.filter((e) => e.type === "table")).toHaveLength(20);
    expect(p.objects.filter((e) => e.type === "chair")).toHaveLength(72);
    expect(p.zones[0].height).toBe(0);
    expect(p.floorOutline?.length).toBeGreaterThan(4);
  });
  it("rejects malformed documents before replacing the current project", () => {
    expect(() => validatePlan({ ...source, name: { bad: true } })).toThrow(
      "name",
    );
    expect(() => validatePlan({ ...source, units: "m" })).toThrow("mm");
    expect(() =>
      validatePlan({
        ...source,
        objects: [{ ...source.objects[0], width: -1 }],
      }),
    ).toThrow("width");
  });
  it("resizes a rotated polygon along its local width and invalidates review", () => {
    let p = validatePlan(source);
    p.zones = [
      {
        id: "test",
        type: "zone",
        name: "room",
        x: 0,
        y: 0,
        z: 0,
        width: 1000,
        depth: 2000,
        height: 0,
        rotation: 0,
        confidence: 1,
        source: "manual",
        reviewed: true,
        polygon: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 2000 },
          { x: 0, y: 2000 },
        ],
      },
    ];
    p = patchEntity(p, "test", { rotation: 90 });
    p = patchEntity(p, "test", { width: 2000 });
    const poly = p.zones[0].polygon!;
    expect(
      Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)),
    ).toBeCloseTo(2000);
    expect(p.zones[0].reviewed).toBe(false);
    expect(source.zones[0].name).not.toBe("room");
  });
});
