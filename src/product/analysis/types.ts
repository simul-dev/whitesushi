import type { DemandParameters, DemandProfile, FinancialAssumption, MarketProfile, OperationPolicy, SimulationConfig, Site, StoreLayout } from "../../core";
import type { ScenarioComparison } from "../../application/scenarioAnalysis";
import type { FinancialAnalysisResult } from "../../modules/financial";
import type { ScenarioEvaluation, SensitivityResult } from "../../modules/scenario";

export interface AnalysisStatusProps { busy?: boolean; stale?: boolean; error?: string | null; disabledReason?: string | null }
export interface MarketStepProps extends AnalysisStatusProps { site: Site; profile: MarketProfile | null; onRun(): void }
export interface DemandStepProps extends AnalysisStatusProps {
  parameters: DemandParameters; profile: DemandProfile | null; market: MarketProfile | null;
  config: SimulationConfig; onChange(parameters: DemandParameters): void; onRun(): void;
}
export interface CustomScenarioInputs { conversionChangePercent: number; spendingChangePercent: number; cooks: number; kitchenConcurrentOrders: number }
export type SensitivityChoice = "conversion" | "seats" | "kitchen" | "spending";
export interface ScenarioStepProps extends AnalysisStatusProps {
  comparison: ScenarioComparison<FinancialAnalysisResult> | null;
  sensitivity: SensitivityResult<FinancialAnalysisResult> | null;
  custom: CustomScenarioInputs; onCustomChange(custom: CustomScenarioInputs): void;
  maxConversionChangePercent?: number;
  sensitivityParameter: SensitivityChoice; onSensitivityParameterChange(choice: SensitivityChoice): void;
  onRun(): void; onRunSensitivity(): void; sensitivityBusy?: boolean;
}
export interface FinancialStepProps extends AnalysisStatusProps {
  assumptions: FinancialAssumption; operation: OperationPolicy; result: FinancialAnalysisResult | null;
  onChange(assumptions: FinancialAssumption): void; onRun(): void; scenarioName?: string;
}
export interface ReviewCandidate { projectName: string; brandName: string; address: string; notes: string; knownAreaM2: number | null }
export interface ReviewStepProps {
  candidate: ReviewCandidate; layout: StoreLayout | null; market: MarketProfile | null;
  operation: ScenarioEvaluation<FinancialAnalysisResult> | null; financial: FinancialAnalysisResult | null;
  comparison: ScenarioComparison<FinancialAnalysisResult> | null; sensitivity: SensitivityResult<FinancialAnalysisResult> | null;
  stale?: boolean; exporting?: boolean; onExport?(): void;
}
