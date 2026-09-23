import { describe, expect, it } from "vitest";
import { canonicalJson } from "../core";
import { createTesterSampleInput } from "./testerSample";
import { executeWorkflowAnalysis } from "./workflowAnalysis";
import { sampleWorkflowSession, workflowInputKeys } from "./workflow";
import type { MarketIntelligenceProfile } from "../modules/market";

describe("ready-to-use Myongji tester sample", () => {
  it("prepares all stages from the supplied identity and real engines without relabelling example geometry", async () => {
    const now = "2026-09-23T12:00:00Z", input = createTesterSampleInput(now);
    const before = canonicalJson(input);
    expect(input.candidate).toMatchObject({ projectName: "백초밥 명지점", brandName: "백초밥", knownAreaM2: 94.44,
      address: "부산광역시 강서구 명지국제2로 80 비주거시설동 1층 1-86, 1-87호" });
    expect(input.session.document).toEqual(sampleWorkflowSession(now).document);
    const result = await executeWorkflowAnalysis({ kind: "sample", input });
    if (result.kind !== "sample" || !result.evaluation.ok) throw new Error("sample preparation failed");
    const { prepared, evaluation, frames, financial, comparison, sensitivity } = result;
    expect(prepared.market.provenance.kind).toBe("demo");
    expect(prepared.market.siteRef).toEqual({ id: prepared.session.project.site.id, revision: prepared.session.project.site.revision });
    expect((prepared.market as MarketIntelligenceProfile).location.address).toBe(input.candidate.address);
    expect(prepared.market.buckets).toHaveLength(72);
    expect(prepared.demand.buckets).toHaveLength(72);
    expect(prepared.keys).toEqual(workflowInputKeys({ ...input, plan: input.session.document, mapping: input.session.mapping, market: prepared.market }));
    expect(evaluation.runs).toHaveLength(3);
    expect(evaluation.runs.every(run => run.status === "completed")).toBe(true);
    expect(evaluation.resolved.layout!.totalAreaM2).not.toBe(input.candidate.knownAreaM2);
    expect(frames).toHaveLength(1201);
    expect(frames.at(-1)!.customers.served).toBe(evaluation.runs[0].result!.customersServed);
    expect(financial.input.simulationRuns.map(run => run.id)).toEqual(evaluation.runs.map(run => run.id));
    expect(financial.monthlyRevenue).toBeGreaterThan(0);
    expect(comparison.ok).toBe(true);
    expect(comparison.rows).toHaveLength(4);
    expect(sensitivity.results).toHaveLength(5);
    const direct = await executeWorkflowAnalysis({ kind: "operation", project: prepared.session.project, now });
    if (direct.kind !== "operation" || !direct.evaluation.ok) throw new Error("direct operation failed");
    expect(direct.evaluation.runs.map(run => run.result)).toEqual(evaluation.runs.map(run => run.result));
    expect(canonicalJson(input)).toBe(before);
  }, 15000);
});
