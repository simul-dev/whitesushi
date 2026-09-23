import type { Entity } from "./types";
const EPS = 0.001;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const positive = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;

export interface WallSegment {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

/** Coordinates in the drawing's millimetre coordinate system. */
export function footprintCorners(entity: Entity): { x: number; y: number }[] {
  const angle = radians(entity.rotation || 0),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const cx = entity.x + entity.width / 2,
    cy = entity.y + entity.depth / 2;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const dx = (sx * entity.width) / 2,
      dy = (sy * entity.depth) / 2;
    return { x: cx + c * dx - s * dy, y: cy + s * dx + c * dy };
  });
}

/**
 * Split a wall into non-overlapping solids around door/window voids. All values
 * here remain mm. Opening footprints are projected into the rotated wall frame.
 * This supports rectangular, parallel wall openings without a fragile mesh CSG.
 */
export function getWallSegments(
  wall: Entity,
  openings: Entity[],
  defaultHeight = 2700,
): WallSegment[] {
  const w = positive(wall.width, 150),
    d = positive(wall.depth, 150),
    h = positive(wall.height, defaultHeight);
  const alongX = w >= d,
    length = alongX ? w : d,
    thickness = alongX ? d : w;
  const theta = radians(wall.rotation || 0),
    c = Math.cos(theta),
    s = Math.sin(theta);
  const cx = wall.x + w / 2,
    cy = wall.y + d / 2;
  const holes: { start: number; end: number; bottom: number; top: number }[] =
    [];
  for (const opening of openings) {
    if (opening.wallId && opening.wallId !== wall.id) continue;
    // A footprint touching a perpendicular return wall must not create a second
    // doorway. Explicit associations are authoritative; otherwise require axes
    // to agree within about 18 degrees before using geometric overlap.
    const wallAxis = theta + (alongX ? 0 : Math.PI / 2);
    const openingAxis =
      radians(opening.rotation || 0) +
      (opening.width >= opening.depth ? 0 : Math.PI / 2);
    if (!opening.wallId && Math.abs(Math.cos(openingAxis - wallAxis)) < 0.95)
      continue;
    const local = footprintCorners(opening).map((p) => {
      const dx = p.x - cx,
        dy = p.y - cy;
      const lx = c * dx + s * dy,
        lz = -s * dx + c * dy;
      return { along: alongX ? lx : lz, across: alongX ? lz : lx };
    });
    const acrossMin = Math.min(...local.map((p) => p.across)),
      acrossMax = Math.max(...local.map((p) => p.across));
    if (acrossMax <= -thickness / 2 + EPS || acrossMin >= thickness / 2 - EPS)
      continue;
    const start = Math.max(-length / 2, Math.min(...local.map((p) => p.along)));
    const end = Math.min(length / 2, Math.max(...local.map((p) => p.along)));
    const bottom = Math.max(0, (opening.z || 0) - (wall.z || 0));
    const top = Math.min(
      h,
      (opening.z || 0) + positive(opening.height, 2100) - (wall.z || 0),
    );
    if (end - start > EPS && top - bottom > EPS)
      holes.push({ start, end, bottom, top });
  }
  const stops = [
    ...new Set([
      -length / 2,
      length / 2,
      ...holes.flatMap((hole) => [hole.start, hole.end]),
    ]),
  ].sort((a, b) => a - b);
  const result: WallSegment[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i],
      b = stops[i + 1],
      mid = (a + b) / 2;
    if (b - a <= EPS) continue;
    const intervals = holes
      .filter((hole) => mid > hole.start - EPS && mid < hole.end + EPS)
      .map((hole) => [hole.bottom, hole.top])
      .sort((aa, bb) => aa[0] - bb[0]);
    let bottom = 0;
    const add = (from: number, to: number) => {
      if (to - from <= EPS) return;
      result.push({
        x: alongX ? mid : 0,
        y: (from + to) / 2,
        z: alongX ? 0 : mid,
        width: alongX ? b - a : w,
        depth: alongX ? d : b - a,
        height: to - from,
      });
    };
    for (const [from, to] of intervals) {
      add(bottom, from);
      bottom = Math.max(bottom, to);
    }
    add(bottom, h);
  }
  return result;
}
