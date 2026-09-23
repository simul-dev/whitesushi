import type {
  DemandParameters, DemandProfile, DomainIssue, FinancialInput, FinancialResult,
  MarketProfile, ModuleVersion, OperationPolicy, OperationProcess, Project, SimulationResult,
  SimulationSnapshot, Site, StoreLayout,
} from "./types";

/** Provider contract; concrete providers live outside Core and preserve provenance. */
export interface MarketProvider {
  readonly descriptor: ModuleVersion;
  fetch(input: { site: Site; period: MarketProfile["period"] }): Promise<MarketProfile>;
}
export interface DemandModel {
  readonly descriptor: ModuleVersion;
  calculate(input: { market: MarketProfile; parameters: DemandParameters }): DemandProfile;
}
/** Industry-specific resource/geometry checks belong to its operation model. */
export interface OperationModel {
  readonly descriptor: ModuleVersion;
  validate(input: { layout: StoreLayout; policy: OperationPolicy }): DomainIssue[];
  defineProcess(input: { layout: StoreLayout; policy: OperationPolicy }): OperationProcess;
}
/** A versioned engine must reproduce a snapshot's values/seed; no UI types cross this port. */
export interface SimulationEngine {
  readonly descriptor: ModuleVersion;
  /** Inject the version-matched industry model; engine must not hardcode restaurant stages. */
  run(input: { runId: string; snapshot: SimulationSnapshot; operationModel: OperationModel }): Promise<SimulationResult>;
}
export interface FinancialEngine {
  readonly descriptor: ModuleVersion;
  calculate(input: FinancialInput): FinancialResult;
}
/** Optional future persistence adapter, not implemented by this phase. */
export interface ProjectRepository {
  load(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
}
