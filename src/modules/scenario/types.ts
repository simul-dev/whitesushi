import type {
  ArtifactRef, Assumption, DayType, DemandModel, DemandParameters, DomainIssue, FinancialAssumption,
  FinancialEngine, FinancialResult, ModuleVersion, OperationModel, OperationPolicy, Project,
  ResolvedScenario, ServiceDurations, SimulationEngine, SimulationRun,
} from "../../core";

/** Percent changes are relative (−20 means ×0.8); absolute ratio values remain 0..1. */
export type ParameterValue = { kind: "absolute"; value: number } | { kind: "percentage-change"; percent: number };
type NumericKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T] & string;
export type NumericParameterPath =
  | `demandParameters.${NumericKeys<DemandParameters>}`
  | `demandParameters.deliveryOrdersByHour.${DayType}.${number}.expectedOrdersPerHour`
  | `operation.resources.${NumericKeys<OperationPolicy["resources"]>}`
  | `operation.durations.${NumericKeys<ServiceDurations>}`
  | "operation.averageSpendingPerCustomer"
  | `financial.${Exclude<NumericKeys<FinancialAssumption>, "revision">}`
  | "layout.tableCount" | "layout.seatCount";
export interface ParameterDescriptor {
  path: NumericParameterPath;
  label: string;
  unit: string;
  /** Metadata only; Core validation remains authoritative for admissible values. */
  description: string;
}
export interface ParameterChange { path: NumericParameterPath; value: ParameterValue }

export type ReplicationPlan =
  | { count: number; seedStrategy: "sequential"; baseSeed: number; step?: number }
  | { count: number; seedStrategy: "explicit"; seeds: number[] };
export interface ResolvedReplicationPlan { count: number; seedStrategy: "sequential" | "explicit"; seeds: number[] }
export interface NumericAggregate {
  count: number; mean: number; min: number; max: number;
  /** Sample standard deviation (n−1); null when n=1, never false certainty of zero. */
  standardDeviation: number | null;
  /** Empirical, linearly interpolated percentiles (not a confidence interval). */
  percentiles: { p05: number; p50: number; p95: number };
}
export const SIMULATION_KPIS = [
  "customersArrived", "customersServed", "customersLost", "customersUnfinished",
  "throughputCustomersPerHour", "averageWaitingSeconds", "maxWaitingSeconds",
  "tableUtilization", "kitchenUtilization", "staffUtilization", "averageCustomerTimeInSystemSeconds",
] as const;
export type SimulationKpi = typeof SIMULATION_KPIS[number];
export interface SimulationAggregate {
  schemaVersion: 1;
  engine: ModuleVersion;
  projectRef: ArtifactRef;
  scenarioRef: ArtifactRef | null;
  runIds: string[];
  seeds: number[];
  /** Exact common simulation inputs/upstream lineage, with only seed normalized to 0. */
  comparisonContentKey: string;
  metrics: Record<SimulationKpi, NumericAggregate>;
  /** Optional channel KPIs are present only if every replication models them. */
  channelMetrics: Record<string, NumericAggregate>;
  resourceUtilization: { resourceId: string; capacityUnits: number; utilization: NumericAggregate }[];
  bottlenecks: { resource: string; replicationCount: number; replicationFraction: number }[];
  assumptions: Assumption[];
}
export interface ScenarioModules<F extends FinancialResult = FinancialResult> {
  demandModel: DemandModel;
  operationModel: OperationModel;
  simulationEngine: SimulationEngine;
  financialEngine?: Omit<FinancialEngine, "calculate"> & { calculate(input: Parameters<FinancialEngine["calculate"]>[0]): F };
}
export interface ScenarioExecutionInput<F extends FinancialResult = FinancialResult> {
  project: Project;
  scenarioId?: string;
  replication: ReplicationPlan;
  runIdPrefix: string;
  startedAt: string;
  completedAt: string;
  modules: ScenarioModules<F>;
}
export type ScenarioEvaluation<F extends FinancialResult = FinancialResult> =
  | { ok: true; resolved: ResolvedScenario; replication: ResolvedReplicationPlan; runs: SimulationRun[]; aggregate: SimulationAggregate; financial: F | null; issues: DomainIssue[] }
  | { ok: false; resolved: ResolvedScenario | null; replication: ResolvedReplicationPlan | null; runs: SimulationRun[]; aggregate: null; financial: null; issues: DomainIssue[] };
export interface SensitivityResult<F extends FinancialResult = FinancialResult> {
  schemaVersion: 1;
  method: "one-way";
  parameter: ParameterDescriptor;
  baseValue: number;
  baseScenarioRef: ArtifactRef | null;
  /** Each point restarts from the same baseline and uses the exact same seed list. */
  results: { parameterValue: number; requestedValue: ParameterValue; scenarioRef: ArtifactRef; evaluation: ScenarioEvaluation<F> }[];
}
