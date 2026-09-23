import { describe, expect, it } from "vitest";
import {
  canonicalJson, createProject, createScenario, resolveScenario, siteContentKey, updateProjectBase,
  type LayoutElement, type MarketProfile, type Project, type Site, type StoreLayout,
} from "../../core";
import { createDefaultDemandParameters, TransparentDemandModel } from "../demand";
import { createRestaurantPolicy, restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine } from "../simulation";
import {
  aggregateNumbers, aggregateSimulationRuns, createScenarioVariant, deriveCapacityLayout, readParameter,
  resolveParameterValue, resolveReplicationPlan, runOneWaySensitivity, runScenarioReplications,
  type NumericParameterPath, type ScenarioExecutionInput, type ScenarioModules,
} from "./index";

const now = "2026-09-23T00:00:00Z", later = "2026-09-23T00:01:00Z";
const modules: ScenarioModules = { demandModel: new TransparentDemandModel({ distribution: "deterministic" }), operationModel: restaurantOperationModel, simulationEngine: discreteEventSimulationEngine };
const site: Site = { id: "site", revision: 1, name: "Synthetic scenario fixture", address: null, coordinates: null, timeZone: "Asia/Seoul" };
function projectFixture(tableCount = 4): Project {
  const element = (id: string, type: string, kind: LayoutElement["kind"] = "object"): LayoutElement => ({ id, type, kind, name: id, confidence: 1, source: "synthetic-test", reviewed: true, x: 0, y: 0, z: 0, width: 1000, depth: 1000, height: 1000, rotationDegrees: 0 });
  const tables = Array.from({ length: tableCount }, (_, i) => ({ elementId: `table-${i}`, capacity: 2 }));
  const layout: StoreLayout = {
    id: "layout", revision: 1, schemaVersion: 1, storeId: site.id,
    source: { format: "floorplan-json", documentId: "synthetic", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 10000, depth: 10000 }, elements: [element("entry", "door", "door"), element("kitchen", "counter"), element("service", "counter"), ...tables.map(table => element(table.elementId, "table"))] },
    totalAreaM2: 100, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount, chairCount: 0, confirmedCapacity: tableCount * 2,
    assignments: { entranceIds: ["entry"], tables, kitchenStationIds: ["kitchen"], serviceStationIds: ["service"], zoneRoles: [] }, assumptions: [], issues: [],
  };
  const market: MarketProfile = { id: "market", revision: 1, siteRef: { id: site.id, revision: site.revision }, siteContentKey: siteContentKey(site), provider: { id: "synthetic", version: "1" }, provenance: { kind: "demo", source: "synthetic test only" }, period: { from: now, to: later }, buckets: Array.from({ length: 24 }, (_, hour) => ({ dayType: "weekday", hour, footTrafficPersons: 10000, population: null })), nearbyBusinesses: [], assumptions: [] };
  return updateProjectBase(createProject({ id: "project", name: "Scenario fixture", createdAt: now, site, layout }), {
    market, demandParameters: createDefaultDemandParameters({ categoryParticipationRate: 1, brandShare: 1, visitConversionRate: 0.01 }),
    operation: createRestaurantPolicy({ operatingWindows: [{ dayType: "weekday", startMinute: 0, endMinute: 1440 }], resources: { cooks: 100, servers: 100, cashiers: 100, kitchenConcurrentOrders: 100 }, durations: { orderingSeconds: 1, cookingSeconds: 5, servingSeconds: 1, diningSeconds: 300, paymentSeconds: 1, cleaningSeconds: 1 }, maxQueueWaitSeconds: 300 }),
    simulation: { seed: 99, durationSeconds: 4 * 3600, startMinute: 0, dayType: "weekday", replications: 3 },
    financial: { id: "money", revision: 1, currency: "KRW", operatingDaysPerMonth: 26, foodCostRatio: 0.3, royaltyRatio: 0, deliveryFeeRatio: 0.1, monthlyRent: 1000000, monthlyLabor: 3000000, monthlyUtilities: 0, monthlyMarketing: 0, monthlyOtherFixed: 0, initialCapex: 0, initialFranchiseFee: 0, initialInteriorCost: 0, assumptions: [] },
  }, now);
}
function execution(project = projectFixture(), additions: Partial<ScenarioExecutionInput> = {}): ScenarioExecutionInput {
  return { project, replication: { count: 3, seedStrategy: "sequential", baseSeed: 1001 }, runIdPrefix: "test", startedAt: now, completedAt: later, modules, ...additions };
}
const sensitivity = (project: Project, path: NumericParameterPath, values: number[]) => runOneWaySensitivity({
  ...execution(project), parameter: { path, label: path, unit: "explicit test unit", description: "Synthetic one-way check" }, values: values.map(value => ({ kind: "absolute", value })), scenarioIdPrefix: `sensitivity-${path}`,
});

describe("replication configuration and sample statistics", () => {
  it("computes sample SD and interpolated empirical percentiles without mutating observations", () => {
    const values = [4, 1, 3, 2], before = [...values];
    const result = aggregateNumbers(values);
    expect(result).toMatchObject({ count: 4, mean: 2.5, min: 1, max: 4 });
    expect(result.standardDeviation).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(result.percentiles.p05).toBeCloseTo(1.15, 12);
    expect(result.percentiles.p50).toBe(2.5);
    expect(result.percentiles.p95).toBeCloseTo(3.85, 12);
    expect(values).toEqual(before);
  });
  it("reports an undefined sample SD for a single run", () => {
    expect(aggregateNumbers([7])).toEqual({ count: 1, mean: 7, min: 7, max: 7, standardDeviation: null, percentiles: { p05: 7, p50: 7, p95: 7 } });
    expect(aggregateNumbers([7, 7]).standardDeviation).toBe(0);
  });
  it("rejects empty, nonfinite and overflowing samples", () => {
    expect(() => aggregateNumbers([])).toThrow();
    expect(() => aggregateNumbers([NaN])).toThrow();
    expect(() => aggregateNumbers([-Number.MAX_VALUE, Number.MAX_VALUE])).toThrow();
  });
  it("supports deterministic stepped and explicit seed lists without silently wrapping", () => {
    expect(resolveReplicationPlan({ count: 3, seedStrategy: "sequential", baseSeed: 1001, step: 7 }).seeds).toEqual([1001, 1008, 1015]);
    expect(resolveReplicationPlan({ count: 2, seedStrategy: "explicit", seeds: [0, 0xffffffff] }).seeds).toEqual([0, 0xffffffff]);
    expect(() => resolveReplicationPlan({ count: 2, seedStrategy: "sequential", baseSeed: 0xffffffff })).toThrow();
    expect(() => resolveReplicationPlan({ count: 2, seedStrategy: "explicit", seeds: [1, 1] })).toThrow("distinct");
    expect(() => resolveReplicationPlan({ count: 2, seedStrategy: "explicit", seeds: [1] })).toThrow("count");
    expect(() => resolveReplicationPlan({ count: 0, seedStrategy: "sequential", baseSeed: 1 })).toThrow();
  });
});

describe("Base + explicit numeric Overrides", () => {
  it("distinguishes absolute fractions, relative percentages and percentage points", () => {
    expect(resolveParameterValue(0.3, { kind: "percentage-change", percent: -20 })).toBeCloseTo(0.24);
    expect(resolveParameterValue(0.3, { kind: "absolute", value: 0.2 })).toBe(0.2);
    expect(() => resolveParameterValue(1, { kind: "percentage-change", percent: Infinity })).toThrow();
  });
  it("creates compact overrides, inherits parent assumptions and leaves its source untouched", () => {
    const source = createScenario(projectFixture(), { id: "parent", name: "Parent", createdAt: now, overrides: { operation: { resources: { cooks: 2 } } } });
    const before = canonicalJson(source);
    const next = createScenarioVariant(source, { id: "conservative", name: "Conservative", createdAt: now, baseScenarioId: "parent", changes: [{ path: "demandParameters.visitConversionRate", value: { kind: "percentage-change", percent: -20 } }, { path: "financial.monthlyRent", value: { kind: "absolute", value: 1200000 } }] });
    const resolved = resolveScenario(next, "conservative");
    expect(resolved.configuration.demandParameters!.visitConversionRate).toBeCloseTo(0.008);
    expect(resolved.configuration.operation!.resources.cooks).toBe(2);
    expect(resolved.configuration.financial!.monthlyRent).toBe(1200000);
    expect(next.scenarios.at(-1)!.overrides.demandParameters).toEqual({ visitConversionRate: 0.008 });
    expect(canonicalJson(source)).toBe(before);
  });
  it("rejects invalid ratios and fractional resources instead of clipping or rounding", () => {
    const source = projectFixture();
    expect(() => createScenarioVariant(source, { id: "invalid", name: "Invalid", createdAt: now, changes: [{ path: "demandParameters.visitConversionRate", value: { kind: "absolute", value: 1.2 } }] })).toThrow();
    expect(() => createScenarioVariant(source, { id: "invalid", name: "Invalid", createdAt: now, changes: [{ path: "operation.resources.cooks", value: { kind: "absolute", value: 2.5 } }] })).toThrow();
  });
  it("requires a configured numeric path and prevents arbitrary/prototype traversal", () => {
    const resolved = resolveScenario(projectFixture());
    expect(() => readParameter(resolved, "financial.__proto__" as NumericParameterPath)).toThrow();
    expect(() => readParameter(resolved, "financial.revision" as NumericParameterPath)).toThrow();
    expect(() => readParameter(resolved, "financial.missing" as NumericParameterPath)).toThrow();
    expect(() => createScenarioVariant(projectFixture(), { id: "invalid", name: "Invalid", createdAt: now, changes: [{ path: "layout.tableCount", value: { kind: "absolute", value: 1 } }, { path: "layout.tableCount", value: { kind: "absolute", value: 2 } }] })).toThrow("once");
  });
  it("registers a hypothetical layout revision with capacity provenance and matching geometry counts", () => {
    const source = projectFixture(2), original = canonicalJson(source.layouts[0]);
    const next = createScenarioVariant(source, { id: "capacity", name: "Capacity", createdAt: now, changes: [{ path: "layout.tableCount", value: { kind: "absolute", value: 5 } }, { path: "layout.seatCount", value: { kind: "absolute", value: 17 } }] });
    const layout = resolveScenario(next, "capacity").layout!;
    expect(layout.revision).toBe(2); expect(layout.tableCount).toBe(5); expect(layout.confirmedCapacity).toBe(17);
    expect(layout.assignments.tables.map(table => table.capacity)).toEqual([4, 4, 3, 3, 3]);
    expect(layout.geometry.elements.filter(element => element.type === "table")).toHaveLength(5);
    expect(layout.assumptions.at(-1)!.description).toContain("not verified");
    expect(canonicalJson(source.layouts[0])).toBe(original);
  });
  it("reduces modeled tables coherently and refuses impossible positive capacity assignments", () => {
    const source = projectFixture().layouts[0];
    expect(deriveCapacityLayout(source, { tableCount: 1, revision: 2 }).confirmedCapacity).toBe(2);
    expect(() => deriveCapacityLayout(source, { seatCount: 3, revision: 2 })).toThrow("one seat");
    expect(() => deriveCapacityLayout(source, { tableCount: 0, revision: 2 })).toThrow();
    expect(() => deriveCapacityLayout(source, { tableCount: 5, revision: 1 })).toThrow("increase");
  });
});

describe("seeded scenario execution and failure boundaries", () => {
  it("recomputes demand for each scenario and preserves exact immutable run lineage", async () => {
    let calls = 0;
    const project = createScenarioVariant(projectFixture(), { id: "half", name: "Half", createdAt: now, changes: [{ path: "demandParameters.visitConversionRate", value: { kind: "percentage-change", percent: -50 } }] });
    const before = canonicalJson(project);
    const result = await runScenarioReplications(execution(project, { scenarioId: "half", modules: { ...modules, demandModel: { descriptor: modules.demandModel.descriptor, calculate: input => { calls++; return modules.demandModel.calculate(input); } } } }));
    expect(result.ok, JSON.stringify(result.issues)).toBe(true); if (!result.ok) throw Error("failed");
    expect(calls).toBe(1); expect(result.runs).toHaveLength(3);
    expect(result.runs.map(run => run.snapshot.input.config.seed)).toEqual([1001, 1002, 1003]);
    expect(result.runs.every(run => run.snapshot.input.config.replications === 1)).toBe(true);
    expect(result.runs.every(run => run.snapshot.scenarioRef?.id === "half")).toBe(true);
    expect(result.runs[0].snapshot.input.demand.buckets[0].expectedCustomersPerHour).toBe(50);
    expect(result.runs[0].snapshot.lineage.demandParameters.visitConversionRate).toBe(0.005);
    expect(Object.isFrozen(result.runs[0].snapshot.input)).toBe(true);
    expect(result.aggregate.runIds).toEqual(["test:1", "test:2", "test:3"]);
    expect(result.financial).toBeNull(); expect(canonicalJson(project)).toBe(before);
  });
  it("reproduces stochastic results and aggregates for identical configuration and seed plan", async () => {
    const input = execution(projectFixture(), { modules: { ...modules, demandModel: new TransparentDemandModel({ distribution: "poisson" }) } });
    const first = await runScenarioReplications(input), second = await runScenarioReplications(input);
    expect(first.ok).toBe(true); expect(second).toEqual(first);
    if (!first.ok) throw Error("failed");
    expect(first.aggregate.metrics.customersArrived.standardDeviation).toBeGreaterThan(0);
  });
  it("fails explicitly on an intermediate engine failure and retains completed and failed snapshots", async () => {
    let count = 0;
    const result = await runScenarioReplications(execution(projectFixture(), { modules: { ...modules, simulationEngine: { descriptor: modules.simulationEngine.descriptor, run: input => { count++; if (count === 2) throw Error("synthetic failure"); return modules.simulationEngine.run(input); } } } }));
    expect(result.ok).toBe(false); expect(result.aggregate).toBeNull(); expect(result.runs.map(run => run.status)).toEqual(["completed", "failed"]);
    expect(result.issues[0].message).toContain("synthetic failure");
  });
  it("rejects stale market data and mismatched demand versions before executing replicas", async () => {
    const project = projectFixture(); project.site.revision++;
    const stale = await runScenarioReplications(execution(project));
    expect(stale.ok).toBe(false); expect(stale.runs).toHaveLength(0); expect(stale.issues.some(issue => issue.code === "stale-market")).toBe(true);
    const wrong = await runScenarioReplications(execution(projectFixture(), { modules: { ...modules, demandModel: { ...modules.demandModel, descriptor: { id: "wrong", version: "1" }, calculate: input => modules.demandModel.calculate(input) } } }));
    expect(wrong.ok).toBe(false); expect(wrong.issues[0].path).toBe("demand.model");
  });
  it("rejects duplicate, changed, incomplete and mixed-configuration aggregate inputs", async () => {
    const first = await runScenarioReplications(execution()); if (!first.ok) throw Error("failed");
    expect(() => aggregateSimulationRuns([first.runs[0], first.runs[0]])).toThrow("distinct");
    const changed = structuredClone(first.runs); changed[0].snapshot.input.config.seed++;
    expect(() => aggregateSimulationRuns(changed)).toThrow("modified");
    const incomplete = structuredClone(first.runs); incomplete[0].status = "failed";
    expect(() => aggregateSimulationRuns(incomplete)).toThrow("cannot enter");
    const other = await runScenarioReplications(execution(projectFixture(8), { runIdPrefix: "other", replication: { count: 1, seedStrategy: "explicit", seeds: [999] } })); if (!other.ok) throw Error("failed");
    expect(() => aggregateSimulationRuns([first.runs[0], other.runs[0]])).toThrow("only seed");
  });
  it("requires valid timestamps and explicit financial assumptions when a financial engine is selected", async () => {
    const badTime = await runScenarioReplications(execution(projectFixture(), { completedAt: "2025-01-01T00:00:00Z" }));
    expect(badTime.ok).toBe(false); expect(badTime.runs).toHaveLength(0);
    const project = projectFixture(); project.base.financial = null;
    const result = await runScenarioReplications(execution(project, { modules: { ...modules, financialEngine: { descriptor: { id: "unused", version: "1" }, calculate: () => { throw Error("must not call"); } } } }));
    expect(result.ok).toBe(false); expect(result.issues.at(-1)!.path).toBe("financial");
  });
});

describe("one-way causal capacity checks with real DES", () => {
  it("A: demand rises but throughput saturates, and waiting/lost demand increases", async () => {
    const result = await sensitivity(projectFixture(), "demandParameters.visitConversionRate", [0.001, 0.003, 0.01, 0.03]);
    expect(result.results.every(point => point.evaluation.ok)).toBe(true);
    const metrics = result.results.map(point => { if (!point.evaluation.ok) throw Error("failed"); return point.evaluation.aggregate.metrics; });
    expect(metrics[1].customersServed.mean).toBeGreaterThan(metrics[0].customersServed.mean);
    expect(metrics[3].customersServed.mean - metrics[2].customersServed.mean).toBeLessThan(metrics[1].customersServed.mean - metrics[0].customersServed.mean);
    expect(metrics[3].averageWaitingSeconds.mean).toBeGreaterThan(metrics[0].averageWaitingSeconds.mean);
    expect(metrics[3].customersLost.mean).toBeGreaterThan(metrics[0].customersLost.mean);
    const seeds = result.results.map(point => point.evaluation.replication!.seeds);
    expect(seeds.every(list => canonicalJson(list) === canonicalJson(seeds[0]))).toBe(true);
  });
  it("B: more tables help a table bottleneck, with limited effect once the kitchen is limiting", async () => {
    const project = projectFixture(2);
    const tables = await sensitivity(project, "layout.tableCount", [2, 8]);
    const served = tables.results.map(point => point.evaluation.ok ? point.evaluation.aggregate.metrics.customersServed.mean : NaN);
    expect(served[1]).toBeGreaterThan(served[0] * 2);
    const kitchen = projectFixture(12); kitchen.base.operation!.durations.cookingSeconds = 300; kitchen.base.operation!.resources.kitchenConcurrentOrders = 1;
    const limited = await sensitivity(kitchen, "layout.tableCount", [12, 24]);
    const constrained = limited.results.map(point => point.evaluation.ok ? point.evaluation.aggregate.metrics.customersServed.mean : NaN);
    expect(constrained[1] - constrained[0]).toBeLessThan(3);
  });
  it("B: seat capacity intervention enables parties that cannot fit baseline tables", async () => {
    const project = projectFixture(2); project.base.operation!.partySizeDistribution = [{ size: 3, probability: 1 }];
    const result = await sensitivity(project, "layout.seatCount", [4, 6]);
    const served = result.results.map(point => point.evaluation.ok ? point.evaluation.aggregate.metrics.customersServed.mean : NaN);
    expect(served[0]).toBe(0); expect(served[1]).toBeGreaterThan(0);
  });
  it("C: kitchen slots and cooks relieve the corresponding bottleneck", async () => {
    const project = projectFixture(30); project.base.operation!.durations.cookingSeconds = 120;
    const result = await sensitivity(project, "operation.resources.kitchenConcurrentOrders", [1, 4]);
    const points = result.results.map(point => { if (!point.evaluation.ok) throw Error(JSON.stringify(point.evaluation.issues)); return point.evaluation.aggregate.metrics; });
    expect(points[1].customersServed.mean).toBeGreaterThan(points[0].customersServed.mean * 2);
    expect(points[1].averageWaitingSeconds.mean).toBeLessThan(points[0].averageWaitingSeconds.mean);
    expect(points[1].kitchenUtilization.mean).toBeLessThan(points[0].kitchenUtilization.mean);
    const cooks = await sensitivity(project, "operation.resources.cooks", [1, 4]);
    expect(cooks.results[1].evaluation.ok && cooks.results[0].evaluation.ok && cooks.results[1].evaluation.aggregate.metrics.customersServed.mean > cooks.results[0].evaluation.aggregate.metrics.customersServed.mean).toBe(true);
  });
  it("restarts from baseline for relative changes and permits operational-only sensitivity", async () => {
    const project = projectFixture(), before = canonicalJson(project);
    const result = await runOneWaySensitivity({ ...execution(project), parameter: { path: "financial.monthlyRent", label: "Rent", unit: "KRW/month", description: "Rent assumption" }, values: [{ kind: "percentage-change", percent: -20 }, { kind: "percentage-change", percent: 20 }], scenarioIdPrefix: "rent" });
    expect(result.results.map(point => point.parameterValue)).toEqual([800000, 1200000]);
    expect(result.results.every(point => point.evaluation.ok && point.evaluation.financial === null)).toBe(true);
    expect(canonicalJson(project)).toBe(before);
  });
  it("varies an explicit delivery hour without reducing dine-in demand and aggregates channel metrics", async () => {
    const project = projectFixture(20);
    project.base.demandParameters!.deliveryOrdersByHour = Array.from({ length: 24 }, (_, hour) => ({ dayType: "weekday", hour, expectedOrdersPerHour: 0, distribution: "deterministic" }));
    project.base.operation!.delivery = { packagingSeconds: 5, maxQueueWaitSeconds: null };
    project.base.operation!.resources.kitchenConcurrentOrders = 1;
    project.base.operation!.durations.cookingSeconds = 120;
    const result = await sensitivity(project, "demandParameters.deliveryOrdersByHour.weekday.0.expectedOrdersPerHour", [0, 100]);
    expect(result.results.every(point => point.evaluation.ok), JSON.stringify(result.results.map(point => point.evaluation.issues))).toBe(true);
    const outcomes = result.results.map(point => { if (!point.evaluation.ok) throw Error("failed"); return point.evaluation; });
    expect(outcomes[0].aggregate.metrics.customersArrived.mean).toBe(outcomes[1].aggregate.metrics.customersArrived.mean);
    expect(outcomes[1].aggregate.channelMetrics["delivery.ordersArrived"].mean).toBe(100);
    expect(outcomes[1].aggregate.channelMetrics["delivery.ordersCompleted"].mean).toBeGreaterThan(0);
    expect(outcomes[1].aggregate.channelMetrics.averageDineInFoodWaitingSeconds.mean).toBeGreaterThan(outcomes[0].aggregate.channelMetrics.averageDineInFoodWaitingSeconds.mean);
    expect(project.base.demandParameters!.deliveryOrdersByHour[0].expectedOrdersPerHour).toBe(0);
  });
});
