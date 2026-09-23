import type { LayoutElement, StoreLayout } from "../../core";
import { validatePlan } from "./model";
import { allEntities, type Category, type Entity, type FloorPlan, type Point } from "./types";

/** Operational semantics are explicit user assignments, never inferred from names. */
export interface LayoutMapping {
  entranceIds?: string[];
  tableCapacities?: Record<string, number | null>;
  kitchenStationIds?: string[];
  serviceStationIds?: string[];
  zoneRoles?: Record<string, "hall" | "kitchen" | "service" | "other">;
}

export interface LayoutAdapterOptions {
  id: string;
  revision: number;
  storeId: string;
  documentId: string;
  documentRevision: number;
  mapping?: LayoutMapping;
}

/** Footprint area only; does not subtract walls/furniture or union overlaps. */
export function polygonAreaM2(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2_000_000;
}

const kinds: Record<Category, LayoutElement["kind"]> = {
  walls: "wall", doors: "door", windows: "window", zones: "zone", objects: "object",
};

function requireIds(ids: readonly string[], allowed: readonly Entity[], label: string) {
  if (new Set(ids).size !== ids.length || ids.some(id => !allowed.some(entity => entity.id === id))) {
    throw new Error(`${label}: 중복되거나 존재하지 않는 요소 ID입니다.`);
  }
}

/** Derives a detached, UI-independent layout. Never replaces or modifies FloorPlan. */
export function toStoreLayout(input: FloorPlan, options: LayoutAdapterOptions): StoreLayout {
  const plan = validatePlan(input);
  for (const key of ["id", "storeId", "documentId"] as const) {
    if (!options[key]?.trim()) throw new Error(`StoreLayout ${key}가 필요합니다.`);
  }
  for (const key of ["revision", "documentRevision"] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`${key}는 양의 정수여야 합니다.`);
  }
  const mapping = structuredClone(options.mapping ?? {});
  const wallIds = new Set(plan.walls.map(wall => wall.id));
  const tables = plan.objects.filter(entity => entity.type === "table");
  const equipment = plan.objects.filter(entity => !["table", "chair", "bench", "column"].includes(entity.type));
  const entranceIds = mapping.entranceIds ?? [];
  const kitchenStationIds = mapping.kitchenStationIds ?? [];
  const serviceStationIds = mapping.serviceStationIds ?? [];
  requireIds(entranceIds, plan.doors, "출입구");
  requireIds(Object.keys(mapping.tableCapacities ?? {}), tables, "테이블 정원");
  requireIds(kitchenStationIds, equipment, "주방 스테이션");
  requireIds(serviceStationIds, equipment, "서비스 스테이션");
  requireIds(Object.keys(mapping.zoneRoles ?? {}), plan.zones, "영역 역할");
  if (kitchenStationIds.some(id => serviceStationIds.includes(id))) {
    throw new Error("하나의 설비를 주방과 서비스 스테이션에 중복 배정할 수 없습니다.");
  }
  const assignedTables = tables.map(table => {
    const capacity = mapping.tableCapacities?.[table.id] ?? null;
    if (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 0)) {
      throw new Error(`${table.id}: 정원은 0 이상의 정수 또는 미설정이어야 합니다.`);
    }
    return { elementId: table.id, capacity };
  });
  const zoneRoles = Object.entries(mapping.zoneRoles ?? {}).map(([elementId, role]) => {
    if (!["hall", "kitchen", "service", "other"].includes(role)) throw new Error("영역 역할이 올바르지 않습니다.");
    return { elementId, role };
  });
  const areaForRole = (role: "hall" | "kitchen" | "service"): number | null => {
    const zones = plan.zones.filter(zone => mapping.zoneRoles?.[zone.id] === role);
    if (!zones.length) return null;
    return zones.reduce((sum, zone) => sum + (zone.polygon
      ? polygonAreaM2(zone.polygon)
      : zone.width * zone.depth / 1_000_000), 0);
  };
  const confirmedCapacity = assignedTables.length && assignedTables.every(table => table.capacity !== null)
    ? assignedTables.reduce((sum, table) => sum + table.capacity!, 0)
    : null;
  const layout: StoreLayout = {
    schemaVersion: 1,
    id: options.id,
    revision: options.revision,
    storeId: options.storeId,
    source: {
      format: "floorplan-json",
      documentId: options.documentId,
      documentVersion: plan.version,
      documentRevision: options.documentRevision,
    },
    geometry: {
      units: "mm",
      coordinateSystem: "x-right-y-down-z-up",
      bounds: { ...plan.bounds },
      ...(plan.floorOutline ? { outline: structuredClone(plan.floorOutline) } : {}),
      elements: allEntities(plan).map(({ category, entity }) => ({
        id: entity.id, kind: kinds[category], type: entity.type, name: entity.name,
        x: entity.x, y: entity.y, z: entity.z,
        width: entity.width, depth: entity.depth, height: entity.height,
        rotationDegrees: entity.rotation,
        confidence: entity.confidence, source: entity.source, reviewed: entity.reviewed ?? false,
        ...(entity.wallId && wallIds.has(entity.wallId) ? { wallId: entity.wallId } : {}),
        ...(entity.polygon ? { polygon: structuredClone(entity.polygon) } : {}),
      })),
    },
    totalAreaM2: plan.floorOutline ? polygonAreaM2(plan.floorOutline) : plan.bounds.width * plan.bounds.depth / 1_000_000,
    totalAreaBasis: plan.floorOutline ? "outline" : "bounds-estimate",
    hallAreaM2: areaForRole("hall"),
    kitchenAreaM2: areaForRole("kitchen"),
    serviceAreaM2: areaForRole("service"),
    tableCount: tables.length,
    chairCount: plan.objects.filter(entity => entity.type === "chair").length,
    confirmedCapacity,
    assignments: { entranceIds, tables: assignedTables, kitchenStationIds, serviceStationIds, zoneRoles },
    assumptions: [
      { id: "space-area-method", description: "도면 footprint 면적. 벽/가구 공제 및 중첩 영역 합집합을 계산하지 않음.", value: plan.floorOutline ? "outline" : "bounds-estimate", unit: "m²", source: "space-adapter" },
      { id: "space-height-defaults", description: "기본 높이는 도면에 없는 편집 가능한 가정이며 개별 요소 값과 다를 수 있음.", value: { wall: plan.settings.wallHeight, door: plan.settings.doorHeight, furniture: plan.settings.furnitureHeight }, unit: "mm", source: "FloorPlan.settings" },
      { id: "space-capacity", description: "영업 정원은 명시적으로 배정한 테이블별 정원의 합. 의자 개수로 추정하지 않음.", value: confirmedCapacity, unit: "customers", source: "user-mapping" },
    ],
    issues: [],
  };
  for (const { entity } of allEntities(plan)) {
    if (entity.wallId && !wallIds.has(entity.wallId)) layout.issues.push({
      code: "unresolved-wall-reference", path: `geometry.elements.${entity.id}.wallId`,
      message: `연결된 벽 ${entity.wallId}이 없어 운영용 형상에서는 연결을 미확정으로 남겼습니다. 원본 문서는 보존됩니다.`,
    });
  }
  if (!plan.floorOutline) layout.issues.push({ code: "estimated-area", path: "totalAreaM2", message: "외곽이 없어 치수 기준 사각형 면적을 사용합니다." });
  if (confirmedCapacity === null) layout.issues.push({ code: "unconfirmed-capacity", path: "assignments.tables", message: "테이블별 정원이 미설정입니다. 벤치 등을 포함한 실제 수용 인원을 확인하세요." });
  if (!entranceIds.length) layout.issues.push({ code: "unassigned-entrance", path: "assignments.entranceIds", message: "외부 출입구를 지정해야 합니다. 내부 문은 자동으로 출입구가 되지 않습니다." });
  if (zoneRoles.length < plan.zones.length) layout.issues.push({ code: "unassigned-zones", path: "assignments.zoneRoles", message: "영업 영역 역할이 지정되지 않은 공간이 있습니다." });
  if (!kitchenStationIds.length) layout.issues.push({ code: "unassigned-kitchen", path: "assignments.kitchenStationIds", message: "주방 설비의 운영 스테이션 역할이 미설정입니다." });
  if (!serviceStationIds.length) layout.issues.push({ code: "unassigned-service", path: "assignments.serviceStationIds", message: "서비스 설비의 운영 스테이션 역할이 미설정입니다." });
  return layout;
}
