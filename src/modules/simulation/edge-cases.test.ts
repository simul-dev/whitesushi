import { describe, expect, it } from "vitest";
import {
  createProject, demandParametersContentKey, marketContentKey, prepareSimulationRun,
  siteContentKey, updateProjectBase,
} from "../../core";
import type {
  DemandParameters, LayoutElement, MarketProfile, OperationModel, OperationPolicy,
  OperationProcess, SimulationResult, Site, StoreLayout,
} from "../../core";
import { createRestaurantPolicy, restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine as engine } from "./index";

const now = "2026-09-23T00:00:00Z";
const site: Site = { id: "edge-site", revision: 1, name: "DES edge fixture", address: null, coordinates: null, timeZone: "Asia/Seoul" };
const modelVersion = { id: "repair-workshop-fixture", version: "1" };
const parameters: DemandParameters = {
  categoryParticipationRate: 1, brandShare: 1, visitConversionRate: 1,
  weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1, dinnerMultiplier: 1,
  weatherEventMultiplier: 1, deliveryRatio: 0,
};

function layout(): StoreLayout {
  const element = (id: string, type: string, kind: LayoutElement["kind"] = "object"): LayoutElement => ({
    id, type, kind, name: id, confidence: 1, source: "synthetic edge fixture", reviewed: true,
    x: 0, y: 0, z: 0, width: 500, depth: 500, height: 1000, rotationDegrees: 0,
  });
  return {
    id: "edge-layout", revision: 1, schemaVersion: 1, storeId: site.id,
    source: { format: "floorplan-json", documentId: "synthetic-edge-layout", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 5000, depth: 5000 }, elements: [
      element("table", "table"), element("entry", "door", "door"), element("range", "range"), element("counter", "counter"),
    ] },
    totalAreaM2: 25, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount: 1, chairCount: 0, confirmedCapacity: 4,
    assignments: { entranceIds: ["entry"], tables: [{ elementId: "table", capacity: 4 }], kitchenStationIds: ["range"], serviceStationIds: ["counter"], zoneRoles: [] },
    assumptions: [], issues: [],
  };
}

function repairProcess(seconds: number, capacity = 1): OperationProcess {
  return {
    schemaVersion: 1, model: modelVersion, startStageId: "repair",
    resources: [{ id: "technicians", capacityUnits: capacity, category: "staff" }],
    stages: [
      { id: "repair", duration: { kind: "constant", seconds }, requirements: [{ resourceId: "technicians", units: 1, release: "stage-end" }], nextStageId: "collected", queue: null, outcome: null },
      { id: "collected", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "served" },
    ],
  };
}

interface CaseOptions {
  process?: OperationProcess;
  policy?: OperationPolicy;
  operationModel?: OperationModel;
  rate?: number;
  durationSeconds?: number;
  startMinute?: number;
  seed?: number;
  operatingWindows?: OperationPolicy["operatingWindows"];
}

async function runCase(options: CaseOptions = {}): Promise<SimulationResult> {
  const process = options.process ?? repairProcess(60);
  const operationModel = options.operationModel ?? {
    descriptor: process.model, validate: () => [], defineProcess: () => structuredClone(process),
  };
  const policy: OperationPolicy = options.policy ?? {
    model: operationModel.descriptor,
    operatingWindows: options.operatingWindows ?? [{ dayType: "weekday", startMinute: 0, endMinute: 1440 }],
    resources: { cooks: 1, servers: 1, cashiers: 1, kitchenConcurrentOrders: 1 },
    durations: { orderingSeconds: 1, cookingSeconds: 1, servingSeconds: 1, diningSeconds: 1, paymentSeconds: 1, cleaningSeconds: 1 },
    averageSpendingPerCustomer: 0, currency: "KRW", assumptions: [],
  };
  const market: MarketProfile = {
    id: "edge-market", revision: 1, siteRef: { id: site.id, revision: site.revision }, siteContentKey: siteContentKey(site),
    provider: { id: "edge-fixture", version: "1" }, provenance: { kind: "demo", source: "Synthetic deterministic DES fixture" },
    period: { from: "2026-09-01T00:00:00Z", to: now },
    buckets: Array.from({ length: 24 }, (_, hour) => ({ dayType: "weekday", hour, population: null, footTrafficPersons: options.rate ?? 60 })),
    nearbyBusinesses: [], assumptions: [],
  };
  const project = updateProjectBase(createProject({ id: "edge-project", name: "Edge fixture", site, layout: layout(), createdAt: now }), {
    market, demandParameters: parameters,
    demand: {
      id: "edge-demand", revision: 1, model: { id: "explicit-arrival-fixture", version: "1" },
      provenance: { kind: "demo", source: "Synthetic deterministic arrivals" },
      lineage: { marketRef: { id: market.id, revision: market.revision }, marketContentKey: marketContentKey(market), parametersContentKey: demandParametersContentKey(parameters) },
      buckets: market.buckets.map((bucket) => ({ dayType: bucket.dayType, hour: bucket.hour, expectedCustomersPerHour: options.rate ?? 60, distribution: "deterministic" })), assumptions: [],
    },
    operation: policy,
    simulation: { seed: options.seed ?? 0, durationSeconds: options.durationSeconds ?? 180, startMinute: options.startMinute ?? 660, dayType: "weekday", replications: 1 },
  }, now);
  const prepared = prepareSimulationRun(project, { id: "edge-run", engine: engine.descriptor, createdAt: now });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
  return engine.run({ runId: prepared.run.id, snapshot: prepared.run.snapshot, operationModel });
}

describe("DES fixed horizon and analytical KPIs", () => {
  it("executes a nonrestaurant graph and gives exact single-server queue accounting", async () => {
    // Arrivals 30,90,150,210,270; service starts 30,120,210,300.
    // At 300: three served, one just started, and one still waiting.
    const result = await runCase({ process: repairProcess(90), durationSeconds: 300 });
    expect(result).toMatchObject({
      customersArrived: 5, customersServed: 3, customersLost: 0, customersUnfinished: 2,
      averageWaitingSeconds: 42, maxWaitingSeconds: 90, averageCustomerTimeInSystemSeconds: 120,
      throughputCustomersPerHour: 36, tableUtilization: 0, kitchenUtilization: 0,
      hourlyThroughput: [{ hour: 11, customersServed: 3 }],
    });
    expect(result.staffUtilization).toBeCloseTo(0.9, 12);
    expect(result.resourceUtilization).toEqual([{ resourceId: "technicians", capacityUnits: 1, utilization: 0.9 }]);
    expect(result.bottlenecks.map((b) => b.resource)).toEqual(["technicians"]);
  });

  it("finishes same-time completions before arrivals without artificial waiting", async () => {
    // Arrivals 30,90,150; the first two completions coincide with later arrivals.
    const result = await runCase();
    expect(result).toMatchObject({ customersArrived: 3, customersServed: 2, customersUnfinished: 1, averageWaitingSeconds: 0, maxWaitingSeconds: 0, averageCustomerTimeInSystemSeconds: 60 });
    expect(result.staffUtilization).toBeCloseTo(150 / 180, 12);
    expect(result.bottlenecks).toEqual([]);
  });

  it("admits at opening, excludes the closing boundary, and lets admitted work finish after closing", async () => {
    // At 30/hour arrivals are 60,180,... seconds. The window is [60,180).
    const result = await runCase({
      rate: 30, durationSeconds: 240, process: repairProcess(150),
      operatingWindows: [{ dayType: "weekday", startMinute: 661, endMinute: 663 }],
    });
    expect(result).toMatchObject({ customersArrived: 1, customersServed: 1, customersLost: 0, customersUnfinished: 0, averageCustomerTimeInSystemSeconds: 150, averageWaitingSeconds: 0 });
    expect(result.staffUtilization).toBeCloseTo(150 / 240, 12);
  });

  it("counts a completion at the observation horizon but censors later work", async () => {
    const exact = await runCase({ rate: 30, durationSeconds: 180, process: repairProcess(120) });
    const later = await runCase({ rate: 30, durationSeconds: 180, process: repairProcess(121) });
    expect(exact).toMatchObject({ customersArrived: 1, customersServed: 1, customersUnfinished: 0, averageCustomerTimeInSystemSeconds: 120 });
    expect(later).toMatchObject({ customersArrived: 1, customersServed: 0, customersUnfinished: 1, averageCustomerTimeInSystemSeconds: 0 });
    expect(exact.staffUtilization).toBeCloseTo(120 / 180, 12);
    expect(later.staffUtilization).toBeCloseTo(120 / 180, 12);
  });

  it("bins completions by local completion hour across an hour boundary", async () => {
    const result = await runCase({ startMinute: 719, durationSeconds: 120, process: repairProcess(30) });
    expect(result).toMatchObject({ customersArrived: 2, customersServed: 2, customersUnfinished: 0 });
    expect(result.hourlyThroughput).toEqual([{ hour: 11, customersServed: 0 }, { hour: 12, customersServed: 2 }]);
  });

  it.each(["zero-demand", "outside-opening"])("returns finite zero KPIs for an idle %s run", async (condition) => {
    const result = await runCase({
      ...(condition === "zero-demand" ? { rate: 0 } : { operatingWindows: [{ dayType: "weekday" as const, startMinute: 720, endMinute: 780 }] }),
    });
    expect(result).toMatchObject({ customersArrived: 0, customersServed: 0, customersLost: 0, customersUnfinished: 0, averageWaitingSeconds: 0, maxWaitingSeconds: 0, averageCustomerTimeInSystemSeconds: 0, throughputCustomersPerHour: 0, staffUtilization: 0, tableUtilization: 0, kitchenUtilization: 0 });
    expect(result.hourlyThroughput).toEqual([{ hour: 11, customersServed: 0 }]);
    expect(result.bottlenecks).toEqual([]);
  });
});

function fittedPartyProcess(capacities: number[], serviceSeconds: number, patience: number | null = null): OperationProcess {
  const process = repairProcess(serviceSeconds);
  process.partySizeDistribution = [{ size: 1, probability: 0.5 }, { size: 4, probability: 0.5 }];
  process.resources = [{ id: "repair-bays", capacityUnits: capacities.length, unitCapacities: capacities, category: "table" }];
  process.stages[0].requirements = [{ resourceId: "repair-bays", units: 1, minimumUnitCapacity: "party-size", release: "stage-end" }];
  if (patience !== null) {
    process.stages[0].queue = { maxWaitSeconds: patience, timeoutStageId: "abandoned" };
    process.stages.push({ id: "abandoned", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "lost" });
  }
  return process;
}

describe("DES exclusive resource fit, FIFO and unavailable staff", () => {
  it("allocates the smallest fitting bay so a later large party can use the larger bay", async () => {
    // Seed 1 produces sizes [1,4,4] for these three deterministic party arrivals.
    // The bays are deliberately stored largest first to test fit, not input order.
    const result = await runCase({ process: fittedPartyProcess([4, 2], 90), rate: 150, seed: 1 });
    expect(result).toMatchObject({ customersArrived: 9, customersServed: 5, customersLost: 0, customersUnfinished: 4, maxWaitingSeconds: 30 });
    expect(result.averageWaitingSeconds).toBeCloseTo(4 * 30 / 9, 12);
    expect(result.tableUtilization).toBeCloseTo(0.5, 12);
  });

  it("keeps small parties behind an earlier oversized party in a strict shared-resource FIFO", async () => {
    // Seed 0 produces sizes [4,1,1]. The first party cannot fit the only 2-seat bay.
    const result = await runCase({ process: fittedPartyProcess([2], 30), rate: 150, seed: 0 });
    expect(result).toMatchObject({ customersArrived: 6, customersServed: 0, customersLost: 0, customersUnfinished: 6, averageWaitingSeconds: 120, maxWaitingSeconds: 150, tableUtilization: 0 });
    expect(result.bottlenecks.map((b) => b.resource)).toEqual(["repair-bays"]);
  });

  it("unblocks FIFO after an oversized party's timeout and conserves every customer", async () => {
    const result = await runCase({ process: fittedPartyProcess([2], 30, 120), rate: 150, seed: 0 });
    expect(result).toMatchObject({ customersArrived: 6, customersServed: 1, customersLost: 4, customersUnfinished: 1, averageWaitingSeconds: 95, maxWaitingSeconds: 120 });
    expect(result.tableUtilization).toBeCloseTo(30 / 180, 12);
    expect(result.customersServed + result.customersLost + result.customersUnfinished!).toBe(result.customersArrived);
  });

  it("records blocked demand with zero technicians without inventing capacity or hanging", async () => {
    const result = await runCase({ process: repairProcess(60, 0) });
    expect(result).toMatchObject({ customersArrived: 3, customersServed: 0, customersLost: 0, customersUnfinished: 3, averageWaitingSeconds: 90, maxWaitingSeconds: 150, staffUtilization: 0 });
    expect(result.resourceUtilization).toEqual([{ resourceId: "technicians", capacityUnits: 0, utilization: 0 }]);
    expect(result.bottlenecks.map((b) => b.resource)).toEqual(["technicians"]);
  });

  it("releases a process-held bay when timeout at a later stage exits as lost", async () => {
    const process: OperationProcess = {
      schemaVersion: 1, model: modelVersion, startStageId: "admission",
      resources: [{ id: "bay", capacityUnits: 1, category: "table" }, { id: "technician", capacityUnits: 0, category: "staff" }],
      stages: [
        { id: "admission", duration: { kind: "constant", seconds: 0 }, requirements: [{ resourceId: "bay", units: 1, release: "process-end" }], nextStageId: "inspection", queue: null, outcome: null },
        { id: "inspection", duration: { kind: "constant", seconds: 30 }, requirements: [{ resourceId: "technician", units: 1, release: "stage-end" }], nextStageId: "collected", queue: { maxWaitSeconds: 60, timeoutStageId: "abandoned" }, outcome: null },
        { id: "collected", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "served" },
        { id: "abandoned", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "lost" },
      ],
    };
    const result = await runCase({ process });
    expect(result).toMatchObject({ customersArrived: 3, customersServed: 0, customersLost: 2, customersUnfinished: 1, averageWaitingSeconds: 50, maxWaitingSeconds: 60, staffUtilization: 0 });
    expect(result.tableUtilization).toBeCloseTo(150 / 180, 12);
  });

  it("keeps a seated restaurant customer unfinished when all servers are absent and later parties abandon", async () => {
    const policy = createRestaurantPolicy({ resources: { servers: 0 }, maxQueueWaitSeconds: 30 });
    const result = await runCase({ policy, operationModel: restaurantOperationModel });
    expect(result).toMatchObject({ customersArrived: 3, customersServed: 0, customersLost: 2, customersUnfinished: 1, averageWaitingSeconds: 70, maxWaitingSeconds: 150, kitchenUtilization: 0, staffUtilization: 0 });
    expect(result.tableUtilization).toBeCloseTo(150 / 180, 12);
    expect(result.bottlenecks.map((b) => b.resource)).toEqual(expect.arrayContaining(["servers", "tables"]));
  });
});
