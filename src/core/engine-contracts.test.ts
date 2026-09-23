import { describe, expect, it } from "vitest";
import {
  applyOverrides, demandParametersContentKey, validateDemandParameters,
  validateOperation, type DemandParameters, type OperationPolicy,
  type ProjectConfiguration,
} from "./index";

const parameters: DemandParameters = {
  categoryParticipationRate: 0.2, brandShare: 0.1, visitConversionRate: 0.2,
  weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1,
  dinnerMultiplier: 1, weatherEventMultiplier: 1, deliveryRatio: 0,
};
const policy: OperationPolicy = {
  model: { id: "test-restaurant", version: "1" },
  operatingWindows: [{ dayType: "weekday", startMinute: 600, endMinute: 1200 }],
  resources: { cooks: 1, servers: 1, cashiers: 1, kitchenConcurrentOrders: 1 },
  durations: { orderingSeconds: 30, cookingSeconds: 300, servingSeconds: 20, diningSeconds: 1200, paymentSeconds: 20, cleaningSeconds: 30 },
  averageSpendingPerCustomer: 0, currency: "KRW", assumptions: [],
};

describe("optional engine contracts", () => {
  it("preserves older policies and parameters and tracks hourly settings in lineage", () => {
    expect(() => validateOperation(policy)).not.toThrow();
    expect(() => validateDemandParameters(parameters)).not.toThrow();
    const hourly = { ...parameters, hourlyMultipliers: [{ dayType: "weekday" as const, hour: 12, multiplier: 2 }] };
    expect(() => validateDemandParameters(hourly)).not.toThrow();
    expect(demandParametersContentKey(hourly)).not.toEqual(demandParametersContentKey(parameters));
  });

  it.each([
    [{ dayType: "weekday", hour: 24, multiplier: 1 }],
    [{ dayType: "weekday", hour: 12, multiplier: -1 }],
    [{ dayType: "weekend", hour: 12, multiplier: 11 }],
    [{ dayType: "invalid", hour: 12, multiplier: 1 }],
    [{ dayType: "weekday", hour: 12, multiplier: 1 }, { dayType: "weekday", hour: 12, multiplier: 2 }],
  ])("rejects malformed or ambiguous hourly overrides %j", (...entries) => {
    expect(() => validateDemandParameters({ ...parameters, hourlyMultipliers: entries as DemandParameters["hourlyMultipliers"] })).toThrow();
  });

  it.each([
    [], [{ size: 0, probability: 1 }], [{ size: 1.5, probability: 1 }],
    [{ size: 1, probability: 0.5 }], [{ size: 1, probability: -1 }, { size: 2, probability: 2 }],
    [{ size: 1, probability: 0.5 }, { size: 1, probability: 0.5 }],
  ])("rejects invalid party distributions %j", (...entries) => {
    expect(() => validateOperation({ ...policy, partySizeDistribution: entries })).toThrow();
  });

  it("allows no timeout or zero patience but rejects negative patience", () => {
    for (const maxQueueWaitSeconds of [null, 0, 1800])
      expect(() => validateOperation({ ...policy, maxQueueWaitSeconds })).not.toThrow();
    expect(() => validateOperation({ ...policy, maxQueueWaitSeconds: -1 })).toThrow();
  });

  it("replaces distribution and hourly arrays through scenario overrides without sharing them", () => {
    const base: ProjectConfiguration = {
      layoutRef: null, market: null, demandParameters: parameters, demand: null,
      operation: { ...policy, partySizeDistribution: [{ size: 1, probability: 1 }] },
      simulation: null, financial: null,
    };
    const parties = [{ size: 2, probability: 1 }];
    const hourly = [{ dayType: "weekend" as const, hour: 12, multiplier: 3 }];
    const resolved = applyOverrides(base, {
      operation: { partySizeDistribution: parties, maxQueueWaitSeconds: null },
      demandParameters: { hourlyMultipliers: hourly },
    });
    expect(resolved.operation!.partySizeDistribution).toEqual(parties);
    resolved.operation!.partySizeDistribution![0].size = 4;
    expect(parties[0].size).toBe(2);
    expect(base.operation!.partySizeDistribution![0].size).toBe(1);
    resolved.demandParameters!.hourlyMultipliers![0].multiplier = 9;
    expect(hourly[0].multiplier).toBe(3);
  });
});
