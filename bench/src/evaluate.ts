/** Runs a policy on every scenario and seed, then scores it. */
import type { DemandProfile, MarketProfile, SimulationSnapshot } from "../../src/core";
import { canonicalJson } from "../../src/core";
import { discreteEventSimulationEngine, type OutcomeRecord } from "../../src/modules/simulation";
import { restaurantOperationModel } from "../../src/modules/operation";
import { SCENARIOS, type Scenario } from "./scenarios";
import { dayPolicy, laborCost, toControl, validatePolicy, type Policy } from "./policy";
import { ECONOMICS, HORIZON_SECONDS, MARGIN, OPEN_MINUTE, SERVICE_LEVELS, SERVICE_TIME_CV, operationPolicy, storeLayout } from "./store";

export function snapshot(scenario: Scenario, seed: number): SimulationSnapshot {
  const hours = scenario.dineIn.map((_, i) => 11 + i);
  const demand: DemandProfile = {
    id: `demand-${scenario.id}`, revision: 1, model: { id: "restaurant-ops-bench", version: "1" }, provenance: { kind: "demo", source: "restaurant-ops-bench" },
    lineage: { marketRef: { id: "market", revision: 1 }, marketContentKey: "bench", parametersContentKey: "bench" },
    buckets: hours.map((hour, i) => ({ dayType: scenario.dayType, hour, expectedCustomersPerHour: scenario.dineIn[i], distribution: "poisson" as const })),
    deliveryBuckets: hours.map((hour, i) => ({ dayType: scenario.dayType, hour, expectedOrdersPerHour: scenario.delivery[i], distribution: "poisson" as const })),
    assumptions: [],
  };
  const market: MarketProfile = {
    id: "market", revision: 1, siteRef: { id: "site", revision: 1 }, siteContentKey: "bench", provider: { id: "bench", version: "1" },
    provenance: { kind: "demo", source: "restaurant-ops-bench" }, period: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }, buckets: [], nearbyBusinesses: [], assumptions: [],
  };
  const snap: SimulationSnapshot = {
    schemaVersion: 1, projectRef: { id: "restaurant-ops-bench", revision: 1 }, scenarioRef: null, engine: discreteEventSimulationEngine.descriptor,
    input: { layout: storeLayout(), demand, operation: operationPolicy(),
      config: { seed, durationSeconds: HORIZON_SECONDS, startMinute: OPEN_MINUTE, dayType: scenario.dayType, replications: 1 } },
    lineage: { site: { id: "site", revision: 1, name: "Synthetic benchmark store", address: null, coordinates: null, timeZone: "Asia/Seoul" }, market, demandParameters: {
      categoryParticipationRate: 1, brandShare: 1, visitConversionRate: 1, weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1, dinnerMultiplier: 1, weatherEventMultiplier: 1, deliveryRatio: 0,
    } }, contentKey: "", integrityKey: "",
  };
  snap.contentKey = canonicalJson({ engine: snap.engine, input: snap.input, lineage: snap.lineage });
  snap.integrityKey = canonicalJson({ schemaVersion: snap.schemaVersion, projectRef: snap.projectRef, scenarioRef: snap.scenarioRef, contentKey: snap.contentKey });
  return snap;
}

const percentile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const stderr = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1) / values.length);
};

export interface ScenarioScore {
  scenario: string; seeds: number;
  /** Mean daily contribution after food, platform fees and labor (KRW). */
  profit: number; profitStdErr: number; margin: number; labor: number;
  dineInArrived: number; dineInServed: number; dineInLostRate: number; dineInP90WaitSeconds: number;
  deliveryArrived: number; deliveryCompleted: number; deliveryLostRate: number; deliveryP90KitchenWaitSeconds: number;
  cookUtilization: number; serverUtilization: number;
  violations: string[];
}
export interface PolicyScore { policy: string; split: string; feasible: boolean; total: number; scenarios: ScenarioScore[] }

export async function evaluateScenario(policy: Policy, scenario: Scenario, seeds: number[]): Promise<ScenarioScore> {
  const day = dayPolicy(policy, scenario.id);
  const labor = laborCost(day, ECONOMICS.hourlyWage);
  const waits: number[] = [], kitchenWaits: number[] = [], profits: number[] = [], margins: number[] = [];
  let dineArrived = 0, dineServed = 0, dineLost = 0, delArrived = 0, delDone = 0, delLost = 0, cookU = 0, serverU = 0;
  for (const seed of seeds) {
    const records: OutcomeRecord[] = [];
    const control = { ...toControl(day), serviceTimeCv: SERVICE_TIME_CV, onOutcome: (r: OutcomeRecord) => records.push(r) };
    const result = await discreteEventSimulationEngine.run({ runId: `${policy.name}:${scenario.id}:${seed}`, snapshot: snapshot(scenario, seed), operationModel: restaurantOperationModel, control });
    let served = 0, orders = 0;
    for (const r of records) {
      if (r.channel === "dine-in") {
        dineArrived += r.size;
        for (let k = 0; k < r.size; k++) waits.push(r.waitSeconds);
        if (r.outcome === "served") { dineServed += r.size; served += r.size; }
        if (r.outcome === "lost") dineLost += r.size;
      } else {
        delArrived++; kitchenWaits.push(r.kitchenWaitSeconds);
        if (r.outcome === "served") { delDone++; orders++; }
        if (r.outcome === "lost") delLost++;
      }
    }
    const margin = served * MARGIN.dineInCustomer + orders * MARGIN.deliveryOrder;
    margins.push(margin); profits.push(margin - labor);
    cookU += result.resourceUtilization!.find(r => r.resourceId === "cooks")!.utilization / seeds.length;
    serverU += result.resourceUtilization!.find(r => r.resourceId === "servers")!.utilization / seeds.length;
  }
  const score: ScenarioScore = {
    scenario: scenario.id, seeds: seeds.length, profit: mean(profits), profitStdErr: stderr(profits), margin: mean(margins), labor,
    dineInArrived: dineArrived / seeds.length, dineInServed: dineServed / seeds.length, dineInLostRate: dineLost / Math.max(1, dineArrived),
    dineInP90WaitSeconds: percentile(waits, 0.9),
    deliveryArrived: delArrived / seeds.length, deliveryCompleted: delDone / seeds.length, deliveryLostRate: delLost / Math.max(1, delArrived),
    deliveryP90KitchenWaitSeconds: percentile(kitchenWaits, 0.9),
    cookUtilization: cookU, serverUtilization: serverU, violations: [],
  };
  const L = SERVICE_LEVELS;
  if (score.dineInLostRate > L.dineInLostRateMax) score.violations.push(`dine-in lost ${(score.dineInLostRate * 100).toFixed(1)}% > ${L.dineInLostRateMax * 100}%`);
  if (score.dineInP90WaitSeconds > L.dineInP90WaitSecondsMax) score.violations.push(`dine-in p90 wait ${Math.round(score.dineInP90WaitSeconds)}s > ${L.dineInP90WaitSecondsMax}s`);
  if (score.deliveryLostRate > L.deliveryLostRateMax) score.violations.push(`delivery lost ${(score.deliveryLostRate * 100).toFixed(1)}% > ${L.deliveryLostRateMax * 100}%`);
  if (score.deliveryP90KitchenWaitSeconds > L.deliveryP90KitchenWaitSecondsMax) score.violations.push(`delivery p90 kitchen wait ${Math.round(score.deliveryP90KitchenWaitSeconds)}s > ${L.deliveryP90KitchenWaitSecondsMax}s`);
  return score;
}

export async function evaluate(policy: Policy, seeds: number[], split: string, scenarios = SCENARIOS): Promise<PolicyScore> {
  const problems = validatePolicy(policy, SCENARIOS.map(s => s.id));
  if (problems.length) throw new Error(`invalid policy:\n- ${problems.join("\n- ")}`);
  const results: ScenarioScore[] = [];
  for (const scenario of scenarios) results.push(await evaluateScenario(policy, scenario, seeds));
  return { policy: policy.name, split, feasible: results.every(r => !r.violations.length), total: results.reduce((s, r) => s + r.profit, 0), scenarios: results };
}
