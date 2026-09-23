# Core contracts (Phase 2, extended for Phase 3–5)

Pure TypeScript contracts and configuration/provenance operations live here. They
do not import Space, React, Three.js, PDF.js, a server, or a third-party dependency.
Market, Demand, restaurant process and simulation implementations live in their
independent modules. Finance is deferred. Test fixtures and the mock Market
provider are labelled demo data, not live observations.

## Public boundary

Import from `src/core/index.ts`. APIs accept **trusted, typed application values**
and validate numeric ranges, references, configuration completeness and JSON
representability when they create/modify projects. This is not an untrusted
Project JSON parser. Do not cast uploaded JSON to `Project`. A future persistence
or project-import adapter must validate unknown input and migrate schema versions
before calling these APIs. Existing FloorPlan uploads retain Space's validator.

`createProject` accepts injected ID/time/site and an optional layout. It creates no
market observation, demand rate, operational policy, simulation seed or financial
default. It remains valid to save/edit an incomplete project. Run preparation
returns missing-input issues until the required inputs and mappings exist.

`registerLayout` appends immutable `(id, revision)` snapshots. It does not change
the selected layout. `updateProjectBase` replaces complete supplied sections;
omitted sections are unchanged and `null` clears them. `createScenario`,
`updateScenario`, `deleteScenario`, and `resolveScenario` operate without mutating
their arguments. A scenario stores overrides and layout references, not a second
copy of its project. A supplied `updateScenario.overrides` replaces the entire
override document, so removing an override restores inheritance.

Scenario overrides use these semantics:

- Omitted section/field: inherit the current base value.
- `null` section: explicitly clear it.
- Arrays: replace the complete array, including `[]` to clear it.
- Policy resources/durations: merge explicitly named scalar fields.
- Layout, market and derived demand: replace by registered reference/full profile.
- Patching an absent base section is rejected. Initialize that complete base first;
  missing service times, costs or seeds are never filled with invented zeroes.
- Changing demand assumptions invalidates the old demand output; Phase 4 must
  recompute it. Changing observed market content similarly invalidates demand.

Layout geometry uses mm, x-right/y-down/z-up; areas use m² and durations seconds.
Observed chair count is not confirmed customer capacity. In this contract,
confirmed capacity is the sum of explicitly assigned table capacities; unattached
bench seating requires explicit mapping in a future schema. Zero capacity is a
valid stored layout but cannot prepare a customer simulation. Geometric bounds
estimates and unmapped area roles remain visible issues; they alone do not block
runs. Missing entrance/table capacity/stations do block applicable runs, as does
an unresolved original wall reference. The source FloorPlan stays outside core.

Market buckets are one-hour population/traffic observations. Demand buckets are
**individual customers per hour**, not groups/parties. Probabilities are [0,1].
Simulation seed is an unsigned 32-bit integer. Initial simulation windows fit
one selected local day, and overnight operating windows must be split. Every
simulated hour needs an explicit demand bucket; absent data is not zero demand.

## Lineage and reproducibility

Providers record `siteContentKey(site)`. Demand models record
`marketContentKey(market)` and `demandParametersContentKey(parameters)`. These keys
use exact canonical JSON rather than a collision-prone shortened hash.

`prepareSimulationRun` captures and freezes all resolved values, project/scenario
references, layout/model/provider versions, seed/config and upstream site/market/
demand assumptions. Its content key excludes project/scenario labels/revisions
and financial settings because these do not alter simulation inputs. A separate
integrity key checks stored project/scenario provenance. These keys are content
comparisons, **not cryptographic signatures or a security boundary**.

`assessRunStaleness` compares effective input content and module versions, so even
in-place content edits without revision increments are detected. Missing/stale
upstream inputs and deleted scenarios also invalidate a run. Historical snapshots
remain unchanged; renaming projects/scenarios or changing financial assumptions
does not invalidate an otherwise identical simulation. `completeSimulationRun`
and `failSimulationRun` perform a one-way transition from prepared and never
calculate results. Financial lineage compares complete simulation run inputs/
results and financial assumptions separately.

## Parallel module seams

- Market implements `MarketProvider.fetch`, preserving observed/demo provenance.
- Demand implements `DemandModel.calculate` using explicit parameters and lineage.
- Operation implements `OperationModel.validate` and `defineProcess`. The latter
  returns a declarative resource/stage graph with durations, FIFO acquisition,
  release points, timeout transitions and terminal outcomes. It contains the
  industry-specific process; the generic engine schedules it.
- Simulation receives a snapshot and an injected `OperationModel` whose descriptor
  must match `snapshot.input.operation.model`. The engine validates
  that match and graph/resource consistency, uses only seeded randomness, and
  executes one caller-seeded replication per run. Algorithm changes require new
  engine/model versions. No restaurant stages or registry live inside Core.
- Finance implements `FinancialEngine.calculate` from completed runs plus costs;
  monthly scaling assumptions and currency must remain explicit.

`npx vitest run src/core/core.test.ts` checks configuration isolation, invalid
scalars, layout/version references, lineage, incomplete inputs, frozen snapshots,
freshness boundaries and result lifecycle without any renderer or UI.
