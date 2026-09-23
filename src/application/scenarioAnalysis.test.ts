import { describe, expect, it } from "vitest";
import {
  canonicalJson, createProject, createScenario, updateProjectBase,
  type FinancialAssumption, type MarketProvider, type Project, type Site,
} from "../core";
import { MockMarketProvider } from "../modules/market";
import { createDefaultDemandParameters, TransparentDemandModel } from "../modules/demand";
import { createRestaurantPolicy, restaurantOperationModel } from "../modules/operation";
import { discreteEventSimulationEngine } from "../modules/simulation";
import { TransparentFinancialEngine } from "../modules/financial";
import { runOneWaySensitivity, type ScenarioEvaluation } from "../modules/scenario";
import { toStoreLayout } from "../modules/space";
import { createSamplePlan } from "../modules/space/sample";
import { compareStoreScenarios, createComparisonScenarios, type ScenarioSelection } from "./scenarioAnalysis";

const now = "2026-09-23T00:00:00Z", later = "2026-09-23T00:01:00Z";
const period = { from: "2026-09-01T00:00:00Z", to: "2026-09-22T00:00:00Z" };
const replication = { count: 3, seedStrategy: "sequential" as const, baseSeed: 1001 };
const modules = {
  marketProvider: new MockMarketProvider(), demandModel: new TransparentDemandModel(),
  operationModel: restaurantOperationModel, simulationEngine: discreteEventSimulationEngine,
  financialEngine: new TransparentFinancialEngine(),
};
const site: Site = { id: "comparison-site", revision: 1, name: "Synthetic comparison only", address: null, coordinates: null, timeZone: "Asia/Seoul" };

function readyProject(): Project {
  const plan = createSamplePlan();
  const layout = toStoreLayout(plan, {
    id: "comparison-layout", revision: 1, storeId: site.id, documentId: "bundled-sample", documentRevision: 1,
    mapping: {
      entranceIds: ["door-entry"], kitchenStationIds: ["range"], serviceStationIds: ["self-bar"],
      tableCapacities: Object.fromEntries(plan.objects.filter(o => o.type === "table").map(o => [o.id, 4])),
      zoneRoles: { "zone-dining": "hall", "zone-kitchen": "kitchen", "zone-corridor": "service" },
    },
  });
  const operation = createRestaurantPolicy();
  operation.operatingWindows = [{ dayType: "weekday", startMinute: 660, endMinute: 900 }];
  operation.resources = { cooks: 2, kitchenConcurrentOrders: 2, servers: 4, cashiers: 2 };
  operation.durations = { orderingSeconds: 10, cookingSeconds: 300, servingSeconds: 10, diningSeconds: 300, paymentSeconds: 10, cleaningSeconds: 10 };
  operation.maxQueueWaitSeconds = 600;
  operation.delivery = { packagingSeconds: 20, maxQueueWaitSeconds: 1200 };
  const financial: FinancialAssumption = {
    id: "comparison-finance", revision: 1, currency: "KRW", operatingDaysPerMonth: 26,
    operatingDayMix: [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: 1 }],
    averageSpendingPerCustomer: 12000, averageDeliveryOrderValue: 20000,
    foodCostRatio: 0.3, paymentFeeRatio: 0.02, royaltyRatio: 0.01, deliveryFeeRatio: 0.15,
    deliveryVariableCostPerOrder: 500,
    monthlyRent: 2000000, monthlyLabor: 5000000, monthlyUtilities: 500000,
    monthlyMarketing: 200000, monthlyOtherFixed: 100000, monthlyMaintenance: 100000, monthlyInsurance: 100000,
    initialCapex: 0, initialFranchiseFee: 10000000, initialInteriorCost: 30000000,
    initialEquipmentCost: 10000000, refundableDeposit: 20000000, assumptions: [],
  };
  return updateProjectBase(createProject({ id: "comparison-project", name: "Phase 6–7 synthetic fixture", site, layout, createdAt: now }), {
    demandParameters: createDefaultDemandParameters({ categoryParticipationRate: 0.5, brandShare: 0.5, visitConversionRate: 0.1,
      deliveryOrdersByHour: [11, 12, 13, 14].map(hour => ({ dayType: "weekday", hour, expectedOrdersPerHour: 3, distribution: "deterministic" })),
    }), operation, financial,
    simulation: { seed: 1001, durationSeconds: 4 * 3600, startMinute: 660, dayType: "weekday", replications: 1 },
  }, now);
}
const compare = (project: Project, selections: ScenarioSelection[], injected: Omit<typeof modules, "marketProvider"> & { marketProvider: MarketProvider } = modules) => compareStoreScenarios({
  project, selections, period, replication, runIdPrefix: "comparison", startedAt: now, completedAt: later, modules: injected,
});
function succeeded<T extends ScenarioEvaluation>(value: T): Extract<T, { ok: true }> {
  expect(value.ok, JSON.stringify(value.issues)).toBe(true);
  if (!value.ok) throw new Error(JSON.stringify(value.issues));
  return value as Extract<T, { ok: true }>;
}

describe("StoreLayout → Market → dual demand → DES → replication → finance → comparison → sensitivity", () => {
  it("compares all four named scenarios with reproducible runs, channel units and full conditional context", async () => {
    const input = createComparisonScenarios(readyProject(), { idPrefix: "standard", createdAt: now,
      customOverrides: { operation: { resources: { cooks: 3, kitchenConcurrentOrders: 3 } } },
    });
    const before = canonicalJson(input.project), first = await compare(input.project, input.selections);
    expect(first.ok, JSON.stringify(first.issues)).toBe(true);
    expect(canonicalJson(input.project)).toBe(before);
    expect(first.rows.map(row => row.kind)).toEqual(["Conservative", "Baseline", "Optimistic", "Custom"]);
    expect(first.rows.every(row => row.demand?.expectedDeliveryOrders === 12)).toBe(true);
    expect(first.rows[0].demand!.expectedDineInCustomers).toBeLessThan(first.rows[1].demand!.expectedDineInCustomers);
    expect(first.rows[2].demand!.expectedDineInCustomers).toBeGreaterThan(first.rows[1].demand!.expectedDineInCustomers);
    for (const row of first.rows) {
      const evaluated = succeeded(row.evaluation);
      expect(evaluated.replication.seeds).toEqual([1001, 1002, 1003]);
      expect(evaluated.aggregate.metrics.customersServed.count).toBe(3);
      expect(evaluated.runs.every(run => run.result!.delivery!.ordersArrived === 12)).toBe(true);
      expect(evaluated.financial!.monthlyRevenue).toBeGreaterThan(0);
      expect(evaluated.financial!.status).toBe("conditional-estimate");
      expect(evaluated.financial!.conditions.scenarioRef?.id).toBe(row.scenarioId);
      expect(evaluated.financial!.conditions.replicationCount).toBe(3);
      expect(evaluated.financial!.conditions.dayEstimates[0].seeds).toEqual([1001, 1002, 1003]);
      expect(evaluated.financial!.input.simulationRuns).toHaveLength(3);
      expect(evaluated.financial!.refundableDeposit).toBe(20000000);
      expect(evaluated.resolved.layout!.geometry.elements).toHaveLength(157);
    }
    const second = await compare(input.project, input.selections);
    expect(second.rows).toEqual(first.rows);
    const sensitivity = await runOneWaySensitivity({
      project: first.project, scenarioId: "standard-baseline", replication, runIdPrefix: "price", scenarioIdPrefix: "price-point",
      startedAt: now, completedAt: later, modules,
      parameter: { path: "financial.averageSpendingPerCustomer", label: "Dine-in spend", unit: "KRW/customer", description: "Relative price assumption" },
      values: [{ kind: "percentage-change", percent: -10 }, { kind: "absolute", value: 12000 }, { kind: "percentage-change", percent: 10 }],
    });
    const points = sensitivity.results.map(point => succeeded(point.evaluation));
    [0.9, 1, 1.1].forEach((factor, index) =>
      expect(points[index].financial!.monthlyDineInRevenue).toBeCloseTo(points[1].financial!.monthlyDineInRevenue * factor, 2));
    expect(points.map(point => point.aggregate.metrics.customersServed.mean)).toEqual(Array(3).fill(points[0].aggregate.metrics.customersServed.mean));
  }, 15000);

  it("shows low-demand losses, viable moderate demand and capacity-limited revenue at excessive demand", async () => {
    let project = readyProject();
    const selections: ScenarioSelection[] = [];
    for (const [id, conversion] of [["low", 0.01], ["moderate", 0.1], ["excessive", 0.5], ["double-excessive", 1]] as const) {
      project = createScenario(project, { id, name: id, createdAt: now, overrides: { demandParameters: { visitConversionRate: conversion } } });
      selections.push({ scenarioId: id, kind: "Custom" });
    }
    const output = await compare(project, selections, { ...modules, demandModel: new TransparentDemandModel({ distribution: "deterministic" }) });
    expect(output.ok, JSON.stringify(output.issues)).toBe(true);
    const [low, moderate, excessive, doubled] = output.rows.map(row => succeeded(row.evaluation));
    expect(low.financial!.monthlyOperatingProfit).toBeLessThan(0);
    expect(moderate.financial!.monthlyOperatingProfit).toBeGreaterThan(0);
    expect(moderate.aggregate.metrics.kitchenUtilization.mean).toBeGreaterThan(low.aggregate.metrics.kitchenUtilization.mean);
    expect(moderate.financial!.monthlyRevenue).toBeGreaterThan(low.financial!.monthlyRevenue);
    expect(excessive.aggregate.metrics.averageWaitingSeconds.mean).toBeGreaterThan(moderate.aggregate.metrics.averageWaitingSeconds.mean);
    expect(excessive.aggregate.metrics.customersLost.mean).toBeGreaterThan(moderate.aggregate.metrics.customersLost.mean);
    expect(doubled.aggregate.metrics.customersArrived.mean).toBeGreaterThan(excessive.aggregate.metrics.customersArrived.mean * 1.9);
    expect(doubled.financial!.monthlyRevenue).toBeLessThan(excessive.financial!.monthlyRevenue * 1.2);
  }, 15000);

  it("propagates unavailable market data without fabricating comparisons", async () => {
    const input = createComparisonScenarios(readyProject(), { idPrefix: "offline", createdAt: now, customOverrides: {} });
    const output = await compare(input.project, input.selections, { ...modules,
      marketProvider: { descriptor: { id: "offline", version: "1" }, fetch: async () => { throw new Error("offline"); } },
    });
    expect(output.ok).toBe(false);
    expect(output.rows).toEqual([]);
    expect(output.issues.some(issue => issue.code === "market-provider-failed")).toBe(true);
    expect(input.project.base.market).toBeNull();
  });

  it("rejects invalid execution settings before requesting market data", async () => {
    let calls = 0;
    const input = createComparisonScenarios(readyProject(), { idPrefix: "preflight", createdAt: now, customOverrides: {} });
    for (const invalid of [{ runIdPrefix: " " }, { completedAt: "invalid" },
      { replication: { count: 2, seedStrategy: "explicit" as const, seeds: [1, 1] } }]) {
      const output = await compareStoreScenarios({ ...input, period, replication, runIdPrefix: "preflight",
        startedAt: now, completedAt: later, ...invalid, modules: { ...modules,
          marketProvider: { descriptor: { id: "counted", version: "1" }, fetch: async request => { calls++; return modules.marketProvider.fetch(request); } },
        },
      });
      expect(output.ok).toBe(false);
      expect(output.rows).toEqual([]);
    }
    expect(calls).toBe(0);
  });
});
