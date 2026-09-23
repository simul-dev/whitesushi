import { describe, expect, it } from "vitest";
import { canonicalJson, prepareSimulationInput, type MarketProfile } from "../core";
import { MockMarketProvider } from "../modules/market";
import { TransparentDemandModel } from "../modules/demand";
import { discreteEventSimulationEngine } from "../modules/simulation";
import { checkpointWorkflow, createWorkflowConfiguration, sampleWorkflowSession, sanitizeMapping, workflowInputKeys } from "./workflow";
import { executeWorkflowAnalysis } from "./workflowAnalysis";
import { createComparisonScenarios } from "./scenarioAnalysis";

const now = "2026-09-23T12:00:00Z";
const candidate = { projectName: "검토 후보점", brandName: "예시 브랜드", address: "사용자가 입력한 검토 주소", notes: "합성 테스트", knownAreaM2: null };
function input() {
  const session = sampleWorkflowSession(now);
  return { session, plan: session.document, mapping: session.mapping, candidate: { ...candidate }, configuration: createWorkflowConfiguration(), market: null as MarketProfile | null, now };
}
async function prepared() {
  const source = input();
  const first = checkpointWorkflow(source);
  const market = await new MockMarketProvider().fetch({ site: first.project.site, period: { from: "2026-08-26T12:00:00Z", to: now } });
  return { source, market, session: checkpointWorkflow({ ...source, session: first, market }) };
}
describe("integrated workflow boundaries", () => {
  it("checkpoints actual Space edits and preserves prior immutable revisions", () => {
    const source = input(), before = canonicalJson(source.session);
    const plan = structuredClone(source.plan); plan.objects.find(o => o.type === "table")!.x += 100;
    const next = checkpointWorkflow({ ...source, plan });
    expect(next.documentRevision).toBe(2);
    expect(next.project.layouts).toHaveLength(2);
    expect(canonicalJson(source.session)).toBe(before);
    expect(next.project.site.address).toBe(candidate.address);
    expect(next.project.base.layoutRef!.revision).toBe(2);
  });

  it("invalidates market on address edits and requires explicit mappings for a replacement document", async () => {
    const ready = await prepared();
    const changed = checkpointWorkflow({ ...ready.source, session: ready.session, market: ready.market,
      candidate: { ...candidate, address: "다른 후보지" } });
    const demand = new TransparentDemandModel().calculate({ market: ready.market, parameters: changed.project.base.demandParameters! });
    changed.project.base.demand = demand;
    const run = prepareSimulationInput(changed.project, discreteEventSimulationEngine.descriptor);
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.issues.some(issue => issue.code === "stale-market")).toBe(true);
    const plan = structuredClone(ready.source.plan); plan.objects = plan.objects.filter(o => o.type !== "table");
    expect(sanitizeMapping(plan, ready.source.mapping).tableCapacities).toEqual({});
    expect(checkpointWorkflow({ ...ready.source, mapping: {} }).project.layouts.at(-1)!.confirmedCapacity).toBeNull();
  });

  it("separates financial freshness from operational freshness and tracks demand/capacity edits", () => {
    const source = input();
    const options = { ...source, custom: { conversionChangePercent: 0, spendingChangePercent: 0, cooks: 3, kitchenConcurrentOrders: 4 }, sensitivity: "conversion" as const };
    const original = workflowInputKeys(options);
    const cost = structuredClone(options); cost.configuration.financial.monthlyRent += 100000;
    expect(workflowInputKeys(cost).operation).toBe(original.operation);
    expect(workflowInputKeys(cost).financial).not.toBe(original.financial);
    const demand = structuredClone(options); demand.configuration.demandParameters.visitConversionRate = 0.5;
    expect(workflowInputKeys(demand).demand).not.toBe(original.demand);
    expect(workflowInputKeys(demand).operation).not.toBe(original.operation);
    const seats = structuredClone(options); seats.mapping.tableCapacities![Object.keys(seats.mapping.tableCapacities!)[0]] = 2;
    expect(workflowInputKeys(seats).operation).not.toBe(original.operation);
  });

  it("runs the worker service with exact sampled playback, then independently recalculates costs", async () => {
    const ready = await prepared();
    // Short observation is an explicit test input, never secretly rescaled into a day.
    ready.session.project.base.simulation!.durationSeconds = 7200;
    ready.session.project.base.simulation!.replications = 2;
    const result = await executeWorkflowAnalysis({ kind: "operation", project: ready.session.project, now });
    expect(result.kind).toBe("operation");
    if (result.kind !== "operation" || !result.evaluation.ok) throw new Error(JSON.stringify(result));
    expect(result.evaluation.runs).toHaveLength(2);
    expect(result.evaluation.financial).toBeNull();
    expect(result.frames[0].elapsedSeconds).toBe(0);
    expect(result.frames.at(-1)!.elapsedSeconds).toBe(7200);
    const first = result.evaluation.runs[0];
    expect(result.frames.at(-1)!.customers.served).toBe(first.result!.customersServed);
    const direct = await discreteEventSimulationEngine.run({ runId: first.id, snapshot: first.snapshot,
      operationModel: (await import("../modules/operation")).restaurantOperationModel });
    expect(direct).toEqual(first.result);
    const costs = ready.session.project.base.financial!;
    const a = await executeWorkflowAnalysis({ kind: "financial", runs: result.evaluation.runs, assumption: costs });
    const b = await executeWorkflowAnalysis({ kind: "financial", runs: result.evaluation.runs, assumption: { ...costs, monthlyRent: costs.monthlyRent + 100000 } });
    if (a.kind !== "financial" || b.kind !== "financial") throw new Error("wrong result kind");
    expect(b.financial.monthlyRevenue).toBe(a.financial.monthlyRevenue);
    expect(a.financial.operatingProfit - b.financial.operatingProfit).toBeCloseTo(100000);
  }, 15000);

  it("connects custom and every sensitivity control to isolated engine inputs", async () => {
    const ready = await prepared();
    ready.session.project.base.simulation!.durationSeconds = 7200;
    ready.session.project.base.simulation!.replications = 1;
    const original = canonicalJson(ready.session.project);
    const compared = await executeWorkflowAnalysis({ kind: "comparison", project: ready.session.project, now,
      custom: { conversionChangePercent: 20, spendingChangePercent: 10, cooks: 3, kitchenConcurrentOrders: 5 } });
    if (compared.kind !== "comparison" || !compared.comparison.ok) throw new Error(JSON.stringify(compared));
    const custom = compared.comparison.rows.find(row => row.kind === "Custom")!.evaluation;
    if (!custom.ok) throw new Error(JSON.stringify(custom.issues));
    expect(custom.resolved.configuration.operation!.resources).toMatchObject({ cooks: 3, kitchenConcurrentOrders: 5 });
    expect(custom.resolved.configuration.demandParameters!.visitConversionRate).toBeCloseTo(0.3);
    expect(custom.financial!.conditions.averageSpendingPerCustomer).toBeCloseTo(24200);
    for (const parameter of ["conversion", "seats", "kitchen", "spending"] as const) {
      const result = await executeWorkflowAnalysis({ kind: "sensitivity", project: ready.session.project, now, parameter });
      if (result.kind !== "sensitivity") throw new Error("wrong result kind");
      expect(result.sensitivity.results.length).toBeGreaterThanOrEqual(3);
      expect(result.sensitivity.results.every(point => point.evaluation.ok)).toBe(true);
      expect(result.sensitivity.results.some(point => point.parameterValue === result.sensitivity.baseValue)).toBe(true);
    }
    expect(canonicalJson(ready.session.project)).toBe(original);
  }, 15000);

  it("explicitly bounds the product optimistic preset while keeping headless defaults strict", async () => {
    const ready = await prepared();
    ready.session.project.base.demandParameters!.visitConversionRate = 0.9;
    ready.session.project.base.simulation!.durationSeconds = 3600;
    ready.session.project.base.simulation!.replications = 1;
    expect(() => createComparisonScenarios(ready.session.project, { idPrefix: "strict", createdAt: now, customOverrides: {} })).toThrow();
    const result = await executeWorkflowAnalysis({ kind: "comparison", project: ready.session.project, now,
      custom: { conversionChangePercent: 0, spendingChangePercent: 0, cooks: 3, kitchenConcurrentOrders: 4 } });
    if (result.kind !== "comparison") throw new Error("wrong result kind");
    expect(result.comparison.ok).toBe(true);
    expect(result.comparison.rows).toHaveLength(4);
    expect(result.comparison.rows.find(row => row.kind === "Optimistic")!.evaluation.resolved!.configuration.demandParameters!.visitConversionRate).toBe(1);
  }, 15000);
});
