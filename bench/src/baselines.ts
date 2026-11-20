/** Reference policies a store manager could write without a simulator. */
import type { Policy, Staffing } from "./policy";
import { SCENARIOS } from "./scenarios";
import { DURATIONS, PACKAGING_SECONDS, PARTY_SIZES, STAFF_LIMITS } from "./store";

const flat = (n: number) => Array(11).fill(n);
const fixed = (cooks: number, servers: number): Staffing => ({ cooks: flat(cooks), servers: flat(servers), cashiers: flat(1) });

/** The original app defaults: 2 cooks, 2 servers, 1 cashier, first come first served. */
export const FIXED_FIFO: Policy = { name: "fixed-2-2-fifo", description: "App defaults all day, first come first served.",
  default: { staffing: fixed(2, 2), dispatch: { rule: "fifo" }, tables: { rule: "best-fit" } } };
export const FIXED_DELIVERY_FIRST: Policy = { name: "fixed-2-2-delivery-first", description: "App defaults, delivery orders jump the queue.",
  default: { staffing: fixed(2, 2), dispatch: { rule: "delivery-first" }, tables: { rule: "best-fit" } } };
export const FIXED_DINE_IN_FIRST: Policy = { name: "fixed-2-2-dine-in-first", description: "App defaults, guests in the hall first.",
  default: { staffing: fixed(2, 2), dispatch: { rule: "dine-in-first" }, tables: { rule: "best-fit" } } };
/** Over-staffed and safe: what a cautious owner does. */
export const FIXED_SAFE: Policy = { name: "fixed-4-2-fifo", description: "4 cooks and 2 servers all day, first come first served.",
  default: { staffing: fixed(4, 2), dispatch: { rule: "fifo" }, tables: { rule: "best-fit" } } };

/**
 * Rule of thumb from the forecast: staff each hour for its expected workload at a target utilisation.
 * cooks = ceil(cook-minutes / (60 * 0.65)), servers = ceil(server-minutes / (60 * 0.55)).
 */
export function workloadRule(cookTarget = 0.65, serverTarget = 0.55): Policy {
  const meanParty = PARTY_SIZES.reduce((s, p) => s + p.size * p.probability, 0);
  const clamp = (value: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, value));
  const byScenario: Policy["byScenario"] = {};
  for (const scenario of SCENARIOS) {
    const cooks: number[] = [], servers: number[] = [];
    scenario.dineIn.forEach((customers, i) => {
      const parties = customers / meanParty, orders = scenario.delivery[i];
      const cookMinutes = (parties * DURATIONS.cookingSeconds + orders * (DURATIONS.cookingSeconds + PACKAGING_SECONDS)) / 60;
      const serverMinutes = parties * (DURATIONS.orderingSeconds + DURATIONS.servingSeconds + DURATIONS.cleaningSeconds) / 60;
      cooks.push(clamp(Math.ceil(cookMinutes / (60 * cookTarget)), STAFF_LIMITS.cooks));
      servers.push(clamp(Math.ceil(serverMinutes / (60 * serverTarget)), STAFF_LIMITS.servers));
    });
    byScenario[scenario.id] = { staffing: { cooks, servers, cashiers: flat(1) } };
  }
  return { name: "workload-rule-fifo", description: `Hourly staffing from forecast workload at ${cookTarget * 100}% cook / ${serverTarget * 100}% server utilisation, FIFO.`,
    default: { staffing: fixed(2, 2), dispatch: { rule: "fifo" }, tables: { rule: "best-fit" } }, byScenario };
}

export const BASELINES: Policy[] = [FIXED_FIFO, FIXED_DELIVERY_FIRST, FIXED_DINE_IN_FIRST, FIXED_SAFE, workloadRule()];
