import { describe, expect, it } from "vitest";
import { createRestaurantPolicy, restaurantOperationModel, RESTAURANT_MODEL } from "./index";
import { fixtureLayout } from "../simulation/test-support";
import { validateOperationProcess } from "../simulation";

describe("restaurant operation model", () => {
  it("declares every business stage and all constrained resources outside the engine", () => {
    const process = restaurantOperationModel.defineProcess({ layout: fixtureLayout([2, 4]), policy: createRestaurantPolicy() });
    expect(process.stages.map((stage) => stage.id)).toEqual(["seating", "ordering", "cooking", "serving", "dining", "payment", "cleaning", "exit", "lost"]);
    expect(process.resources.map((resource) => resource.id)).toEqual(["tables", "seats", "kitchen", "cooks", "servers", "cashiers"]);
    expect(process.resources[0].unitCapacities).toEqual([2, 4]);
    expect(() => validateOperationProcess(process)).not.toThrow();
  });
  it("rejects unresolved tables and missing configured resource mappings", () => {
    const layout = fixtureLayout();
    layout.confirmedCapacity = null; layout.assignments.tables[0].capacity = null;
    layout.assignments.entranceIds = []; layout.assignments.kitchenStationIds = []; layout.assignments.serviceStationIds = [];
    const issues = restaurantOperationModel.validate({ layout, policy: createRestaurantPolicy() });
    expect(issues.map((issue) => issue.code)).toEqual(["unconfirmed-tables", "unassigned-entrance", "unassigned-kitchen", "unassigned-service"]);
    expect(() => restaurantOperationModel.defineProcess({ layout, policy: createRestaurantPolicy() })).toThrow("Confirm");
  });
  it("permits zero staff as an explicit capacity scenario and preserves optional legacy defaults", () => {
    const policy = createRestaurantPolicy({ resources: { cooks: 0 } });
    delete policy.partySizeDistribution; delete policy.maxQueueWaitSeconds;
    const process = restaurantOperationModel.defineProcess({ layout: fixtureLayout(), policy });
    expect(process.partySizeDistribution).toEqual([{ size: 1, probability: 1 }]);
    expect(process.stages[0].queue?.maxWaitSeconds).toBe(1800);
    expect(process.resources.find((resource) => resource.id === "cooks")?.capacityUnits).toBe(0);
  });
  it("returns independent defaults and rejects invalid policy distributions and mismatched versions", () => {
    const first = createRestaurantPolicy(), second = createRestaurantPolicy();
    first.model.version = "changed"; first.resources.cooks = 999;
    expect(second.model).toEqual(RESTAURANT_MODEL); expect(second.resources.cooks).toBe(2);
    expect(restaurantOperationModel.validate({ layout: fixtureLayout(), policy: first })[0].code).toBe("model-version-mismatch");
    expect(() => createRestaurantPolicy({ partySizeDistribution: [{ size: 2, probability: 0.2 }] })).toThrow();
    expect(() => createRestaurantPolicy({ maxQueueWaitSeconds: -1 })).toThrow();
  });
});
