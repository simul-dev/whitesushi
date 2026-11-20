/**
 * Simulation-based local search: the simulator, not a person, judges every change.
 * Per scenario, greedy coordinate moves on hourly staffing plus a sweep of queue and table rules,
 * accepted only when the scenario stays within the service levels (with a safety margin) on the dev seeds.
 */
import { evaluateScenario, type ScenarioScore } from "./evaluate";
import { dayPolicy, type DayPolicy, type DispatchRule, type Policy, type Role, type TableRule } from "./policy";
import { SCENARIOS } from "./scenarios";
import { SERVICE_LEVELS, STAFF_LIMITS } from "./store";

const RULES: DispatchRule[] = [
  { rule: "fifo" }, { rule: "fifo", backfill: true }, { rule: "longest-wait", backfill: true },
  { rule: "dine-in-first", backfill: true }, { rule: "delivery-first", backfill: true },
  { rule: "weighted-wait", deliveryWeight: 2, backfill: true }, { rule: "weighted-wait", deliveryWeight: 4, backfill: true },
];
const TABLES: TableRule[] = [{ rule: "best-fit" }, { rule: "limit-empty-seats", maxEmptySeats: 2 }, { rule: "limit-empty-seats", maxEmptySeats: 3 }];

/** Feasible with every limit tightened by `margin` (0.9 = 10% headroom). */
function safe(score: ScenarioScore, margin: number) {
  const L = SERVICE_LEVELS;
  return score.dineInLostRate <= L.dineInLostRateMax * margin && score.dineInP90WaitSeconds <= L.dineInP90WaitSecondsMax * margin
    && score.deliveryLostRate <= L.deliveryLostRateMax * margin && score.deliveryP90KitchenWaitSeconds <= L.deliveryP90KitchenWaitSecondsMax * margin;
}

export async function optimize(start: Policy, seeds: number[], options: { margin?: number; log?: (line: string) => void } = {}) {
  const margin = options.margin ?? 0.9, log = options.log ?? (() => {});
  let evaluations = 0;
  const byScenario: Record<string, DayPolicy> = {};
  for (const scenario of SCENARIOS) {
    let best = structuredClone(dayPolicy(start, scenario.id));
    const score = async (day: DayPolicy) => { evaluations++; return evaluateScenario({ name: "search", default: day }, scenario, seeds); };
    let bestScore = await score(best);
    // Start from a feasible point: add cooks, then servers, everywhere until safe.
    while (!safe(bestScore, margin)) {
      const role: Role = best.staffing.cooks.some(c => c < STAFF_LIMITS.cooks[1]) ? "cooks" : "servers";
      if (best.staffing[role].every(v => v >= STAFF_LIMITS[role][1])) break;
      best.staffing[role] = best.staffing[role].map(v => Math.min(STAFF_LIMITS[role][1], v + 1));
      bestScore = await score(best);
    }
    const better = (s: ScenarioScore) => safe(s, margin) && s.profit > bestScore.profit + 1;
    for (let pass = 1, improved = true; improved && pass <= 6; pass++) {
      improved = false;
      for (const dispatch of RULES) for (const tables of TABLES) {
        const candidate = { ...structuredClone(best), dispatch, tables };
        const s = await score(candidate);
        if (better(s)) { best = candidate; bestScore = s; improved = true; }
      }
      for (const role of ["cooks", "servers", "cashiers"] as Role[]) for (let slot = 0; slot < 11; slot++) for (const step of [-1, 1]) {
        const value = best.staffing[role][slot] + step;
        if (value < STAFF_LIMITS[role][0] || value > STAFF_LIMITS[role][1]) continue;
        const candidate = structuredClone(best);
        candidate.staffing[role][slot] = value;
        const s = await score(candidate);
        if (better(s)) { best = candidate; bestScore = s; improved = true; }
      }
      log(`${scenario.id} pass ${pass}: profit ${Math.round(bestScore.profit)} KRW, labor ${bestScore.labor}, rule ${best.dispatch.rule}${best.dispatch.backfill ? "+backfill" : ""}/${best.tables.rule}`);
    }
    byScenario[scenario.id] = best;
  }
  const policy: Policy = {
    name: "sim-search", description: `Greedy simulation-based search on ${seeds.length} dev seeds with ${Math.round((1 - margin) * 100)}% service-level headroom (${evaluations} scenario evaluations).`,
    default: byScenario[SCENARIOS[0].id], byScenario: Object.fromEntries(SCENARIOS.slice(1).map(s => [s.id, byScenario[s.id]])),
  };
  return { policy, evaluations };
}
