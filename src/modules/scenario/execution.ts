import {
  canonicalJson, completeSimulationRun, DomainValidationError, failSimulationRun, financialInputContentKey,
  prepareSimulationRun, resolveScenario, validateProject,
  type DomainIssue, type FinancialResult, type Project, type ResolvedScenario, type SimulationRun,
} from "../../core";
import { aggregateSimulationRuns, resolveReplicationPlan } from "./statistics";
import type { ResolvedReplicationPlan, ScenarioEvaluation, ScenarioExecutionInput } from "./types";

/**
 * Materialize derived demand and a single run's seed in an isolated project copy.
 * Source refs stay stable; the frozen run contains the exact effective config.
 * Replication seeds are execution inputs, not edits to the stored Scenario.
 */
function executionProject(project: Project, scenarioId: string | undefined, configuration: ResolvedScenario["configuration"]): Project {
  const copy = structuredClone(project);
  if (scenarioId === undefined) copy.base = structuredClone(configuration);
  else {
    const scenario = copy.scenarios.find(item => item.id === scenarioId)!;
    scenario.overrides = { ...scenario.overrides, demand: structuredClone(configuration.demand), simulation: structuredClone(configuration.simulation) };
  }
  return copy;
}

/** Headless Scenario → demand recalculation → isolated seeded DES → optional finance. */
export async function runScenarioReplications<F extends FinancialResult = FinancialResult>(input: ScenarioExecutionInput<F>): Promise<ScenarioEvaluation<F>> {
  const runs: SimulationRun[] = [], issues: DomainIssue[] = [];
  let resolved: ResolvedScenario | null = null, replication: ResolvedReplicationPlan | null = null;
  try {
    validateProject(input.project);
    if (!input.runIdPrefix.trim()) throw new DomainValidationError("runIdPrefix", "must be non-empty");
    if (!Number.isFinite(Date.parse(input.startedAt)) || !Number.isFinite(Date.parse(input.completedAt)) || Date.parse(input.completedAt) < Date.parse(input.startedAt))
      throw new DomainValidationError("timestamps", "provide ordered ISO start/completion timestamps");
    replication = resolveReplicationPlan(input.replication);
    resolved = resolveScenario(input.project, input.scenarioId);
    const configuration = resolved.configuration;
    if (!configuration.market || !configuration.demandParameters || !configuration.operation || !configuration.simulation)
      throw new DomainValidationError("scenario.configuration", "market, demand parameters, operation and simulation must be configured");
    const demand = input.modules.demandModel.calculate({ market: structuredClone(configuration.market), parameters: structuredClone(configuration.demandParameters) });
    if (canonicalJson(demand.model) !== canonicalJson(input.modules.demandModel.descriptor))
      throw new DomainValidationError("demand.model", "result must match injected demand model version");
    configuration.demand = structuredClone(demand);
    for (let index = 0; index < replication.count; index++) {
      const perRun = structuredClone(configuration);
      perRun.simulation = { ...configuration.simulation, seed: replication.seeds[index], replications: 1 };
      const prepared = prepareSimulationRun(executionProject(input.project, input.scenarioId, perRun), {
        id: `${input.runIdPrefix}:${index + 1}`, engine: input.modules.simulationEngine.descriptor,
        createdAt: input.startedAt, ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
      });
      if (!prepared.ok) {
        issues.push(...prepared.issues);
        return { ok: false, resolved, replication, runs, aggregate: null, financial: null, issues };
      }
      let run = prepared.run;
      try {
        const result = await input.modules.simulationEngine.run({ runId: run.id, snapshot: run.snapshot, operationModel: input.modules.operationModel });
        run = completeSimulationRun(run, result, input.completedAt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run = failSimulationRun(run, message, input.completedAt);
        runs.push(run);
        issues.push({ code: "replication-failed", path: `replication.${index + 1}`, message });
        return { ok: false, resolved, replication, runs, aggregate: null, financial: null, issues };
      }
      runs.push(run);
    }
    const aggregate = aggregateSimulationRuns(runs);
    let financial: F | null = null;
    if (input.modules.financialEngine) {
      if (!configuration.financial) throw new DomainValidationError("financial", "financial engine supplied without financial assumptions");
      const financialInput = { simulationRuns: structuredClone(runs), assumption: structuredClone(configuration.financial) };
      const contentKey = financialInputContentKey(financialInput);
      financial = input.modules.financialEngine.calculate(financialInput);
      if (canonicalJson(financial.engine) !== canonicalJson(input.modules.financialEngine.descriptor) || financial.inputContentKey !== contentKey || financialInputContentKey(financial.input) !== contentKey)
        throw new DomainValidationError("financial.lineage", "financial result must preserve engine version and exact replication/assumption inputs");
      canonicalJson(financial);
    }
    return { ok: true, resolved, replication, runs, aggregate, financial, issues };
  } catch (error) {
    issues.push({ code: "scenario-evaluation-failed", path: error instanceof DomainValidationError ? error.path : "scenario", message: error instanceof Error ? error.message : String(error) });
    return { ok: false, resolved, replication, runs, aggregate: null, financial: null, issues };
  }
}
