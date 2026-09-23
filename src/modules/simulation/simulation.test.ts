import { describe, expect, it } from "vitest";
import { canonicalJson, type OperationModel, type OperationProcess, type SimulationSnapshot } from "../../core";
import { restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine as engine, validateOperationProcess } from "./index";
import { fixturePolicy, fixtureSnapshot, sealSnapshot } from "./test-support";

const simulate = (options: Parameters<typeof fixtureSnapshot>[0] = {}) => engine.run({ runId: "run", snapshot: fixtureSnapshot(options), operationModel: restaurantOperationModel });
const copies = (count: number, capacity = 2) => Array.from({ length: count }, () => capacity);

describe("restaurant DES capacity validation scenarios", () => {
  it("A: demand first raises throughput, then saturates capacity and raises waiting/utilization", async () => {
    const [low, medium, high] = await Promise.all([10, 60, 240].map((rate) => simulate({ rate, capacities: [2, 2] })));
    expect(medium.customersServed).toBeGreaterThan(low.customersServed);
    expect(high.customersServed - medium.customersServed).toBeLessThan(medium.customersServed - low.customersServed);
    expect(high.averageWaitingSeconds).toBeGreaterThan(medium.averageWaitingSeconds);
    expect(high.tableUtilization).toBeGreaterThan(low.tableUtilization);
    expect(high.throughputCustomersPerHour).toBeLessThanOrEqual(2 * 3600 / 305);
    expect(high.bottlenecks.some((item) => item.resource === "tables")).toBe(true);
  });
  it("B: extra tables raise table-limited throughput; extra seats permit larger parties", async () => {
    const [few, many] = await Promise.all([2, 8].map((count) => simulate({ rate: 200, capacities: copies(count) })));
    expect(many.customersServed).toBeGreaterThan(few.customersServed * 2);
    expect(many.averageWaitingSeconds).toBeLessThan(few.averageWaitingSeconds);
    const policy = fixturePolicy(); policy.partySizeDistribution = [{ size: 3, probability: 1 }]; policy.maxQueueWaitSeconds = 60;
    const [small, fitting] = await Promise.all([[2, 2], [4, 4]].map((capacities) => simulate({ rate: 60, capacities, policy })));
    expect(small.customersServed).toBe(0); expect(small.customersLost).toBeGreaterThan(0);
    expect(fitting.customersServed).toBeGreaterThan(0);
    expect(fitting.customersArrived % 3).toBe(0);
  });
  it("B/C: extra tables have limited effect at a kitchen bottleneck; kitchen capacity raises throughput", async () => {
    const policy = fixturePolicy(); policy.resources.kitchenConcurrentOrders = 1; policy.durations.cookingSeconds = 240; policy.durations.diningSeconds = 10;
    const [baseline, moreTables, moreKitchen] = await Promise.all([
      simulate({ rate: 200, capacities: copies(20), policy }),
      simulate({ rate: 200, capacities: copies(40), policy }),
      simulate({ rate: 200, capacities: copies(40), policy: { ...policy, resources: { ...policy.resources, kitchenConcurrentOrders: 4 } } }),
    ]);
    expect(moreTables.customersServed - baseline.customersServed).toBeLessThanOrEqual(1);
    expect(moreKitchen.customersServed).toBeGreaterThan(baseline.customersServed * 2);
    expect(moreKitchen.averageWaitingSeconds).toBeLessThan(moreTables.averageWaitingSeconds);
    expect(baseline.bottlenecks.some((item) => item.resource === "kitchen")).toBe(true);
  });
  it.each(["cooks", "servers"] as const)("D: increasing %s relieves that staff bottleneck", async (role) => {
    const policy = fixturePolicy(); policy.resources[role] = 1; policy.durations.diningSeconds = 10;
    if (role === "cooks") policy.durations.cookingSeconds = 240;
    else { policy.durations.orderingSeconds = 120; policy.durations.servingSeconds = 120; policy.durations.cleaningSeconds = 120; }
    const [few, more] = await Promise.all([1, 4].map((capacity) => simulate({ rate: 200, capacities: copies(100), policy: { ...policy, resources: { ...policy.resources, [role]: capacity } } })));
    expect(more.customersServed).toBeGreaterThan(few.customersServed * 2);
    expect(more.averageWaitingSeconds).toBeLessThan(few.averageWaitingSeconds);
    expect(few.bottlenecks.some((item) => item.resource === role)).toBe(true);
  });
  it("E: identical snapshot and seed reproduce exactly; independent seeds change stochastic arrivals", async () => {
    const policy = fixturePolicy(); policy.partySizeDistribution = [{ size: 1, probability: 0.4 }, { size: 2, probability: 0.6 }];
    const options = { rate: 80, distribution: "poisson" as const, policy };
    const [first, repeated, other] = await Promise.all([simulate(options), simulate(options), simulate({ ...options, config: { seed: 43 } })]);
    expect(repeated).toEqual(first); expect(other.customersArrived).not.toBe(first.customersArrived);
  });
});

describe("fixed-horizon accounting and queue behavior", () => {
  it("carries fractional deterministic arrival intensity across hours and ignores zero-probability sizes", async () => {
    const policy = fixturePolicy(); policy.partySizeDistribution = [{ size: 1, probability: 1 }, { size: 100, probability: 0 }];
    const result = await simulate({ rate: 0.25, policy, config: { durationSeconds: 86400 } });
    expect(result.customersArrived).toBe(6); expect(result.customersServed).toBe(6);
  });
  it("conserves customers at the horizon and integrates exact table busy time", async () => {
    const policy = fixturePolicy(); policy.durations.diningSeconds = 595;
    const result = await simulate({ rate: 60, capacities: [1], policy, config: { durationSeconds: 3600 } });
    // Arrivals at 30, 90, ... ; each full process occupies the table for exactly 600 seconds.
    expect(result.customersArrived).toBe(60); expect(result.customersServed).toBe(5); expect(result.customersUnfinished).toBe(55);
    expect(result.customersArrived).toBe(result.customersServed + result.customersLost + result.customersUnfinished!);
    expect(result.tableUtilization).toBeCloseTo(3570 / 3600, 10);
    expect(result.hourlyThroughput).toEqual([{ hour: 0, customersServed: 5 }]);
    expect(result.throughputCustomersPerHour).toBe(5);
    expect(result.averageWaitingSeconds).toBeGreaterThan(0);
    expect(result.maxWaitingSeconds).toBeGreaterThanOrEqual(result.averageWaitingSeconds);
    for (const resource of result.resourceUtilization!) expect(resource.utilization).toBeGreaterThanOrEqual(0);
    for (const resource of result.resourceUtilization!) expect(resource.utilization).toBeLessThanOrEqual(1);
    expect(result.revenueStatus).toBe("not-modeled"); expect(result.revenue).toBe(0); expect(result.revenueByHour).toEqual([]);
  });
  it("admits only during opening windows and counts closed-period completions within observation", async () => {
    const policy = fixturePolicy(); policy.operatingWindows = [{ dayType: "weekday", startMinute: 30, endMinute: 45 }];
    const result = await simulate({ rate: 60, capacities: copies(100), policy, config: { durationSeconds: 3600 } });
    expect(result.customersArrived).toBe(15); expect(result.customersServed).toBe(15);
    expect(result.throughputCustomersPerHour).toBe(15);
  });
  it("terminates zero-resource scenarios, records censored waits, and handles zero arrivals", async () => {
    const policy = fixturePolicy(); policy.resources.cooks = 0;
    const result = await simulate({ rate: 50, policy });
    expect(result.customersServed).toBe(0); expect(result.customersUnfinished).toBe(result.customersArrived);
    expect(result.bottlenecks.some((item) => item.resource === "cooks")).toBe(true);
    const empty = await simulate({ rate: 0, policy });
    expect(empty.customersArrived).toBe(0); expect(empty.averageWaitingSeconds).toBe(0); expect(empty.averageCustomerTimeInSystemSeconds).toBe(0);
    expect(empty.tableUtilization).toBe(0);
  });
  it("uses complete parties and returns finite loss after admission timeout", async () => {
    const policy = fixturePolicy(); policy.maxQueueWaitSeconds = 10; policy.partySizeDistribution = [{ size: 2, probability: 1 }];
    const result = await simulate({ rate: 120, capacities: [2], policy, config: { durationSeconds: 3600 } });
    expect(result.customersLost).toBeGreaterThan(0);
    expect(result.customersArrived).toBe(120);
    expect(result.customersServed % 2).toBe(0); expect(result.customersLost % 2).toBe(0);
    expect(result.customersArrived).toBe(result.customersServed + result.customersLost + result.customersUnfinished!);
  });
});

function genericModel(process: OperationProcess): OperationModel {
  return { descriptor: process.model, validate: () => [], defineProcess: () => process };
}
function simpleProcess(): OperationProcess {
  return {
    schemaVersion: 1, model: { id: "generic-test", version: "1" }, startStageId: "alpha", resources: [{ id: "machine", capacityUnits: 1 }],
    stages: [
      { id: "alpha", duration: { kind: "constant", seconds: 10 }, requirements: [{ resourceId: "machine", units: 1, release: "stage-end" }], nextStageId: "omega", queue: null, outcome: null },
      { id: "omega", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "served" },
    ],
  };
}
async function genericRun(process: OperationProcess, snapshot = fixtureSnapshot({ rate: 3600, config: { durationSeconds: 30 } })) {
  snapshot.input.operation.model = { ...process.model }; sealSnapshot(snapshot);
  return engine.run({ runId: "generic", snapshot, operationModel: genericModel(process) });
}

describe("generic injected process and input safeguards", () => {
  it("executes arbitrary stage/resource names with FIFO waiting and analytical KPI values", async () => {
    const result = await genericRun(simpleProcess());
    expect(result.customersArrived).toBe(30); expect(result.customersServed).toBe(2);
    expect(result.averageCustomerTimeInSystemSeconds).toBe(14.5); // first 10s, second 19s
    expect(result.resourceUtilization![0].utilization).toBeCloseTo(29.5 / 30);
    expect(result.averageWaitingSeconds).toBeCloseTo((9 + 18 + Array.from({ length: 27 }, (_, i) => 26.5 - i).reduce((a, b) => a + b, 0)) / 30);
    expect(result.tableUtilization).toBe(0);
  });
  it("supports exponential service with repeatable seeds", async () => {
    const process = simpleProcess(); process.stages[0].duration = { kind: "exponential", meanSeconds: 10 };
    expect(await genericRun(process)).toEqual(await genericRun(process));
  });
  it("releases held resources on queue timeout paths", async () => {
    const process = simpleProcess();
    process.resources.push({ id: "blocked", capacityUnits: 0 });
    process.stages[0].duration = { kind: "constant", seconds: 0 };
    process.stages[0].requirements[0].release = "process-end"; process.stages[0].nextStageId = "beta";
    process.stages.push(
      { id: "beta", duration: { kind: "constant", seconds: 0 }, requirements: [{ resourceId: "blocked", units: 1, release: "stage-end" }], nextStageId: "omega", queue: { maxWaitSeconds: 2, timeoutStageId: "lost" }, outcome: null },
      { id: "lost", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "lost" },
    );
    const result = await genericRun(process);
    expect(result.customersLost).toBe(14); expect(result.customersServed).toBe(0);
  });
  it("rejects cycles, missing resources, malformed party distributions and repeated held acquisitions", () => {
    const cycle = simpleProcess(); cycle.stages[0].nextStageId = "alpha";
    expect(() => validateOperationProcess(cycle)).toThrow("cycles");
    const missing = simpleProcess(); missing.resources = [];
    expect(() => validateOperationProcess(missing)).toThrow("unknown resource");
    const probability = simpleProcess(); probability.partySizeDistribution = [{ size: 1, probability: 0.5 }];
    expect(() => validateOperationProcess(probability)).toThrow("sum to one");
    const repeated = simpleProcess(); repeated.stages[0].requirements[0].release = "process-end"; repeated.stages[1].requirements = structuredClone(repeated.stages[0].requirements);
    expect(() => validateOperationProcess(repeated)).toThrow("already held");
  });
  it("rejects modified snapshots, model/version mismatch, missing hours and unsupported aggregation", async () => {
    const changed = fixtureSnapshot(); changed.input.config.seed++;
    await expect(engine.run({ runId: "run", snapshot: changed, operationModel: restaurantOperationModel })).rejects.toThrow("modified");
    const version = fixtureSnapshot(); version.engine = { ...engine.descriptor, version: "other" }; sealSnapshot(version);
    await expect(engine.run({ runId: "run", snapshot: version, operationModel: restaurantOperationModel })).rejects.toThrow("version mismatch");
    const missing = fixtureSnapshot(); missing.input.demand.buckets = []; sealSnapshot(missing);
    await expect(engine.run({ runId: "run", snapshot: missing, operationModel: restaurantOperationModel })).rejects.toThrow("missing explicit demand");
    await expect(simulate({ config: { replications: 2 } })).rejects.toThrow("one replication");
    await expect(simulate({ rate: 1e10 })).rejects.toThrow("guard");
  });
  it("does not mutate its input and keeps repeated invocations independent", async () => {
    const snapshot = fixtureSnapshot(), before = canonicalJson(snapshot);
    await engine.run({ runId: "run", snapshot, operationModel: restaurantOperationModel });
    expect(canonicalJson(snapshot)).toBe(before);
    expect(await simulate({ rate: 0 })).toEqual(await simulate({ rate: 0 }));
  });
});
