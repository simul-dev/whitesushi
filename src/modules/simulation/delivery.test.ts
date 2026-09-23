import { describe, expect, it } from "vitest";
import { canonicalJson, completeSimulationRun, type OperationModel, type SimulationResult, type SimulationRun } from "../../core";
import { restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine as engine, validateOperationProcess } from "./index";
import { fixturePolicy, fixtureSnapshot, sealSnapshot } from "./test-support";

type FixtureOptions = Parameters<typeof fixtureSnapshot>[0];
function deliverySnapshot(rate: number, options: FixtureOptions = {}, packagingSeconds = 15, patience: number | null = null) {
  const snapshot = fixtureSnapshot(options);
  snapshot.input.operation.delivery = { packagingSeconds, maxQueueWaitSeconds: patience };
  snapshot.input.demand.deliveryBuckets = Array.from({ length: 24 }, (_, hour) => ({
    dayType: "weekday", hour, expectedOrdersPerHour: rate, distribution: options?.distribution ?? "deterministic",
  }));
  return sealSnapshot(snapshot);
}
const run = (snapshot: ReturnType<typeof fixtureSnapshot>, operationModel: OperationModel = restaurantOperationModel) =>
  engine.run({ runId: "delivery-test", snapshot, operationModel });
const tables = (count: number) => Array.from({ length: count }, () => 4);
function customerResult(result: SimulationResult) {
  const { delivery: _delivery, assumptions: _assumptions, ...rest } = result;
  return rest;
}
function capacityPolicy(capacity: number) {
  const policy = fixturePolicy();
  policy.resources.cooks = capacity; policy.resources.kitchenConcurrentOrders = capacity;
  policy.durations.cookingSeconds = 120; policy.durations.diningSeconds = 10;
  return policy;
}

describe("independent delivery shared-kitchen validation", () => {
  it.each(["deterministic", "poisson"] as const)("D1: zero delivery preserves all existing customer/resource results and RNG for %s arrivals", async distribution => {
    const policy = fixturePolicy();
    policy.partySizeDistribution = [{ size: 1, probability: 0.4 }, { size: 3, probability: 0.6 }];
    const options = { rate: 100, policy, distribution, config: { seed: 478 }, capacities: tables(20) };
    const legacy = await run(fixtureSnapshot(options));
    const zero = await run(deliverySnapshot(0, options));
    expect(customerResult(zero)).toEqual(customerResult(legacy));
    expect(zero.delivery).toMatchObject({ ordersArrived: 0, ordersCompleted: 0, ordersLost: 0, ordersUnfinished: 0, averageKitchenWaitingSeconds: 0 });
  });

  it("D2: spare kitchen/cook capacity absorbs delivery with no deterioration in dine-in service", async () => {
    const policy = capacityPolicy(100); policy.durations.cookingSeconds = 30;
    const options = { rate: 30, policy, capacities: tables(100) };
    const [zero, busy] = await Promise.all([0, 40].map(rate => run(deliverySnapshot(rate, options))));
    expect(busy.customersArrived).toBe(zero.customersArrived);
    expect(busy.customersServed).toBe(zero.customersServed);
    expect(busy.averageCustomerTimeInSystemSeconds).toBeCloseTo(zero.averageCustomerTimeInSystemSeconds, 10);
    expect(busy.averageDineInFoodWaitingSeconds).toBe(0);
    expect(busy.delivery!.ordersCompleted).toBeGreaterThan(0);
    expect(busy.kitchenUtilization).toBeGreaterThan(zero.kitchenUtilization);
  });

  it("D3: delivery increases actual shared-kitchen queueing, dine-in food wait and time in system", async () => {
    const options = { rate: 20, policy: capacityPolicy(1), capacities: tables(100) };
    const [zero, congested] = await Promise.all([0, 30].map(rate => run(deliverySnapshot(rate, options))));
    expect(congested.customersArrived).toBe(zero.customersArrived);
    expect(congested.kitchenUtilization).toBeGreaterThan(zero.kitchenUtilization);
    expect(congested.averageDineInFoodWaitingSeconds!).toBeGreaterThan(zero.averageDineInFoodWaitingSeconds! + 100);
    expect(congested.averageCustomerTimeInSystemSeconds).toBeGreaterThan(zero.averageCustomerTimeInSystemSeconds);
    expect(congested.customersServed).toBeLessThan(zero.customersServed);
    expect(congested.delivery!.averageKitchenWaitingSeconds).toBeGreaterThan(100);
    expect(congested.delivery!.ordersUnfinished).toBeGreaterThan(0);
  });

  it("D4: more shared kitchen slots and cooks relieve both channels", async () => {
    const [congested, expanded] = await Promise.all([1, 4].map(capacity => run(deliverySnapshot(30, {
      rate: 20, policy: capacityPolicy(capacity), capacities: tables(100),
    }))));
    expect(expanded.customersServed).toBeGreaterThan(congested.customersServed);
    expect(expanded.delivery!.ordersCompleted).toBeGreaterThan(congested.delivery!.ordersCompleted);
    expect(expanded.averageDineInFoodWaitingSeconds!).toBeLessThan(congested.averageDineInFoodWaitingSeconds!);
    expect(expanded.delivery!.averageKitchenWaitingSeconds).toBeLessThan(congested.delivery!.averageKitchenWaitingSeconds);
    expect(expanded.delivery!.averageTimeInSystemSeconds).toBeLessThan(congested.delivery!.averageTimeInSystemSeconds);
    for (const result of [congested, expanded]) for (const resource of result.resourceUtilization!) {
      expect(resource.utilization).toBeGreaterThanOrEqual(0); expect(resource.utilization).toBeLessThanOrEqual(1);
    }
  });
});

describe("delivery units, queue policy and accounting", () => {
  it("shares an actual FIFO cook pool between dine-in cooking and delivery packaging", async () => {
    const policy = capacityPolicy(1);
    policy.durations = { orderingSeconds: 1, cookingSeconds: 10, servingSeconds: 1, diningSeconds: 1, paymentSeconds: 1, cleaningSeconds: 1 };
    const result = await run(deliverySnapshot(60, { rate: 60, policy, capacities: [1], config: { durationSeconds: 60 } }, 5));
    // Both arrive at30s: delivery cooks30..40, older dine-in kitchen request at31
    // wins cook40..50, then delivery packages50..55. No duplicate cook capacity.
    expect(result.customersServed).toBe(1);
    expect(result.averageDineInFoodWaitingSeconds).toBe(9);
    expect(result.delivery).toMatchObject({ ordersArrived: 1, ordersCompleted: 1, averageKitchenWaitingSeconds: 0, averageTimeInSystemSeconds: 25 });
    expect(result.resourceUtilization!.find(resource => resource.resourceId === "cooks")!.utilization).toBeCloseTo(25 / 60, 12);
    expect(result.kitchenUtilization).toBeCloseTo(20 / 60, 12);
  });

  it("orders consume no tables/seats or customer counts, and packaging consumes real cook time", async () => {
    const policy = capacityPolicy(1); policy.durations.cookingSeconds = 10;
    policy.resources.servers = 0; policy.resources.cashiers = 0;
    const result = await run(deliverySnapshot(60, { rate: 0, policy, config: { durationSeconds: 60 } }, 5));
    expect(result).toMatchObject({ customersArrived: 0, customersServed: 0, customersLost: 0, customersUnfinished: 0, throughputCustomersPerHour: 0, tableUtilization: 0 });
    expect(result.delivery).toMatchObject({ ordersArrived: 1, ordersCompleted: 1, throughputOrdersPerHour: 60, averageTimeInSystemSeconds: 15 });
    expect(result.resourceUtilization!.find(resource => resource.resourceId === "cooks")!.utilization).toBeCloseTo(15 / 60, 12);
    expect(result.resourceUtilization!.find(resource => resource.resourceId === "seats")!.utilization).toBe(0);
  });

  it("counts delivery losses and censored kitchen waiting independently of dine-in", async () => {
    const policy = capacityPolicy(1); policy.resources.cooks = 0;
    const options = { rate: 0, policy, config: { durationSeconds: 120 } };
    const [finite, indefinite] = await Promise.all([15, null].map(patience => run(deliverySnapshot(60, options, 5, patience))));
    expect(finite.delivery).toMatchObject({ ordersArrived: 2, ordersCompleted: 0, ordersLost: 2, ordersUnfinished: 0, averageKitchenWaitingSeconds: 15, maxKitchenWaitingSeconds: 15 });
    expect(indefinite.delivery).toMatchObject({ ordersArrived: 2, ordersCompleted: 0, ordersLost: 0, ordersUnfinished: 2, averageKitchenWaitingSeconds: 60, maxKitchenWaitingSeconds: 90 });
    expect(finite.customersLost).toBe(0); expect(indefinite.averageWaitingSeconds).toBe(0);
    expect(indefinite.bottlenecks.find(item => item.resource === "cooks")?.description).toContain("order-seconds");
  });

  it("preserves input, seeded arrivals, channel conservation and completed-run contracts", async () => {
    const snapshot = deliverySnapshot(40, { rate: 55, policy: capacityPolicy(2), capacities: tables(50), distribution: "poisson" });
    const before = canonicalJson(snapshot);
    const first = await run(snapshot);
    expect(await run(snapshot)).toEqual(first);
    expect(canonicalJson(snapshot)).toBe(before);
    expect(first.customersArrived).toBe(first.customersServed + first.customersLost + first.customersUnfinished!);
    const delivery = first.delivery!;
    expect(delivery.ordersArrived).toBe(delivery.ordersCompleted + delivery.ordersLost + delivery.ordersUnfinished);
    expect(delivery.hourlyThroughput.reduce((sum, bucket) => sum + bucket.ordersCompleted, 0)).toBe(delivery.ordersCompleted);
    const prepared: SimulationRun = { id: first.runId, status: "prepared", snapshot, createdAt: "2026-09-23T00:00:00Z", completedAt: null, result: null, error: null };
    expect(completeSimulationRun(prepared, first, "2026-09-23T01:00:00Z").status).toBe("completed");
    const different = structuredClone(snapshot); different.input.config.seed++; sealSnapshot(different);
    expect((await run(different)).delivery!.ordersArrived).not.toBe(delivery.ordersArrived);
  });

  it("never scales delivery orders by dine-in party size or loses fractional intensity at hour boundaries", async () => {
    const policy = fixturePolicy(); policy.partySizeDistribution = [{ size: 4, probability: 1 }];
    const result = await run(deliverySnapshot(0.25, { rate: 0, policy, config: { durationSeconds: 86400 } }, 1));
    expect(result.delivery!.ordersArrived).toBe(6); expect(result.delivery!.ordersCompleted).toBe(6);
    expect(result.customersArrived).toBe(0);
  });

  it("uses independent stochastic channel streams when rates and party sizes change", async () => {
    const policy = fixturePolicy();
    const options = { rate: 30, policy, capacities: tables(100), distribution: "poisson" as const };
    const [zero, additional, changedCustomers] = await Promise.all([
      run(deliverySnapshot(0, options)),
      run(deliverySnapshot(45, options)),
      run(deliverySnapshot(45, { ...options, rate: 200, policy: { ...policy, partySizeDistribution: [{ size: 3, probability: 1 }] } })),
    ]);
    expect(additional.customersArrived).toBe(zero.customersArrived);
    expect(changedCustomers.delivery!.ordersArrived).toBe(additional.delivery!.ordersArrived);
  });

  it("applies the same opening windows and fractional observation interval to both streams", async () => {
    const policy = fixturePolicy();
    policy.operatingWindows = [{ dayType: "weekday", startMinute: 30, endMinute: 45 }];
    const result = await run(deliverySnapshot(60, { rate: 0, policy, config: { startMinute: 30, durationSeconds: 1800 } }, 1));
    expect(result.delivery).toMatchObject({ ordersArrived: 15, ordersCompleted: 15, throughputOrdersPerHour: 30, hourlyThroughput: [{ hour: 0, ordersCompleted: 15 }] });
  });

  it("rejects missing delivery hours and positive demand without a declared stream", async () => {
    const absent = deliverySnapshot(60); delete absent.input.operation.delivery; sealSnapshot(absent);
    await expect(run(absent)).rejects.toThrow(/delivery process stream/);
    const missing = deliverySnapshot(60); missing.input.demand.deliveryBuckets = []; sealSnapshot(missing);
    await expect(run(missing)).rejects.toThrow(/missing explicit delivery demand/);
  });

  it("routes streams and wait metrics through arbitrary stage/resource names", async () => {
    const snapshot = deliverySnapshot(30, { rate: 20, policy: capacityPolicy(1), capacities: tables(100) });
    const reference = await run(snapshot);
    const process = restaurantOperationModel.defineProcess({ layout: snapshot.input.layout, policy: snapshot.input.operation });
    const renamed = structuredClone(process); renamed.model = { id: "generic-shared-machine", version: "1" };
    const stageName = (id: string) => `node-${process.stages.findIndex(stage => stage.id === id)}`;
    const resourceName = (id: string) => `pool-${process.resources.findIndex(resource => resource.id === id)}`;
    renamed.startStageId = stageName(renamed.startStageId);
    renamed.resources.forEach(resource => { resource.id = resourceName(resource.id); });
    renamed.arrivalStreams!.forEach(stream => { stream.startStageId = stageName(stream.startStageId); });
    renamed.stages.forEach(stage => {
      stage.id = stageName(stage.id);
      if (stage.nextStageId) stage.nextStageId = stageName(stage.nextStageId);
      if (stage.queue) stage.queue.timeoutStageId = stageName(stage.queue.timeoutStageId);
      stage.requirements.forEach(requirement => { requirement.resourceId = resourceName(requirement.resourceId); });
    });
    snapshot.input.operation.model = { ...renamed.model }; sealSnapshot(snapshot);
    const actual = await run(snapshot, { descriptor: renamed.model, validate: () => [], defineProcess: () => renamed });
    expect(actual.customersServed).toBe(reference.customersServed);
    expect(actual.delivery).toEqual(reference.delivery);
    expect(actual.averageDineInFoodWaitingSeconds).toBe(reference.averageDineInFoodWaitingSeconds);
    expect(actual.kitchenUtilization).toBe(reference.kitchenUtilization);
  });

  it("validates additional stream roots, metric tags and retained resources", () => {
    const snapshot = deliverySnapshot(10);
    const process = restaurantOperationModel.defineProcess({ layout: snapshot.input.layout, policy: snapshot.input.operation });
    const missing = structuredClone(process); missing.arrivalStreams![1].startStageId = "unknown";
    expect(() => validateOperationProcess(missing)).toThrow(/stream start/);
    const duplicate = structuredClone(process); duplicate.arrivalStreams!.push({ ...duplicate.arrivalStreams![1], id: "duplicate-channel" });
    expect(() => validateOperationProcess(duplicate)).toThrow(/one stream per/);
    const held = structuredClone(process);
    held.stages.find(stage => stage.id === "delivery-cooking")!.requirements.find(requirement => requirement.resourceId === "cooks")!.release = "process-end";
    expect(() => validateOperationProcess(held)).toThrow(/already held/);
  });
});
