import { describe, expect, it } from "vitest";
import { canonicalJson } from "../core";
import { createTesterSampleInput } from "./testerSample";
import { checkpointWorkflow } from "./workflow";
import type { MarketIntelligenceProfile } from "../modules/market";
import { executeWorkflowAnalysis, type WorkflowAnalysisResult } from "./workflowAnalysis";

type Prepared = Extract<WorkflowAnalysisResult, { kind: "sample" | "refresh" }>;
const cacheFrom = (r: Prepared) => ({
  operation: { key: r.prepared.keys.operation, value: r.evaluation }, frames: r.frames,
  financial: { key: r.prepared.keys.financial, value: r.financial },
  comparison: { key: r.prepared.keys.comparison, value: r.comparison },
  sensitivity: { key: r.prepared.keys.sensitivity, value: r.sensitivity },
});

describe("automatic connected workflow refresh", () => {
  it("propagates costs and custom scenarios without rerunning unaffected operating records", async () => {
    const input = createTesterSampleInput("2026-09-24T00:00:00Z");
    input.configuration.simulation.durationSeconds = 7200;
    input.configuration.simulation.replications = 1;
    input.session = checkpointWorkflow({ ...input, plan: input.session.document, mapping: input.session.mapping, market: null });
    const base = await executeWorkflowAnalysis({ kind: "sample", input });
    if (base.kind !== "sample") throw new Error("expected sample");
    const edited = structuredClone(base.prepared);
    edited.now = "2026-09-24T00:01:00Z";
    edited.configuration.financial.monthlyRent += 500000;
    edited.configuration.financial.revision++;
    edited.session = checkpointWorkflow({ ...edited, plan: edited.session.document, mapping: edited.session.mapping, market: edited.market });
    const before = canonicalJson(edited);
    const cost = await executeWorkflowAnalysis({ kind: "refresh", input: edited, market: base.prepared.market, cache: cacheFrom(base) });
    if (cost.kind !== "refresh") throw new Error("expected refresh");
    expect(cost.evaluation).toEqual(base.evaluation);
    expect(cost.frames).toEqual(base.frames);
    expect(cost.financial.monthlyRevenue).toBe(base.financial.monthlyRevenue);
    expect(cost.financial.operatingProfit).toBeCloseTo(base.financial.operatingProfit - 500000);
    for (let i = 0; i < 4; i++) {
      expect(cost.comparison.rows[i].evaluation.financial!.operatingProfit)
        .toBeCloseTo(base.comparison.rows[i].evaluation.financial!.operatingProfit - 500000);
    }
    expect(canonicalJson(edited)).toBe(before);
    const custom = structuredClone(cost.prepared);
    custom.now = "2026-09-24T00:02:00Z";
    custom.custom.spendingChangePercent = 20;
    const comparison = await executeWorkflowAnalysis({ kind: "refresh", input: custom, market: cost.prepared.market, cache: cacheFrom(cost) });
    if (comparison.kind !== "refresh") throw new Error("expected refresh");
    expect(comparison.financial).toEqual(cost.financial);
    expect(comparison.evaluation).toEqual(cost.evaluation);
    expect(comparison.sensitivity).toEqual(cost.sensitivity);
    expect(comparison.comparison.rows.find(row => row.kind === "Custom")!.evaluation.financial!.monthlyRevenue)
      .toBeGreaterThan(cost.comparison.rows.find(row => row.kind === "Custom")!.evaluation.financial!.monthlyRevenue);
  }, 15000);

  it("refreshes a changed candidate and demand through every dependent stage", async () => {
    const input = createTesterSampleInput("2026-09-24T00:00:00Z");
    input.configuration.simulation.durationSeconds = 3600;
    input.configuration.simulation.replications = 1;
    input.session = checkpointWorkflow({ ...input, plan: input.session.document, mapping: input.session.mapping, market: null });
    const base = await executeWorkflowAnalysis({ kind: "sample", input });
    if (base.kind !== "sample") throw new Error("expected sample");
    const next = structuredClone(base.prepared);
    next.now = "2026-09-24T00:03:00Z";
    next.candidate.address = "부산광역시 변경 후보지";
    next.configuration.demandParameters.visitConversionRate = 0.1;
    next.session = checkpointWorkflow({ ...next, plan: next.session.document, mapping: next.session.mapping, market: null });
    const result = await executeWorkflowAnalysis({ kind: "refresh", input: next, market: null, cache: cacheFrom(base) });
    if (result.kind !== "refresh" || !result.evaluation.ok) throw new Error("expected refresh");
    expect((result.prepared.market as MarketIntelligenceProfile).location.address).toBe(next.candidate.address);
    expect(result.prepared.market.siteRef.revision).toBe(next.session.project.site.revision);
    expect(result.prepared.keys.operation).not.toBe(base.prepared.keys.operation);
    expect(result.evaluation.runs[0].id).not.toBe(base.evaluation.runs[0].id);
    expect(result.evaluation.runs[0].snapshot.input.demand).toEqual(result.prepared.demand);
    expect(result.financial.input.simulationRuns.map(run => run.id)).toEqual(result.evaluation.runs.map(run => run.id));
    expect(result.comparison.ok).toBe(true);
  }, 15000);
});
