import {
  CATEGORIES,
  DEFAULT_SETTINGS,
  type Entity,
  type FloorPlan,
  type Point,
} from "./types";
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown) => finite(v) && v > 0 && v <= 1000000;
const isPoint = (p: unknown): p is Point =>
  !!p &&
  typeof p === "object" &&
  finite((p as Point).x) &&
  finite((p as Point).y);
export function validatePlan(input: unknown): FloorPlan {
  if (!input || typeof input !== "object")
    throw new Error("FloorPlan JSON 객체가 필요합니다.");
  const p = structuredClone(input) as FloorPlan;
  if (p.units !== "mm") throw new Error("좌표 단위는 mm여야 합니다.");
  if (!p.bounds || !positive(p.bounds.width) || !positive(p.bounds.depth))
    throw new Error("bounds의 width, depth가 올바르지 않습니다.");
  p.version ??= 1;
  if (p.name != null && typeof p.name !== "string")
    throw new Error("name은 문자열이어야 합니다.");
  p.name ||= "가져온 도면";
  p.settings = { ...DEFAULT_SETTINGS, ...p.settings };
  for (const key of [
    "wallHeight",
    "ceilingHeight",
    "wallThickness",
    "doorHeight",
    "furnitureHeight",
    "lighting",
  ] as const)
    if (!positive(p.settings[key]))
      throw new Error(`기본값 ${key}가 올바르지 않습니다.`);
  if (typeof p.settings.material !== "string")
    throw new Error("material은 문자열이어야 합니다.");
  const ids = new Set<string>();
  for (const category of CATEGORIES) {
    if (!Array.isArray(p[category]))
      throw new Error(`${category} 배열이 필요합니다.`);
    if (p[category].length > 5000)
      throw new Error(
        "요소 수가 너무 많습니다. 한 범주당 5,000개까지 지원합니다.",
      );
    for (const e of p[category]) {
      if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id))
        throw new Error("각 요소에 고유한 id가 필요합니다.");
      ids.add(e.id);
      for (const k of ["x", "y", "z", "rotation", "confidence"] as const)
        if (!finite(e[k])) throw new Error(`${e.id}: ${k} 숫자를 확인하세요.`);
      for (const k of ["width", "depth", "height"] as const)
        if (
          !(category === "zones" && k === "height" && e[k] === 0) &&
          !positive(e[k])
        )
          throw new Error(`${e.id}: ${k}는 0보다 커야 합니다.`);
      if (
        e.confidence < 0 ||
        e.confidence > 1 ||
        Math.abs(e.x) > 1e6 ||
        Math.abs(e.y) > 1e6 ||
        Math.abs(e.z) > 1e6
      )
        throw new Error(`${e.id}: 좌표 또는 confidence 범위를 확인하세요.`);
      if (
        typeof e.type !== "string" ||
        typeof e.name !== "string" ||
        typeof e.source !== "string"
      )
        throw new Error(`${e.id}: type/name/source가 필요합니다.`);
      if (
        e.polygon &&
        (!Array.isArray(e.polygon) ||
          e.polygon.length < 3 ||
          !e.polygon.every(isPoint))
      )
        throw new Error(`${e.id}: polygon을 확인하세요.`);
    }
  }
  if (
    p.floorOutline &&
    (!Array.isArray(p.floorOutline) ||
      p.floorOutline.length < 3 ||
      !p.floorOutline.every(isPoint))
  )
    throw new Error("floorOutline에 최소 3개의 좌표가 필요합니다.");
  if (p.overlay) {
    const o = p.overlay;
    if (
      ![o.x, o.y, o.page].every(finite) ||
      ![o.width, o.depth, o.pageWidth, o.pageHeight].every(positive)
    )
      throw new Error("overlay 좌표가 올바르지 않습니다.");
    // Imported JSON cannot silently fetch remote overlays or arbitrary local URLs.
    if (
      !(
        typeof o.url === "string" &&
        (/^data:image\/(png|jpeg|webp);base64,/.test(o.url) ||
          /^\/(sample-plan\.png)$/.test(o.url))
      )
    )
      delete p.overlay;
  }
  return p;
}
export function patchEntity(
  plan: FloorPlan,
  id: string,
  patch: Partial<Entity>,
): FloorPlan {
  return {
    ...plan,
    ...Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        plan[c].map((e) => {
          if (e.id !== id) return e;
          const geometricEdit = Object.keys(patch).some((k) =>
            [
              "x",
              "y",
              "z",
              "width",
              "depth",
              "height",
              "rotation",
              "polygon",
              "name",
              "type",
            ].includes(k),
          );
          const next = {
            ...e,
            ...patch,
            ...(geometricEdit
              ? {
                  source: "manual",
                  originalSource: e.originalSource || e.source,
                  originalConfidence: e.originalConfidence ?? e.confidence,
                  confidence: Math.min(0.5, e.confidence),
                }
              : {}),
          };
          if (
            e.polygon &&
            ("x" in patch ||
              "y" in patch ||
              "width" in patch ||
              "depth" in patch ||
              "rotation" in patch)
          ) {
            const oldAngle = (e.rotation * Math.PI) / 180,
              newAngle = (next.rotation * Math.PI) / 180;
            next.polygon = e.polygon.map((p) => {
              const dx = p.x - e.x - e.width / 2,
                dy = p.y - e.y - e.depth / 2;
              const px =
                ((dx * Math.cos(oldAngle) + dy * Math.sin(oldAngle)) *
                  next.width) /
                e.width;
              const py =
                ((-dx * Math.sin(oldAngle) + dy * Math.cos(oldAngle)) *
                  next.depth) /
                e.depth;
              return {
                x:
                  next.x +
                  next.width / 2 +
                  px * Math.cos(newAngle) -
                  py * Math.sin(newAngle),
                y:
                  next.y +
                  next.depth / 2 +
                  px * Math.sin(newAngle) +
                  py * Math.cos(newAngle),
              };
            });
          }
          return { ...next, reviewed: patch.reviewed ?? false };
        }),
      ]),
    ),
  };
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function newEntity(type: string, plan: FloorPlan): Entity {
  const size: Record<string, number[]> = {
    wall: [2000, plan.settings.wallThickness, plan.settings.wallHeight],
    door: [900, 150, plan.settings.doorHeight],
    sliding_door: [1000, 100, plan.settings.doorHeight],
    window: [1200, 150, 1200],
    zone: [3000, 3000, 10],
    table: [1000, 750, plan.settings.furnitureHeight],
    chair: [450, 450, 800],
    bench: [1800, 500, 850],
    sink: [900, 750, 850],
    counter: [1200, 750, 850],
    refrigerator: [900, 750, 1800],
    showcase: [500, 450, 1200],
    fryer: [600, 750, 850],
    dishwasher: [750, 750, 850],
  };
  const [width, depth, height] = size[type] || [800, 600, 800];
  return {
    id: crypto.randomUUID(),
    type,
    name: TYPE_LABELS[type] || type,
    x: Math.round((plan.bounds.width - width) / 2),
    y: Math.round((plan.bounds.depth - depth) / 2),
    z: type === "window" ? 900 : 0,
    width,
    depth,
    height,
    rotation: 0,
    confidence: 0.3,
    source: "manual",
    reviewed: false,
  };
}
export const TYPE_LABELS: Record<string, string> = {
  wall: "벽",
  door: "여닫이문",
  sliding_door: "슬라이딩 도어",
  window: "창",
  zone: "공간",
  table: "테이블",
  chair: "의자",
  bench: "붙박이 의자",
  sink: "싱크대",
  counter: "작업대",
  refrigerator: "냉장고",
  showcase: "쇼케이스",
  fryer: "튀김기",
  dishwasher: "세척기",
};
