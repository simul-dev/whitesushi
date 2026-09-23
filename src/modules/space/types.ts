export interface Point {
  x: number;
  y: number;
}
export interface Entity {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  confidence: number;
  source: string;
  reviewed?: boolean;
  wallId?: string;
  color?: string;
  polygon?: Point[];
  notes?: string | string[];
  [key: string]: unknown;
}
export interface PlanSettings {
  wallHeight: number;
  ceilingHeight: number;
  wallThickness: number;
  doorHeight: number;
  furnitureHeight: number;
  material: string;
  lighting: number;
}
export interface Overlay {
  x: number;
  y: number;
  width: number;
  depth: number;
  pageWidth: number;
  pageHeight: number;
  page: number;
  url: string;
}
export interface FloorPlan {
  version: number | string;
  name: string;
  units: "mm";
  bounds: { width: number; depth: number };
  floorOutline?: Point[];
  settings: PlanSettings;
  walls: Entity[];
  doors: Entity[];
  windows: Entity[];
  zones: Entity[];
  objects: Entity[];
  overlay?: Overlay;
  metadata?: Record<string, unknown>;
  notes?: string[];
  calibration?: Record<string, unknown>;
  [key: string]: unknown;
}
export type Category = "walls" | "doors" | "windows" | "zones" | "objects";
export type ViewPreset =
  | "Perspective"
  | "Top"
  | "Front"
  | "Back"
  | "Left"
  | "Right";
export const CATEGORIES: Category[] = [
  "walls",
  "doors",
  "windows",
  "zones",
  "objects",
];
export const CATEGORY_LABELS: Record<Category, string> = {
  walls: "벽체",
  doors: "문",
  windows: "창",
  zones: "공간",
  objects: "가구 · 설비",
};
export const DEFAULT_SETTINGS: PlanSettings = {
  wallHeight: 2800,
  ceilingHeight: 2800,
  wallThickness: 100,
  doorHeight: 2100,
  furnitureHeight: 750,
  material: "warm-neutral",
  lighting: 1,
};
export const VIEWS: ViewPreset[] = [
  "Perspective",
  "Top",
  "Front",
  "Back",
  "Left",
  "Right",
];
export const allEntities = (plan: FloorPlan) =>
  CATEGORIES.flatMap((category) =>
    plan[category].map((entity) => ({ category, entity })),
  );
export const confidenceColor = (e: Entity) =>
  e.reviewed || e.confidence >= 0.85
    ? "#409777"
    : e.confidence >= 0.5
      ? "#c58a25"
      : "#d26058";
