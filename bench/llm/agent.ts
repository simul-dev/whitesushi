/**
 * LLM baseline: a model proposes a policy, the simulator scores it on the dev seeds, the model revises.
 * Usage: npm run bench:llm -- --model <model id> [--evals 12] [--effort high] [--out bench/policies/llm-<name>.json]
 * Credentials come from the environment the Anthropic SDK reads (ANTHROPIC_API_KEY or an `ant auth login` profile).
 * The model never sees the test seeds; score the result afterwards with `npm run bench -- eval <out> --split test`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describeProblem } from "../src/describe";
import { evaluate, type PolicyScore } from "../src/evaluate";
import { validatePolicy, type Policy } from "../src/policy";
import { DEV_SEEDS, SCENARIOS } from "../src/scenarios";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const model = flag("model");
if (!model) throw new Error("--model is required (the benchmark records which model produced a policy, so it has no default)");
const maxEvals = Number(flag("evals", "12"));
const effort = flag("effort", "high") as "low" | "medium" | "high" | "xhigh" | "max";
const out = flag("out", `bench/policies/llm-${model.replace(/[^a-z0-9.-]/gi, "_")}.json`)!;

const client = new Anthropic();
const system = `${describeProblem()}

You will get feedback after each proposal: per-day profit, service-level violations, waits and utilisation on the dev seeds.
You have ${maxEvals} evaluations. Each reply must contain exactly one complete policy as a single \`\`\`json code block, with "name": "llm-agent".
Before the JSON, write at most five short lines on what you changed and why.`;

function summarise(score: PolicyScore) {
  return [`total ${Math.round(score.total)} KRW/day, ${score.feasible ? "meets every service level" : "VIOLATES service levels"}`,
    ...score.scenarios.map(s => `${s.scenario}: profit ${Math.round(s.profit)} (labor ${s.labor}), hall lost ${(s.dineInLostRate * 100).toFixed(1)}%, hall p90 wait ${Math.round(s.dineInP90WaitSeconds)}s, delivery lost ${(s.deliveryLostRate * 100).toFixed(1)}%, delivery p90 kitchen wait ${Math.round(s.deliveryP90KitchenWaitSeconds)}s, cooks busy ${(s.cookUtilization * 100).toFixed(0)}%, servers busy ${(s.serverUtilization * 100).toFixed(0)}%${s.violations.length ? `; VIOLATIONS: ${s.violations.join("; ")}` : ""}`)].join("\n");
}
function extract(message: Anthropic.Message): Policy | string {
  const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return "No ```json block found. Reply with one complete policy in a ```json block.";
  try { return JSON.parse(match[1]) as Policy; } catch (error) { return `The JSON did not parse: ${(error as Error).message}`; }
}

const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Propose your first policy." }];
const log: { attempt: number; feasible: boolean | null; total: number | null; note: string }[] = [];
let best: { policy: Policy; score: PolicyScore } | null = null;
for (let attempt = 1, evals = 0; evals < maxEvals && attempt <= maxEvals * 2; attempt++) {
  const stream = client.messages.stream({ model, max_tokens: 32000, output_config: { effort }, system, messages });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("the model declined the request");
  messages.push({ role: "assistant", content: message.content });
  const proposal = extract(message);
  const problems = typeof proposal === "string" ? [proposal] : validatePolicy(proposal, SCENARIOS.map(s => s.id));
  if (problems.length) {
    log.push({ attempt, feasible: null, total: null, note: problems.join("; ") });
    messages.push({ role: "user", content: `Invalid policy (not counted as an evaluation):\n- ${problems.join("\n- ")}` });
    continue;
  }
  const policy = { ...(proposal as Policy), name: "llm-agent" };
  const score = await evaluate(policy, DEV_SEEDS, "dev");
  evals++;
  log.push({ attempt, feasible: score.feasible, total: Math.round(score.total), note: "" });
  console.log(`eval ${evals}/${maxEvals}: ${score.feasible ? "ok" : "violates"} ${Math.round(score.total)}`);
  const better = !best || (score.feasible && !best.score.feasible) || (score.feasible === best.score.feasible && score.total > best.score.total);
  if (better) best = { policy, score };
  messages.push({ role: "user", content: `Evaluation ${evals}/${maxEvals} on the dev seeds:\n${summarise(score)}${evals < maxEvals ? "\nPropose your next policy." : ""}` });
}
if (!best) throw new Error("no valid policy was produced");
const final = { ...best.policy, description: `LLM agent (${model}, effort ${effort}), best of ${log.filter(l => l.total !== null).length} dev evaluations.` };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(final, null, 2) + "\n");
writeFileSync(out.replace(/\.json$/, ".log.json"), JSON.stringify(log, null, 2) + "\n");
console.log(`best on dev: ${best.score.feasible ? "ok" : "violates"} ${Math.round(best.score.total)} -> wrote ${out}`);
