import { describe, expect, it } from "vitest";
import {
  assessRunStaleness, canonicalJson, completeSimulationRun, createProject,
  prepareSimulationRun, updateProjectBase, type Project, type SimulationResult, type Site,
} from "../core";
import { MockMarketProvider } from "../modules/market";
import { TransparentDemandModel, createDefaultDemandParameters } from "../modules/demand";
import { createRestaurantPolicy, restaurantOperationModel } from "../modules/operation";
import { discreteEventSimulationEngine } from "../modules/simulation";
import { createSamplePlan } from "../modules/space/sample";
import { toStoreLayout } from "../modules/space";
import { analyzeStoreProject, type StoreAnalysisModules } from "./storeAnalysis";

const now = "2026-09-23T00:00:00Z", later = "2026-09-23T00:01:00Z";
const site: Site = { id: "demo-site", revision: 1, name: "Synthetic analysis site", address: null, coordinates: null, timeZone: "Asia/Seoul" };
const period = { from: "2026-09-01T00:00:00Z", to: "2026-09-22T00:00:00Z" };
const modules: StoreAnalysisModules = {
  marketProvider: new MockMarketProvider(), demandModel: new TransparentDemandModel(),
  operationModel: restaurantOperationModel, simulationEngine: discreteEventSimulationEngine,
};

function readyProject(): Project {
  const plan = createSamplePlan();
  const layout = toStoreLayout(plan, {
    id: "sample-layout", revision: 1, storeId: site.id, documentId: "bundled-floorplan", documentRevision: 1,
    mapping: {
      entranceIds: ["door-entry"], kitchenStationIds: ["range"], serviceStationIds: ["self-bar"],
      tableCapacities: Object.fromEntries(plan.objects.filter(o => o.type === "table").map(o => [o.id, 4])),
      zoneRoles: { "zone-dining": "hall", "zone-kitchen": "kitchen", "zone-corridor": "service" },
    },
  });
  // These capacities are explicit test assumptions, not certified facts about the drawing.
  const project = createProject({ id: "demo-project", name: "Headless pipeline fixture", site, layout, createdAt: now });
  return updateProjectBase(project, {
    demandParameters: createDefaultDemandParameters({ categoryParticipationRate: 0.5, brandShare: 0.5, visitConversionRate: 0.5 }),
    operation: createRestaurantPolicy(),
    simulation: { seed: 12345, durationSeconds: 4 * 3600, startMinute: 660, dayType: "weekday", replications: 1 },
  }, now);
}
const analyze = (project = readyProject(), injected = modules) => analyzeStoreProject({
  project, period, runId: "demo-run", startedAt: now, completedAt: later, modules: injected,
});

describe("StoreLayout → Market → Demand → Restaurant DES", () => {
  it("runs the sample Space layout through real engines with frozen lineage and no UI", async () => {
    const project = readyProject(), before = canonicalJson(project);
    const outcome = await analyze(project);
    expect(outcome.ok, JSON.stringify(outcome.issues)).toBe(true);
    if (!outcome.ok) throw new Error("analysis failed");
    const { run } = outcome, result = run.result!;
    expect(canonicalJson(project)).toBe(before);
    expect(run.status).toBe("completed");
    expect(run.snapshot.input.layout.geometry.elements).toHaveLength(157);
    expect(run.snapshot.input.layout.confirmedCapacity).toBe(80);
    expect(run.snapshot.lineage.market.provenance.kind).toBe("demo");
    expect(run.snapshot.input.demand.provenance.kind).toBe("demo");
    expect(run.snapshot.input.demand.buckets[0].expectedCustomersPerHour).toBeLessThan(
      run.snapshot.lineage.market.buckets[0].footTrafficPersons!,
    );
    expect(result.customersArrived).toBeGreaterThan(0);
    expect(result.customersServed).toBeGreaterThan(0);
    expect(result.customersServed + result.customersLost + result.customersUnfinished!).toBe(result.customersArrived);
    expect(result.hourlyThroughput!.reduce((sum, b) => sum + b.customersServed, 0)).toBe(result.customersServed);
    expect(result.revenueStatus).toBe("not-modeled");
    expect(result.revenue).toBe(0);
    expect(Object.isFrozen(run.snapshot.input)).toBe(true);
    expect(assessRunStaleness(run, outcome.project, modules.simulationEngine.descriptor).stale).toBe(false);
  });

  it("reproduces the complete result for identical inputs and seed", async () => {
    const first = await analyze(), second = await analyze();
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    expect(first.run!.result).toEqual(second.run!.result);
  });

  it("invalidates earlier demand when a time-specific assumption changes", async () => {
    const result = await analyze();
    expect(result.ok).toBe(true);
    const changed = updateProjectBase(result.project, { demandParameters: {
      ...result.project.base.demandParameters!, hourlyMultipliers: [{ dayType: "weekday", hour: 12, multiplier: 2 }],
    } }, later);
    const stale = assessRunStaleness(result.run!, changed, modules.simulationEngine.descriptor);
    expect(stale.stale).toBe(true);
    expect(stale.issues.some(issue => issue.code === "stale-demand")).toBe(true);
  });

  it("contains external provider failure without a fabricated result or mutation", async () => {
    const project = readyProject(), before = canonicalJson(project);
    const failed = await analyze(project, { ...modules, marketProvider: {
      descriptor: { id: "offline-provider", version: "1" }, fetch: async () => { throw new Error("offline"); },
    } });
    expect(failed.ok).toBe(false); expect(failed.run).toBeNull();
    expect(failed.issues.some(issue => issue.code === "market-provider-failed")).toBe(true);
    expect(canonicalJson(project)).toBe(before);
    expect(failed.project.base.market).toBeNull();
  });

  it("requires explicit operational mappings before simulation", async () => {
    const project = readyProject();
    project.layouts[0].assignments.entranceIds = [];
    const result = await analyze(project);
    expect(result.ok).toBe(false); expect(result.run).toBeNull();
    expect(result.issues.some(issue => issue.code === "unassigned-entrance")).toBe(true);
  });

  it("retains a failed run when the injected model version is wrong", async () => {
    const outcome = await analyze(readyProject(), { ...modules, operationModel: {
      descriptor: { id: "incompatible-model", version: "0" },
      validate: () => [], defineProcess: input => restaurantOperationModel.defineProcess(input),
    } });
    expect(outcome.ok).toBe(false);
    expect(outcome.run?.status).toBe("failed");
    expect(outcome.run?.result).toBeNull();
  });

  it("validates customer conservation, hourly totals and unmodeled revenue at completion", async () => {
    const outcome = await analyze();
    expect(outcome.ok).toBe(true);
    const prepared = prepareSimulationRun(outcome.project, { id: "demo-run", engine: modules.simulationEngine.descriptor, createdAt: now });
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
    const result = outcome.run!.result!;
    const invalid: Partial<SimulationResult>[] = [
      { customersUnfinished: result.customersUnfinished! + 1 },
      { hourlyThroughput: [] },
      { hourlyThroughput: [{ hour: 0, customersServed: result.customersServed }] },
      { hourlyThroughput: [{ hour: 11, customersServed: result.customersServed }, { hour: 11, customersServed: 0 }] },
      { resourceUtilization: [{ resourceId: "cooks", capacityUnits: 1, utilization: 1.1 }] },
      { revenue: 1 },
    ];
    for (const patch of invalid)
      expect(() => completeSimulationRun(prepared.run, { ...result, ...patch }, later)).toThrow();
    expect(completeSimulationRun(prepared.run, result, later).status).toBe("completed");
  });
});
