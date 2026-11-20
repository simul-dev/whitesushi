/** The JSON a participant submits, and how it becomes engine hooks. */
import type { EngineControl } from "../../src/modules/simulation";
import { SLOT_HOURS, STAFF_LIMITS } from "./store";

export type Role = "cooks" | "servers" | "cashiers";
export type Staffing = Record<Role, number[]>; // one headcount per slot, 11:00 ... 21:00
export interface DispatchRule {
  /** fifo = first come first served for every shared resource (the reference engine). */
  rule: "fifo" | "dine-in-first" | "delivery-first" | "longest-wait" | "weighted-wait";
  /** weighted-wait only: a delivery order's waiting time counts this many times. */
  deliveryWeight?: number;
  /** true lets a later request start when an earlier one cannot (no head-of-line blocking). */
  backfill?: boolean;
}
export interface TableRule {
  /** best-fit = smallest free table that fits. */
  rule: "best-fit" | "limit-empty-seats";
  /** limit-empty-seats only: never seat a party at a table with more than this many empty seats. */
  maxEmptySeats?: number;
}
export interface DayPolicy { staffing: Staffing; dispatch: DispatchRule; tables: TableRule }
export interface Policy {
  name: string;
  description?: string;
  /** Used for every scenario unless byScenario gives that scenario its own day policy. */
  default: DayPolicy;
  byScenario?: Record<string, Partial<DayPolicy>>;
}

const ROLES: Role[] = ["cooks", "servers", "cashiers"];
const RULES = ["fifo", "dine-in-first", "delivery-first", "longest-wait", "weighted-wait"];

export function dayPolicy(policy: Policy, scenarioId: string): DayPolicy {
  const override = policy.byScenario?.[scenarioId] ?? {};
  return { ...policy.default, ...override };
}

/** Returns a list of problems; an empty list means the policy is valid. */
export function validatePolicy(policy: Policy, scenarioIds: string[]): string[] {
  const problems: string[] = [];
  if (!policy || typeof policy !== "object") return ["policy must be an object"];
  if (typeof policy.name !== "string" || !policy.name.trim()) problems.push("name is required");
  if (!policy.default) return [...problems, "default day policy is required"];
  for (const id of Object.keys(policy.byScenario ?? {})) if (!scenarioIds.includes(id)) problems.push(`byScenario.${id}: unknown scenario`);
  for (const id of scenarioIds) {
    const day = dayPolicy(policy, id), at = `scenario ${id}`;
    for (const role of ROLES) {
      const slots = day.staffing?.[role];
      const [min, max] = STAFF_LIMITS[role];
      if (!Array.isArray(slots) || slots.length !== SLOT_HOURS.length) { problems.push(`${at}: staffing.${role} needs ${SLOT_HOURS.length} hourly values (11:00 ... 21:00)`); continue; }
      slots.forEach((value, i) => { if (!Number.isInteger(value) || value < min || value > max) problems.push(`${at}: staffing.${role}[${i}] must be an integer in [${min}, ${max}]`); });
    }
    if (!day.dispatch || !RULES.includes(day.dispatch.rule)) problems.push(`${at}: dispatch.rule must be one of ${RULES.join(", ")}`);
    else if (day.dispatch.rule === "weighted-wait" && !(typeof day.dispatch.deliveryWeight === "number" && day.dispatch.deliveryWeight > 0 && day.dispatch.deliveryWeight <= 20))
      problems.push(`${at}: weighted-wait needs deliveryWeight in (0, 20]`);
    if (day.dispatch?.backfill !== undefined && typeof day.dispatch.backfill !== "boolean") problems.push(`${at}: dispatch.backfill must be boolean`);
    if (!day.tables || !["best-fit", "limit-empty-seats"].includes(day.tables.rule)) problems.push(`${at}: tables.rule must be best-fit or limit-empty-seats`);
    else if (day.tables.rule === "limit-empty-seats" && !(Number.isInteger(day.tables.maxEmptySeats) && day.tables.maxEmptySeats! >= 0 && day.tables.maxEmptySeats! <= 5))
      problems.push(`${at}: limit-empty-seats needs an integer maxEmptySeats in [0, 5]`);
  }
  return problems;
}

export function toControl(day: DayPolicy): EngineControl {
  const control: EngineControl = {
    capacitySchedule: Object.fromEntries(ROLES.map(role => [role, day.staffing[role].map((units, i) => ({ atSeconds: i * 3600, units }))])),
  };
  const { rule, deliveryWeight = 1, backfill = false } = day.dispatch;
  if (rule === "dine-in-first") control.rank = r => (r.channel === "dine-in" ? 0 : 1);
  if (rule === "delivery-first") control.rank = r => (r.channel === "delivery" ? 0 : 1);
  if (rule === "longest-wait") control.rank = r => -r.waitedSeconds;
  if (rule === "weighted-wait") control.rank = r => -r.waitedSeconds * (r.channel === "delivery" ? deliveryWeight : 1);
  if (backfill) control.backfill = true;
  if (day.tables.rule === "limit-empty-seats") {
    const limit = day.tables.maxEmptySeats!;
    control.chooseTable = (size, free) => free.find(table => table.capacity - size <= limit)?.index ?? null;
  }
  return control;
}

/** Paid staff hours in one day. */
export function laborCost(day: DayPolicy, wage: Record<Role, number>): number {
  return ROLES.reduce((sum, role) => sum + day.staffing[role].reduce((a, b) => a + b, 0) * wage[role], 0);
}
