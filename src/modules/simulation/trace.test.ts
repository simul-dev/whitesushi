import { describe, expect, it } from "vitest";
import { canonicalJson, type OperationModel, type SimulationFrame } from "../../core";
import { restaurantOperationModel } from "../operation";
import { discreteEventSimulationEngine as engine } from "./index";
import { fixturePolicy, fixtureSnapshot, sealSnapshot } from "./test-support";

function mixedSnapshot() {
  const policy = fixturePolicy();
  policy.resources.cooks = 2; policy.resources.kitchenConcurrentOrders = 2;
  policy.durations.cookingSeconds = 90; policy.maxQueueWaitSeconds = 45;
  policy.partySizeDistribution = [{ size: 1, probability: 0.4 }, { size: 2, probability: 0.6 }];
  policy.delivery = { packagingSeconds: 12, maxQueueWaitSeconds: 120 };
  const snapshot = fixtureSnapshot({ rate: 90, policy, distribution: "poisson", config: { durationSeconds: 901, seed: 489 } });
  snapshot.input.demand.deliveryBuckets = [{ dayType: "weekday", hour: 0, distribution: "poisson", expectedOrdersPerHour: 50 }];
  return sealSnapshot(snapshot);
}

describe("exact DES observation", () => {
  it("produces identical results with and without visualization and detached regular frames", async () => {
    const snapshot = mixedSnapshot(), before = canonicalJson(snapshot);
    const frames: SimulationFrame[] = [];
    const input = { runId: "observed", snapshot, operationModel: restaurantOperationModel };
    const plain = await engine.run(input);
    const observed = await engine.run({ ...input, observation: { intervalSeconds: 7.5, onFrame: frame => frames.push(frame) } });
    expect(observed).toEqual(plain);
    expect(canonicalJson(snapshot)).toBe(before);
    expect(frames[0].elapsedSeconds).toBe(0);
    expect(frames.at(-1)!.elapsedSeconds).toBe(901);
    expect(frames.map(frame => frame.elapsedSeconds)).toEqual([...Array.from({ length: 121 }, (_, index) => index * 7.5), 901]);
    for (const frame of frames) {
      expect(frame.customers.arrived).toBe(frame.customers.served + frame.customers.lost + frame.customers.inSystem);
      expect(frame.delivery.arrived).toBe(frame.delivery.completed + frame.delivery.lost + frame.delivery.inSystem);
      expect(frame.customers.waiting).toBeLessThanOrEqual(frame.customers.inSystem);
      expect(frame.delivery.waiting).toBeLessThanOrEqual(frame.delivery.inSystem);
      expect(frame.entities.filter(entity => entity.channel === "dine-in").reduce((sum, entity) => sum + entity.size, 0)).toBe(frame.customers.inSystem);
      expect(frame.entities.filter(entity => entity.channel === "delivery")).toHaveLength(frame.delivery.inSystem);
      expect(new Set(frame.entities.map(entity => entity.id)).size).toBe(frame.entities.length);
      for (const resource of frame.resources) {
        expect(resource.busyUnits).toBeGreaterThanOrEqual(0); expect(resource.busyUnits).toBeLessThanOrEqual(resource.capacityUnits);
        const claims = frame.entities.flatMap(entity => entity.allocations).filter(allocation => allocation.resourceId === resource.resourceId);
        expect(claims.reduce((sum, claim) => sum + claim.units, 0)).toBe(resource.busyUnits);
        const unitIndices = claims.flatMap(claim => claim.unitIndices).sort((a, b) => a - b);
        expect(unitIndices).toEqual(resource.occupiedUnitIndices);
        expect(new Set(unitIndices).size).toBe(unitIndices.length);
      }
    }
    const last = frames.at(-1)!;
    expect(last.customers).toMatchObject({ arrived: observed.customersArrived, served: observed.customersServed, lost: observed.customersLost, inSystem: observed.customersUnfinished });
    expect(last.delivery).toMatchObject({ arrived: observed.delivery!.ordersArrived, completed: observed.delivery!.ordersCompleted, lost: observed.delivery!.ordersLost, inSystem: observed.delivery!.ordersUnfinished });
  });

  it("observer mutation cannot change scheduler state, later frames or random inputs", async () => {
    const baseline = mixedSnapshot(), snapshot = structuredClone(baseline);
    const plain = await engine.run({ runId: "mutation", snapshot: baseline, operationModel: restaurantOperationModel });
    const result = await engine.run({ runId: "mutation", snapshot, operationModel: restaurantOperationModel, observation: {
      intervalSeconds: 10,
      onFrame(frame) {
        expect(frame.customers.arrived).toBeLessThan(1000);
        frame.customers.arrived = 999999;
        frame.resources.forEach(resource => { resource.busyUnits = 999999; resource.occupiedUnitIndices.push(999); });
        frame.entities.forEach(entity => { entity.size = 999999; entity.allocations.length = 0; });
        frame.entities.length = 0;
        // Even a caller mutating its own unfrozen input cannot alter a running observation.
        snapshot.input.config.seed++;
      },
    } });
    expect(result).toEqual(plain);
  });

  it.each([0, 1])("captures after all same-clock transitions, including zero-duration terminal chains (service%s)", async seconds => {
    const model: OperationModel = {
      descriptor: { id: "trace-fixture", version: "1" }, validate: () => [],
      defineProcess: () => ({ schemaVersion: 1, model: { id: "trace-fixture", version: "1" }, startStageId: "work", resources: [{ id: "machine", capacityUnits: 1 }], stages: [
        { id: "work", duration: { kind: "constant", seconds }, requirements: [{ resourceId: "machine", units: 1, release: "stage-end" }], nextStageId: "end", queue: null, outcome: null },
        { id: "end", duration: { kind: "constant", seconds: 0 }, requirements: [], nextStageId: null, queue: null, outcome: "served" },
      ] }),
    };
    const snapshot = fixtureSnapshot({ rate: 3600, config: { durationSeconds: 3.5 } });
    snapshot.input.operation.model = model.descriptor; sealSnapshot(snapshot);
    const frames: SimulationFrame[] = [];
    const result = await engine.run({ runId: "clock", snapshot, operationModel: model, observation: { intervalSeconds: 0.5, onFrame: frame => frames.push(frame) } });
    expect(frames.find(frame => frame.elapsedSeconds === 1.5)!.customers).toMatchObject({ arrived: 2, served: seconds ? 1 : 2, waiting: 0, inSystem: seconds ? 1 : 0 });
    expect(frames.find(frame => frame.elapsedSeconds === 1.5)!.entities.every(entity => entity.stageId === "work")).toBe(true);
    expect(frames.at(-1)!.customers.served).toBe(3);
    expect(frames.at(-1)!.resources[0].busyUnits).toBe(0);
    expect(result.customersServed).toBe(3);
  });

  it("observes empty and short runs through the exact horizon and rejects excessive frame requests", async () => {
    const frames: SimulationFrame[] = [];
    const snapshot = fixtureSnapshot({ rate: 0, config: { durationSeconds: 10 } });
    await engine.run({ runId: "empty", snapshot, operationModel: restaurantOperationModel, observation: { intervalSeconds: 20, onFrame: frame => frames.push(frame) } });
    expect(frames.map(frame => frame.elapsedSeconds)).toEqual([0, 10]);
    expect(frames.every(frame => frame.entities.length === 0 && frame.customers.arrived === 0)).toBe(true);
    for (const intervalSeconds of [0, -1, NaN, Infinity, 0.001]) {
      await expect(engine.run({ runId: "guard", snapshot, operationModel: restaurantOperationModel, observation: { intervalSeconds, onFrame: () => {} } })).rejects.toThrow(/observation/);
    }
  });
});
