import { describe, expect, it } from "vitest";
import { canonicalJson, demandParametersContentKey, type DeliveryDemandBucket, type MarketProfile } from "../../core";
import { createDefaultDemandParameters, DELIVERY_DEMAND_PARAMETER_DEFINITION, TransparentDemandModel } from "./index";

const market: MarketProfile = {
  id: "independent-fixture", revision: 1, siteRef: { id: "site", revision: 1 }, siteContentKey: "fixture",
  provider: { id: "synthetic-test", version: "1" }, provenance: { kind: "demo", source: "independent channel unit test" },
  period: { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" },
  buckets: [{ dayType: "weekday", hour: 12, population: null, footTrafficPersons: 1000 }], nearbyBusinesses: [], assumptions: [],
};
const bucket = (expectedOrdersPerHour: number): DeliveryDemandBucket => ({ dayType: "weekday", hour: 12, expectedOrdersPerHour, distribution: "deterministic" });

describe("explicit independent delivery demand", () => {
  it("preserves dine-in intensity while adding an independent orders/hour profile", () => {
    const model = new TransparentDemandModel();
    const base = createDefaultDemandParameters({ categoryParticipationRate: 0.4, brandShare: 0.25, visitConversionRate: 0.2 });
    const before = model.calculate({ market, parameters: base });
    const parameters = { ...base, deliveryOrdersByHour: [bucket(37)] };
    const result = model.calculate({ market, parameters });
    expect(result.buckets[0].expectedCustomersPerHour).toBe(20);
    expect(result.buckets).toEqual(before.buckets);
    expect(result.deliveryBuckets).toEqual([bucket(37)]);
    expect(result.buckets[0].expectedDeliveryCustomersPerHour).toBe(0);
    expect(result.assumptions.find(assumption => assumption.id === "demand.channels")?.description).toContain("independent");
    expect(result.lineage.parametersContentKey).toBe(demandParametersContentKey(parameters));
    expect(DELIVERY_DEMAND_PARAMETER_DEFINITION.unit).toBe("orders/hour");
  });

  it("keeps legacy deliveryRatio split behavior and requires an explicit migration to independent orders", () => {
    const model = new TransparentDemandModel();
    const legacy = createDefaultDemandParameters({ deliveryRatio: 0.25 });
    const result = model.calculate({ market, parameters: legacy });
    expect(result.deliveryBuckets).toBeUndefined();
    expect(result.buckets[0].expectedCustomersPerHour).toBeCloseTo(result.buckets[0].expectedAllChannelCustomersPerHour * 0.75);
    expect(() => model.calculate({ market, parameters: { ...legacy, deliveryOrdersByHour: [bucket(1)] } })).toThrow(/deliveryRatio/);
  });

  it("does not infer missing hours, apply traffic multipliers to order assumptions, or alias inputs", () => {
    const model = new TransparentDemandModel();
    const parameters = createDefaultDemandParameters({ deliveryOrdersByHour: [bucket(13)], weekdayMultiplier: 8 });
    const input = canonicalJson({ market, parameters });
    const result = model.calculate({ market, parameters });
    expect(result.deliveryBuckets).toEqual([bucket(13)]);
    result.deliveryBuckets![0].expectedOrdersPerHour = 99;
    expect(canonicalJson({ market, parameters })).toBe(input);
    const empty = model.calculate({ market, parameters: { ...parameters, deliveryOrdersByHour: [] } });
    expect(empty.deliveryBuckets).toEqual([]);
  });

  it("rejects negative, nonfinite, duplicate or invalid-hour order buckets", () => {
    const model = new TransparentDemandModel();
    for (const buckets of [[bucket(-1)], [bucket(Infinity)], [bucket(2), bucket(3)], [{ ...bucket(1), hour: 24 }]]) {
      expect(() => model.calculate({ market, parameters: { ...createDefaultDemandParameters(), deliveryOrdersByHour: buckets } })).toThrow();
    }
  });
});
