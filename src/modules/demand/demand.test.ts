import { describe, expect, it } from "vitest";
import { canonicalJson, demandParametersContentKey, marketContentKey } from "../../core";
import type { DemandModel, DemandParameters, MarketProfile } from "../../core";
import { createDefaultDemandParameters, DEMAND_PARAMETER_DEFINITIONS, TransparentDemandModel } from "./index";

function market(): MarketProfile {
  return {
    id: "market-fixture", revision: 3,
    siteRef: { id: "site-fixture", revision: 2 }, siteContentKey: "independent-site-fixture",
    provider: { id: "independent-fixture", version: "1" },
    provenance: { kind: "demo", source: "Demand unit test synthetic observations" },
    period: { from: "2026-09-01T00:00:00Z", to: "2026-09-22T00:00:00Z" },
    buckets: [{ dayType: "weekday", hour: 12, population: 10000, footTrafficPersons: 1000 }],
    nearbyBusinesses: [], assumptions: [{ id: "coverage", description: "Synthetic fixture coverage", value: { radiusMeters: 300 }, unit: "meters", source: "fixture" }],
  };
}
const parameters = (overrides: Partial<DemandParameters> = {}) => createDefaultDemandParameters({
  categoryParticipationRate: 0.4, brandShare: 0.25, visitConversionRate: 0.2, ...overrides,
});
const model = new TransparentDemandModel();

describe("transparent demand conversion", () => {
  it("implements the existing port and distinguishes passers-by, category demand, selection and arrivals", () => {
    const port: DemandModel = model;
    const result = port.calculate({ market: market(), parameters: parameters() });
    expect(result.buckets[0].expectedCustomersPerHour).toBe(20);
    const bucket = model.calculate({ market: market(), parameters: parameters() }).buckets[0];
    expect(bucket).toMatchObject({
      potentialTraffic: 1000, categoryDemand: 400, selectedStoreDemand: 100, conversionRate: 0.2,
      expectedAllChannelCustomersPerHour: 20, expectedDeliveryCustomersPerHour: 0,
      expectedCustomersPerHour: 20, distribution: "poisson",
      timeBucket: { startMinute: 720, endMinute: 780, durationHours: 1 },
    });
  });

  it("multiplies day, meal, weather and hourly factors and explicitly separates delivery", () => {
    const result = model.calculate({ market: market(), parameters: parameters({
      weekdayMultiplier: 2, lunchMultiplier: 3, weatherEventMultiplier: 0.5,
      hourlyMultipliers: [{ dayType: "weekday", hour: 12, multiplier: 1.5 }], deliveryRatio: 0.25,
    }) });
    expect(result.buckets[0]).toMatchObject({
      multipliers: { day: 2, meal: 3, weatherEvent: 0.5, hourly: 1.5, combined: 4.5 },
      expectedAllChannelCustomersPerHour: 90, expectedDeliveryCustomersPerHour: 22.5, expectedCustomersPerHour: 67.5,
    });
    expect(result.assumptions.find((a) => a.id === "demand.channels")?.description).toContain("delivery kitchen load");
  });

  it("uses half-open lunch and dinner windows without boosting other hours", () => {
    const input = market();
    input.buckets = [10, 11, 13, 14, 16, 17, 20, 21].map((hour) => ({ ...input.buckets[0], hour }));
    const result = model.calculate({ market: input, parameters: parameters({ lunchMultiplier: 2, dinnerMultiplier: 3 }) });
    expect(result.buckets.map((b) => b.expectedCustomersPerHour)).toEqual([20, 40, 40, 20, 20, 60, 60, 20]);
  });

  it("applies weekend multipliers to holidays and scopes hourly overrides by both day and hour", () => {
    const input = market();
    input.buckets = (["weekday", "weekend", "holiday"] as const).map((dayType) => ({ ...input.buckets[0], dayType }));
    const result = model.calculate({ market: input, parameters: parameters({
      weekdayMultiplier: 2, weekendMultiplier: 3,
      hourlyMultipliers: [{ dayType: "weekend", hour: 12, multiplier: 2 }, { dayType: "holiday", hour: 13, multiplier: 4 }],
    }) });
    expect(result.buckets.map((b) => b.expectedCustomersPerHour)).toEqual([40, 120, 60]);
  });

  it.each([0, 1])("handles the delivery ratio endpoint %s without adding delivery arrivals", (deliveryRatio) => {
    const bucket = model.calculate({ market: market(), parameters: parameters({ deliveryRatio }) }).buckets[0];
    expect(bucket.expectedCustomersPerHour).toBe(20 * (1 - deliveryRatio));
    expect(bucket.expectedDeliveryCustomersPerHour + bucket.expectedCustomersPerHour).toBe(bucket.expectedAllChannelCustomersPerHour);
  });

  it.each(["categoryParticipationRate", "brandShare", "visitConversionRate", "weekdayMultiplier", "lunchMultiplier", "weatherEventMultiplier"] as const)("%s = 0 produces explicit zero arrivals", (key) => {
    expect(model.calculate({ market: market(), parameters: parameters({ [key]: 0 }) }).buckets[0].expectedCustomersPerHour).toBe(0);
  });

  it("keeps observed zero traffic distinct from missing traffic and never substitutes population", () => {
    const input = market();
    input.buckets[0].footTrafficPersons = 0;
    expect(model.calculate({ market: input, parameters: parameters() }).buckets[0].expectedCustomersPerHour).toBe(0);
    input.buckets[0].footTrafficPersons = null;
    expect(() => model.calculate({ market: input, parameters: parameters() })).toThrow(/population is not a substitute/);
  });

  it("does not add population, divide by observation days or invent unsupplied hours", () => {
    const input = market();
    const first = model.calculate({ market: input, parameters: parameters() });
    input.buckets[0].population = null;
    input.period.from = "2020-01-01T00:00:00Z";
    expect(model.calculate({ market: input, parameters: parameters() }).buckets).toEqual(first.buckets);
    expect(first.buckets).toHaveLength(1);
  });

  it("rejects an empty or duplicate market profile instead of returning fake zero demand", () => {
    const input = market();
    input.buckets = [];
    expect(() => model.calculate({ market: input, parameters: parameters() })).toThrow(/at least one/);
    input.buckets = [market().buckets[0], market().buckets[0]];
    expect(() => model.calculate({ market: input, parameters: parameters() })).toThrow(/duplicate/);
  });

  it("rejects overflow while permitting finite scenario multipliers above one", () => {
    const input = market(); input.buckets[0].footTrafficPersons = Number.MAX_VALUE;
    expect(() => model.calculate({ market: input, parameters: parameters({ weekdayMultiplier: Number.MAX_VALUE }) })).toThrow(/overflow/);
  });
});

describe("demand defaults, provenance and reproducibility", () => {
  it("provides defaults, units, descriptions and valid ranges for every parameter", () => {
    const defaults = createDefaultDemandParameters();
    expect(Object.keys(DEMAND_PARAMETER_DEFINITIONS)).toEqual([...Object.keys(defaults), "hourlyMultipliers"]);
    for (const [key, value] of Object.entries(defaults)) {
      const definition = DEMAND_PARAMETER_DEFINITIONS[key as keyof typeof defaults];
      expect(value).toBe(definition.defaultValue);
      expect(definition.unit.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(20);
      expect(value).toBeGreaterThanOrEqual(definition.validRange.min);
      expect(value).toBeLessThanOrEqual(definition.validRange.max);
    }
  });

  it.each<Partial<DemandParameters>>([
    { brandShare: 1.01 }, { visitConversionRate: -0.1 }, { deliveryRatio: Infinity },
    { weekdayMultiplier: -1 }, { weatherEventMultiplier: NaN },
    { hourlyMultipliers: [{ dayType: "weekday", hour: 24, multiplier: 1 }] },
    { hourlyMultipliers: [{ dayType: "weekday", hour: 12, multiplier: 10.1 }] },
    { hourlyMultipliers: [{ dayType: "weekday", hour: 12, multiplier: 1 }, { dayType: "weekday", hour: 12, multiplier: 2 }] },
  ])("rejects invalid parameter values at the entry boundary: %j", (overrides) => {
    expect(() => createDefaultDemandParameters(overrides)).toThrow();
    expect(() => model.calculate({ market: market(), parameters: { ...parameters(), ...overrides } })).toThrow();
  });

  it("tracks exact upstream content and optional hourly parameters, including subsequent edits", () => {
    const input = market();
    const values = parameters({ hourlyMultipliers: [{ dayType: "weekday", hour: 12, multiplier: 2 }] });
    const result = model.calculate({ market: input, parameters: values });
    expect(result.lineage).toEqual({ marketRef: { id: input.id, revision: input.revision }, marketContentKey: marketContentKey(input), parametersContentKey: demandParametersContentKey(values) });
    values.hourlyMultipliers![0].multiplier = 3;
    expect(result.lineage.parametersContentKey).not.toBe(demandParametersContentKey(values));
    input.buckets[0].footTrafficPersons = 2000;
    expect(result.lineage.marketContentKey).not.toBe(marketContentKey(input));
  });

  it("retains demo labels and states that real observations still produce derived scenario expectations", () => {
    const input = market();
    const demo = model.calculate({ market: input, parameters: parameters() });
    expect(demo.provenance.kind).toBe("demo");
    expect(demo.assumptions.find((a) => a.id === "demand.interpretation")?.description).toContain("not a guaranteed future forecast");
    input.provenance.kind = "observed";
    const derived = model.calculate({ market: input, parameters: parameters() });
    expect(derived.provenance.kind).toBe("derived");
    expect(derived.assumptions.find((a) => a.id === "demand.marketSource")?.value).toMatchObject({ provenance: { kind: "observed" } });
  });

  it("is repeatable, preserves inputs and returns detached data and assumptions", () => {
    const input = market(), values = parameters();
    const before = canonicalJson({ input, values });
    const first = model.calculate({ market: input, parameters: values });
    expect(model.calculate({ market: input, parameters: values })).toEqual(first);
    expect(canonicalJson({ input, values })).toBe(before);
    const source = first.assumptions.find((a) => a.id === "demand.marketSource")!;
    (source.value as { assumptions: unknown[] }).assumptions.push({ mutation: true });
    first.buckets[0].potentialTraffic = 1;
    expect(canonicalJson({ input, values })).toBe(before);
    expect(model.calculate({ market: input, parameters: values }).buckets[0].potentialTraffic).toBe(1000);
  });

  it("allows explicit artifact revisions and deterministic arrivals while copying constructor options", () => {
    const profileRef = { id: "scenario-demand", revision: 7 };
    const alternate = new TransparentDemandModel({ profileRef, distribution: "deterministic" });
    profileRef.revision = 99;
    const result = alternate.calculate({ market: market(), parameters: parameters() });
    expect(result.id).toBe("scenario-demand"); expect(result.revision).toBe(7);
    expect(result.buckets[0].distribution).toBe("deterministic");
    expect(result.assumptions.find((a) => a.id === "demand.arrivalDistribution")?.value).toBe("deterministic");
  });
});
