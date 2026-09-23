import { describe, expect, it } from "vitest";
import {
  completeSimulationRun, createProject, createScenario, demandParametersContentKey,
  isFinancialResultStale, marketContentKey, prepareSimulationRun, siteContentKey, updateProjectBase,
  type DayType, type DemandParameters, type FinancialAssumption, type MarketProfile,
  type OperationPolicy, type SimulationResult, type SimulationRun, type Site, type StoreLayout,
} from "../../core";
import { TransparentFinancialEngine } from "./index";

const engine = new TransparentFinancialEngine();
const createdAt = "2026-09-23T00:00:00Z", completedAt = "2026-09-23T01:00:00Z";
const site: Site = { id: "site", revision: 1, name: "Synthetic finance fixture", address: null, coordinates: null, timeZone: "Asia/Seoul" };
const parameters: DemandParameters = {
  categoryParticipationRate: 0.1, brandShare: 0.1, visitConversionRate: 0.1,
  weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1, dinnerMultiplier: 1,
  weatherEventMultiplier: 1, deliveryRatio: 0,
};
const dayTypes: DayType[] = ["weekday", "weekend", "holiday"];
function policy(): OperationPolicy {
  return {
    model: { id: "analytic-fixture", version: "1" },
    operatingWindows: dayTypes.map(dayType => ({ dayType, startMinute: 0, endMinute: 1440 })),
    resources: { cooks: 2, servers: 3, cashiers: 1, kitchenConcurrentOrders: 4 },
    durations: { orderingSeconds: 1, cookingSeconds: 1, servingSeconds: 1, diningSeconds: 1, paymentSeconds: 1, cleaningSeconds: 1 },
    averageSpendingPerCustomer: 10, currency: "KRW", assumptions: [],
    delivery: { packagingSeconds: 1, maxQueueWaitSeconds: null },
  };
}
function assumption(overrides: Partial<FinancialAssumption> = {}): FinancialAssumption {
  return {
    id: "finance", revision: 1, currency: "KRW", operatingDaysPerMonth: 26,
    operatingDayMix: [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: 1 }],
    foodCostRatio: 0.3, royaltyRatio: 0.05, deliveryFeeRatio: 0.1,
    averageSpendingPerCustomer: 10, averageDeliveryOrderValue: 20, paymentFeeRatio: 0.02,
    deliveryVariableCostPerOrder: 2,
    monthlyRent: 1000, monthlyLabor: 5000, monthlyUtilities: 200, monthlyMaintenance: 100,
    monthlyMarketing: 300, monthlyInsurance: 50, monthlyOtherFixed: 150,
    initialCapex: 1000, initialFranchiseFee: 2000, initialInteriorCost: 3000,
    initialEquipmentCost: 4000, initialOtherInvestment: 5000, refundableDeposit: 6000,
    assumptions: [], ...overrides,
  };
}
interface RunOptions {
  id?: string; seed?: number; dayType?: DayType; customers?: number; orders?: number;
  startMinute?: number; durationSeconds?: number; operation?: OperationPolicy;
  scenarioId?: string; withDeliveryDemand?: boolean;
}
/** Analytic completed counts, not stochastic DES outcomes; finance tests isolate arithmetic. */
function run(options: RunOptions = {}): SimulationRun {
  const { id = "run-1", seed = 1, dayType = "weekday", customers = 100, orders = 20,
    startMinute = 60, durationSeconds = 3600 } = options;
  const element = (id: string, type: string, kind: "object" | "door" = "object") => ({
    id, type, kind, name: id, x: 0, y: 0, z: 0, width: 1000, depth: 1000, height: 1000,
    rotationDegrees: 0, confidence: 1, source: "analytic fixture", reviewed: true,
  });
  const layout: StoreLayout = {
    schemaVersion: 1, id: "layout", revision: 1, storeId: site.id,
    source: { format: "floorplan-json", documentId: "fixture", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 10000, depth: 10000 },
      elements: [element("table", "table"), element("entry", "door", "door"), element("kitchen", "range"), element("service", "counter")] },
    totalAreaM2: 100, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount: 1, chairCount: 0, confirmedCapacity: 1,
    assignments: { entranceIds: ["entry"], tables: [{ elementId: "table", capacity: 1 }], kitchenStationIds: ["kitchen"], serviceStationIds: ["service"], zoneRoles: [] },
    assumptions: [], issues: [],
  };
  const market: MarketProfile = {
    id: "market", revision: 1, siteRef: { id: site.id, revision: site.revision }, siteContentKey: siteContentKey(site),
    provider: { id: "analytic-market", version: "1" }, provenance: { kind: "demo", source: "synthetic analytic fixture" },
    period: { from: "2026-09-01T00:00:00Z", to: createdAt },
    buckets: dayTypes.flatMap(dayType => Array.from({ length: 24 }, (_, hour) => ({ dayType, hour, population: 1000, footTrafficPersons: 1000 }))),
    nearbyBusinesses: [], assumptions: [],
  };
  let project = createProject({ id: "project", name: "Analytic fixture", site, layout, createdAt });
  project = updateProjectBase(project, {
    market, demandParameters: parameters,
    demand: {
      id: "demand", revision: 1, model: { id: "analytic-demand", version: "1" }, provenance: { kind: "demo", source: "analytic fixture" },
      lineage: { marketRef: { id: market.id, revision: market.revision }, marketContentKey: marketContentKey(market), parametersContentKey: demandParametersContentKey(parameters) },
      buckets: dayTypes.flatMap(dayType => Array.from({ length: 24 }, (_, hour) => ({ dayType, hour, expectedCustomersPerHour: 1000, distribution: "deterministic" as const }))),
      ...(options.withDeliveryDemand ? { deliveryBuckets: [{ dayType, hour: 1, expectedOrdersPerHour: 20, distribution: "deterministic" as const }] } : {}),
      assumptions: [],
    },
    operation: options.operation ?? policy(),
    simulation: { seed, dayType, startMinute, durationSeconds, replications: 1 }, financial: assumption(),
  }, createdAt);
  if (options.scenarioId) project = createScenario(project, { id: options.scenarioId, name: options.scenarioId, createdAt, overrides: {} });
  const prepared = prepareSimulationRun(project, { id, engine: { id: "analytic-engine", version: "1" }, createdAt, scenarioId: options.scenarioId });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.issues));
  const result: SimulationResult = {
    runId: id, customersArrived: customers, customersServed: customers, customersLost: 0, customersUnfinished: 0,
    averageWaitingSeconds: 0, maxWaitingSeconds: 0, throughputCustomersPerHour: customers * 3600 / durationSeconds,
    tableUtilization: 0.5, kitchenUtilization: 0.5, staffUtilization: 0.5, averageCustomerTimeInSystemSeconds: 6,
    revenue: 0, revenueStatus: "not-modeled", currency: (options.operation ?? policy()).currency, revenueByHour: [], bottlenecks: [], assumptions: [],
    delivery: {
      ordersArrived: orders, ordersCompleted: orders, ordersLost: 0, ordersUnfinished: 0,
      throughputOrdersPerHour: orders * 3600 / durationSeconds,
      averageKitchenWaitingSeconds: 0, maxKitchenWaitingSeconds: 0,
      averageTimeInSystemSeconds: 1,
      hourlyThroughput: [{ hour: Math.floor(startMinute / 60), ordersCompleted: orders }],
    },
  };
  return completeSimulationRun(prepared.run, result, completedAt);
}

describe("TransparentFinancialEngine", () => {
  it("matches hand-calculated mixed-channel monthly revenue, cost lines, profit and simple payback", () => {
    const financial = assumption({ operatingDayMix: [
      { dayType: "weekday", daysPerMonth: 20, runToDayMultiplier: 2 },
      { dayType: "weekend", daysPerMonth: 6, runToDayMultiplier: 1 },
    ] });
    const result = engine.calculate({ simulationRuns: [
      run({ id: "week-1", seed: 1, customers: 80, orders: 10 }),
      run({ id: "week-2", seed: 2, customers: 120, orders: 30 }),
      run({ id: "end-1", seed: 1, dayType: "weekend", customers: 300, orders: 100 }),
    ], assumption: financial });
    expect(result.monthlyDineInCustomers).toBe(5800);
    expect(result.monthlyDeliveryOrders).toBe(1400);
    expect(result.monthlyDineInRevenue).toBe(58000);
    expect(result.monthlyDeliveryRevenue).toBe(28000);
    expect(result.monthlyRevenue).toBe(86000);
    expect(result.foodMaterialCost).toBe(25800);
    expect(result.paymentFees).toBe(1720);
    expect(result.deliveryPlatformFees).toBe(2800);
    expect(result.deliveryVariableCost).toBe(2800);
    expect(result.royaltyCost).toBe(4300);
    expect(result.variableCost).toBe(37420);
    expect(result.otherFixedCosts).toBe(800);
    expect(result.fixedCost).toBe(6800);
    expect(result.contribution).toBe(48580);
    expect(result.operatingProfit).toBe(41780);
    expect(result.operatingMargin).toBeCloseTo(41780 / 86000);
    expect(result.breakEvenRevenue).toBeCloseTo(6800 / (48580 / 86000));
    expect(result.breakEvenDailyDineInCustomers).toBeCloseTo(5800 * 6800 / 48580 / 26);
    expect(result.breakEvenDailyDeliveryOrders).toBeCloseTo(1400 * 6800 / 48580 / 26);
    expect(result.breakEvenDailyCustomersOrOrders).toBeCloseTo(7200 * 6800 / 48580 / 26);
    expect(result.observedThroughputMarginPerDay).toBeCloseTo(7200 / 26 - result.breakEvenDailyCustomersOrOrders!);
    expect(result.capacityComparisonBasis).toContain("not-maximum-capacity");
    expect(result.breakEvenCustomers).toBeNull();
    expect(result.nullReasons.breakEvenCustomers).toMatch(/distinct units/);
    expect(result.nonRefundableInvestment).toBe(15000);
    expect(result.initialInvestment).toBe(21000);
    expect(result.estimatedPaybackMonths).toBeCloseTo(15000 / 41780);
    expect(result.conditions.replicationCount).toBe(3);
    expect(result.conditions.dayEstimates[0].meanCompletedDineInCustomersPerRun).toBe(100);
  });

  it("averages replicas instead of multiplying revenue by replication count", () => {
    const first = run({ seed: 1 }), second = run({ id: "run-2", seed: 2 });
    const one = engine.calculate({ simulationRuns: [first], assumption: assumption() });
    const two = engine.calculate({ simulationRuns: [first, second], assumption: assumption() });
    expect(two.monthlyRevenue).toBe(one.monthlyRevenue);
    expect(two.operatingProfit).toBe(one.operatingProfit);
    expect(two.conditions.dayEstimates[0].seeds).toEqual([1, 2]);
    expect(two.conditions.runInputContentKeys).toHaveLength(2);
  });

  it("uses explicit horizon scaling and exposes the observed minutes without assuming full days", () => {
    const completed = run({ durationSeconds: 1800 });
    const single = engine.calculate({ simulationRuns: [completed], assumption: assumption() });
    const expanded = engine.calculate({ simulationRuns: [completed], assumption: assumption({ operatingDayMix: [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: 4 }] }) });
    expect(expanded.monthlyRevenue).toBe(single.monthlyRevenue * 4);
    expect(expanded.laborCost).toBe(single.laborCost);
    expect(expanded.conditions.dayEstimates[0].durationMinutes).toBe(30);
    const unspecified = assumption(); delete unspecified.operatingDayMix;
    expect(() => engine.calculate({ simulationRuns: [completed], assumption: unspecified })).toThrow(/explicit day weights/);
  });

  it("links monthly worker costs to the actual operation resources without daily rescaling", () => {
    const financial = assumption({ monthlyLabor: 0, labor: {
      mode: "operation-linked", monthlyCostPerCook: 300, monthlyCostPerServer: 200,
      monthlyCostPerCashier: 100, otherStaffCount: 2, monthlyCostPerOtherStaff: 50,
    } });
    const result = engine.calculate({ simulationRuns: [run()], assumption: financial });
    expect(result.laborCost).toBe(1400);
    expect(result.conditions.laborResources).toEqual({ cooks: 2, servers: 3, cashiers: 1, otherStaff: 2 });
    const expanded = policy(); expanded.resources.cooks = 3;
    const moreCooks = engine.calculate({ simulationRuns: [run({ operation: expanded })], assumption: financial });
    expect(moreCooks.laborCost).toBe(1700);
    expect(moreCooks.operatingProfit).toBe(result.operatingProfit - 300);
    expect(() => engine.calculate({ simulationRuns: [run()], assumption: { ...financial, monthlyLabor: 1 } })).toThrow(/monthlyLabor|double|zero/i);
  });

  it("supports legacy assumptions with explicit day scaling and operation customer price", () => {
    const financial = assumption(); delete financial.averageSpendingPerCustomer;
    const completed = structuredClone(run({ orders: 0 })); delete completed.result!.delivery;
    const result = engine.calculate({ simulationRuns: [completed], assumption: financial });
    expect(result.monthlyRevenue).toBe(26000);
    expect(result.conditions.spendingSource).toBe("operation-policy");
    expect(result.breakEvenCustomers).toBe(result.breakEvenCustomersOrOrders);
    expect(result.breakEvenDailyDeliveryOrders).toBe(0);
  });

  it("overrides operation spending explicitly and includes assumptions and demand/run lineage", () => {
    const completed = run({ scenarioId: "custom", orders: 0 });
    const financial = assumption({ averageSpendingPerCustomer: 30, assumptions: [{ id: "manual-price", description: "Synthetic price", value: 30, unit: "KRW/customer", source: "test" }] });
    const result = engine.calculate({ simulationRuns: [completed], assumption: financial });
    expect(result.monthlyRevenue).toBe(78000);
    expect(result.conditions.scenarioRef).toEqual({ id: "custom", revision: 1 });
    expect(result.input.simulationRuns[0].snapshot.lineage.demandParameters).toEqual(parameters);
    expect(result.assumptions.some(a => a.id === "manual-price")).toBe(true);
    expect(result.status).toBe("conditional-estimate");
    expect(isFinancialResultStale(result, [completed], financial, engine.descriptor)).toBe(false);
    financial.monthlyRent = 1200;
    expect(isFinancialResultStale(result, [completed], financial, engine.descriptor)).toBe(true);
    expect(result.input.assumption.monthlyRent).toBe(1000);
  });

  it.each([0, -100])("returns null and reasons instead of invalid payback at operating profit %i", profit => {
    const financial = assumption({ operatingDaysPerMonth: 1, operatingDayMix: [{ dayType: "weekday", daysPerMonth: 1, runToDayMultiplier: 1 }],
      foodCostRatio: 0, paymentFeeRatio: 0, royaltyRatio: 0, monthlyRent: 1000 - profit,
      monthlyLabor: 0, monthlyUtilities: 0, monthlyMaintenance: 0, monthlyMarketing: 0, monthlyInsurance: 0, monthlyOtherFixed: 0 });
    const result = engine.calculate({ simulationRuns: [run({ customers: 100, orders: 0 })], assumption: financial });
    expect(result.operatingProfit).toBe(profit);
    expect(result.estimatedPaybackMonths).toBeNull();
    expect(result.nullReasons.estimatedPaybackMonths).toMatch(/nonpositive/);
  });

  it.each([1, 1.1])("does not invent break-even for nonpositive contribution at variable ratio %f", totalRatio => {
    const result = engine.calculate({ simulationRuns: [run({ orders: 0 })], assumption: assumption({ foodCostRatio: 1, paymentFeeRatio: totalRatio - 1, royaltyRatio: 0 }) });
    expect(result.contribution).toBeLessThanOrEqual(0);
    expect(result.breakEvenRevenue).toBeNull();
    expect(result.breakEvenDailyCustomersOrOrders).toBeNull();
    expect(result.nullReasons.breakEven).toMatch(/nonpositive/);
    expect(result.estimatedPaybackMonths).toBeNull();
  });

  it("handles zero demand without NaN, Infinity or fabricated channel-mix capacity", () => {
    const result = engine.calculate({ simulationRuns: [run({ customers: 0, orders: 0 })], assumption: assumption() });
    expect(result.monthlyRevenue).toBe(0);
    expect(result.operatingProfit).toBe(-6800);
    expect(result.operatingMargin).toBeNull();
    expect(result.contributionMargin).toBeNull();
    expect(result.breakEvenRevenue).toBeNull();
    expect(result.observedThroughputMarginPerDay).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it("reports a negative observed throughput margin without calling it maximum physical capacity", () => {
    const result = engine.calculate({ simulationRuns: [run({ customers: 1, orders: 0 })], assumption: assumption() });
    expect(result.observedThroughputMarginPerDay).toBeLessThan(0);
    expect(result.capacityComparisonBasis).toContain("observed-throughput");
    expect(result.capacityComparisonBasis).toContain("not-maximum-capacity");
  });

  it.each([
    [{ dayType: "weekday", daysPerMonth: 25, runToDayMultiplier: 1 }],
    [{ dayType: "weekday", daysPerMonth: 13, runToDayMultiplier: 1 }, { dayType: "weekday", daysPerMonth: 13, runToDayMultiplier: 1 }],
    [{ dayType: "weekend", daysPerMonth: 26, runToDayMultiplier: 1 }],
    [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: 0 }],
    [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: -1 }],
  ])("rejects inconsistent, duplicate, absent or nonpositive day scaling %j", (...mix) => {
    expect(() => engine.calculate({ simulationRuns: [run()], assumption: assumption({ operatingDayMix: mix as FinancialAssumption["operatingDayMix"] }) })).toThrow();
  });

  it("rejects duplicate run IDs and duplicate same-day seeds", () => {
    expect(() => engine.calculate({ simulationRuns: [run(), run()], assumption: assumption() })).toThrow(/duplicate run/);
    expect(() => engine.calculate({ simulationRuns: [run(), run({ id: "run-2" })], assumption: assumption() })).toThrow(/duplicate seeds/);
  });

  it("rejects inconsistent observation horizons, operation, and scenario lineage", () => {
    const first = run();
    expect(() => engine.calculate({ simulationRuns: [first, run({ id: "run-2", seed: 2, durationSeconds: 1800 })], assumption: assumption() })).toThrow(/horizon/);
    const operation = policy(); operation.resources.cooks = 5;
    expect(() => engine.calculate({ simulationRuns: [first, run({ id: "run-2", seed: 2, operation })], assumption: assumption() })).toThrow(/mixed/);
    expect(() => engine.calculate({ simulationRuns: [first, run({ id: "run-2", seed: 2, scenarioId: "other" })], assumption: assumption() })).toThrow(/mixed/);
  });

  it("rejects mismatched currency, result/run references, corrupt snapshots and incomplete runs", () => {
    expect(() => engine.calculate({ simulationRuns: [run()], assumption: assumption({ currency: "USD" }) })).toThrow(/currency/);
    const wrongResult = structuredClone(run()); wrongResult.result!.runId = "unrelated";
    expect(() => engine.calculate({ simulationRuns: [wrongResult], assumption: assumption() })).toThrow(/another run/);
    const corrupt = structuredClone(run()); corrupt.snapshot.input.config.seed = 77;
    expect(() => engine.calculate({ simulationRuns: [corrupt], assumption: assumption() })).toThrow(/modified/);
    const incomplete = structuredClone(run()); incomplete.status = "failed";
    expect(() => engine.calculate({ simulationRuns: [incomplete], assumption: assumption() })).toThrow(/completed/);
  });

  it("requires delivery order pricing and refuses to treat missing delivery results as zero", () => {
    const missingPrice = assumption(); delete missingPrice.averageDeliveryOrderValue;
    expect(() => engine.calculate({ simulationRuns: [run()], assumption: missingPrice })).toThrow(/order value/);
    const missingDelivery = structuredClone(run({ withDeliveryDemand: true })); delete missingDelivery.result!.delivery;
    expect(() => engine.calculate({ simulationRuns: [missingDelivery], assumption: assumption() })).toThrow(/delivery.*(missing|requires)/);
  });

  it("does not use legacy DES revenue placeholders or mutate caller inputs", () => {
    const completed = structuredClone(run()); delete completed.result!.revenueStatus;
    completed.result!.revenue = 99999999;
    const input = { simulationRuns: [completed], assumption: assumption() };
    const before = JSON.stringify(input);
    const first = engine.calculate(input), second = engine.calculate(input);
    expect(first.monthlyRevenue).toBe(36400);
    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(before);
    first.input.simulationRuns[0].result!.customersServed = 0;
    expect(input.simulationRuns[0].result!.customersServed).toBe(100);
  });
});
