import { describe, expect, it } from "vitest";
import { evaluate, evaluateScenario } from "../src/evaluate";
import { BASELINES, FIXED_FIFO } from "../src/baselines";
import { validatePolicy, type Policy } from "../src/policy";
import { DEV_SEEDS, SCENARIOS } from "../src/scenarios";
import { readFileSync } from "node:fs";

const ids = SCENARIOS.map(s => s.id);

describe("restaurant-ops-bench", () => {
  it("baselines are valid policies", () => {
    for (const policy of BASELINES) expect(validatePolicy(policy, ids)).toEqual([]);
  });

  it("rejects malformed policies with readable reasons", () => {
    const bad = structuredClone(FIXED_FIFO) as Policy;
    bad.default.staffing.cooks = [9];
    bad.default.dispatch = { rule: "weighted-wait" };
    bad.byScenario = { holiday: {} };
    const problems = validatePolicy(bad, ids).join("\n");
    expect(problems).toMatch(/staffing.cooks needs 11/);
    expect(problems).toMatch(/deliveryWeight/);
    expect(problems).toMatch(/holiday: unknown scenario/);
  });

  it("scores are reproducible", async () => {
    const a = await evaluateScenario(FIXED_FIFO, SCENARIOS[0], DEV_SEEDS.slice(0, 3));
    const b = await evaluateScenario(FIXED_FIFO, SCENARIOS[0], DEV_SEEDS.slice(0, 3));
    expect(a).toEqual(b);
  });

  it("the app defaults miss the service levels and the committed search policy meets them on the dev seeds", async () => {
    expect((await evaluate(FIXED_FIFO, DEV_SEEDS.slice(0, 5), "dev")).feasible).toBe(false);
    const search = JSON.parse(readFileSync(new URL("../policies/sim-search.json", import.meta.url), "utf8"));
    const score = await evaluate(search, DEV_SEEDS, "dev");
    expect(score.feasible).toBe(true);
  }, 60000);
});
