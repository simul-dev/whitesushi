import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DemandProfile, type MarketProfile, type SimulationFrame, type Site,
} from "../core";
import {
  checkpointWorkflow, sanitizeMapping, workflowInputKeys, isValidCandidateArea,
  type CandidateDetails, type CustomScenarioInputs, type SensitivityChoice,
} from "../application/workflow";
import type { WorkflowAnalysisRequest, WorkflowAnalysisResult, WorkflowWorkerReply } from "../application/workflowAnalysis";
import type { ScenarioComparison } from "../application/scenarioAnalysis";
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
import { createTesterSampleInput } from "../application/testerSample";

const initialStep = (): WorkflowStep => WORKFLOW_STEPS.find(s => s.id === window.location.hash.slice(1))?.id ?? "site";
const jobNames = { sample: "백초밥 명지점의 샘플 분석을 준비하고 있습니다…", refresh: "변경한 조건을 관련 분석에 자동 반영하고 있습니다…", operation: "가상영업을 계산하고 있습니다…", comparison: "운영 조건을 비교하고 있습니다…", sensitivity: "가정의 영향을 비교하고 있습니다…", financial: "수익구조를 계산하고 있습니다…" };
type Job = keyof typeof jobNames;
type Stamped<T> = { value: T; key: string };

export default function SimulatorApp() {
  const [initial] = useState(() => createTesterSampleInput(new Date().toISOString()));
  const [session, setSession] = useState(initial.session);
  const [plan, setPlan] = useState(session.document);
  const initialPlan = useRef(session.document);
  const planSignature = useRef(JSON.stringify(session.document));
  const [mapping, setMapping] = useState<LayoutMapping>(session.mapping);
  const [spaceConfirmed, setSpaceConfirmed] = useState(false);
  const [sampleSpaceReady, setSampleSpaceReady] = useState(true);
  const spaceReady = spaceConfirmed || sampleSpaceReady;
  const [sampleStatus, setSampleStatus] = useState<"loading" | "ready" | "error" | "edited">("loading");
  const [candidate, setCandidate] = useState<CandidateDetails>(initial.candidate);
  const [configuration, setConfiguration] = useState(initial.configuration);
  const [custom, setCustom] = useState<CustomScenarioInputs>(initial.custom);
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
  const [invalidDraft, setInvalidDraft] = useState(false), [exporting, setExporting] = useState(false);
  const lastAutoAttempt = useRef("");
  const worker = useRef<Worker | null>(null), requestVersion = useRef(0);
  const keys = useMemo(() => workflowInputKeys({ candidate, plan, mapping, configuration, market: market?.value ?? null, custom, sensitivity: sensitivityParameter }), [candidate, plan, mapping, configuration, market, custom, sensitivityParameter]);
  const layout = useMemo(() => {
    try { return toStoreLayout(plan, { id: session.layoutId, revision: session.documentRevision, storeId: session.project.site.id,
      documentId: session.documentId, documentRevision: session.documentRevision, mapping: sanitizeMapping(plan, mapping) }); }
    catch { return null; }
  }, [plan, mapping, session]);
  const readySite = !!candidate.projectName.trim() && !!candidate.brandName.trim() && !!candidate.address.trim() && isValidCandidateArea(candidate.knownAreaM2);
  const marketStale = !!market && (!readySite || market.key !== keys.site);
  const demandStale = !!demand && (demand.key !== keys.demand || marketStale);
  const operationStale = !!operation && (operation.key !== keys.operation || !spaceReady || marketStale || demandStale);
  const financialStale = !!financial && (financial.key !== keys.financial || operationStale);
  const comparisonStale = !!comparison && (comparison.key !== keys.comparison || !spaceReady || marketStale || demandStale);
  const sensitivityStale = !!sensitivity && (sensitivity.key !== keys.sensitivity || !spaceReady || marketStale || demandStale);
  const analysisBlock = !readySite ? "site" : "";
  const operationBlock = !readySite ? "site" : !spaceReady ? "space" : "";
  const blockMessages: Record<string, string> = { site: !isValidCandidateArea(candidate.knownAreaM2) ? "후보지 면적은 0.1 m² 이상으로 입력하거나 비워 주세요." : "후보지에서 점포명·브랜드·주소를 먼저 입력해 주세요.", space: "공간설계에서 출입구와 좌석 정원을 확인해 주세요." };

  const cancelTask = useCallback((edited = true) => {
    requestVersion.current++; worker.current?.terminate(); worker.current = null; setJob(null); setError("");
    if (edited) { setSampleStatus("edited"); lastAutoAttempt.current = ""; }
  }, []);
  useEffect(() => {
    // Each StrictMode setup owns a new generation; edits cancel the whole transaction.
    startWorker({ kind: "sample", input: initial }, "");
    return () => { requestVersion.current++; worker.current?.terminate(); worker.current = null; };
  }, [initial]);
  useEffect(() => {
    if (!readySite || !spaceReady || invalidDraft || job || sampleStatus === "loading") return;
    if (market && demand && operation?.value.ok && financial && comparison?.value.ok && sensitivity &&
      !marketStale && !demandStale && !operationStale && !financialStale && !comparisonStale && !sensitivityStale) {
      if (sampleStatus !== "ready") setSampleStatus("ready");
      return;
    }
    const attempt = keys.comparison + keys.sensitivity;
    if (lastAutoAttempt.current === attempt) return;
    const timer = window.setTimeout(() => { lastAutoAttempt.current = attempt; refreshAll(); }, 550);
    return () => window.clearTimeout(timer);
  }, [keys.comparison, keys.sensitivity, candidate, readySite, spaceReady, invalidDraft, job, sampleStatus]);
  useEffect(() => { const listener = () => { setInvalidDraft(false); setStep(initialStep()); }; window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }, []);
  function navigate(next: WorkflowStep) {
    setInvalidDraft(false);
    setStep(next); window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const changePlan = useCallback((next: FloorPlan) => {
    const signature = JSON.stringify(next);
    if (signature === planSignature.current) return;
    planSignature.current = signature; cancelTask(); setPlan(next);
    setMapping(previous => sanitizeMapping(next, previous)); setSpaceConfirmed(false); setSampleSpaceReady(false);
  }, [cancelTask]);
  const replaceDocument = useCallback(() => { cancelTask(); setMapping({}); setSpaceConfirmed(false); setSampleSpaceReady(false); }, [cancelTask]);
  function checkpoint(currentMarket: MarketProfile | null = market?.value ?? null) {
    const next = checkpointWorkflow({ session, candidate, plan, mapping, configuration, market: currentMarket, now: new Date().toISOString() });
    setSession(next); return next;
  }
  function startWorker(request: WorkflowAnalysisRequest, stamp: string) {
    cancelTask(false); const version = ++requestVersion.current; setJob(request.kind);
    setSampleStatus(previous => request.kind === "sample" ? "loading" : previous === "loading" ? "edited" : previous);
    try {
      const activeWorker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" }); worker.current = activeWorker;
      const finish = () => { activeWorker.terminate(); if (worker.current === activeWorker) worker.current = null; if (version === requestVersion.current) setJob(null); };
      activeWorker.onmessage = (event: MessageEvent<WorkflowWorkerReply>) => {
        if (version !== requestVersion.current) { finish(); return; }
        if (!event.data.ok) { setError(event.data.error); if (request.kind === "sample") setSampleStatus("error"); }
        else acceptResult(event.data.result, stamp);
        finish();
      };
      activeWorker.onerror = () => { if (version === requestVersion.current) { setError("분석을 실행하지 못했습니다. 페이지를 새로고침하기 전에 도면을 JSON으로 저장하고 다시 시도해 주세요."); if (request.kind === "sample") setSampleStatus("error"); } finish(); };
      activeWorker.postMessage(request);
    } catch (e) { worker.current?.terminate(); worker.current = null; setJob(null); setError(e instanceof Error ? e.message : String(e)); if (request.kind === "sample") setSampleStatus("error"); }
  }
  function acceptResult(result: WorkflowAnalysisResult, stamp: string) {
    switch (result.kind) {
      case "sample":
      case "refresh": {
        const prepared = result.prepared, stamps = prepared.keys;
        setSession(prepared.session);
        setMarket({ value: prepared.market, key: stamps.site });
        setDemand({ value: prepared.demand, key: stamps.demand });
        setOperation({ value: result.evaluation, key: stamps.operation }); setFrames(result.frames);
        setComparison({ value: result.comparison, key: stamps.comparison });
        setSensitivity({ value: result.sensitivity, key: stamps.sensitivity });
        setFinancial({ value: result.financial, key: stamps.financial });
        setSampleStatus("ready"); break;
      }
      case "operation":
        setOperation({ value: result.evaluation, key: stamp }); setFrames(result.frames);
        if (!result.evaluation.ok) setError(result.evaluation.issues.map(i => i.message).join(" · "));
        break;
      case "comparison": setComparison({ value: result.comparison, key: stamp }); if (!result.comparison.ok) setError(result.comparison.issues.map(i => i.message).join(" · ")); break;
      case "sensitivity": setSensitivity({ value: result.sensitivity, key: stamp }); break;
      case "financial": setFinancial({ value: result.financial, key: stamp }); break;
    }
  }
  function refreshAll() {
    try {
      if (!readySite || !spaceReady) throw new Error(blockMessages[!readySite ? "site" : "space"]);
      if (invalidDraft) return;
      const currentMarket = !marketStale ? market?.value ?? null : null;
      const current = checkpoint(currentMarket), now = new Date().toISOString();
      startWorker({ kind: "refresh", input: { now, session: current, candidate, configuration, custom, sensitivity: sensitivityParameter },
        market: currentMarket, cache: { operation, frames, financial, comparison, sensitivity } }, "");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  const updating = job === "sample" || job === "refresh";
  const status = (value: unknown, stale: boolean, running = false): StepStatus => running ? "running" : !value ? "empty" : stale ? "stale" : "ready";
  const statuses = {
    site: readySite ? "ready" : "empty", space: spaceReady ? "ready" : "empty",
    market: status(market, marketStale, updating), demand: status(demand, demandStale, updating),
    operation: status(operation?.value.ok, operationStale, updating),
    scenario: status(comparison?.value.ok, comparisonStale || sensitivityStale, updating),
    financial: status(financial, financialStale, updating),
    review: status(financial && comparison?.value.ok, financialStale || comparisonStale || sensitivityStale || operationStale, updating),
  } satisfies Record<WorkflowStep, StepStatus>;
  const displaySite: Site = { ...session.project.site, name: candidate.projectName || "새 후보점", address: candidate.address || null };
  async function exportReview() {
    if (job || invalidDraft || exporting || !readySite || financialStale || comparisonStale || operationStale || sensitivityStale || !financial || !comparison?.value.ok || !operation?.value.ok || !market || !layout) return;
    const snapshot = structuredClone({ candidate, layout, market: market.value, operation: operation.value,
      financial: financial.value, comparison: comparison.value, sensitivity: sensitivity?.value ?? null });
    setExporting(true);
    try { const { exportProposalWorkbook } = await import("../application/exportProposal"); await exportProposalWorkbook(snapshot); }
    catch (e) { setError(e instanceof Error ? e.message : "엑셀 제안서를 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setExporting(false); }
  }
  function checkVisibleDrafts(container: HTMLElement) {
    const invalid = [...container.querySelectorAll<HTMLInputElement>("input:not(:disabled), select:not(:disabled)")]
      .some(input => !input.closest("[hidden]") && !input.validity.valid);
    setInvalidDraft(invalid);
    if (invalid) cancelTask();
  }
  return <ProductShell candidate={candidate} step={step} statuses={statuses} onNavigate={navigate} busy={job ? jobNames[job] : undefined} error={error} onDismissError={() => setError("")}>
    <div className="product-workflow-content" onChange={event => checkVisibleDrafts(event.currentTarget)} onBlur={event => checkVisibleDrafts(event.currentTarget)}>
    <span data-testid="sample-status" data-state={sampleStatus} hidden />
    {step !== "site" && <p className="product-demo-note"><strong>예시 분석</strong> 상권·운영·비용은 체험용 가정입니다. <span>{invalidDraft ? "입력 범위를 확인해 주세요." : "조건을 바꾸면 관련 결과에 자동 반영됩니다."}</span></p>}
    {step === "site" && <SiteStep value={candidate} onChange={value => { cancelTask(); setCandidate(value); }} onContinue={() => navigate("space")} onOpenSpace={() => navigate("space")} hasPlan={true} planName={plan.name} preview={<PlanThumbnail plan={plan} />}
      sampleStatus={sampleStatus} onOpenOperation={() => navigate("operation")} onRetrySample={() => startWorker({ kind: "sample", input: initial }, "")} />}
    <div className="product-workflow-panel" hidden={step !== "space"}>
      <SpaceStep plan={plan} mapping={mapping} layout={layout} confirmed={spaceConfirmed} sampleReady={sampleSpaceReady} knownAreaM2={candidate.knownAreaM2}
        onMappingChange={value => { cancelTask(); setMapping(value); setSpaceConfirmed(false); setSampleSpaceReady(false); }}
        onConfirm={() => { if (!sampleSpaceReady) setSpaceConfirmed(true); navigate("market"); }}>
        <SpaceWorkspace initialPlan={initialPlan.current} active={step === "space"} embedded onPlanChange={changePlan} onDocumentReplace={replaceDocument} />
      </SpaceStep>
    </div>
    {step === "market" && <MarketStep site={displaySite} profile={market?.value ?? null} onRun={refreshAll} busy={updating} stale={marketStale} disabledReason={blockMessages[analysisBlock]} />}
    {step === "demand" && <DemandStep parameters={configuration.demandParameters} profile={demand?.value ?? null} market={market?.value ?? null} config={configuration.simulation}
      onChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, demandParameters: value })); }} onRun={refreshAll} stale={demandStale || invalidDraft}
      busy={updating} disabledReason={blockMessages[operationBlock]} />}
    {step === "operation" && <OperationStep run={operation?.value.ok ? operation.value.runs[0] : null} frames={frames} layout={layout} policy={configuration.operation} config={configuration.simulation}
      onPolicyChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, operation: value })); }}
      onConfigChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, simulation: value,
        financial: { ...previous.financial, operatingDayMix: [{ dayType: value.dayType, daysPerMonth: previous.financial.operatingDaysPerMonth, runToDayMultiplier: 1 }] } })); }}
      onRun={refreshAll} busy={updating} stale={operationStale || invalidDraft}
      disabledReason={job === "sample" ? "샘플 영업 기록을 자동으로 준비하고 있습니다. 준비가 끝나면 바로 재생할 수 있습니다." : blockMessages[operationBlock]} />}
    {step === "scenario" && <ScenarioStep comparison={comparison?.value ?? null} sensitivity={sensitivity?.value ?? null} custom={custom}
      maxConversionChangePercent={configuration.demandParameters.visitConversionRate > 0 ? (1 / configuration.demandParameters.visitConversionRate - 1) * 100 : undefined}
      onCustomChange={value => { cancelTask(); setCustom(value); }} sensitivityParameter={sensitivityParameter}
      onSensitivityParameterChange={value => { cancelTask(); setSensitivityParameter(value); }}
      onRun={refreshAll} onRunSensitivity={refreshAll} busy={updating} sensitivityBusy={updating}
      stale={comparisonStale || sensitivityStale || invalidDraft} disabledReason={blockMessages[operationBlock]} />}
    {step === "financial" && <FinancialStep assumptions={configuration.financial} result={financial?.value ?? null} operation={configuration.operation}
      onChange={value => { cancelTask(); setConfiguration(previous => ({ ...previous, financial: { ...value, revision: previous.financial.revision + 1 } })); }}
      onRun={refreshAll} scenarioName="기준 조건" busy={updating} stale={financialStale || invalidDraft}
      disabledReason={blockMessages[operationBlock]} />}
    {step === "review" && <ReviewStep candidate={candidate} layout={layout} market={market?.value ?? null} operation={operation?.value ?? null}
      financial={financial?.value ?? null} comparison={comparison?.value ?? null} sensitivity={sensitivity?.value ?? null}
      stale={financialStale || comparisonStale || sensitivityStale || operationStale || marketStale || demandStale || !!job || invalidDraft} exporting={exporting} onExport={exportReview} />}
    {step !== "site" && step !== "space" && <div className="product-page product-actions product-next-actions"><button className="product-button product-button-secondary" onClick={() => navigate(WORKFLOW_STEPS[Math.max(0, WORKFLOW_STEPS.findIndex(s => s.id === step) - 1)].id)}>이전 단계</button>{step !== "review" && <button className="product-button product-button-primary" onClick={() => navigate(WORKFLOW_STEPS[WORKFLOW_STEPS.findIndex(s => s.id === step) + 1].id)}>다음 단계로</button>}</div>}
    <p className="product-session-note">검토 내용을 공유하려면 출점검토에서 엑셀 제안서를 저장하세요. 현재 작업은 이 브라우저에서 유지되며 새로고침하면 샘플로 다시 시작합니다.</p>
    </div>
  </ProductShell>;
}
