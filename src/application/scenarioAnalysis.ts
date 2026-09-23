import {
  createScenario, resolveScenario, updateProjectBase, validateProject,
  type DomainIssue, type FinancialResult, type MarketProfile, type MarketProvider,
  type Project, type ResolvedScenario, type ScenarioOverrides,
} from "../core";
import { fetchMarketProfile } from "../modules/market";
import {
  createScenarioVariant, resolveReplicationPlan, runScenarioReplications,
  type ReplicationPlan, type ScenarioEvaluation, type ScenarioModules,
} from "../modules/scenario";

export type ComparisonKind = "Conservative" | "Baseline" | "Optimistic" | "Custom";
export interface ScenarioSelection { kind: ComparisonKind; scenarioId: string }

/** Optional named starting points; percentages are relative to the same base. */
export function createComparisonScenarios(project: Project, input: {
  idPrefix: string; createdAt: string; customOverrides: ScenarioOverrides;
}): { project: Project; selections: ScenarioSelection[] } {
  const spendingPath = project.base.financial?.averageSpendingPerCustomer !== undefined
    ? "financial.averageSpendingPerCustomer" : "operation.averageSpendingPerCustomer";
  const selections: ScenarioSelection[] = [];
  let next = project;
  for (const [kind, conversion, spending] of [
    ["Conservative", -20, -10], ["Baseline", 0, 0], ["Optimistic", 20, 10],
  ] as const) {
    const id = `${input.idPrefix}-${kind.toLowerCase()}`;
    next = createScenarioVariant(next, { id, name: kind, createdAt: input.createdAt, changes: [
      { path: "demandParameters.visitConversionRate", value: { kind: "percentage-change", percent: conversion } },
      { path: spendingPath, value: { kind: "percentage-change", percent: spending } },
    ] });
    selections.push({ kind, scenarioId: id });
  }
  const id = `${input.idPrefix}-custom`;
  next = createScenario(next, { id, name: "Custom", createdAt: input.createdAt, overrides: input.customOverrides });
  selections.push({ kind: "Custom", scenarioId: id });
  return { project: next, selections };
}

export interface ScenarioDemandSummary {
  expectedDineInCustomers: number;
  expectedDeliveryOrders: number;
  deliveryMode: "independent-orders" | "legacy-ratio-excluded-from-des";
  durationSeconds: number;
  /** Integrates hourly rates only over open portions of this observation window. */
  basis: "expected-arrivals-during-open-observation-window";
}
function summarizeDemand(resolved: ResolvedScenario): ScenarioDemandSummary {
  const { demand, operation, simulation } = resolved.configuration;
  if (!demand || !operation || !simulation) throw new Error("Scenario demand has not been prepared");
  const start = simulation.startMinute * 60, end = start + simulation.durationSeconds;
  const exposureHours = (hour: number) => operation.operatingWindows
    .filter(w => w.dayType === simulation.dayType)
    .reduce((sum, w) => sum + Math.max(0,
      Math.min(end, (hour + 1) * 3600, w.endMinute * 60) - Math.max(start, hour * 3600, w.startMinute * 60)) / 3600, 0);
  return {
    expectedDineInCustomers: demand.buckets.filter(b => b.dayType === simulation.dayType)
      .reduce((sum, b) => sum + b.expectedCustomersPerHour * exposureHours(b.hour), 0),
    expectedDeliveryOrders: (demand.deliveryBuckets ?? []).filter(b => b.dayType === simulation.dayType)
      .reduce((sum, b) => sum + b.expectedOrdersPerHour * exposureHours(b.hour), 0),
    deliveryMode: demand.deliveryBuckets === undefined ? "legacy-ratio-excluded-from-des" : "independent-orders",
    durationSeconds: simulation.durationSeconds, basis: "expected-arrivals-during-open-observation-window",
  };
}
export interface ScenarioComparison<F extends FinancialResult = FinancialResult> {
  schemaVersion: 1;
  ok: boolean;
  project: Project;
  rows: { kind: ComparisonKind; scenarioId: string; demand: ScenarioDemandSummary | null; evaluation: ScenarioEvaluation<F> }[];
  issues: DomainIssue[];
  interpretation: "conditional-on-inputs-not-a-forecast-or-investment-decision";
}

/** Provider → demand per scenario → shared-resource DES → replication → finance. */
export async function compareStoreScenarios<F extends FinancialResult = FinancialResult>(input: {
  project: Project; selections: ScenarioSelection[]; period: MarketProfile["period"];
  replication: ReplicationPlan; runIdPrefix: string; startedAt: string; completedAt: string;
  modules: ScenarioModules<F> & { marketProvider: MarketProvider }; marketTimeoutMs?: number;
}): Promise<ScenarioComparison<F>> {
  const output: ScenarioComparison<F> = {
    schemaVersion: 1, ok: false, project: structuredClone(input.project), rows: [], issues: [],
    interpretation: "conditional-on-inputs-not-a-forecast-or-investment-decision",
  };
  try {
    validateProject(output.project);
    resolveReplicationPlan(input.replication);
    if (!input.runIdPrefix.trim()) throw new Error("runIdPrefix must be non-empty");
    if ([input.startedAt, input.completedAt].some(value => !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) ||
      Date.parse(input.completedAt) < Date.parse(input.startedAt)) throw new Error("Provide ordered ISO start/completion timestamps");
    if (!input.selections.length || new Set(input.selections.map(s => s.scenarioId)).size !== input.selections.length)
      throw new Error("Select at least one distinct scenario");
    // Validate IDs before invoking an external provider.
    input.selections.forEach(s => resolveScenario(output.project, s.scenarioId));
    const market = await fetchMarketProfile(input.modules.marketProvider, { site: output.project.site, period: input.period },
      input.marketTimeoutMs === undefined ? {} : { timeoutMs: input.marketTimeoutMs });
    output.issues.push(...market.issues);
    if (market.status === "unavailable") return output;
    output.project = updateProjectBase(output.project, { market: market.profile }, input.startedAt);
    for (const selection of input.selections) {
      const evaluation = await runScenarioReplications({
        project: output.project, scenarioId: selection.scenarioId, replication: input.replication,
        runIdPrefix: `${input.runIdPrefix}-${selection.scenarioId}`, startedAt: input.startedAt,
        completedAt: input.completedAt, modules: input.modules,
      });
      output.rows.push({ ...selection, demand: evaluation.ok ? summarizeDemand(evaluation.resolved) : null, evaluation });
      output.issues.push(...evaluation.issues);
    }
    output.ok = output.rows.every(row => row.evaluation.ok);
  } catch (error) {
    output.issues.push({ code: "scenario-comparison-failed", path: "comparison", message: error instanceof Error ? error.message : String(error) });
  }
  return output;
}
