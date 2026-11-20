# restaurant-ops-bench

**Can an AI plan a restaurant's day better than the rules a manager writes, and can you prove it before trying it on real guests?**

A small benchmark where every operating plan is judged by a discrete-event simulation (DES), not by opinion.
One synthetic 38-seat sushi bar with a delivery channel, three operating days, and a plan made of hourly staffing,
a queue rule for the shared kitchen and staff, and a table rule. The simulator replays each day many times with random
arrivals and service times, then scores profit under hard service levels.

The point it makes: an LLM proposes, the simulator validates. A plan that looks sensible on paper can still break a
service level when guests arrive in bunches, and the only way to know before opening the doors is to run it.

## The problem in one screen

`npm run bench -- describe` prints the full task statement (it is generated from the same constants the scorer uses).

- **Store**: 8 counter seats, four 2-tops, four 4-tops, one 6-top. Hall guests: seat, order, cook, serve, dine, pay, clean.
  Delivery orders: cook, pack. Both channels share 5 kitchen stations and the same cooks.
- **Days**: `weekday` (sharp lunch and dinner peaks), `weekend` (busy all day), `rainy-weekend` (fewer walk-ins, 2.4x delivery).
- **Uncertainty**: Poisson arrivals, lognormal service times (CV 0.35), guests leave after 20 minutes at the door,
  delivery orders are cancelled if cooking has not started within 15 minutes.
- **Decisions** (JSON): cooks / servers / cashiers for each hour 11:00 ... 21:00; who goes first when several wait
  (`fifo`, `dine-in-first`, `delivery-first`, `longest-wait`, `weighted-wait`) and whether a blocked request holds the line;
  `best-fit` tables or `limit-empty-seats`. Each day may have its own plan.
- **Score**: daily profit = food margin of guests served + delivery margin of orders completed - paid staff hours.
  Service levels (pooled over replications): hall lost <= 5%, hall p90 total queueing <= 15 min,
  delivery lost <= 5%, delivery p90 kitchen wait <= 10 min. Plans that meet every level on every day rank first, then by total profit.
- **Seeds**: tune on dev seeds 1-20; final numbers use test seeds 101-150 (50 replications per day).

## Results (test seeds)

| policy | meets service levels | total daily profit (KRW) | weekday | weekend | rainy-weekend |
|---|---|---|---|---|---|
| sim-search | yes | 818.4만 | 202.2만 | 316.3만 | 299.9만 |
| llm-agent | yes | 812.4만 | 204.6만 | 312.6만 | 295.2만 |
| workload-rule-fifo | no | 805.2만 | 206.6만 | 305.1만 ✗ | 293.5만 |
| fixed-4-2-fifo | no | 733.8만 | 168.6만 | 292.7만 ✗ | 272.5만 |
| fixed-2-2-dine-in-first | no | 730.4만 | 190.4만 ✗ | 292.5만 ✗ | 247.6만 ✗ |
| fixed-2-2-fifo | no | 728.2만 | 192.2만 ✗ | 288.2만 ✗ | 247.8만 ✗ |
| fixed-2-2-delivery-first | no | 644.9만 | 184.8만 ✗ | 258.5만 ✗ | 201.6만 ✗ |

- `fixed-2-2-*` are the original app defaults (2 cooks, 2 servers all day). The queue rule alone cannot rescue them:
  `delivery-first` saves delivery and loses the hall, `dine-in-first` does the opposite.
- `fixed-4-2-fifo` buys safety with labour and still fails the weekend: the weekend bottleneck is the tables, not the kitchen.
- `workload-rule-fifo` staffs each hour from the forecast, the way a careful manager would. It is close on profit and misses one service level.
- `sim-search` is a plain greedy search that lets the simulator judge every change. It changes the table rule and the queue rule
  per day and trims staff hour by hour, and meets every service level with the highest profit.
- `llm-agent` is a coding agent given only the task statement and the `eval` command, limited to 12 dev evaluations,
  with no access to the source code or the other policies. With 11 evaluations it reached 99% of `sim-search`'s profit,
  which used 952 day-evaluations; it never tried the table rule. See [`results/llm-agent.md`](results/llm-agent.md).

Full per-day numbers: [`results/leaderboard.md`](results/leaderboard.md).

## Run it

```bash
npm ci
npm run bench -- describe                                  # the task
npm run bench -- eval bench/policies/sim-search.json --split dev
npm run bench -- optimize                                  # re-run the simulation-based search (about a minute)
npm run bench -- leaderboard bench/policies/*.json         # score baselines + given policies on the test seeds
npm run bench:llm -- --model <model id> --evals 12         # LLM loop through the Anthropic API (needs credentials)
npx vitest run bench src/modules/simulation/control.test.ts
```

A policy file looks like this:

```json
{ "name": "example",
  "default": { "staffing": { "cooks": [2,2,2,2,2,2,2,2,2,2,2], "servers": [2,2,2,2,2,2,2,2,2,2,2], "cashiers": [1,1,1,1,1,1,1,1,1,1,1] },
               "dispatch": { "rule": "fifo", "backfill": false }, "tables": { "rule": "best-fit" } },
  "byScenario": { "weekend": { "tables": { "rule": "limit-empty-seats", "maxEmptySeats": 2 } } } }
```

## How it is built

The engine is the project's own `generic-des` engine (`src/modules/simulation/engine.ts`) with optional policy hooks
(`EngineControl`: queue rank, backfill, table choice, hourly capacity schedule, service-time noise, per-party outcome records).
Without hooks it reproduces the reference results exactly; the whole project test suite runs against it.
Each run takes about 7 ms, so a full leaderboard (6 policies x 3 days x 50 seeds) finishes in seconds.

| File | Role |
|---|---|
| `src/store.ts` | the synthetic store, economics and service levels |
| `src/scenarios.ts` | demand for the three days, dev and test seeds |
| `src/policy.ts` | policy JSON, validation, mapping to engine hooks |
| `src/evaluate.ts` | runs and scores a policy |
| `src/baselines.ts` | rule-based baselines |
| `src/optimize.ts` | simulation-based greedy search |
| `llm/agent.ts` | propose-evaluate-revise loop for an LLM |

## Limits (read before quoting a number)

- Every number is an illustrative assumption. The store, demand, prices and wages are synthetic and calibrated to nothing.
  The benchmark ranks decision methods on a fixed model; it does not predict any real restaurant.
- One table per party (no joining tables), one cook per dish, no menu mix, no batching, no walking distances, no reservations,
  no rider model for delivery. Staff leaving at the hour finish their task; nobody is pre-empted.
- Service levels are pooled over replications, so a plan can pass while having bad individual days.
- Test seeds are public. Fair play means designing on the dev seeds only.
