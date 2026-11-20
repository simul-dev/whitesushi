import { describe, expect, it } from "vitest";
import { restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine as engine, type EngineControl, type OutcomeRecord } from "./index";
import { fixturePolicy, fixtureSnapshot, sealSnapshot } from "./test-support";

const run = (snapshot: ReturnType<typeof fixtureSnapshot>, control?: EngineControl) =>
  engine.run({ runId: "control-test", snapshot, operationModel: restaurantOperationModel, control });

function congested(seed = 7) {
  const policy = fixturePolicy();
  policy.partySizeDistribution = [{ size: 1, probability: 0.5 }, { size: 2, probability: 0.5 }];
  policy.resources.cooks = 2; policy.resources.kitchenConcurrentOrders = 2; policy.durations.cookingSeconds = 300;
  policy.maxQueueWaitSeconds = 600;
  const snapshot = fixtureSnapshot({ rate: 40, policy, distribution: "poisson", config: { seed }, capacities: [1, 2, 2, 4] });
  snapshot.input.operation.delivery = { packagingSeconds: 30, maxQueueWaitSeconds: 600 };
  snapshot.input.demand.deliveryBuckets = Array.from({ length: 24 }, (_, hour) => ({ dayType: "weekday" as const, hour, expectedOrdersPerHour: 12, distribution: "poisson" as const }));
  return sealSnapshot(snapshot);
}

describe("engine control hooks", () => {
  it("an empty control reproduces the reference result exactly", async () => {
    expect(await run(congested(), {})).toEqual(await run(congested()));
    expect(await run(congested(), { serviceTimeCv: 0, backfill: false })).toEqual(await run(congested()));
  });

  it("a capacity schedule holds cooking until cooks arrive", async () => {
    const records: OutcomeRecord[] = [];
    const result = await run(congested(), { capacitySchedule: { cooks: [{ atSeconds: 0, units: 0 }, { atSeconds: 3600, units: 3 }] }, onOutcome: r => records.push(r) });
    const served = records.filter(r => r.outcome === "served");
    expect(served.length).toBeGreaterThan(0);
    expect(Math.min(...served.map(r => r.endedAt!))).toBeGreaterThan(3600);
    expect(result.resourceUtilization!.find(r => r.resourceId === "cooks")!.utilization).toBeLessThanOrEqual(1);
  });

  it("rejects schedules for exclusive tables, unknown resources and unordered steps", async () => {
    await expect(run(congested(), { capacitySchedule: { tables: [{ atSeconds: 0, units: 1 }] } })).rejects.toThrow(/exclusive/);
    await expect(run(congested(), { capacitySchedule: { robots: [{ atSeconds: 0, units: 1 }] } })).rejects.toThrow(/unknown resource/);
    await expect(run(congested(), { capacitySchedule: { cooks: [{ atSeconds: 10, units: 1 }, { atSeconds: 5, units: 1 }] } })).rejects.toThrow(/increasing/);
  });

  it("rank decides who the shared kitchen serves first", async () => {
    const deliveryFirst = await run(congested(), { rank: r => (r.channel === "delivery" ? 0 : 1) });
    const dineInFirst = await run(congested(), { rank: r => (r.channel === "dine-in" ? 0 : 1) });
    expect(deliveryFirst.delivery!.averageKitchenWaitingSeconds).toBeLessThan(dineInFirst.delivery!.averageKitchenWaitingSeconds);
    expect(deliveryFirst.averageDineInFoodWaitingSeconds!).toBeGreaterThan(dineInFirst.averageDineInFoodWaitingSeconds!);
  });

  it("backfill removes head-of-line blocking behind a party no table fits", async () => {
    const policy = fixturePolicy();
    policy.partySizeDistribution = [{ size: 1, probability: 0.7 }, { size: 3, probability: 0.3 }]; // no table seats 3
    const snapshot = fixtureSnapshot({ rate: 20, policy, distribution: "poisson", capacities: [2, 2, 2, 2] });
    const strict = await run(snapshot), backfill = await run(snapshot, { backfill: true });
    expect(backfill.customersServed).toBeGreaterThan(strict.customersServed);
  });

  it("chooseTable can hold a party back and must return a free fitting table", async () => {
    const snapshot = fixtureSnapshot({ rate: 20, distribution: "poisson", capacities: [4, 4] });
    expect((await run(snapshot, { chooseTable: () => null })).customersServed).toBe(0);
    await expect(run(snapshot, { chooseTable: () => 99 })).rejects.toThrow(/chooseTable/);
    const first = await run(snapshot, { chooseTable: (_size, free) => free[0].index });
    expect(first).toEqual(await run(snapshot));
  });

  it("service-time noise is seeded and outcome records conserve customers", async () => {
    const records: OutcomeRecord[] = [];
    const noisy = await run(congested(), { serviceTimeCv: 0.4, onOutcome: r => records.push(r) });
    expect(await run(congested(), { serviceTimeCv: 0.4 })).toEqual(noisy);
    expect(noisy).not.toEqual(await run(congested()));
    const hall = records.filter(r => r.channel === "dine-in");
    expect(hall.reduce((s, r) => s + r.size, 0)).toBe(noisy.customersArrived);
    expect(hall.filter(r => r.outcome === "served").reduce((s, r) => s + r.size, 0)).toBe(noisy.customersServed);
    expect(records.filter(r => r.channel === "delivery").length).toBe(noisy.delivery!.ordersArrived);
  });
});
