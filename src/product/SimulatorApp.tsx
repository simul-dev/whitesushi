import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  updateProjectBase, type DemandProfile, type MarketProfile, type SimulationFrame, type Site,
} from "../core";
import {
  checkpointWorkflow, createWorkflowConfiguration, sampleWorkflowSession, sanitizeMapping, workflowInputKeys,
  type CandidateDetails, type CustomScenarioInputs, type SensitivityChoice,
} from "../application/workflow";
import type { WorkflowAnalysisRequest, WorkflowAnalysisResult, WorkflowWorkerReply } from "../application/workflowAnalysis";
import type { ScenarioComparison } from "../application/scenarioAnalysis";
import { MockMarketProvider, fetchMarketProfile } from "../modules/market";
import { TransparentDemandModel } from "../modules/demand";
import type { FinancialAnalysisResult } from "../modules/financial";
import type { ScenarioEvaluation, SensitivityResult } from "../modules/scenario";
import { toStoreLayout, type FloorPlan, type LayoutMapping } from "../modules/space";
import { SpaceWorkspace } from "../modules/space/ui";
import { ProductShell, WORKFLOW_STEPS } from "./ProductShell";
import { SiteStep } from "./SiteStep";
import { SpaceStep, PlanThumbnail } from "./SpaceStep";
import { OperationStep } from "./operation";
import { MarketStep, DemandStep, ScenarioStep, FinancialStep, ReviewStep } from "./analysis";
import type { StepStatus, WorkflowStep } from "./types";

const initialStep = (): WorkflowStep => WORKFLOW_STEPS.find(s => s.id === window.location.hash.slice(1))?.id ?? "site";
const jobNames = { market: "예시 상권 자료를 준비하고 있습니다…", operation: "같은 조건으로 가상영업을 반복하고 있습니다…", comparison: "네 가지 운영 조건을 비교하고 있습니다…", sensitivity: "한 가지 가정의 영향을 비교하고 있습니다…", financial: "완료된 영업 결과로 수익구조를 계산하고 있습니다…" };
type Job = keyof typeof jobNames;
type Stamped<T> = { value: T; key: string };

export default function SimulatorApp() {
  const [session, setSession] = useState(() => sampleWorkflowSession(new Date().toISOString()));
  const [plan, setPlan] = useState(session.document);
  const initialPlan = useRef(session.document);
  const planSignature = useRef(JSON.stringify(session.document));
  const [mapping, setMapping] = useState<LayoutMapping>(session.mapping);
  const [spaceConfirmed, setSpaceConfirmed] = useState(false);
  const [candidate, setCandidate] = useState<CandidateDetails>({ projectName: "새 후보점", brandName: "", address: "", notes: "", knownAreaM2: null });
  const [configuration, setConfiguration] = useState(createWorkflowConfiguration);
  const [custom, setCustom] = useState<CustomScenarioInputs>({ conversionChangePercent: 0, spendingChangePercent: 0, cooks: 3, kitchenConcurrentOrders: 4 });
  const [sensitivityParameter, setSensitivityParameter] = useState<SensitivityChoice>("conversion");
  const [step, setStep] = useState<WorkflowStep>(initialStep);
  const [market, setMarket] = useState<Stamped<MarketProfile> | null>(null);
  const [demand, setDemand] = useState<Stamped<DemandProfile> | null>(null);
  const [operation, setOperation] = useState<Stamped<ScenarioEvaluation<FinancialAnalysisResult>> | null>(null);
  const [frames, setFrames] = useState<SimulationFrame[]>([]);
  const [financial, setFinancial] = useState<Stamped<FinancialAnalysisResult> | null>(null);
  const [comparison, setComparison] = useState<Stamped<ScenarioComparison<FinancialAnalysisResult>> | null>(null);
  const [sensitivity, setSensitivity] = useState<Stamped<SensitivityResult<FinancialAnalysisResult>> | null>(null);
  const [job, setJob] = useState<Job | null>(null), [error, setError] = useState("");
  const worker = useRef<Worker | null>(null), requestVersion = useRef(0);
  const keys = useMemo(() => workflowInputKeys({ candidate, plan, mapping, configuration, market: market?.value ?? null, custom, sensitivity: sensitivityParameter }), [candidate, plan, mapping, configuration, market, custom, sensitivityParameter]);
  const layout = useMemo(() => {
    try { return toStoreLayout(plan, { id: session.layoutId, revision: session.documentRevision, storeId: session.project.site.id,
      documentId: session.documentId, documentRevision: session.documentRevision, mapping: sanitizeMapping(plan, mapping) }); }
    catch { return null; }
  }, [plan, mapping, session]);
  const readySite = !!candidate.projectName.trim() && !!candidate.brandName.trim() && !!candidate.address.trim();
  const marketStale = !!market && (!readySite || market.key !== keys.site);
  const demandStale = !!demand && (demand.key !== keys.demand || marketStale);
  const operationStale = !!operation && (operation.key !== keys.operation || !spaceConfirmed || marketStale || demandStale);
  const financialStale = !!financial && (financial.key !== keys.financial || operationStale);
  const comparisonStale = !!comparison && (comparison.key !== keys.comparison || !spaceConfirmed || marketStale || demandStale);
  const sensitivityStale = !!sensitivity && (sensitivity.key !== keys.sensitivity || !spaceConfirmed || marketStale || demandStale);
  const analysisBlock = !readySite ? "site" : "";
  const operationBlock = !readySite ? "site" : !spaceConfirmed ? "space" : !market || marketStale ? "market" : !demand || demandStale ? "demand" : "";
  const blockMessages: Record<string, string> = { site: "후보지에서 점포명·브랜드·주소를 먼저 입력해 주세요.", space: "공간설계에서 출입구와 좌석 정원을 확인해 주세요.", market: "상권분석에서 현재 후보지의 자료를 불러와 주세요.", demand: "수요가정에서 변경한 가정으로 유입 수요를 계산해 주세요." };

  const cancelTask = useCallback(() => {
    requestVersion.current++; worker.current?.terminate(); worker.current = null; setJob(null); setError("");
  }, []);
  useEffect(() => () => { requestVersion.current++; worker.current?.terminate(); }, []);
  useEffect(() => { const listener = () => setStep(initialStep()); window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }, []);
  function navigate(next: WorkflowStep) {
    setStep(next); window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const changePlan = useCallback((next: FloorPlan) => {
    const signature = JSON.stringify(next);
    if (signature === planSignature.current) return;
    planSignature.current = signature; cancelTask(); setPlan(next);
    setMapping(previous => sanitizeMapping(next, previous)); setSpaceConfirmed(false);
  }, [cancelTask]);
  const replaceDocument = useCallback(() => { cancelTask(); setMapping({}); setSpaceConfirmed(false); }, [cancelTask]);
  function checkpoint(currentMarket: MarketProfile | null = market?.value ?? null) {
    const next = checkpointWorkflow({ session, candidate, plan, mapping, configuration, market: currentMarket, now: new Date().toISOString() });
    setSession(next); return next;
  }
  async function loadMarket() {
    cancelTask(); const version = ++requestVersion.current; setJob("market");
    try {
      const current = checkpoint(null), now = new Date();
      const outcome = await fetchMarketProfile(new MockMarketProvider(), { site: current.project.site,
        period: { from: new Date(now.getTime() - 28 * 86400000).toISOString(), to: now.toISOString() } });
      if (version !== requestVersion.current) return;
      if (outcome.status === "unavailable") throw new Error(outcome.issues.map(i => i.message).join(" · "));
      setMarket({ value: outcome.profile, key: keys.site });
      setSession({ ...current, project: updateProjectBase(current.project, { market: outcome.profile }, now.toISOString()) });
    } catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === requestVersion.current) setJob(null); }
  }
  function calculateDemand() {
    cancelTask();
    try {
      if (!market || marketStale) throw new Error(blockMessages.market);
      const profile = new TransparentDemandModel().calculate({ market: market.value, parameters: configuration.demandParameters });
      setDemand({ value: profile, key: keys.demand });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function startWorker(request: WorkflowAnalysisRequest, stamp: string) {
    cancelTask(); const version = ++requestVersion.current; setJob(request.kind);
    try {
      const activeWorker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }); worker.current = activeWorker;
      const finish = () => { activeWorker.terminate(); if (worker.current === activeWorker) worker.current = null; if (version === requestVersion.current) setJob(null); };
      activeWorker.onmessage = (event: MessageEvent<WorkflowWorkerReply>) => {
        if (version !== requestVersion.current) { finish(); return; }
        if (!event.data.ok) setError(event.data.error);
        else acceptResult(event.data.result, stamp);
        finish();
      };
      activeWorker.onerror = () => { if (version === requestVersion.current) setError("분석을 실행하지 못했습니다. 페이지를 새로고침하기 전에 도면을 JSON으로 저장하고 다시 시도해 주세요."); finish(); };
      activeWorker.postMessage(request);
    } catch (e) { setJob(null); setError(e instanceof Error ? e.message : String(e)); }
  }
  function acceptResult(result: WorkflowAnalysisResult, stamp: string) {
    switch (result.kind) {
      case "operation":
        setOperation({ value: result.evaluation, key: stamp }); setFrames(result.frames);
        if (!result.evaluation.ok) setError(result.evaluation.issues.map(i => i.message).join(" · "));
        break;
      case "comparison": setComparison({ value: result.comparison, key: stamp }); if (!result.comparison.ok) setError(result.comparison.issues.map(i => i.message).join(" · ")); break;
      case "sensitivity": setSensitivity({ value: result.sensitivity, key: stamp }); break;
      case "financial": setFinancial({ value: result.financial, key: stamp }); break;
    }
  }
  function runAnalysis(kind: "operation" | "comparison" | "sensitivity") {
    try {
      if (operationBlock) throw new Error(blockMessages[operationBlock]);
      const current = checkpoint(), now = new Date().toISOString();
      if (kind === "operation") startWorker({ kind, project: current.project, now }, keys.operation);
      else if (kind === "comparison") startWorker({ kind, project: current.project, custom, now }, keys.comparison);
      else startWorker({ kind, project: current.project, parameter: sensitivityParameter, now }, keys.sensitivity);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function calculateFinancial() {
    if (!operation?.value.ok || operationStale) { setError("가상영업에서 현재 조건으로 먼저 실행해 주세요."); return; }
    startWorker({ kind: "financial", runs: operation.value.runs, assumption: configuration.financial }, keys.financial);
  }
  const status = (value: unknown, stale: boolean, running = false): StepStatus => running ? "running" : !value ? "empty" : stale ? "stale" : "ready";
  const statuses = {
    site: readySite ? "ready" : "empty", space: spaceConfirmed ? "ready" : "empty",
    market: status(market, marketStale, job === "market"), demand: status(demand, demandStale),
    operation: status(operation?.value.ok, operationStale, job === "operation"),
    scenario: status(comparison?.value.ok, comparisonStale || sensitivityStale, job === "comparison" || job === "sensitivity"),
    financial: status(financial, financialStale, job === "financial"),
    review: status(financial && comparison?.value.ok, financialStale || comparisonStale || sensitivityStale || operationStale),
  } satisfies Record<WorkflowStep, StepStatus>;
  const displaySite: Site = { ...session.project.site, name: candidate.projectName || "새 후보점", address: candidate.address || null };
  function exportReview() {
    if (!readySite || financialStale || comparisonStale || operationStale || sensitivityStale || !financial || !comparison?.value.ok) return;
    const data = { product: "AI Store Simulator", exportedAt: new Date().toISOString(), candidate, layout,
      market: market?.value, demand: demand?.value, configuration, operation: operation?.value.ok ? operation.value.aggregate : null,
      financial: { ...financial.value, input: { assumption: financial.value.input.assumption, runIds: financial.value.input.simulationRuns.map(r => r.id) } },
      scenarios: comparison.value.rows.map(row => ({ kind: row.kind, demand: row.demand, aggregate: row.evaluation.aggregate,
        assumptions: row.evaluation.resolved ? { demand: row.evaluation.resolved.configuration.demandParameters,
          operation: row.evaluation.resolved.configuration.operation, simulation: row.evaluation.resolved.configuration.simulation,
          financial: row.evaluation.resolved.configuration.financial } : null,
        monthlyRevenue: row.evaluation.financial?.monthlyRevenue, operatingProfit: row.evaluation.financial?.operatingProfit })),
      sensitivity: sensitivity ? { parameter: sensitivity.value.parameter, baseValue: sensitivity.value.baseValue,
        points: sensitivity.value.results.map(point => ({ parameterValue: point.parameterValue, aggregate: point.evaluation.aggregate,
          monthlyRevenue: point.evaluation.financial?.monthlyRevenue, operatingProfit: point.evaluation.financial?.operatingProfit })) } : null,
      interpretation: "명시된 예시 상권과 사용자 가정에 따른 검토 자료이며 출점 권고나 매출 보장이 아닙니다.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "store-review.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <ProductShell candidate={candidate} step={step} statuses={statuses} onNavigate={navigate} busy={job ? jobNames[job] : undefined} error={error} onDismissError={() => setError("")}>
    {step === "site" && <SiteStep value={candidate} onChange={value => { cancelTask(); setCandidate(value); }} onContinue={() => navigate("space")} onOpenSpace={() => navigate("space")} hasPlan={true} planName={plan.name} preview={<PlanThumbnail plan={plan} />} />}
    <div className="product-workflow-panel" hidden={step !== "space"}>
      <SpaceStep plan={plan} mapping={mapping} layout={layout} confirmed={spaceConfirmed}
        onMappingChange={value => { cancelTask(); setMapping(value); setSpaceConfirmed(false); }}
        onConfirm={() => { setSpaceConfirmed(true); navigate("market"); }}>
        <SpaceWorkspace initialPlan={initialPlan.current} active={step === "space"} embedded onPlanChange={changePlan} onDocumentReplace={replaceDocument} />
      </SpaceStep>
    </div>
    {step === "market" && <MarketStep site={displaySite} profile={market?.value ?? null} onRun={loadMarket} busy={job === "market"} stale={marketStale} disabledReason={blockMessages[analysisBlock]} />}
    {step === "demand" && <DemandStep parameters={configuration.demandParameters} profile={demand?.value ?? null} market={market?.value ?? null} config={configuration.simulation}
      onChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, demandParameters: value })); }} onRun={calculateDemand} stale={demandStale}
      disabledReason={!market || marketStale ? blockMessages.market : undefined} />}
    {step === "operation" && <OperationStep run={operation?.value.ok ? operation.value.runs[0] : null} frames={frames} layout={layout} policy={configuration.operation} config={configuration.simulation}
      onPolicyChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, operation: value })); }}
      onConfigChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, simulation: value,
        financial: { ...previous.financial, operatingDayMix: [{ dayType: value.dayType, daysPerMonth: previous.financial.operatingDaysPerMonth, runToDayMultiplier: 1 }] } })); }}
      onRun={() => runAnalysis("operation")} busy={job === "operation"} stale={operationStale} disabledReason={blockMessages[operationBlock]} />}
    {step === "scenario" && <ScenarioStep comparison={comparison?.value ?? null} sensitivity={sensitivity?.value ?? null} custom={custom}
      maxConversionChangePercent={configuration.demandParameters.visitConversionRate > 0 ? (1 / configuration.demandParameters.visitConversionRate - 1) * 100 : undefined}
      onCustomChange={value => { cancelTask(); setCustom(value); }} sensitivityParameter={sensitivityParameter}
      onSensitivityParameterChange={value => { cancelTask(); setSensitivityParameter(value); }}
      onRun={() => runAnalysis("comparison")} onRunSensitivity={() => runAnalysis("sensitivity")} busy={job === "comparison"} sensitivityBusy={job === "sensitivity"}
      stale={comparisonStale || sensitivityStale} disabledReason={blockMessages[operationBlock]} />}
    {step === "financial" && <FinancialStep assumptions={configuration.financial} result={financial?.value ?? null} operation={configuration.operation}
      onChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, financial: { ...value, revision: previous.financial.revision + 1 } })); }}
      onRun={calculateFinancial} scenarioName="기준 조건" busy={job === "financial"} stale={financialStale}
      disabledReason={!operation?.value.ok || operationStale ? "가상영업에서 현재 조건으로 먼저 실행해 주세요." : undefined} />}
    {step === "review" && <ReviewStep candidate={candidate} layout={layout} market={market?.value ?? null} operation={operation?.value ?? null}
      financial={financial?.value ?? null} comparison={comparison?.value ?? null} sensitivity={sensitivity?.value ?? null}
      stale={financialStale || comparisonStale || sensitivityStale || operationStale || marketStale || demandStale} onExport={exportReview} />}
    {step !== "site" && step !== "space" && <div className="product-page product-actions product-next-actions"><button className="product-button product-button-secondary" onClick={() => navigate(WORKFLOW_STEPS[Math.max(0, WORKFLOW_STEPS.findIndex(s => s.id === step) - 1)].id)}>이전 단계</button>{step !== "review" && <button className="product-button product-button-primary" onClick={() => navigate(WORKFLOW_STEPS[WORKFLOW_STEPS.findIndex(s => s.id === step) + 1].id)}>다음 단계로</button>}</div>}
    <p className="product-session-note">현재 브라우저에서 작업 중입니다. 페이지를 닫기 전에 공간설계의 JSON 저장과 출점검토의 검토 자료 저장을 이용하세요. 상권은 예시 자료이며 실제 주소를 조회하지 않습니다.</p>
  </ProductShell>;
}
