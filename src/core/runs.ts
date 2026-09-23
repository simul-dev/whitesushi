import type {
  DomainIssue, FinancialAssumption, FinancialInput, FinancialResult, MarketProfile,
  ModuleVersion, Project, SimulationResult, SimulationRun, SimulationSnapshot,
} from "./types";
import { resolveScenario, sameRef, siteContentKey } from "./projects";
import { canonicalJson, DomainValidationError, moduleVersion, number, text, timestamp, validateFinancial } from "./validation";

export const marketContentKey = (market: MarketProfile) => canonicalJson(market);
export const demandParametersContentKey = (parameters: NonNullable<Project["base"]["demandParameters"]>) => canonicalJson(parameters);
const snapshotContentKey = (snapshot: Pick<SimulationSnapshot, "engine" | "input" | "lineage">) =>
  canonicalJson({ engine: snapshot.engine, input: snapshot.input, lineage: snapshot.lineage });
const snapshotIntegrityKey = (snapshot: Pick<SimulationSnapshot, "schemaVersion" | "projectRef" | "scenarioRef" | "contentKey">) =>
  canonicalJson({ schemaVersion: snapshot.schemaVersion, projectRef: snapshot.projectRef, scenarioRef: snapshot.scenarioRef, contentKey: snapshot.contentKey });

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export type PreparationResult = { ok: true; snapshot: SimulationSnapshot } | { ok: false; issues: DomainIssue[] };

/** Prepare inputs only. This does not implement or execute any simulation model. */
export function prepareSimulationInput(project: Project, engine: ModuleVersion, scenarioId?: string): PreparationResult {
  moduleVersion(engine, "engine");
  const resolved = resolveScenario(project, scenarioId), config = resolved.configuration;
  const issues: DomainIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  for (const key of ["market", "demandParameters", "demand", "operation", "simulation"] as const)
    if (config[key] === null) add("missing-input", key, `${key} has not been configured`);
  if (!resolved.layout) add("missing-input", "layoutRef", "Select a registered layout revision");
  if (config.market && (!sameRef(config.market.siteRef, resolved.site) || config.market.siteContentKey !== siteContentKey(resolved.site)))
    add("stale-market", "market", "Site inputs changed; refresh the market profile");
  if (config.demand && config.market && (!sameRef(config.demand.lineage.marketRef, config.market) || config.demand.lineage.marketContentKey !== marketContentKey(config.market)))
    add("stale-demand", "demand.lineage.market", "Market inputs changed; recompute demand");
  if (config.demand && config.demandParameters && config.demand.lineage.parametersContentKey !== demandParametersContentKey(config.demandParameters))
    add("stale-demand", "demand.lineage.parameters", "Demand assumptions changed; recompute demand");
  if (resolved.layout) {
    resolved.layout.issues.filter((issue) => issue.code === "unresolved-wall-reference").forEach((issue) => issues.push(structuredClone(issue)));
    if (resolved.layout.confirmedCapacity === null || resolved.layout.confirmedCapacity <= 0)
      add("unconfirmed-capacity", "layout.confirmedCapacity", "Confirm operational customer capacity");
    const tables = resolved.layout.geometry.elements.filter((e) => e.kind === "object" && e.type === "table");
    if (tables.some((table) => !resolved.layout!.assignments.tables.some((a) => a.elementId === table.id && a.capacity !== null && a.capacity > 0)))
      add("unassigned-tables", "layout.assignments.tables", "Confirm the capacity of each table");
    if (!resolved.layout.assignments.entranceIds.length)
      add("unassigned-entrance", "layout.assignments.entranceIds", "Identify at least one customer entrance");
    if (config.operation && config.operation.resources.kitchenConcurrentOrders > 0 && !resolved.layout.assignments.kitchenStationIds.length)
      add("unassigned-kitchen", "layout.assignments.kitchenStationIds", "Assign kitchen stations for the configured kitchen resource");
    if (config.operation && (config.operation.resources.servers > 0 || config.operation.resources.cashiers > 0) && !resolved.layout.assignments.serviceStationIds.length)
      add("unassigned-service", "layout.assignments.serviceStationIds", "Assign service stations for the configured service resources");
  }
  if (config.simulation && config.operation && !config.operation.operatingWindows.some((w) => w.dayType === config.simulation!.dayType))
    add("missing-hours", "operation.operatingWindows", "Specify operating hours for the simulated day type");
  if (config.simulation && config.demand) {
    const first = Math.floor(config.simulation.startMinute / 60);
    const last = Math.ceil((config.simulation.startMinute * 60 + config.simulation.durationSeconds) / 3600);
    for (let hour = first; hour < last; hour++) {
      if (!config.demand.buckets.some((b) => b.dayType === config.simulation!.dayType && b.hour === hour))
        add("missing-demand-hour", `demand.buckets.${hour}`, `Explicit arrivals (including zero) are required for hour ${hour}`);
    }
  }
  if (issues.length) return { ok: false, issues };
  // Each nullable section was checked above; never synthesize missing parameters.
  if (!resolved.layout || !config.market || !config.demandParameters || !config.demand || !config.operation || !config.simulation)
    throw new DomainValidationError("input", "incomplete simulation configuration");
  const snapshot: SimulationSnapshot = {
    schemaVersion: 1,
    projectRef: resolved.projectRef,
    scenarioRef: resolved.scenarioRef,
    engine: structuredClone(engine),
    input: { layout: resolved.layout, demand: config.demand, operation: config.operation, config: config.simulation },
    lineage: { site: resolved.site, market: config.market, demandParameters: config.demandParameters },
    contentKey: "",
    integrityKey: "",
  };
  snapshot.contentKey = snapshotContentKey(snapshot);
  snapshot.integrityKey = snapshotIntegrityKey(snapshot);
  return { ok: true, snapshot: freeze(snapshot) };
}
export function prepareSimulationRun(project: Project, input: { id: string; engine: ModuleVersion; createdAt: string; scenarioId?: string }):
  { ok: true; run: SimulationRun } | { ok: false; issues: DomainIssue[] } {
  text(input.id, "run.id"); timestamp(input.createdAt, "run.createdAt");
  const result = prepareSimulationInput(project, input.engine, input.scenarioId);
  if (!result.ok) return result;
  return { ok: true, run: freeze({ id: input.id, status: "prepared", snapshot: result.snapshot, createdAt: input.createdAt, completedAt: null, result: null, error: null }) };
}
/** Verify a prepared snapshot before an engine consumes it. This is not a security signature. */
export function validateSimulationSnapshot(snapshot: SimulationSnapshot) {
  if (snapshot.schemaVersion !== 1)
    throw new DomainValidationError("run.snapshot.schemaVersion", "unsupported snapshot version");
  if (snapshotContentKey(snapshot) !== snapshot.contentKey || snapshotIntegrityKey(snapshot) !== snapshot.integrityKey)
    throw new DomainValidationError("run.snapshot", "stored input snapshot was modified");
}
function checkSnapshot(run: SimulationRun) { validateSimulationSnapshot(run.snapshot); }
export function assessRunStaleness(run: SimulationRun, project: Project, engine: ModuleVersion): { stale: boolean; issues: DomainIssue[] } {
  const issues: DomainIssue[] = [];
  try { checkSnapshot(run); } catch (error) {
    issues.push({ code: "modified-snapshot", path: "run.snapshot", message: error instanceof Error ? error.message : String(error) });
  }
  if (run.snapshot.projectRef.id !== project.id)
    issues.push({ code: "different-project", path: "project.id", message: "Run belongs to a different project" });
  const scenarioId = run.snapshot.scenarioRef?.id;
  if (scenarioId && !project.scenarios.some((s) => s.id === scenarioId))
    issues.push({ code: "missing-scenario", path: "scenario.id", message: "The source scenario no longer exists" });
  if (issues.length) return { stale: true, issues };
  let current: PreparationResult;
  try { current = prepareSimulationInput(project, engine, scenarioId); }
  catch (error) {
    return { stale: true, issues: [{ code: "invalid-current-input", path: "project", message: error instanceof Error ? error.message : String(error) }] };
  }
  if (!current.ok) return { stale: true, issues: current.issues };
  if (current.snapshot.contentKey !== run.snapshot.contentKey)
    issues.push({ code: "changed-input", path: "run.snapshot", message: "Effective inputs or module versions changed; rerun the simulation" });
  return { stale: issues.length > 0, issues };
}
export function completeSimulationRun(run: SimulationRun, result: SimulationResult, completedAt: string): SimulationRun {
  checkSnapshot(run);
  if (run.status !== "prepared") throw new DomainValidationError("run.status", "only a prepared run can complete");
  timestamp(completedAt, "run.completedAt");
  if (Date.parse(completedAt) < Date.parse(run.createdAt)) throw new DomainValidationError("run.completedAt", "completion precedes creation");
  if (result.runId !== run.id) throw new DomainValidationError("result.runId", "result belongs to another run");
  for (const field of ["customersArrived", "customersServed", "customersLost"] as const) number(result[field], `result.${field}`, 0, Number.MAX_SAFE_INTEGER, true);
  for (const field of ["averageWaitingSeconds", "maxWaitingSeconds", "throughputCustomersPerHour", "averageCustomerTimeInSystemSeconds", "revenue"] as const) number(result[field], `result.${field}`);
  for (const field of ["tableUtilization", "kitchenUtilization", "staffUtilization"] as const) number(result[field], `result.${field}`, 0, 1);
  if (result.customersServed + result.customersLost > result.customersArrived) throw new DomainValidationError("result.customers", "served + lost exceeds arrivals");
  if (result.customersUnfinished !== undefined) {
    number(result.customersUnfinished, "result.customersUnfinished", 0, Number.MAX_SAFE_INTEGER, true);
    if (result.customersServed + result.customersLost + result.customersUnfinished !== result.customersArrived)
      throw new DomainValidationError("result.customers", "served + lost + unfinished must equal arrivals");
  }
  if (result.maxWaitingSeconds < result.averageWaitingSeconds) throw new DomainValidationError("result.waiting", "maximum is smaller than average");
  if (result.currency !== run.snapshot.input.operation.currency) throw new DomainValidationError("result.currency", "must match operation currency");
  result.revenueByHour.forEach((b) => { number(b.hour, "result.revenue.hour", 0, 23, true); number(b.revenue, "result.revenue.value"); });
  if (result.hourlyThroughput !== undefined) {
    if (new Set(result.hourlyThroughput.map((b) => b.hour)).size !== result.hourlyThroughput.length)
      throw new DomainValidationError("result.hourlyThroughput", "duplicate hour");
    result.hourlyThroughput.forEach((b) => {
      number(b.hour, "result.hourlyThroughput.hour", 0, 23, true);
      number(b.customersServed, "result.hourlyThroughput.customersServed", 0, Number.MAX_SAFE_INTEGER, true);
      const { startMinute, durationSeconds } = run.snapshot.input.config;
      if (b.hour < Math.floor(startMinute / 60) || b.hour >= Math.ceil((startMinute * 60 + durationSeconds) / 3600))
        throw new DomainValidationError("result.hourlyThroughput.hour", "hour is outside the observation interval");
    });
    if (result.hourlyThroughput.reduce((sum, b) => sum + b.customersServed, 0) !== result.customersServed)
      throw new DomainValidationError("result.hourlyThroughput", "hourly completions must sum to customers served");
  }
  if (result.resourceUtilization !== undefined) {
    if (new Set(result.resourceUtilization.map((r) => r.resourceId)).size !== result.resourceUtilization.length)
      throw new DomainValidationError("result.resourceUtilization", "duplicate resource");
    result.resourceUtilization.forEach((r) => {
      text(r.resourceId, "result.resourceUtilization.resourceId");
      number(r.capacityUnits, "result.resourceUtilization.capacityUnits", 0, Number.MAX_SAFE_INTEGER, true);
      number(r.utilization, "result.resourceUtilization.utilization", 0, 1);
    });
  }
  if (result.revenueStatus !== undefined && result.revenueStatus !== "not-modeled")
    throw new DomainValidationError("result.revenueStatus", "unsupported revenue status");
  if (result.revenueStatus === "not-modeled" && (result.revenue !== 0 || result.revenueByHour.some((b) => b.revenue !== 0)))
    throw new DomainValidationError("result.revenue", "unmodeled revenue must remain zero");
  canonicalJson(result);
  return freeze({ ...structuredClone(run), status: "completed", completedAt, result: structuredClone(result), error: null });
}
export function failSimulationRun(run: SimulationRun, error: string, completedAt: string): SimulationRun {
  checkSnapshot(run);
  if (run.status !== "prepared") throw new DomainValidationError("run.status", "only a prepared run can fail");
  text(error, "run.error"); timestamp(completedAt, "run.completedAt");
  if (Date.parse(completedAt) < Date.parse(run.createdAt)) throw new DomainValidationError("run.completedAt", "completion precedes creation");
  return freeze({ ...structuredClone(run), status: "failed", completedAt, result: null, error });
}
/** Financial lineage support only; no revenue/cost calculations happen here. */
export function financialInputContentKey(input: FinancialInput): string {
  validateFinancial(input.assumption);
  if (!input.simulationRuns.length) throw new DomainValidationError("financial.runs", "at least one completed simulation run is required");
  input.simulationRuns.forEach((run) => {
    checkSnapshot(run);
    if (run.status !== "completed" || !run.result) throw new DomainValidationError("financial.runs", "all runs must have completed results");
    if (run.result.currency !== input.assumption.currency) throw new DomainValidationError("financial.currency", "simulation and financial currency differ");
  });
  return canonicalJson(input);
}
export function isFinancialResultStale(result: FinancialResult, runs: SimulationRun[], assumption: FinancialAssumption, engine: ModuleVersion): boolean {
  return result.inputContentKey !== financialInputContentKey(result.input) ||
    result.inputContentKey !== financialInputContentKey({ simulationRuns: runs, assumption }) ||
    canonicalJson(result.engine) !== canonicalJson(engine);
}
