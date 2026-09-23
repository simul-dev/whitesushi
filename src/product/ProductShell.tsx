import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { CandidateDetails, StepStatus, WorkflowStep } from "./types";
import "./product.css";

export const WORKFLOW_STEPS: readonly { id: WorkflowStep; label: string }[] = [
  { id: "site", label: "후보지" },
  { id: "space", label: "공간설계" },
  { id: "market", label: "상권분석" },
  { id: "demand", label: "수요가정" },
  { id: "operation", label: "가상영업" },
  { id: "scenario", label: "시나리오" },
  { id: "financial", label: "수익성" },
  { id: "review", label: "출점검토" },
];

const STATUS_LABELS: Record<StepStatus, string> = {
  empty: "미설정", ready: "준비됨", stale: "재계산 필요", running: "계산 중",
};

export interface ProductShellProps {
  candidate: CandidateDetails;
  step: WorkflowStep;
  statuses: Partial<Record<WorkflowStep, StepStatus>>;
  onNavigate: (step: WorkflowStep) => void;
  children: ReactNode;
  busy?: string;
  error?: string;
  onDismissError?: () => void;
}

export function ProductShell({ candidate, step, statuses, onNavigate, children, busy, error, onDismissError }: ProductShellProps) {
  const navigation = useRef<HTMLElement>(null);
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const selected = nav?.querySelector<HTMLElement>("[aria-current='step']");
    if (!nav || !selected) return;
    // Scroll only the horizontal workflow strip, preserving the page position.
    const keepCurrentVisible = () => {
      const left = selected.offsetLeft;
      if (left < nav.scrollLeft) nav.scrollLeft = left;
      else if (left + selected.offsetWidth > nav.scrollLeft + nav.clientWidth)
        nav.scrollLeft = left + selected.offsetWidth - nav.clientWidth;
    };
    keepCurrentVisible();
    const observer = new ResizeObserver(keepCurrentVisible);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [step]);

  return (
    <div className="simulator">
      <a className="product-skip-link" href="#product-content" onClick={event => { event.preventDefault(); content.current?.focus(); content.current?.scrollIntoView(); }}>본문으로 이동</a>
      <header className="product-header">
        <div className="product-header-inner">
          <button className="product-wordmark" type="button" onClick={() => onNavigate("site")} aria-label="AI Store Simulator 후보지로 이동">
            <span className="product-logo" aria-hidden="true"><span /><span /><span /></span>
            <span>AI Store <strong>Simulator</strong><small>계약 전, 매장의 가능성을 검토하다</small></span>
          </button>
          <div className="product-project-context" aria-label="현재 후보지">
            <span className="product-context-label">검토 중인 후보지</span>
            <strong title={candidate.projectName}>{candidate.projectName.trim() || "새 후보지"}</strong>
            <span className="product-context-address" title={candidate.address}>{candidate.address.trim() || "후보지 주소를 입력하세요"}</span>
          </div>
          <div className="product-workspace-label"><span aria-hidden="true" />출점 검토 워크스페이스</div>
        </div>
      </header>

      <div className="product-navigation-wrap">
        <nav ref={navigation} className="product-navigation" aria-label="출점 검토 단계">
          {WORKFLOW_STEPS.map(({ id, label }, index) => {
            const status = statuses[id] ?? "empty";
            return <button key={id} type="button" onClick={() => onNavigate(id)}
              className={`product-step${step === id ? " product-step-current" : ""}`}
              aria-current={step === id ? "step" : undefined}
              aria-label={`${String(index + 1).padStart(2, "0")} ${label}, ${STATUS_LABELS[status]}`}>
              <span className="product-step-heading"><span className="product-step-number">{String(index + 1).padStart(2, "0")}</span><span>{label}</span></span>
              <span className={`product-step-status product-step-status-${status}`}><i aria-hidden="true" />{STATUS_LABELS[status]}</span>
            </button>;
          })}
        </nav>
      </div>

      {(busy || error) && <div className="product-notifications">
        {busy && <div className="product-notice" role="status"><span className="product-spinner" aria-hidden="true" />{busy}</div>}
        {error && <div className="product-error" role="alert"><span>{error}</span>{onDismissError && <button type="button" aria-label="오류 메시지 닫기" onClick={onDismissError}><X size={17} /></button>}</div>}
      </div>}

      <main ref={content} id="product-content" className={`product-main product-main-${step}`} tabIndex={-1} aria-busy={Boolean(busy)}>{children}</main>
      <footer className="product-footer"><span>AI Store Simulator</span><p>공간과 가정을 연결해, 출점 검토의 근거를 만듭니다.</p><button type="button" onClick={() => onNavigate("review")}>검토 내용 모아보기 <ArrowUpRight size={14} /></button></footer>
    </div>
  );
}

export default ProductShell;
