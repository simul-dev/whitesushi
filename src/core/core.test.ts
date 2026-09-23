import { describe, expect, it } from "vitest";
import {
  applyOverrides, assessRunStaleness, canonicalJson, completeSimulationRun,
  createProject, createScenario, deleteScenario, demandParametersContentKey,
  failSimulationRun, financialInputContentKey, isFinancialResultStale,
  marketContentKey, prepareSimulationInput, prepareSimulationRun, registerLayout,
  resolveScenario, siteContentKey, updateProject, updateProjectBase, updateScenario,
  validateLayout,
} from "./index";
import type {
  DemandParameters, FinancialAssumption, FinancialResult, LayoutElement,
  MarketProfile, Project, ScenarioOverrides, SimulationResult, SimulationRun,
  Site, StoreLayout,
} from "./index";

const now = "2026-09-23T01:00:00Z", later = "2026-09-23T02:00:00Z";
const engine = { id: "fixture-engine", version: "1.0" };
const site: Site = { id: "site-1", revision: 1, name: "Fixture site", address: null, coordinates: null, timeZone: "Asia/Seoul" };
const parameters: DemandParameters = {
  categoryParticipationRate: 0.2, brandShare: 0.2, visitConversionRate: 0.1,
  weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1,
  dinnerMultiplier: 1, weatherEventMultiplier: 1, deliveryRatio: 0,
};
function element(id: string, type: string, kind: LayoutElement["kind"] = "object"): LayoutElement {
  return { id, type, kind, name: id, x: 0, y: 0, z: 0, width: 1000, depth: 500, height: 800, rotationDegrees: 0, confidence: 1, source: "test-fixture", reviewed: true };
}
function layout(): StoreLayout {
  return {
    schemaVersion: 1, id: "layout-1", revision: 1, storeId: site.id,
    source: { format: "floorplan-json", documentId: "plan-1", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 5000, depth: 5000 }, elements: [element("table-1", "table"), element("chair-1", "chair"), element("chair-2", "chair"), element("entrance-1", "swing", "door"), element("kitchen-1", "range"), element("service-1", "counter")] },
    totalAreaM2: 25, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount: 1, chairCount: 2, confirmedCapacity: 2,
    assignments: { entranceIds: ["entrance-1"], tables: [{ elementId: "table-1", capacity: 2 }], kitchenStationIds: ["kitchen-1"], serviceStationIds: ["service-1"], zoneRoles: [] },
    assumptions: [], issues: [{ code: "bounds-estimate", path: "totalAreaM2", message: "Geometry estimate, not measured net area" }],
  };
}
function financial(): FinancialAssumption {
  return { id: "financial-1", revision: 1, currency: "KRW", operatingDaysPerMonth: 26, foodCostRatio: 0.3, royaltyRatio: 0, deliveryFeeRatio: 0, monthlyRent: 100, monthlyLabor: 200, monthlyUtilities: 30, monthlyMarketing: 10, monthlyOtherFixed: 20, initialCapex: 1000, initialFranchiseFee: 0, initialInteriorCost: 500, assumptions: [] };
}
function readyProject(): Project {
  const project = createProject({ id: "project-1", name: "Fixture project", site, createdAt: now, layout: layout() });
  const market: MarketProfile = {
    id: "market-1", revision: 1, siteRef: { id: site.id, revision: site.revision }, siteContentKey: siteContentKey(site),
    provider: { id: "fixture-provider", version: "1" }, provenance: { kind: "demo", source: "unit-test fixture" },
    period: { from: "2026-09-22T00:00:00Z", to: now }, buckets: [{ dayType: "weekday", hour: 11, population: 1000, footTrafficPersons: 100 }], nearbyBusinesses: [], assumptions: [],
  };
  return updateProjectBase(project, {
    market, demandParameters: parameters,
    demand: { id: "demand-1", revision: 1, model: { id: "fixture-demand", version: "1" }, provenance: { kind: "demo", source: "unit-test fixture" }, lineage: { marketRef: { id: market.id, revision: market.revision }, marketContentKey: marketContentKey(market), parametersContentKey: demandParametersContentKey(parameters) }, buckets: [{ dayType: "weekday", hour: 11, expectedCustomersPerHour: 3, distribution: "poisson" }], assumptions: [] },
    operation: { model: { id: "restaurant", version: "1" }, operatingWindows: [{ dayType: "weekday", startMinute: 600, endMinute: 1200 }], resources: { cooks: 1, servers: 1, cashiers: 1, kitchenConcurrentOrders: 2 }, durations: { orderingSeconds: 30, cookingSeconds: 120, servingSeconds: 30, diningSeconds: 600, paymentSeconds: 20, cleaningSeconds: 30 }, averageSpendingPerCustomer: 10000, currency: "KRW", assumptions: [] },
    simulation: { seed: 42, durationSeconds: 3600, startMinute: 660, dayType: "weekday", replications: 1 }, financial: financial(),
  }, now);
}
function prepared(project = readyProject(), scenarioId?: string): SimulationRun {
  const result = prepareSimulationRun(project, { id: "run-1", createdAt: now, engine, ...(scenarioId ? { scenarioId } : {}) });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.run;
}
function result(runId = "run-1"): SimulationResult {
  return { runId, customersArrived: 3, customersServed: 2, customersLost: 1, averageWaitingSeconds: 10, maxWaitingSeconds: 20, throughputCustomersPerHour: 2, tableUtilization: 0.5, kitchenUtilization: 0.5, staffUtilization: 0.5, averageCustomerTimeInSystemSeconds: 900, revenue: 20000, currency: "KRW", revenueByHour: [{ hour: 11, revenue: 20000 }], bottlenecks: [], assumptions: [] };
}

describe("project and scenario configuration", () => {
  it("creates an honest incomplete project; preparation does not fill missing model values", () => {
    const project = createProject({ id: "new", name: "New project", site, createdAt: now });
    expect(Object.values(project.base).every((v) => v === null)).toBe(true);
    const readiness = prepareSimulationInput(project, engine);
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["layoutRef", "market", "demand", "operation", "simulation"]));
  });
  it("retains immutable layout revisions and scenario references across base edits", () => {
    let project = createScenario(readyProject(), { id: "alternative", name: "Alternative", createdAt: now, overrides: { layoutRef: { id: "layout-1", revision: 1 } } });
    const nextLayout = layout(); nextLayout.revision = 2; nextLayout.source.documentRevision = 2; nextLayout.geometry.elements[0].x = 100;
    project = registerLayout(project, nextLayout, later);
    project = updateProjectBase(project, { layoutRef: { id: nextLayout.id, revision: nextLayout.revision } }, later);
    expect(resolveScenario(project).layout?.geometry.elements[0].x).toBe(100);
    expect(resolveScenario(project, "alternative").layout?.geometry.elements[0].x).toBe(0);
    expect(project.scenarios[0]).not.toHaveProperty("base");
    expect(project.scenarios[0]).not.toHaveProperty("layouts");
    expect(() => registerLayout(project, nextLayout, later)).toThrow(/immutable/);
  });
  it("merges only named nested policy fields, replaces arrays and leaves the base untouched", () => {
    const base = readyProject().base, before = canonicalJson(base);
    const resolved = applyOverrides(base, { operation: { resources: { servers: 3 }, operatingWindows: [{ dayType: "weekend", startMinute: 600, endMinute: 900 }] } });
    expect(resolved.operation?.resources).toEqual({ cooks: 1, servers: 3, cashiers: 1, kitchenConcurrentOrders: 2 });
    expect(resolved.operation?.operatingWindows).toHaveLength(1);
    expect(resolved.operation?.operatingWindows[0].dayType).toBe("weekend");
    resolved.operation!.durations.cookingSeconds = 500;
    expect(canonicalJson(base)).toBe(before);
  });
  it("distinguishes inherit, clear, and replacing the scenario override document", () => {
    let project = createScenario(readyProject(), { id: "clear", name: "Clear", createdAt: now, overrides: { operation: null, simulation: { seed: 123 } } });
    expect(resolveScenario(project, "clear").configuration.operation).toBeNull();
    expect(prepareSimulationInput(project, engine, "clear").ok).toBe(false);
    project = updateScenario(project, "clear", { overrides: {} }, later);
    expect(resolveScenario(project, "clear").configuration.simulation?.seed).toBe(42);
    project = deleteScenario(project, "clear", later);
    expect(project.scenarios).toEqual([]);
    expect(() => resolveScenario(project, "clear")).toThrow(/unknown scenario/);
  });
  it("requires a configured base rather than inventing missing values for a partial override", () => {
    const project = createProject({ id: "new", name: "New", site, createdAt: now });
    expect(() => createScenario(project, { id: "bad", name: "Bad", createdAt: now, overrides: { simulation: { seed: 1 } } })).toThrow(/initialize/);
  });
  it("rejects unknown layout revisions and layouts from another site", () => {
    const project = readyProject();
    expect(() => updateProjectBase(project, { layoutRef: { id: "missing", revision: 1 } }, later)).toThrow(/not registered/);
    expect(() => registerLayout(project, { ...layout(), revision: 2, storeId: "another-site" }, later)).toThrow(/different site/);
  });
  it.each<[string, ScenarioOverrides]>([
    ["negative staff", { operation: { resources: { servers: -1 } } }],
    ["fractional staff", { operation: { resources: { cooks: 1.5 } } }],
    ["negative duration", { operation: { durations: { cookingSeconds: -1 } } }],
    ["infinite duration", { operation: { durations: { cookingSeconds: Infinity } } }],
    ["conversion over 100%", { demandParameters: { visitConversionRate: 1.1 } }],
    ["negative multiplier", { demandParameters: { weekdayMultiplier: -1 } }],
    ["negative seed", { simulation: { seed: -1 } }],
    ["fractional seed", { simulation: { seed: 1.5 } }],
    ["missing replications", { simulation: { replications: 0 } }],
    ["NaN duration", { simulation: { durationSeconds: NaN } }],
    ["invalid cost ratio", { financial: { foodCostRatio: 1.01 } }],
    ["negative rent", { financial: { monthlyRent: -1 } }],
    ["undefined override", { simulation: undefined }],
  ])("rejects %s at the mutation boundary", (_label, overrides) => {
    const original = readyProject(), before = canonicalJson(original);
    expect(() => createScenario(original, { id: "invalid", name: "Invalid", createdAt: now, overrides })).toThrow();
    expect(canonicalJson(original)).toBe(before);
  });
  it("compares market period timestamps by instant when ISO offsets differ", () => {
    const project = readyProject(), market = structuredClone(project.base.market!);
    market.period = { from: "2026-09-23T10:00:00+09:00", to: "2026-09-23T02:00:00Z" };
    expect(() => updateProjectBase(project, { market }, later)).not.toThrow();
    market.period = { from: "2026-09-23T02:00:00Z", to: "2026-09-23T10:00:00+09:00" };
    expect(() => updateProjectBase(project, { market }, later)).toThrow(/end precedes/);
  });
});

describe("simulation input lineage and readiness", () => {
  it("snapshots all resolved values, seeds and versions without calling any engine", () => {
    const project = readyProject(), run = prepared(project);
    expect(run.status).toBe("prepared"); expect(run.result).toBeNull();
    expect(run.snapshot.engine).toEqual(engine);
    expect(run.snapshot.input.config.seed).toBe(42);
    expect(run.snapshot.input.operation.model.version).toBe("1");
    expect(run.snapshot.input.demand.model.version).toBe("1");
    expect(run.snapshot.lineage.market.provenance.kind).toBe("demo");
    project.base.operation!.resources.servers = 10;
    expect(run.snapshot.input.operation.resources.servers).toBe(1);
    expect(() => { run.snapshot.input.config.seed = 99; }).toThrow();
    expect(prepared().snapshot.contentKey).toBe(run.snapshot.contentKey);
  });
  it("requires explicit capacity, entrance, table and station assignments", () => {
    const project = readyProject(), incomplete = structuredClone(project);
    incomplete.layouts[0].confirmedCapacity = null;
    incomplete.layouts[0].assignments.tables[0].capacity = null;
    incomplete.layouts[0].assignments.entranceIds = [];
    incomplete.layouts[0].assignments.kitchenStationIds = [];
    incomplete.layouts[0].assignments.serviceStationIds = [];
    const readiness = prepareSimulationInput(incomplete, engine);
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["unconfirmed-capacity", "unassigned-tables", "unassigned-entrance", "unassigned-kitchen", "unassigned-service"]));
    // The geometric area estimate is informational and does not prevent a ready run.
    expect(prepareSimulationInput(project, engine).ok).toBe(true);
  });
  it("blocks translated orphan wall references without blocking informational issues", () => {
    const project = readyProject();
    project.layouts[0].issues.push({ code: "unresolved-wall-reference", path: "door.wallId", message: "Original wall no longer exists" });
    const readiness = prepareSimulationInput(project, engine);
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.issues.map((i) => i.code)).toContain("unresolved-wall-reference");
  });
  it("rejects contradictory counts and capacity instead of consuming guessed values", () => {
    const bad = layout(); bad.chairCount = 20;
    expect(() => validateLayout(bad)).toThrow(/counts/);
    bad.chairCount = 2; bad.confirmedCapacity = 20;
    expect(() => validateLayout(bad)).toThrow(/capacity sum/);
  });
  it("rejects stale demand after a parameter override without filling arrival rates", () => {
    const project = createScenario(readyProject(), { id: "changed-demand", name: "Changed demand", createdAt: now, overrides: { demandParameters: { visitConversionRate: 0.5 } } });
    const readiness = prepareSimulationInput(project, engine, "changed-demand");
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "stale-demand", path: "demand.lineage.parameters" })]));
  });
  it("detects market and site content mutation even when their revisions were not bumped", () => {
    const project = readyProject();
    project.base.market!.buckets[0].footTrafficPersons = 200;
    const marketChanged = prepareSimulationInput(project, engine);
    expect(marketChanged.ok).toBe(false);
    if (!marketChanged.ok) expect(marketChanged.issues.some((i) => i.code === "stale-demand")).toBe(true);
    const other = readyProject(); other.site.address = "Changed address";
    const siteChanged = prepareSimulationInput(other, engine);
    expect(siteChanged.ok).toBe(false);
    if (!siteChanged.ok) expect(siteChanged.issues.some((i) => i.code === "stale-market")).toBe(true);
  });
  it("requires explicit demand buckets for every simulated hour, including zero demand", () => {
    const project = readyProject(); project.base.simulation!.durationSeconds = 7200;
    const readiness = prepareSimulationInput(project, engine);
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.issues.some((i) => i.code === "missing-demand-hour")).toBe(true);
  });
});

describe("run freshness and result lifecycle", () => {
  it("ignores project/scenario labels, project revisions and financial edits", () => {
    let project = createScenario(readyProject(), { id: "scenario-1", name: "Baseline", createdAt: now });
    const run = prepared(project, "scenario-1");
    project = updateProject(project, { name: "Renamed project" }, later);
    project = updateScenario(project, "scenario-1", { name: "Renamed scenario" }, later);
    project = updateProjectBase(project, { financial: { ...financial(), revision: 2, monthlyRent: 999 } }, later);
    expect(assessRunStaleness(run, project, engine)).toEqual({ stale: false, issues: [] });
    expect(run.snapshot.projectRef.revision).not.toBe(project.revision);
  });
  it("detects changes to seed, layout geometry, policy or engine version", () => {
    const project = readyProject(), run = prepared(project);
    const changedSeed = updateProjectBase(project, { simulation: { ...project.base.simulation!, seed: 7 } }, later);
    expect(assessRunStaleness(run, changedSeed, engine).stale).toBe(true);
    const changedGeometry = structuredClone(project); changedGeometry.layouts[0].geometry.elements[0].x = 10;
    expect(assessRunStaleness(run, changedGeometry, engine).stale).toBe(true);
    const changedPolicy = structuredClone(project); changedPolicy.base.operation!.resources.servers = 2;
    expect(assessRunStaleness(run, changedPolicy, engine).stale).toBe(true);
    expect(assessRunStaleness(run, project, { ...engine, version: "2" }).stale).toBe(true);
  });
  it("detects modified stored snapshot content and provenance independently of current inputs", () => {
    const project = readyProject(), changed = structuredClone(prepared(project));
    changed.snapshot.input.config.seed = 9;
    expect(assessRunStaleness(changed, project, engine).issues[0].code).toBe("modified-snapshot");
    const changedProvenance = structuredClone(prepared(project)); changedProvenance.snapshot.projectRef.revision += 1;
    expect(assessRunStaleness(changedProvenance, project, engine).issues[0].code).toBe("modified-snapshot");
  });
  it("flags deleted scenario and malformed current configuration as stale", () => {
    let project = createScenario(readyProject(), { id: "scenario-1", name: "Baseline", createdAt: now });
    const run = prepared(project, "scenario-1"); project = deleteScenario(project, "scenario-1", later);
    expect(assessRunStaleness(run, project, engine).issues[0].code).toBe("missing-scenario");
    const malformed = readyProject(), baseline = prepared(malformed); malformed.base.simulation!.seed = -1;
    expect(assessRunStaleness(baseline, malformed, engine).issues[0].code).toBe("invalid-current-input");
  });
  it("validates result association, basic conservation and one-way completion", () => {
    const run = prepared();
    expect(() => completeSimulationRun(run, result("wrong-run"), later)).toThrow(/another run/);
    expect(() => completeSimulationRun(run, { ...result(), customersServed: 10 }, later)).toThrow(/exceeds arrivals/);
    expect(() => completeSimulationRun(run, { ...result(), staffUtilization: 2 }, later)).toThrow();
    const completed = completeSimulationRun(run, result(), later);
    expect(completed.status).toBe("completed"); expect(run.status).toBe("prepared");
    expect(() => completeSimulationRun(completed, result(), later)).toThrow(/prepared/);
    const failed = failSimulationRun(run, "Engine fixture failed", later);
    expect(failed.status).toBe("failed"); expect(failed.result).toBeNull();
    expect(() => completeSimulationRun(failed, result(), later)).toThrow(/prepared/);
  });
  it("keeps financial result lineage separate from simulation freshness", () => {
    const project = readyProject(), run = completeSimulationRun(prepared(project), result(), later);
    const input = { simulationRuns: [run], assumption: financial() }, key = financialInputContentKey(input);
    const report: FinancialResult = { id: "report-1", engine: { id: "fixture-financial", version: "1" }, input: structuredClone(input), inputContentKey: key, currency: "KRW", monthlyRevenue: 0, costOfGoodsSold: 0, laborCost: 0, fixedCost: 0, variableCost: 0, operatingProfit: 0, operatingMargin: null, breakEvenRevenue: null, breakEvenCustomers: null, estimatedPaybackMonths: null, assumptions: [] };
    expect(isFinancialResultStale(report, [run], financial(), report.engine)).toBe(false);
    expect(isFinancialResultStale(report, [run], { ...financial(), monthlyRent: 999 }, report.engine)).toBe(true);
    expect(assessRunStaleness(run, project, engine).stale).toBe(false);
    expect(() => financialInputContentKey({ simulationRuns: [prepared()], assumption: financial() })).toThrow(/completed/);
  });
  it("canonicalizes key order and rejects non-JSON or cyclic input", () => {
    expect(canonicalJson({ a: 1, b: { x: 2, y: 3 } })).toBe(canonicalJson({ b: { y: 3, x: 2 }, a: 1 }));
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
  });
});
