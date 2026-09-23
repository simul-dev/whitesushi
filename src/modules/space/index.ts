// Pure public API. Browser UI, PDF workers and Three.js have separate entry points.
export type { FloorPlan, Entity, Point, PlanSettings, Overlay, Category } from "./types";
export { CATEGORIES, DEFAULT_SETTINGS, allEntities } from "./types";
export { validatePlan, patchEntity, newEntity } from "./model";
export { footprintCorners, getWallSegments } from "./wallGeometry";
