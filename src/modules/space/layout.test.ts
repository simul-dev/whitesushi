import { describe, expect, it } from "vitest";
import source from "../../../floorplan.json";
import { toStoreLayout, validatePlan, type LayoutMapping } from "./index";

const options = { id: "layout", revision: 1, storeId: "store", documentId: "original", documentRevision: 1 };
const sample = () => validatePlan(source);

describe("FloorPlan → StoreLayout", () => {
  it("uses the irregular outline and distinguishes observed geometry from business capacity", () => {
    const layout = toStoreLayout(sample(), options);
    expect(layout.totalAreaM2).toBeCloseTo(159.929657105, 8);
    expect(layout.totalAreaBasis).toBe("outline");
    expect(layout.geometry.elements).toHaveLength(157);
    expect(layout.tableCount).toBe(20);
    expect(layout.chairCount).toBe(72);
    expect(layout.confirmedCapacity).toBeNull();
    expect(layout.hallAreaM2).toBeNull();
    expect(layout.kitchenAreaM2).toBeNull();
    expect(layout.assignments.entranceIds).toEqual([]);
    expect(layout.assignments.kitchenStationIds).toEqual([]);
    expect(layout.issues.some(issue => issue.code === "unconfirmed-capacity")).toBe(true);
    expect(layout.geometry.elements.find(element => element.id === "door-entry")?.wallId).toBeTruthy();
  });

  it("accepts explicit roles and table capacities without mutating the original document or mapping", () => {
    const plan = sample();
    const before = structuredClone(plan);
    const mapping: LayoutMapping = {
      entranceIds: ["door-entry"],
      tableCapacities: Object.fromEntries(plan.objects.filter(entity => entity.type === "table").map(table => [table.id, 4])),
      zoneRoles: { "zone-dining": "hall", "zone-kitchen": "kitchen", "zone-corridor": "service" },
    };
    const layout = toStoreLayout(plan, { ...options, mapping });
    expect(layout.confirmedCapacity).toBe(80);
    expect(layout.hallAreaM2).toBeCloseTo(83.578, 2);
    expect(layout.kitchenAreaM2).toBeCloseTo(24.122, 2);
    expect(layout.assignments.entranceIds).toEqual(["door-entry"]);
    layout.geometry.elements[0].x = -12345;
    layout.assignments.entranceIds.push("foreign-id");
    expect(plan).toEqual(before);
    expect(mapping.entranceIds).toEqual(["door-entry"]);
  });

  it("keeps capacity unknown when only some tables have assignments", () => {
    const table = sample().objects.find(entity => entity.type === "table")!;
    expect(toStoreLayout(sample(), { ...options, mapping: { tableCapacities: { [table.id]: 4 } } }).confirmedCapacity).toBeNull();
  });

  it("labels bounds fallback as an estimate", () => {
    const plan = sample();
    delete plan.floorOutline;
    const layout = toStoreLayout(plan, options);
    expect(layout.totalAreaM2).toBe(186.56);
    expect(layout.totalAreaBasis).toBe("bounds-estimate");
    expect(layout.issues.some(issue => issue.code === "estimated-area")).toBe(true);
  });

  it("preserves a legacy deleted-wall document while marking the derived association unresolved", () => {
    const plan = sample();
    const door = plan.doors.find(entity => entity.wallId)!;
    plan.walls = plan.walls.filter(wall => wall.id !== door.wallId);
    const layout = toStoreLayout(plan, options);
    expect(layout.geometry.elements.find(element => element.id === door.id)?.wallId).toBeUndefined();
    expect(layout.issues.some(issue => issue.code === "unresolved-wall-reference" && issue.path.includes(door.id))).toBe(true);
    expect(plan.doors.find(entity => entity.id === door.id)?.wallId).toBe(door.wallId);
  });

  it("rejects foreign IDs, wrong element categories, fractional and invalid capacities", () => {
    const table = sample().objects.find(entity => entity.type === "table")!;
    for (const mapping of [
      { entranceIds: ["not-there"] },
      { entranceIds: [table.id] },
      { entranceIds: ["door-entry", "door-entry"] },
      { zoneRoles: { [table.id]: "hall" as const } },
      { tableCapacities: { [table.id]: 1.5 } },
      { tableCapacities: { [table.id]: -1 } },
      { tableCapacities: { [table.id]: NaN } },
    ]) expect(() => toStoreLayout(sample(), { ...options, mapping })).toThrow();
    expect(() => toStoreLayout(sample(), { ...options, revision: 0 })).toThrow();
  });
});
