import { useId, type FormEvent, type ReactNode } from "react";
import { ArrowRight, FileUp } from "lucide-react";
import type { CandidateDetails } from "./types";

export interface SiteStepProps {
  value: CandidateDetails;
  onChange: (next: CandidateDetails) => void;
  onContinue: () => void;
  onOpenSpace: () => void;
  preview: ReactNode;
  hasPlan: boolean;
  planName?: string;
  onOpenOperation?: () => void;
  sampleStatus?: "loading" | "ready" | "error" | "edited";
  onRetrySample?: () => void;
}

export function SiteStep({ value, onChange, onContinue, onOpenSpace, preview, hasPlan, planName, onOpenOperation, sampleStatus, onRetrySample }: SiteStepProps) {
  const id = useId();
  const sampleMessage = sampleStatus === "loading" ? "샘플 영업을 계산하고 있습니다."
    : sampleStatus === "ready" ? "샘플 결과가 준비되었습니다."
    : sampleStatus === "error" ? "샘플 계산을 마치지 못했습니다."
    : "입력값을 수정했습니다. 각 단계의 계산 상태를 확인하세요.";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.projectName.trim() || !value.brandName.trim() || !value.address.trim()) return;
    onContinue();
  }
  return <div className="product-page product-site-page">
    <div className="product-site-intro">
      <p className="product-eyebrow">01 / 후보지 등록</p>
      <h1>계약하기 전에<br />먼저 열어보세요<span>.</span></h1>
      <p className="product-site-lead">검토 중인 공간에 우리 브랜드 매장을 담아보세요.<br className="product-desktop-break" /> 하루의 운영부터 수익구조까지, 하나의 흐름으로 살펴봅니다.</p>
    </div>

    <div className="product-site-body">
      <form className="product-site-form" onSubmit={submit}>
        {sampleStatus && <section className="product-tester-sample" aria-label="테스터 샘플">
          <div className="product-tester-heading"><span className="product-inline-status">테스터 샘플</span><p role="status">{sampleStatus === "loading" && <span className="product-spinner" aria-hidden="true" />}{sampleMessage}</p></div>
          <p className="product-tester-source">점포명·주소·입력 면적{value.knownAreaM2 !== null ? ` ${value.knownAreaM2.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} m²` : ""}는 사용자 제공 정보입니다. 상권·가격·비용은 예시 가정이며, 기본 도면은 후보지의 실측 도면이 아닙니다.</p>
          <div className="product-tester-actions">{onOpenOperation && <button className="product-button product-button-primary" type="button" onClick={onOpenOperation}>샘플 영업 바로 보기 <ArrowRight size={16} /></button>}{sampleStatus === "error" && onRetrySample && <button className="product-button product-button-secondary" type="button" onClick={onRetrySample}>샘플 다시 계산</button>}</div>
        </section>}
        <div className="product-section-heading"><h2>어떤 매장을 검토하시나요?</h2><span>필수 항목 <b aria-hidden="true">*</b></span></div>
        <div className="product-form-grid">
          <label className="product-field" htmlFor={`${id}-name`}><span>프로젝트 / 점포명 <b aria-hidden="true">*</b></span>
            <input className="product-input" id={`${id}-name`} required pattern={".*\\S.*"} title="공백이 아닌 프로젝트 또는 점포명을 입력하세요." maxLength={120} placeholder="예: 백초밥 명지점" value={value.projectName} onChange={event => onChange({ ...value, projectName: event.target.value })} />
          </label>
          <label className="product-field" htmlFor={`${id}-brand`}><span>브랜드명 <b aria-hidden="true">*</b></span>
            <input className="product-input" id={`${id}-brand`} required pattern={".*\\S.*"} title="공백이 아닌 브랜드명을 입력하세요." maxLength={80} placeholder="예: 백초밥" value={value.brandName} onChange={event => onChange({ ...value, brandName: event.target.value })} />
          </label>
          <label className="product-field product-field-wide" htmlFor={`${id}-address`}><span>후보지 주소 <b aria-hidden="true">*</b></span>
            <input className="product-input" id={`${id}-address`} required pattern={".*\\S.*"} title="공백이 아닌 후보지 주소를 입력하세요." maxLength={240} autoComplete="street-address" placeholder="시·구·도로명 및 상세주소" value={value.address} onChange={event => onChange({ ...value, address: event.target.value })} />
          </label>
          <label className="product-field" htmlFor={`${id}-area`}><span>알고 있는 면적 <small>선택</small></span>
            <div className="product-input-with-unit"><input className="product-input" id={`${id}-area`} type="number" min="0.1" step="any" aria-label="알고 있는 면적 (제곱미터)" placeholder="미확인" value={value.knownAreaM2 ?? ""} onChange={event => onChange({ ...value, knownAreaM2: Number.isNaN(event.target.valueAsNumber) ? null : event.target.valueAsNumber })} /><span aria-hidden="true">m²</span></div>
            <small>참고 면적이며 도면의 측정값과 구분합니다.</small>
          </label>
          <label className="product-field product-field-wide" htmlFor={`${id}-notes`}><span>검토 메모 <small>선택</small></span>
            <textarea className="product-input product-textarea" id={`${id}-notes`} rows={3} maxLength={2000} placeholder="층수, 전면 길이, 임대조건 등 확인할 내용을 남겨주세요." value={value.notes} onChange={event => onChange({ ...value, notes: event.target.value })} />
          </label>
        </div>
        <div className="product-site-continue"><button className="product-button product-button-primary" type="submit">공간설계로 계속 <ArrowRight size={16} /></button><p>다음 단계에서 도면과 공간을 확인합니다.</p></div>
      </form>

      <aside className="product-site-plan" aria-label="후보지 도면">
        <div className="product-plan-label"><span>{hasPlan ? "현재 작업 도면" : "도면에서 시작하는 검토"}</span><span>SPACE PREVIEW</span></div>
        <div className={`product-plan-preview${hasPlan ? "" : " product-plan-preview-empty"}`}>{hasPlan ? preview : <div className="product-plan-placeholder"><FileUp size={35} strokeWidth={1.3} /><strong>이 공간에, 우리 매장을.</strong><p>PDF 도면을 불러와<br />배치와 운영 가능성을 살펴보세요.</p></div>}</div>
        {hasPlan && <p className="product-note">{planName && <>{planName} · </>}처음 제공되는 도면은 후보지와 다른 공개 예시 도면(159.9 m²)입니다. 실제 후보지 PDF로 바꿀 수 있습니다.</p>}
        <div className="product-plan-caption"><div><h2>{hasPlan ? "공간부터 구체적으로" : "후보지 도면을 준비하세요"}</h2><p>{hasPlan ? "도면의 구조와 좌석 배치를 확인한 뒤 운영 조건을 연결합니다." : "도면을 불러오면 치수 확인과 2D·3D 공간 검토로 이어집니다."}</p></div><button type="button" className="product-button product-button-secondary" onClick={onOpenSpace}><FileUp size={16} />{hasPlan ? "도면 확인 · 변경" : "PDF 도면 불러오기"}</button></div>
        <div className="product-site-journey" aria-label="검토 과정"><span><b>공간</b>매장 배치</span><ArrowRight size={14} aria-hidden="true" /><span><b>운영</b>하루의 영업</span><ArrowRight size={14} aria-hidden="true" /><span><b>수익</b>조건별 비교</span></div>
      </aside>
    </div>
  </div>;
}

export default SiteStep;
