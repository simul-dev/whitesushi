import { describe, it, expect } from "vitest";
import data from "../../../floorplan.json";
import { getWallSegments, type WallSegment } from "./wallGeometry";
import { validatePlan } from "./model";
import { buildPlanModel, disposeObject } from "./scene";
import type { Entity } from "./types";
import { Box3, Vector3 } from "three";
const plan = validatePlan(data);
function covered(
  w: Entity,
  segments: WallSegment[],
  x: number,
  y: number,
  z = 1000,
) {
  const dx = x - w.x - w.width / 2,
    dy = y - w.y - w.depth / 2,
    a = (w.rotation * Math.PI) / 180;
  const u = dx * Math.cos(a) + dy * Math.sin(a),
    v = -dx * Math.sin(a) + dy * Math.cos(a);
  return segments.some(
    (s) =>
      Math.abs(u - s.x) < s.width / 2 - 0.01 &&
      Math.abs(v - s.z) < s.depth / 2 - 0.01 &&
      Math.abs(z - s.y) < s.height / 2 - 0.01,
  );
}
describe("source doorway editing", () => {
  for (const door of plan.doors)
    it(`${door.id}: opening and lintel match, moved/deleted old hole closes`, () => {
      const w = plan.walls.find((w) => w.id === door.wallId)!;
      expect(w).toBeDefined();
      const x = door.x + door.width / 2,
        y = door.y + door.depth / 2;
      const pieces = getWallSegments(w, plan.doors);
      expect(covered(w, pieces, x, y)).toBe(false);
      expect(covered(w, pieces, x, y, 2500)).toBe(true);
      expect(
        covered(
          w,
          getWallSegments(
            w,
            plan.doors.filter((e) => e.id !== door.id),
          ),
          x,
          y,
        ),
      ).toBe(true);
      const a = (door.rotation * Math.PI) / 180,
        ux = Math.cos(a),
        uy = Math.sin(a);
      const moved = { ...door, x: door.x + ux * 300, y: door.y + uy * 300 };
      expect(
        covered(
          w,
          getWallSegments(
            w,
            plan.doors.map((e) => (e.id === door.id ? moved : e)),
          ),
          x - ux * (door.width / 2 - 100),
          y - uy * (door.width / 2 - 100),
        ),
      ).toBe(true);
    });
  it("bench back follows the long west wall without changing footprint", () => {
    const model = buildPlanModel(plan);
    const e = plan.objects.find((e) => e.type === "bench")!;
    const g = model.children.find((g) => g.userData.entityId === e.id)!;
    const back = g.getObjectByName("bench back")!;
    const box = new Box3().setFromObject(back);
    const dimensions = box.getSize(new Vector3());
    expect(dimensions.z).toBeGreaterThan(6);
    expect(dimensions.x).toBeLessThan(0.2);
    expect(box.getCenter(new Vector3()).x).toBeLessThan(0.2);
    disposeObject(model);
  });
});
