import { canonicalJson, completeSimulationRun, DomainValidationError, validateSimulationSnapshot, type SimulationRun } from "../../core";
import { SIMULATION_KPIS, type NumericAggregate, type ReplicationPlan, type ResolvedReplicationPlan, type SimulationAggregate } from "./types";

function integer(value: number, path: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new DomainValidationError(path, `must be an integer in [${min}, ${max}]`);
}
export function resolveReplicationPlan(plan: ReplicationPlan): ResolvedReplicationPlan {
  integer(plan.count, "replication.count", 1, 100000);
  let seeds: number[];
  if (plan.seedStrategy === "explicit") {
    if (!Array.isArray(plan.seeds) || plan.seeds.length !== plan.count)
      throw new DomainValidationError("replication.seeds", "seed count must match replication count");
    seeds = [...plan.seeds];
  } else if (plan.seedStrategy === "sequential") {
    integer(plan.baseSeed, "replication.baseSeed", 0, 0xffffffff);
    integer(plan.step ?? 1, "replication.step", 1, 0xffffffff);
    // Deliberately reject uint32 wraparound instead of accidentally reusing seeds.
    seeds = Array.from({ length: plan.count }, (_, i) => plan.baseSeed + i * (plan.step ?? 1));
  } else throw new DomainValidationError("replication.seedStrategy", "unsupported seed strategy");
  seeds.forEach(seed => integer(seed, "replication.seed", 0, 0xffffffff));
  if (new Set(seeds).size !== seeds.length)
    throw new DomainValidationError("replication.seeds", "independent replications require distinct seeds");
  return { count: plan.count, seedStrategy: plan.seedStrategy, seeds };
}

export function aggregateNumbers(values: readonly number[]): NumericAggregate {
  if (!values.length || values.some(value => !Number.isFinite(value)))
    throw new DomainValidationError("aggregate.values", "requires at least one finite value");
  const sorted = [...values].sort((a, b) => a - b);
  // Online mean / sample variance avoids summing large nearly equal squares.
  let mean = 0, squaredDifferences = 0;
  values.forEach((value, index) => { const delta = value - mean; mean += delta / (index + 1); squaredDifferences += delta * (value - mean); });
  const percentile = (p: number) => {
    const position = (sorted.length - 1) * p, lower = Math.floor(position), fraction = position - lower;
    return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
  };
  const standardDeviation = values.length < 2 ? null : Math.sqrt(Math.max(0, squaredDifferences / (values.length - 1)));
  const result = { count: values.length, mean, min: sorted[0], max: sorted[sorted.length - 1], standardDeviation, percentiles: { p05: percentile(0.05), p50: percentile(0.5), p95: percentile(0.95) } };
  canonicalJson(result); // Overflow is an explicit failure, never an Infinity result.
  return result;
}

export function replicationComparisonKey(run: SimulationRun): string {
  const snapshot = structuredClone(run.snapshot);
  snapshot.input.config.seed = 0;
  return canonicalJson({ engine: snapshot.engine, projectRef: snapshot.projectRef, scenarioRef: snapshot.scenarioRef, input: snapshot.input, lineage: snapshot.lineage });
}

export function aggregateSimulationRuns(runs: readonly SimulationRun[]): SimulationAggregate {
  if (!runs.length) throw new DomainValidationError("aggregate.runs", "at least one completed run is required");
  const expected = replicationComparisonKey(runs[0]);
  const ids = new Set<string>(), seeds = new Set<number>();
  for (const run of runs) {
    validateSimulationSnapshot(run.snapshot);
    if (run.status !== "completed" || !run.result || !run.completedAt)
      throw new DomainValidationError("aggregate.runs", "failed, missing, or prepared runs cannot enter aggregates");
    completeSimulationRun({ ...run, status: "prepared", result: null, completedAt: null, error: null }, run.result, run.completedAt);
    if (run.snapshot.input.config.replications !== 1)
      throw new DomainValidationError("aggregate.replications", "each snapshot must represent exactly one replication");
    if (replicationComparisonKey(run) !== expected)
      throw new DomainValidationError("aggregate.inputs", "replications must share scenario, inputs, horizon, and versions; only seed may vary");
    if (ids.has(run.id) || seeds.has(run.snapshot.input.config.seed))
      throw new DomainValidationError("aggregate.runs", "run IDs and seeds must be distinct");
    ids.add(run.id); seeds.add(run.snapshot.input.config.seed);
  }
  const values = runs.map(run => run.result!);
  const metrics = Object.fromEntries(SIMULATION_KPIS.map(key => [key, aggregateNumbers(values.map(result => key === "customersUnfinished"
    ? result.customersUnfinished ?? result.customersArrived - result.customersServed - result.customersLost
    : result[key]))])) as SimulationAggregate["metrics"];
  const channelMetrics: SimulationAggregate["channelMetrics"] = {};
  // Additive channel extensions remain compatible with old, dine-in-only engines.
  for (const key of ["averageDineInFoodWaitingSeconds", "maxDineInFoodWaitingSeconds"]) {
    const samples = values.map(result => (result as unknown as Record<string, unknown>)[key]);
    if (samples.every(value => typeof value === "number")) channelMetrics[key] = aggregateNumbers(samples as number[]);
    else if (samples.some(value => value !== undefined)) throw new DomainValidationError(`aggregate.${key}`, "channel metric must be provided by every replication");
  }
  const deliveryResults = values.map(result => (result as unknown as { delivery?: Record<string, unknown> }).delivery);
  if (deliveryResults.every(result => result !== undefined)) {
    for (const key of ["ordersArrived", "ordersCompleted", "ordersLost", "ordersUnfinished", "throughputOrdersPerHour", "averageKitchenWaitingSeconds", "maxKitchenWaitingSeconds", "averageTimeInSystemSeconds"])
      channelMetrics[`delivery.${key}`] = aggregateNumbers(deliveryResults.map(result => result![key] as number));
  } else if (deliveryResults.some(result => result !== undefined))
    throw new DomainValidationError("aggregate.delivery", "delivery metrics must be present in all or none of the replications");
  const resourceShape = (run: SimulationRun) => (run.result!.resourceUtilization ?? []).map(({ resourceId, capacityUnits }) => ({ resourceId, capacityUnits })).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  const resources = resourceShape(runs[0]);
  if (runs.some(run => canonicalJson(resourceShape(run)) !== canonicalJson(resources)))
    throw new DomainValidationError("aggregate.resources", "resource definitions must match across replications");
  const bottlenecks = new Map<string, number>();
  values.forEach(result => new Set(result.bottlenecks.map(item => item.resource)).forEach(resource => bottlenecks.set(resource, (bottlenecks.get(resource) ?? 0) + 1)));
  return {
    schemaVersion: 1, engine: { ...runs[0].snapshot.engine }, projectRef: { ...runs[0].snapshot.projectRef }, scenarioRef: structuredClone(runs[0].snapshot.scenarioRef),
    runIds: [...ids], seeds: [...seeds], comparisonContentKey: expected, metrics, channelMetrics,
    resourceUtilization: resources.map(resource => ({ ...resource, utilization: aggregateNumbers(values.map(result => result.resourceUtilization!.find(item => item.resourceId === resource.resourceId)!.utilization)) })),
    bottlenecks: [...bottlenecks].map(([resource, replicationCount]) => ({ resource, replicationCount, replicationFraction: replicationCount / runs.length })).sort((a, b) => b.replicationCount - a.replicationCount || a.resource.localeCompare(b.resource)),
    assumptions: [{ id: "replication-statistics", description: "Equal-weight independent seeded replications of one fixed scenario/horizon. Sample SD uses n−1; p05/p50/p95 interpolate empirical order statistics and are not confidence intervals. Means of per-run waiting/utilization KPIs are not pooled customer-weighted estimates.", value: { count: runs.length, seeds: [...seeds] }, unit: "replications", source: "scenario/1.0.0" }],
  };
}
