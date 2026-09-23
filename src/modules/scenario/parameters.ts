import {
  applyOverrides, createScenario, DomainValidationError, registerLayout, resolveScenario,
  validateLayout, type Project, type ResolvedScenario, type ScenarioOverrides, type StoreLayout,
} from "../../core";
import type { NumericParameterPath, ParameterChange, ParameterDescriptor, ParameterValue } from "./types";

const definition = (path: NumericParameterPath, unit: string, description: string): ParameterDescriptor => ({ path, unit, label: path, description });
/** Extensible parameter catalog. Paths identify numeric leaves; no eval or arbitrary object traversal. */
export const SENSITIVITY_PARAMETERS: ParameterDescriptor[] = [
  ...(["categoryParticipationRate", "brandShare", "visitConversionRate", "deliveryRatio"] as const).map(key => definition(`demandParameters.${key}`, "ratio", "Absolute fractions 0..1; percentage-change is relative, not percentage points.")),
  ...(["weekdayMultiplier", "weekendMultiplier", "lunchMultiplier", "dinnerMultiplier", "weatherEventMultiplier"] as const).map(key => definition(`demandParameters.${key}`, "multiplier", "Nonnegative demand multiplier applied to the configured market.")),
  ...(["cooks", "servers", "cashiers", "kitchenConcurrentOrders"] as const).map(key => definition(`operation.resources.${key}`, "count", "Integer operational capacity; percentage results must be integral and are never silently rounded.")),
  ...(["orderingSeconds", "cookingSeconds", "servingSeconds", "diningSeconds", "paymentSeconds", "cleaningSeconds"] as const).map(key => definition(`operation.durations.${key}`, "seconds", "Positive service duration, retaining existing simulation units.")),
  definition("operation.averageSpendingPerCustomer", "currency/customer", "Dine-in price fallback in operation.currency."),
  definition("financial.averageSpendingPerCustomer", "currency/customer", "Explicit dine-in spending in financial.currency, overriding the operation price fallback."),
  definition("financial.averageDeliveryOrderValue", "currency/order", "Delivery order value in financial.currency, independently configured from dine-in spending."),
  ...(["foodCostRatio", "royaltyRatio", "deliveryFeeRatio", "paymentFeeRatio"] as const).map(key => definition(`financial.${key}`, "ratio", "Financial cost fraction, 0..1.")),
  ...(["monthlyRent", "monthlyLabor", "monthlyUtilities", "monthlyMarketing", "monthlyOtherFixed", "monthlyMaintenance", "monthlyInsurance"] as const).map(key => definition(`financial.${key}`, "currency/month", "Monthly cost in financial.currency.")),
  ...(["initialCapex", "initialFranchiseFee", "initialInteriorCost"] as const).map(key => definition(`financial.${key}`, "currency", "Initial investment in financial.currency.")),
  definition("financial.operatingDaysPerMonth", "days/month", "Representative operating days; explicit day-mix totals must stay consistent."),
  definition("layout.tableCount", "tables", "Hypothetical capacity intervention; copy/remove modeled tables. Does not establish spatial feasibility."),
  definition("layout.seatCount", "seats", "Redistribute positive integer operational capacity over existing tables; observed chair geometry remains unchanged."),
];

function pathParts(path: NumericParameterPath): string[] {
  const parts = path.split(".");
  const allowed = parts.length === 2 && ["demandParameters", "financial"].includes(parts[0]) ||
    parts.length === 2 && parts[0] === "operation" && parts[1] === "averageSpendingPerCustomer" ||
    parts.length === 3 && parts[0] === "operation" && ["resources", "durations"].includes(parts[1]) ||
    parts.length === 2 && parts[0] === "layout" && ["tableCount", "seatCount"].includes(parts[1]) ||
    parts.length === 5 && parts[0] === "demandParameters" && parts[1] === "deliveryOrdersByHour" &&
      ["weekday", "weekend", "holiday"].includes(parts[2]) && /^(?:[0-9]|1[0-9]|2[0-3])$/.test(parts[3]) && parts[4] === "expectedOrdersPerHour";
  if (!allowed || parts.some(part => ["__proto__", "constructor", "prototype", "revision"].includes(part)))
    throw new DomainValidationError("parameter.path", "unsupported numeric configuration path");
  return parts;
}
export function readParameter(resolved: ResolvedScenario, path: NumericParameterPath): number {
  const parts = pathParts(path);
  if (parts[1] === "deliveryOrdersByHour") {
    const bucket = resolved.configuration.demandParameters?.deliveryOrdersByHour?.find(item => item.dayType === parts[2] && item.hour === Number(parts[3]));
    if (!bucket) throw new DomainValidationError(path, "configure the explicit delivery hour before applying sensitivity");
    return bucket.expectedOrdersPerHour;
  }
  let current: unknown = parts[0] === "layout" ? resolved.layout : resolved.configuration;
  const steps = parts[0] === "layout" ? [parts[1] === "seatCount" ? "confirmedCapacity" : "tableCount"] : parts;
  for (const key of steps) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      throw new DomainValidationError(path, "configure a numeric baseline value before applying sensitivity");
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "number" || !Number.isFinite(current))
    throw new DomainValidationError(path, "baseline must be a finite numeric value");
  return current;
}
export function resolveParameterValue(baseValue: number, requested: ParameterValue): number {
  if (!Number.isFinite(baseValue)) throw new DomainValidationError("parameter.baseValue", "must be finite");
  let result: number;
  if (requested.kind === "absolute") result = requested.value;
  else if (requested.kind === "percentage-change") result = baseValue * (1 + requested.percent / 100);
  else throw new DomainValidationError("parameter.value", "explicit absolute or percentage-change kind required");
  if (!Number.isFinite(result)) throw new DomainValidationError("parameter.value", "must produce a finite value");
  return result;
}

/** Derive an explicitly hypothetical capacity layout without altering the source PDF/FloorPlan. */
export function deriveCapacityLayout(layout: StoreLayout, input: { tableCount?: number; seatCount?: number; revision: number }): StoreLayout {
  validateLayout(layout);
  const count = input.tableCount ?? layout.tableCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
    throw new DomainValidationError("layout.tableCount", "hypothetical table count must be an integer in [1,10000]");
  if (!layout.assignments.tables.length || layout.assignments.tables.some(table => table.capacity === null || table.capacity < 1))
    throw new DomainValidationError("layout.tables", "confirm baseline table capacities before deriving a capacity scenario");
  if (!Number.isSafeInteger(input.revision) || input.revision <= layout.revision)
    throw new DomainValidationError("layout.revision", "derived layout revision must increase");
  const copy = structuredClone(layout), originals = structuredClone(layout.assignments.tables);
  const originalElements = new Map(layout.geometry.elements.map(element => [element.id, element]));
  const tableIds = new Set(originals.map(table => table.elementId));
  const kept = originals.slice(0, count);
  copy.geometry.elements = copy.geometry.elements.filter(element => !tableIds.has(element.id) || kept.some(table => table.elementId === element.id));
  const ids = new Set(copy.geometry.elements.map(element => element.id));
  while (kept.length < count) {
    const original = originals[kept.length % originals.length];
    let id = `${original.elementId}:capacity:${kept.length + 1}`;
    while (ids.has(id)) id += ":new";
    ids.add(id);
    const element = structuredClone(originalElements.get(original.elementId)!);
    copy.geometry.elements.push({ ...element, id, name: `${element.name} (hypothetical capacity)`, source: "scenario-capacity-assumption", reviewed: false });
    kept.push({ elementId: id, capacity: original.capacity });
  }
  if (input.seatCount !== undefined) {
    if (!Number.isSafeInteger(input.seatCount) || input.seatCount < count)
      throw new DomainValidationError("layout.seatCount", "integer seats must allow at least one seat per table");
    const each = Math.floor(input.seatCount / count), remainder = input.seatCount % count;
    kept.forEach((table, index) => { table.capacity = each + (index < remainder ? 1 : 0); });
  }
  copy.revision = input.revision;
  copy.assignments.tables = kept;
  copy.tableCount = kept.length;
  copy.confirmedCapacity = kept.reduce((sum, table) => sum + table.capacity!, 0);
  copy.assumptions = copy.assumptions.filter(assumption => assumption.id !== "scenario-capacity-intervention");
  copy.assumptions.push({ id: "scenario-capacity-intervention", description: "Hypothetical operating capacity only. Additional modeled tables share template positions; geometry clearance, floor area, customer safety and design feasibility are not verified. Seat changes redistribute capacity evenly; observed chair count is unchanged.", value: { sourceLayoutId: layout.id, sourceRevision: layout.revision, tableCount: copy.tableCount, seatCount: copy.confirmedCapacity }, unit: "capacity", source: "scenario/1.0.0" });
  validateLayout(copy);
  return copy;
}

function setOverride(overrides: ScenarioOverrides, path: NumericParameterPath, value: number) {
  const parts = pathParts(path), section = parts[0] as keyof ScenarioOverrides;
  const record = overrides as unknown as Record<string, unknown>;
  const outer = record[section] && typeof record[section] === "object" ? { ...(record[section] as object) } as Record<string, unknown> : {};
  if (parts.length === 2) outer[parts[1]] = value;
  else outer[parts[1]] = { ...(outer[parts[1]] as object ?? {}), [parts[2]]: value };
  record[section] = outer;
}

/** Build Base + typed Overrides, optionally inheriting another scenario's override document. */
export function createScenarioVariant(project: Project, input: {
  id: string; name: string; createdAt: string; baseScenarioId?: string; changes: ParameterChange[];
}): Project {
  const initial = resolveScenario(project, input.baseScenarioId);
  let next = structuredClone(project);
  const overrides: ScenarioOverrides = input.baseScenarioId === undefined ? {} : structuredClone(project.scenarios.find(scenario => scenario.id === input.baseScenarioId)!.overrides);
  const duplicate = new Set<string>();
  const capacity: { tableCount?: number; seatCount?: number } = {};
  for (const change of input.changes) {
    if (duplicate.has(change.path)) throw new DomainValidationError("changes", "each parameter may be specified once");
    duplicate.add(change.path);
    const value = resolveParameterValue(readParameter(initial, change.path), change.value);
    if (change.path === "layout.tableCount") capacity.tableCount = value;
    else if (change.path === "layout.seatCount") capacity.seatCount = value;
    else if (change.path.startsWith("demandParameters.deliveryOrdersByHour.")) {
      const parts = pathParts(change.path);
      const deliveryOrdersByHour = structuredClone(overrides.demandParameters?.deliveryOrdersByHour ?? initial.configuration.demandParameters!.deliveryOrdersByHour!);
      deliveryOrdersByHour.find(bucket => bucket.dayType === parts[2] && bucket.hour === Number(parts[3]))!.expectedOrdersPerHour = value;
      overrides.demandParameters = { ...overrides.demandParameters, deliveryOrdersByHour };
    } else setOverride(overrides, change.path, value);
  }
  if (Object.keys(capacity).length) {
    if (!initial.layout) throw new DomainValidationError("layout", "capacity sensitivity requires a registered layout");
    const revision = Math.max(...project.layouts.filter(layout => layout.id === initial.layout!.id).map(layout => layout.revision)) + 1;
    const derived = deriveCapacityLayout(initial.layout, { ...capacity, revision });
    next = registerLayout(next, derived, input.createdAt);
    overrides.layoutRef = { id: derived.id, revision: derived.revision };
  }
  // Validate resulting absolute values (ratios, integer resources, positive durations).
  applyOverrides(next.base, overrides);
  return createScenario(next, { id: input.id, name: input.name, createdAt: input.createdAt, overrides });
}
