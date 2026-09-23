import { resolveScenario, type FinancialAssumption, type Project, type SimulationFrame, type SimulationRun } from "../core";
import { TransparentDemandModel } from "../modules/demand";
import { TransparentFinancialEngine, type FinancialAnalysisResult } from "../modules/financial";
import { MockMarketProvider } from "../modules/market";
import { restaurantOperationModel } from "../modules/operation";
import { discreteEventSimulationEngine } from "../modules/simulation";
import { runOneWaySensitivity, runScenarioReplications, type ScenarioEvaluation, type SensitivityResult, type ParameterDescriptor } from "../modules/scenario";
import { compareStoreScenarios, createComparisonScenarios, type ScenarioComparison } from "./scenarioAnalysis";
import type { CustomScenarioInputs, SensitivityChoice } from "./workflow";
import { prepareTesterSample, type TesterSampleInput } from "./testerSample";

export type WorkflowAnalysisRequest =
  | { kind: "sample"; input: TesterSampleInput }
  | { kind: "operation"; project: Project; now: string }
  | { kind: "comparison"; project: Project; custom: CustomScenarioInputs; now: string }
  | { kind: "sensitivity"; project: Project; parameter: SensitivityChoice; now: string }
  | { kind: "financial"; runs: SimulationRun[]; assumption: FinancialAssumption };
export type WorkflowAnalysisResult =
  | { kind: "sample"; prepared: Awaited<ReturnType<typeof prepareTesterSample>>;
      evaluation: ScenarioEvaluation<FinancialAnalysisResult>; frames: SimulationFrame[];
      comparison: ScenarioComparison<FinancialAnalysisResult>; sensitivity: SensitivityResult<FinancialAnalysisResult>; financial: FinancialAnalysisResult }
  | { kind: "operation"; evaluation: ScenarioEvaluation<FinancialAnalysisResult>; frames: SimulationFrame[] }
  | { kind: "comparison"; comparison: ScenarioComparison<FinancialAnalysisResult> }
  | { kind: "sensitivity"; sensitivity: SensitivityResult<FinancialAnalysisResult> }
  | { kind: "financial"; financial: FinancialAnalysisResult };
export type WorkflowWorkerReply = { ok: true; result: WorkflowAnalysisResult } | { ok: false; error: string };

const modules = {
  marketProvider: new MockMarketProvider(), demandModel: new TransparentDemandModel(),
  operationModel: restaurantOperationModel, simulationEngine: discreteEventSimulationEngine,
  financialEngine: new TransparentFinancialEngine(),
};

/** Same pure engines as the headless API, executed in a worker by the product. */
export async function executeWorkflowAnalysis(request: WorkflowAnalysisRequest): Promise<WorkflowAnalysisResult> {
  if (request.kind === "sample") {
    const prepared = await prepareTesterSample(request.input);
    const { now, session, custom } = prepared;
    const operation = await executeWorkflowAnalysis({ kind: "operation", project: session.project, now });
    if (operation.kind !== "operation" || !operation.evaluation.ok) throw new Error("샘플 가상영업을 준비하지 못했습니다.");
    const comparison = await executeWorkflowAnalysis({ kind: "comparison", project: session.project, custom, now });
    if (comparison.kind !== "comparison" || !comparison.comparison.ok) throw new Error("샘플 시나리오 비교를 준비하지 못했습니다.");
    const sensitivity = await executeWorkflowAnalysis({ kind: "sensitivity", project: session.project, parameter: prepared.sensitivity, now });
    if (sensitivity.kind !== "sensitivity" || !sensitivity.sensitivity.results.every(point => point.evaluation.ok)) throw new Error("샘플 민감도를 준비하지 못했습니다.");
    const financial = modules.financialEngine.calculate({ simulationRuns: operation.evaluation.runs, assumption: prepared.configuration.financial });
    return { kind: "sample", prepared, evaluation: operation.evaluation, frames: operation.frames,
      comparison: comparison.comparison, sensitivity: sensitivity.sensitivity, financial };
  }
  if (request.kind === "financial") return { kind: "financial", financial: modules.financialEngine.calculate({ simulationRuns: request.runs, assumption: request.assumption }) };
  const config = request.project.base.simulation;
  if (!config) throw new Error("가상영업 시간을 먼저 설정해 주세요.");
  if (config.replications > 10) throw new Error("화면에서는 반복실험을 최대 10회까지 실행할 수 있습니다.");
  const common = { project: request.project, replication: { count: config.replications, seedStrategy: "sequential" as const, baseSeed: config.seed },
    runIdPrefix: `${request.kind}-${request.now}`, startedAt: request.now, completedAt: request.now };
  if (request.kind === "operation") {
    const frames: SimulationFrame[] = [];
    const evaluation = await runScenarioReplications<FinancialAnalysisResult>({ ...common, modules: {
      demandModel: modules.demandModel, operationModel: modules.operationModel,
      simulationEngine: { descriptor: modules.simulationEngine.descriptor, run: input => modules.simulationEngine.run({ ...input,
        ...(input.snapshot.input.config.seed === config.seed ? { observation: { intervalSeconds: 30, onFrame: frame => frames.push(frame) } } : {}),
      }) },
    } });
    return { kind: "operation", evaluation, frames: evaluation.ok ? frames : [] };
  }
  if (request.kind === "comparison") {
    const base = request.project.base, custom = request.custom;
    if (!base.market || !base.demandParameters || !base.financial) throw new Error("상권·수요·비용 가정을 먼저 설정해 주세요.");
    const prepared = createComparisonScenarios(request.project, { idPrefix: `comparison-${request.now}`, createdAt: request.now, boundConversionRate: true,
      customOverrides: {
        demandParameters: { visitConversionRate: base.demandParameters.visitConversionRate * (1 + custom.conversionChangePercent / 100) },
        financial: { averageSpendingPerCustomer: (base.financial.averageSpendingPerCustomer ?? base.operation!.averageSpendingPerCustomer) * (1 + custom.spendingChangePercent / 100) },
        operation: { resources: { cooks: custom.cooks, kitchenConcurrentOrders: custom.kitchenConcurrentOrders } },
      },
    });
    return { kind: "comparison", comparison: await compareStoreScenarios({ ...common, ...prepared, period: base.market.period,
      // Reuse the explicitly loaded profile, preserving its exact provenance and site lineage.
      modules: { ...modules, marketProvider: { descriptor: base.market.provider, fetch: async () => structuredClone(base.market!) } },
    }) };
  }
  const resolved = resolveScenario(request.project);
  const c = resolved.configuration;
  let parameter: ParameterDescriptor, values: number[];
  switch (request.parameter) {
    case "conversion": {
      parameter = { path: "demandParameters.visitConversionRate", label: "방문 전환율", unit: "ratio", description: "다른 가정은 유지하고 방문 전환율만 변경" };
      const base = c.demandParameters!.visitConversionRate;
      values = [0.25, 0.5, 1, 2, 3].map(factor => Math.min(1, base * factor)); break;
    }
    case "seats": {
      parameter = { path: "layout.seatCount", label: "좌석 정원", unit: "seats", description: "공간 적합성을 검증하지 않은 운영 정원 가정" };
      const base = resolved.layout!.confirmedCapacity!;
      values = [0.5, 0.75, 1, 1.25, 1.5].map(factor => Math.max(resolved.layout!.tableCount, Math.round(base * factor))); break;
    }
    case "kitchen": {
      parameter = { path: "operation.resources.kitchenConcurrentOrders", label: "동시 조리 자리", unit: "orders", description: "조리사 수를 유지하고 주방 자리만 변경" };
      const base = c.operation!.resources.kitchenConcurrentOrders;
      values = [Math.max(1, base - 2), Math.max(1, base - 1), base, base + 1, base + 2]; break;
    }
    case "spending": {
      parameter = { path: "financial.averageSpendingPerCustomer", label: "홀 객단가", unit: "KRW/customer", description: "수요는 유지하고 홀 고객당 가격만 변경" };
      const base = c.financial!.averageSpendingPerCustomer!;
      values = [0.8, 0.9, 1, 1.1, 1.2].map(factor => Math.round(base * factor)); break;
    }
  }
  values = [...new Set(values)].sort((a, b) => a - b);
  return { kind: "sensitivity", sensitivity: await runOneWaySensitivity({ ...common, modules, parameter,
    values: values.map(value => ({ kind: "absolute", value })), scenarioIdPrefix: `sensitivity-${request.now}`,
  }) };
}
