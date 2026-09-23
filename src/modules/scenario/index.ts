/** UI-free Scenario / Replication / Sensitivity public API. */
export * from "./types";
export { aggregateNumbers, aggregateSimulationRuns, replicationComparisonKey, resolveReplicationPlan } from "./statistics";
export { createScenarioVariant, deriveCapacityLayout, readParameter, resolveParameterValue, SENSITIVITY_PARAMETERS } from "./parameters";
export { runScenarioReplications } from "./execution";
export { runOneWaySensitivity } from "./sensitivity";
