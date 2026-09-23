import { DomainValidationError, resolveScenario, type FinancialResult } from "../../core";
import { runScenarioReplications } from "./execution";
import { createScenarioVariant, readParameter, resolveParameterValue } from "./parameters";
import { resolveReplicationPlan } from "./statistics";
import type { ParameterDescriptor, ParameterValue, ScenarioExecutionInput, SensitivityResult } from "./types";

/** One factor at a time: points never inherit changes made by preceding points. */
export async function runOneWaySensitivity<F extends FinancialResult = FinancialResult>(input: ScenarioExecutionInput<F> & {
  parameter: ParameterDescriptor;
  values: ParameterValue[];
  scenarioIdPrefix: string;
}): Promise<SensitivityResult<F>> {
  if (!input.values.length || input.values.length > 10000)
    throw new DomainValidationError("sensitivity.values", "provide between 1 and 10000 points");
  if (!input.scenarioIdPrefix.trim()) throw new DomainValidationError("sensitivity.scenarioIdPrefix", "must be non-empty");
  const baseline = resolveScenario(input.project, input.scenarioId);
  const baseValue = readParameter(baseline, input.parameter.path);
  const replication = resolveReplicationPlan(input.replication);
  const results: SensitivityResult<F>["results"] = [];
  for (const [index, requestedValue] of input.values.entries()) {
    const scenarioId = `${input.scenarioIdPrefix}:${index + 1}`;
    const parameterValue = resolveParameterValue(baseValue, requestedValue);
    const project = createScenarioVariant(input.project, {
      id: scenarioId, name: `${input.parameter.label}: ${parameterValue} ${input.parameter.unit}`, createdAt: input.startedAt,
      ...(input.scenarioId === undefined ? {} : { baseScenarioId: input.scenarioId }),
      changes: [{ path: input.parameter.path, value: requestedValue }],
    });
    const evaluation = await runScenarioReplications({
      ...input, project, scenarioId, runIdPrefix: `${input.runIdPrefix}:${index + 1}`,
      replication: { count: replication.count, seedStrategy: "explicit", seeds: replication.seeds },
    });
    results.push({ parameterValue, requestedValue: structuredClone(requestedValue), scenarioRef: { id: scenarioId, revision: 1 }, evaluation });
  }
  return { schemaVersion: 1, method: "one-way", parameter: structuredClone(input.parameter), baseValue, baseScenarioRef: baseline.scenarioRef, results };
}
