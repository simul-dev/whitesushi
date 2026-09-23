import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  boundsCorners,
  buildPlanModel,
  createFittedCamera,
  disposeObject,
  footprintCorners,
  getModelBounds,
  getWallSegments,
  VIEW_PRESETS,
} from "./scene";
import type { Entity, FloorPlan } from "./types";

const entity = (overrides: Partial<Entity> = {}): Entity => ({
  id: "test",
  type: "wall",
  name: "Test",
  x: 0,
  y: 0,
  z: 0,
  width: 4000,
  depth: 200,
  height: 2800,
  rotation: 0,
  confidence: 1,
  source: "test",
  ...overrides,
});
const plan = (overrides: Partial<FloorPlan> = {}): FloorPlan => ({
  version: 1,
  name: "Test",
  units: "mm",
  bounds: { width: 8800, depth: 21200 },
  settings: {
    wallHeight: 2800,
    ceilingHeight: 2800,
    wallThickness: 150,
    doorHeight: 2100,
    furnitureHeight: 750,
    material: "warm-neutral",
    lighting: 1,
  },
  walls: [],
  doors: [],
  windows: [],
  objects: [],
  zones: [],
  ...overrides,
});

describe("actual opening solids", () => {
  it("cuts a diagonal doorway with intact lintel and exact remaining volume", () => {
    const wall = entity({ rotation: 37 }),
      door = entity({
        id: "door",
        type: "door",
        x: 1500,
        width: 1000,
        height: 2100,
        rotation: 37,
        wallId: wall.id,
      });
    const solids = getWallSegments(wall, [door]);
    expect(solids).toHaveLength(3);
    const volume = solids.reduce(
      (sum, s) => sum + s.width * s.depth * s.height,
      0,
    );
    expect(volume).toBeCloseTo((4000 * 2800 - 1000 * 2100) * 200, 3);
    expect(
      solids.some(
        (s) => Math.abs(s.x) < 0.01 && s.y - s.height / 2 >= 2100 - 0.01,
      ),
    ).toBe(true);
  });
  it("cuts vertical walls and respects a different explicit wall association", () => {
    const wall = entity({ width: 200, depth: 4000 });
    const door = entity({
      type: "door",
      id: "door",
      x: 0,
      y: 1500,
      width: 200,
      depth: 1000,
      height: 2100,
    });
    expect(getWallSegments(wall, [door])).toHaveLength(3);
    expect(
      getWallSegments(wall, [{ ...door, wallId: "unrelated" }]),
    ).toHaveLength(1);
  });
  it("merges overlapping vertical openings without negative or overlapping solids", () => {
    const wall = entity(),
      a = entity({ id: "a", x: 1000, width: 1500, height: 2100 });
    const b = entity({ id: "b", x: 2000, width: 1000, z: 900, height: 1500 });
    const solids = getWallSegments(wall, [a, b]);
    expect(
      solids.every((s) => s.width > 0 && s.depth > 0 && s.height > 0),
    ).toBe(true);
    const solidVolume = solids.reduce(
      (sum, s) => sum + s.width * s.depth * s.height,
      0,
    );
    const removed = 1500 * 2100 + 1000 * 1500 - 500 * 1200;
    expect(solidVolume).toBeCloseTo((4000 * 2800 - removed) * 200, 3);
  });
  it("does not cut an unassociated perpendicular return wall", () => {
    const wall = entity({ width: 200, depth: 4000 });
    const perpendicular = entity({
      id: "door",
      width: 900,
      depth: 100,
      height: 2100,
    });
    expect(getWallSegments(wall, [perpendicular])).toHaveLength(1);
  });
});

describe("exact model coordinates and camera fit", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-0.25, -0.1, -0.05),
    new THREE.Vector3(9.1, 2.8, 21.5),
  );
  for (const view of VIEW_PRESETS)
    for (const aspect of [0.4, 4 / 3, 2.4]) {
      it(`fits all corners for ${view} at ${aspect}`, () => {
        const camera = createFittedCamera(view, bounds, aspect);
        expect(camera instanceof THREE.OrthographicCamera).toBe(
          view !== "Perspective",
        );
        for (const corner of boundsCorners(bounds)) {
          const p = corner.project(camera);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
        }
      });
    }
  it("preserves drawing x right and drawing y down in top view", () => {
    const camera = createFittedCamera("Top", bounds, 4 / 3);
    const a = new THREE.Vector3(0, 0, 0).project(camera),
      b = new THREE.Vector3(1, 0, 1).project(camera);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y);
  });
  it("uses the rotated millimetre source footprint and metres in the scene", () => {
    const object = entity({
      type: "table",
      x: 4200,
      y: 6100,
      width: 1000,
      depth: 750,
      height: 720,
      rotation: 30,
    });
    const model = buildPlanModel(plan({ objects: [object] }));
    const group = model.children.find(
      (node) => node.userData.entityId === object.id,
    )!;
    const box = getModelBounds(group),
      points = footprintCorners(object);
    expect(box.min.x).toBeCloseTo(
      Math.min(...points.map((p) => p.x)) / 1000,
      6,
    );
    expect(box.max.z).toBeCloseTo(
      Math.max(...points.map((p) => p.y)) / 1000,
      6,
    );
    expect(box.max.y).toBeCloseTo(0.72, 6);
    disposeObject(model);
  });
  it("keeps all parametric object geometry inside declared dimensions", () => {
    const types = [
      "table",
      "chair",
      "stool",
      "bench",
      "sink",
      "counter",
      "refrigerator",
      "showcase",
      "fryer",
      "dishwasher",
      "column",
      "iceMaker",
      "shelf",
    ];
    const objects = types.map((type, index) =>
      entity({
        id: String(index),
        type,
        width: 900,
        depth: 650,
        height: 800,
        rotation: 0,
      }),
    );
    const model = buildPlanModel(plan({ objects }));
    for (const object of objects) {
      const group = model.children.find(
        (node) => node.userData.entityId === object.id,
      )!;
      const bounds = getModelBounds(group),
        size = bounds.getSize(new THREE.Vector3());
      expect(size.x).toBeLessThanOrEqual(0.900001);
      expect(size.z).toBeLessThanOrEqual(0.650001);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.000001);
      expect(bounds.max.y).toBeLessThanOrEqual(0.800001);
    }
    disposeObject(model);
  });
});
