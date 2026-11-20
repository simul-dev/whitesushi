/** The task statement an agent (or a person) receives, generated from the same constants the scorer uses. */
import { SCENARIOS, DEV_SEEDS, TEST_SEEDS } from "./scenarios";
import { DELIVERY_ACCEPT_SECONDS, DURATIONS, ECONOMICS, KITCHEN_SLOTS, MARGIN, PACKAGING_SECONDS, PARTY_SIZES, SEATING_PATIENCE_SECONDS, SERVICE_LEVELS, SERVICE_TIME_CV, STAFF_LIMITS, TABLES } from "./store";

export function describeProblem(): string {
  const L = SERVICE_LEVELS, hours = SCENARIOS[0].dineIn.map((_, i) => `${11 + i}`.padStart(3)).join("");
  return `# Restaurant operations benchmark

You run one synthetic sushi bar for three different days. For each day you choose hourly staffing and two operating rules.
A discrete-event simulator plays the day many times (random arrivals and service times) and scores your choice.

## Store
- Open for new guests 11:00-21:00; the day is observed until 22:00. Staffing slots are the 11 hours 11:00 ... 21:00.
- Tables (seats each): ${TABLES.join(", ")} (${TABLES.length} tables, ${TABLES.reduce((a, b) => a + b, 0)} seats). One party per table, no sharing or joining.
- Party sizes: ${PARTY_SIZES.map(p => `${p.size} (${p.probability * 100}%)`).join(", ")}.
- Hall guest flow: seat -> order (server ${DURATIONS.orderingSeconds}s) -> cook (cook + kitchen station ${DURATIONS.cookingSeconds}s) -> serve (server ${DURATIONS.servingSeconds}s)
  -> dine ${DURATIONS.diningSeconds}s -> pay (cashier ${DURATIONS.paymentSeconds}s) -> clean (server ${DURATIONS.cleaningSeconds}s). The table is held from seating to the end of cleaning.
- Delivery order flow: cook (cook + kitchen station ${DURATIONS.cookingSeconds}s) -> pack (cook ${PACKAGING_SECONDS}s). Delivery shares the same cooks and ${KITCHEN_SLOTS} kitchen stations.
- Every service time is the value above times a lognormal factor with mean 1 and coefficient of variation ${SERVICE_TIME_CV}.
- A party that is not seated within ${SEATING_PATIENCE_SECONDS / 60} minutes leaves (lost). A delivery order whose cooking has not started within ${DELIVERY_ACCEPT_SECONDS / 60} minutes is cancelled (lost).

## Demand (expected per hour; arrivals are Poisson)
\`\`\`
hour            ${hours}
${SCENARIOS.map(s => `${s.id.padEnd(15)} hall guests ${s.dineIn.map(v => `${v}`.padStart(3)).join("")}\n${"".padEnd(15)} delivery    ${s.delivery.map(v => `${v}`.padStart(3)).join("")}`).join("\n")}
\`\`\`

## Decisions (JSON)
- staffing.cooks / servers / cashiers: 11 integers each (11:00 ... 21:00). Limits: cooks ${STAFF_LIMITS.cooks.join("-")}, servers ${STAFF_LIMITS.servers.join("-")}, cashiers ${STAFF_LIMITS.cashiers.join("-")}. Staff leaving at the hour finish their current task.
- dispatch.rule: who gets a free cook / server / cashier / table first when several wait.
  fifo (first request first), dine-in-first, delivery-first, longest-wait, weighted-wait (delivery waiting counts deliveryWeight times).
  dispatch.backfill: false = a waiting request blocks later requests for the same resources (strict queue); true = later requests may start if they fit.
- tables.rule: best-fit (smallest free table that fits) or limit-empty-seats with maxEmptySeats (wait rather than waste seats).
- A policy has a "default" day policy and optional "byScenario" overrides, so each day may get its own plan.

## Score
- Profit per day = hall guests served x ${MARGIN.dineInCustomer} KRW + delivery orders completed x ${MARGIN.deliveryOrder} KRW - paid staff hours
  (cook ${ECONOMICS.hourlyWage.cooks}, server ${ECONOMICS.hourlyWage.servers}, cashier ${ECONOMICS.hourlyWage.cashiers} KRW per hour). Guests still in the store at 22:00 do not count.
- Service levels per day, pooled over all replications: hall guests lost <= ${L.dineInLostRateMax * 100}%, 90th percentile of a hall guest's total queueing time <= ${L.dineInP90WaitSecondsMax / 60} min,
  delivery orders lost <= ${L.deliveryLostRateMax * 100}%, 90th percentile delivery wait for the kitchen <= ${L.deliveryP90KitchenWaitSecondsMax / 60} min.
- A policy that meets every service level on every day ranks above any policy that does not; then by total profit over the three days.
- Design on the dev seeds (${DEV_SEEDS[0]}-${DEV_SEEDS.at(-1)}). Final scores use the test seeds (${TEST_SEEDS[0]}-${TEST_SEEDS.at(-1)}), which you must not tune on.

## Example policy
\`\`\`json
{ "name": "example", "default": { "staffing": { "cooks": [2,2,2,2,2,2,2,2,2,2,2], "servers": [2,2,2,2,2,2,2,2,2,2,2], "cashiers": [1,1,1,1,1,1,1,1,1,1,1] },
  "dispatch": { "rule": "fifo", "backfill": false }, "tables": { "rule": "best-fit" } } }
\`\`\`
`;
}
