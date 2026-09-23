import type {
  ArtifactRef, Assumption, DemandParameters, DemandProfile, FinancialAssumption,
  MarketProfile, ModuleVersion, OperationPolicy, Project, ProjectConfiguration,
  ScenarioOverrides, SimulationConfig, Site, StoreLayout,
} from "./types";

export class DomainValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DomainValidationError";
  }
}
const fail = (path: string, message: string): never => { throw new DomainValidationError(path, message); };
export const text = (value: unknown, path: string) => {
  if (typeof value !== "string" || !value.trim()) fail(path, "must be a non-empty string");
};
export function number(value: unknown, path: string, min = 0, max = Number.MAX_VALUE, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value)))
    fail(path, `must be ${integer ? "an integer" : "finite"} in [${min}, ${max}]`);
}
export function timestamp(value: string, path: string) {
  text(value, path);
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail(path, "must be an ISO timestamp");
}
export function ref(value: ArtifactRef, path: string) { text(value.id, `${path}.id`); number(value.revision, `${path}.revision`, 1, Number.MAX_SAFE_INTEGER, true); }
export function moduleVersion(value: ModuleVersion, path: string) { text(value.id, `${path}.id`); text(value.version, `${path}.version`); }
const day = (value: unknown, path: string) => {
  if (!["weekday", "weekend", "holiday"].includes(String(value))) fail(path, "invalid day type");
};
const unique = (values: string[], path: string) => {
  if (new Set(values).size !== values.length) fail(path, "duplicate identifier");
};

/** Exact canonical JSON is intentionally retained instead of a lossy short hash. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("json", "non-finite numbers are not supported");
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || !item) return fail("json", "only JSON values are supported; omit undefined fields");
    if (ancestors.has(item)) fail("json", "cyclic values are not supported");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      fail("json", "only plain objects are supported");
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) if (!(i in item)) fail("json", "sparse arrays are not supported");
      result = `[${item.map(encode).join(",")}]`;
    } else {
      const record = item as Record<string, unknown>;
      result = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}
function assumptions(values: Assumption[], path: string) {
  unique(values.map((a) => a.id), path);
  values.forEach((a, i) => {
    text(a.id, `${path}.${i}.id`); text(a.description, `${path}.${i}.description`);
    text(a.unit, `${path}.${i}.unit`); text(a.source, `${path}.${i}.source`); canonicalJson(a.value);
  });
}
export function validateSite(site: Site) {
  ref(site, "site"); text(site.name, "site.name"); text(site.timeZone, "site.timeZone");
  try { new Intl.DateTimeFormat("en", { timeZone: site.timeZone }); } catch { fail("site.timeZone", "unknown IANA timezone"); }
  if (site.address !== null) text(site.address, "site.address");
  if (site.coordinates !== null) {
    number(site.coordinates.latitude, "site.latitude", -90, 90);
    number(site.coordinates.longitude, "site.longitude", -180, 180);
  }
}
export function validateLayout(layout: StoreLayout) {
  ref(layout, "layout"); text(layout.storeId, "layout.storeId");
  if (layout.schemaVersion !== 1 || layout.geometry.units !== "mm" || layout.geometry.coordinateSystem !== "x-right-y-down-z-up" || layout.source.format !== "floorplan-json") fail("layout", "unsupported schema/units/source format");
  text(layout.source.documentId, "layout.source.documentId");
  if (typeof layout.source.documentVersion === "number") number(layout.source.documentVersion, "layout.source.documentVersion", 0);
  else text(layout.source.documentVersion, "layout.source.documentVersion");
  number(layout.source.documentRevision, "layout.source.documentRevision", 1, Number.MAX_SAFE_INTEGER, true);
  number(layout.geometry.bounds.width, "layout.bounds.width", Number.MIN_VALUE);
  number(layout.geometry.bounds.depth, "layout.bounds.depth", Number.MIN_VALUE);
  const point = (p: { x: number; y: number }) => { number(p.x, "layout.point.x", -1e9, 1e9); number(p.y, "layout.point.y", -1e9, 1e9); };
  const polygon = (points: { x: number; y: number }[]) => { if (points.length < 3) fail("layout.polygon", "requires at least three points"); points.forEach(point); };
  if (layout.geometry.outline) polygon(layout.geometry.outline);
  unique(layout.geometry.elements.map((e) => e.id), "layout.elements");
  layout.geometry.elements.forEach((e) => {
    text(e.id, "element.id"); text(e.type, "element.type"); text(e.name, "element.name");
    number(e.confidence, "element.confidence", 0, 1); text(e.source, "element.source");
    if (typeof e.reviewed !== "boolean") fail("element.reviewed", "must be boolean");
    if (!["wall", "door", "window", "zone", "object"].includes(e.kind)) fail("element.kind", "unsupported element kind");
    [e.x, e.y, e.z, e.rotationDegrees].forEach((v) => number(v, `element.${e.id}.coordinate`, -1e9, 1e9));
    [e.width, e.depth].forEach((v) => number(v, `element.${e.id}.size`, Number.MIN_VALUE));
    number(e.height, `element.${e.id}.height`, e.kind === "zone" ? 0 : Number.MIN_VALUE);
    if (e.polygon) polygon(e.polygon);
  });
  number(layout.totalAreaM2, "layout.totalAreaM2", Number.MIN_VALUE);
  if (!["outline", "bounds-estimate"].includes(layout.totalAreaBasis)) fail("layout.totalAreaBasis", "unsupported area basis");
  for (const field of ["hallAreaM2", "kitchenAreaM2", "serviceAreaM2"] as const) if (layout[field] !== null) number(layout[field], `layout.${field}`);
  for (const field of ["tableCount", "chairCount"] as const) number(layout[field], `layout.${field}`, 0, Number.MAX_SAFE_INTEGER, true);
  if (layout.tableCount !== layout.geometry.elements.filter((e) => e.kind === "object" && e.type === "table").length ||
      layout.chairCount !== layout.geometry.elements.filter((e) => e.kind === "object" && e.type === "chair").length)
    fail("layout.counts", "observed counts must match geometry");
  if (layout.confirmedCapacity !== null) number(layout.confirmedCapacity, "layout.confirmedCapacity", 0, Number.MAX_SAFE_INTEGER, true);
  const elements = new Map(layout.geometry.elements.map((e) => [e.id, e]));
  layout.geometry.elements.forEach((e) => {
    if (e.wallId !== undefined && elements.get(e.wallId)?.kind !== "wall") fail("element.wallId", "must reference a wall");
  });
  const assigned = (ids: string[], label: string, kind: string) => {
    unique(ids, label);
    ids.forEach((id) => { if (elements.get(id)?.kind !== kind) fail(label, `missing or incompatible element ${id}`); });
  };
  assigned(layout.assignments.entranceIds, "layout.entrances", "door");
  assigned(layout.assignments.kitchenStationIds, "layout.kitchenStations", "object");
  assigned(layout.assignments.serviceStationIds, "layout.serviceStations", "object");
  assigned(layout.assignments.tables.map((t) => t.elementId), "layout.tables", "object");
  layout.assignments.tables.forEach((t) => {
    if (elements.get(t.elementId)?.type !== "table") fail("layout.tables", "table assignment requires a table element");
    if (t.capacity !== null) number(t.capacity, "layout.table.capacity", 0, Number.MAX_SAFE_INTEGER, true);
  });
  if (layout.confirmedCapacity !== null && (layout.assignments.tables.length !== layout.tableCount ||
      layout.assignments.tables.some((t) => t.capacity === null) ||
      layout.assignments.tables.reduce((sum, t) => sum + (t.capacity ?? 0), 0) !== layout.confirmedCapacity))
    fail("layout.confirmedCapacity", "requires complete table assignments and must equal their capacity sum");
  assigned(layout.assignments.zoneRoles.map((z) => z.elementId), "layout.zoneRoles", "zone");
  layout.assignments.zoneRoles.forEach((z) => { if (!["hall", "kitchen", "service", "other"].includes(z.role)) fail("layout.zoneRoles", "unknown role"); });
  assumptions(layout.assumptions, "layout.assumptions");
  layout.issues.forEach((issue) => { text(issue.code, "issue.code"); text(issue.path, "issue.path"); text(issue.message, "issue.message"); });
  canonicalJson(layout);
}
export function validateDemandParameters(parameters: DemandParameters) {
  for (const key of ["categoryParticipationRate", "brandShare", "visitConversionRate", "deliveryRatio"] as const) number(parameters[key], `demandParameters.${key}`, 0, 1);
  for (const key of ["weekdayMultiplier", "weekendMultiplier", "lunchMultiplier", "dinnerMultiplier", "weatherEventMultiplier"] as const) number(parameters[key], `demandParameters.${key}`);
}
function provenance(value: MarketProfile["provenance"], path: string) {
  if (!["observed", "manual", "derived", "demo"].includes(value.kind)) fail(path, "unknown data provenance");
  text(value.source, `${path}.source`);
  if (value.observedAt !== undefined) timestamp(value.observedAt, `${path}.observedAt`);
}
export function validateMarket(market: MarketProfile) {
  ref(market, "market"); ref(market.siteRef, "market.siteRef"); text(market.siteContentKey, "market.siteContentKey");
  moduleVersion(market.provider, "market.provider"); provenance(market.provenance, "market.provenance");
  timestamp(market.period.from, "market.period.from"); timestamp(market.period.to, "market.period.to");
  if (Date.parse(market.period.to) < Date.parse(market.period.from)) fail("market.period", "end precedes start");
  unique(market.buckets.map((b) => `${b.dayType}:${b.hour}`), "market.buckets");
  market.buckets.forEach((b) => {
    day(b.dayType, "market.dayType"); number(b.hour, "market.hour", 0, 23, true);
    if (b.population !== null) number(b.population, "market.population");
    if (b.footTrafficPersons !== null) number(b.footTrafficPersons, "market.footTrafficPersons");
  });
  unique(market.nearbyBusinesses.map((b) => b.id), "market.nearbyBusinesses");
  market.nearbyBusinesses.forEach((b) => { text(b.id, "business.id"); text(b.name, "business.name"); text(b.category, "business.category"); number(b.distanceMeters, "business.distanceMeters"); if (typeof b.competitor !== "boolean") fail("business.competitor", "must be boolean"); });
  assumptions(market.assumptions, "market.assumptions");
}
export function validateDemand(demand: DemandProfile) {
  ref(demand, "demand"); moduleVersion(demand.model, "demand.model"); provenance(demand.provenance, "demand.provenance");
  ref(demand.lineage.marketRef, "demand.marketRef");
  text(demand.lineage.marketContentKey, "demand.marketContentKey"); text(demand.lineage.parametersContentKey, "demand.parametersContentKey");
  unique(demand.buckets.map((b) => `${b.dayType}:${b.hour}`), "demand.buckets");
  demand.buckets.forEach((b) => {
    day(b.dayType, "demand.dayType"); number(b.hour, "demand.hour", 0, 23, true);
    number(b.expectedCustomersPerHour, "demand.expectedCustomersPerHour");
    if (!["poisson", "deterministic"].includes(b.distribution)) fail("demand.distribution", "unsupported distribution");
  });
  assumptions(demand.assumptions, "demand.assumptions");
}
export function validateOperation(policy: OperationPolicy) {
  moduleVersion(policy.model, "operation.model");
  for (const field of ["cooks", "servers", "cashiers", "kitchenConcurrentOrders"] as const) number(policy.resources[field], `operation.resources.${field}`, 0, Number.MAX_SAFE_INTEGER, true);
  for (const field of ["orderingSeconds", "cookingSeconds", "servingSeconds", "diningSeconds", "paymentSeconds", "cleaningSeconds"] as const) number(policy.durations[field], `operation.durations.${field}`, Number.MIN_VALUE);
  policy.operatingWindows.forEach((window) => {
    day(window.dayType, "operation.window.dayType"); number(window.startMinute, "operation.window.startMinute", 0, 1439, true);
    number(window.endMinute, "operation.window.endMinute", 1, 1440, true);
    if (window.endMinute <= window.startMinute) fail("operation.window", "end must follow start; split overnight windows");
  });
  for (const dayType of ["weekday", "weekend", "holiday"] as const) {
    const windows = policy.operatingWindows.filter((w) => w.dayType === dayType).sort((a, b) => a.startMinute - b.startMinute);
    if (windows.some((w, i) => i > 0 && w.startMinute < windows[i - 1].endMinute)) fail("operation.operatingWindows", "windows overlap");
  }
  number(policy.averageSpendingPerCustomer, "operation.averageSpendingPerCustomer"); text(policy.currency, "operation.currency");
  assumptions(policy.assumptions, "operation.assumptions");
}
export function validateSimulation(config: SimulationConfig) {
  number(config.seed, "simulation.seed", 0, 0xffffffff, true);
  number(config.durationSeconds, "simulation.durationSeconds", Number.MIN_VALUE, 86400);
  number(config.startMinute, "simulation.startMinute", 0, 1439, true);
  if (config.startMinute * 60 + config.durationSeconds > 86400) fail("simulation", "a run must fit one selected day; split overnight runs");
  day(config.dayType, "simulation.dayType"); number(config.replications, "simulation.replications", 1, 100000, true);
}
export function validateFinancial(value: FinancialAssumption) {
  ref(value, "financial"); text(value.currency, "financial.currency");
  number(value.operatingDaysPerMonth, "financial.operatingDaysPerMonth", Number.MIN_VALUE, 31);
  for (const field of ["foodCostRatio", "royaltyRatio", "deliveryFeeRatio"] as const) number(value[field], `financial.${field}`, 0, 1);
  for (const field of ["monthlyRent", "monthlyLabor", "monthlyUtilities", "monthlyMarketing", "monthlyOtherFixed", "initialCapex", "initialFranchiseFee", "initialInteriorCost"] as const) number(value[field], `financial.${field}`);
  assumptions(value.assumptions, "financial.assumptions");
}
export function validateConfiguration(value: ProjectConfiguration) {
  if (value.layoutRef !== null) ref(value.layoutRef, "layoutRef");
  if (value.market !== null) validateMarket(value.market);
  if (value.demandParameters !== null) validateDemandParameters(value.demandParameters);
  if (value.demand !== null) validateDemand(value.demand);
  if (value.operation !== null) validateOperation(value.operation);
  if (value.simulation !== null) validateSimulation(value.simulation);
  if (value.financial !== null) validateFinancial(value.financial);
  canonicalJson(value);
}
const OVERRIDE_KEYS = ["layoutRef", "market", "demandParameters", "demand", "operation", "simulation", "financial"];
export function validateOverridesShape(overrides: ScenarioOverrides) {
  if (Object.keys(overrides).some((key) => !OVERRIDE_KEYS.includes(key))) fail("overrides", "unknown configuration section");
  canonicalJson(overrides);
}
/** Typed internal boundary only; this is deliberately NOT an unknown/JSON parser. */
export function validateProject(project: Project) {
  if (project.schemaVersion !== 1) fail("project.schemaVersion", "unsupported version");
  ref(project, "project"); text(project.name, "project.name"); validateSite(project.site);
  timestamp(project.createdAt, "project.createdAt"); timestamp(project.updatedAt, "project.updatedAt");
  project.layouts.forEach(validateLayout);
  if (project.layouts.some((layout) => layout.storeId !== project.site.id)) fail("layout.storeId", "layout belongs to a different site");
  unique(project.layouts.map((l) => `${l.id}:${l.revision}`), "project.layouts");
  validateConfiguration(project.base);
  unique(project.scenarios.map((s) => s.id), "project.scenarios");
  project.scenarios.forEach((s) => {
    ref(s, "scenario"); text(s.name, "scenario.name");
    if (s.projectId !== project.id) fail("scenario.projectId", "scenario belongs to another project");
    timestamp(s.createdAt, "scenario.createdAt"); timestamp(s.updatedAt, "scenario.updatedAt"); validateOverridesShape(s.overrides);
  });
  canonicalJson(project);
}
