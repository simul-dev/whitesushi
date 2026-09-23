import {
  canonicalJson, completeSimulationRun, DomainValidationError, failSimulationRun,
  prepareSimulationRun, updateProjectBase, validateProject,
  type DemandModel, type DomainIssue, type MarketProfile, type MarketProvider,
  type OperationModel, type Project, type SimulationEngine, type SimulationRun,
} from "../core";
import { fetchMarketProfile } from "../modules/market";

export interface StoreAnalysisModules {
  marketProvider: MarketProvider;
  demandModel: DemandModel;
  operationModel: OperationModel;
  simulationEngine: SimulationEngine;
}
export type StoreAnalysisOutcome =
  | { ok: true; project: Project; run: SimulationRun; issues: DomainIssue[] }
  | { ok: false; project: Project; run: SimulationRun | null; issues: DomainIssue[] };

/**
 * Headless base-project pipeline. Defaults, timestamps and provider selection are
 * explicit caller decisions. A failed provider never silently becomes demo data.
 * For replicated scenario comparison, use compareStoreScenarios in scenarioAnalysis.
 */
export async function analyzeStoreProject(input: {
  project: Project;
  period: MarketProfile["period"];
  runId: string;
  startedAt: string;
  completedAt: string;
  modules: StoreAnalysisModules;
  marketTimeoutMs?: number;
}): Promise<StoreAnalysisOutcome> {
  let project = structuredClone(input.project);
  let run: SimulationRun | null = null;
  const issues: DomainIssue[] = [];
  try {
    validateProject(project);
    for (const key of ["demandParameters", "operation", "simulation"] as const) {
      if (!project.base[key]) issues.push({ code: "missing-input", path: key, message: `Configure ${key} before analysis` });
    }
    if (issues.length) return { ok: false, project, run, issues };
    const market = await fetchMarketProfile(input.modules.marketProvider, {
      site: project.site, period: input.period,
    }, input.marketTimeoutMs === undefined ? {} : { timeoutMs: input.marketTimeoutMs });
    issues.push(...market.issues);
    if (market.status === "unavailable") return { ok: false, project, run, issues };
    const demand = input.modules.demandModel.calculate({
      market: structuredClone(market.profile), parameters: structuredClone(project.base.demandParameters!),
    });
    if (canonicalJson(demand.model) !== canonicalJson(input.modules.demandModel.descriptor))
      throw new DomainValidationError("demand.model", "Demand output must match the injected model version");
    project = updateProjectBase(project, { market: market.profile, demand }, input.startedAt);
    const prepared = prepareSimulationRun(project, {
      id: input.runId, engine: input.modules.simulationEngine.descriptor, createdAt: input.startedAt,
    });
    if (!prepared.ok) return { ok: false, project, run, issues: [...issues, ...prepared.issues] };
    run = prepared.run;
    const result = await input.modules.simulationEngine.run({
      runId: run.id, snapshot: run.snapshot, operationModel: input.modules.operationModel,
    });
    run = completeSimulationRun(run, result, input.completedAt);
    return { ok: true, project, run, issues };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({ code: "analysis-failed", path: error instanceof DomainValidationError ? error.path : "analysis", message });
    if (run?.status === "prepared") {
      // If a supplied completion timestamp is invalid, preserve the prepared run
      // and the validation issue instead of masking it with a second exception.
      try { run = failSimulationRun(run, message, input.completedAt); } catch { /* retain prepared snapshot */ }
    }
    return { ok: false, project, run, issues };
  }
}
