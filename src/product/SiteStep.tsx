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
}

export function SiteStep({ value, onChange, onContinue, onOpenSpace, preview, hasPlan, planName }: SiteStepProps) {
  const id = useId();
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
        <div className="product-section-heading"><h2>어떤 매장을 검토하시나요?</h2><span>필수 항목 <b aria-hidden="true">*</b></span></div>
        <div className="product-form-grid">
          <label className="product-field" htmlFor={`${id}-name`}><span>프로젝트 / 점포명 <b aria-hidden="true">*</b></span>
            <input className="product-input" id={`${id}-name`} required pattern={".*\\S.*"} title="공백이 아닌 프로젝트 또는 점포명을 입력하세요." maxLength={120} placeholder="예: 백초밥 송도 후보점" value={value.projectName} onChange={event => onChange({ ...value, projectName: event.target.value })} />
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
        {hasPlan && <p className="product-note">{planName} · 처음에는 기본 예시 도면이 열립니다. 후보지의 PDF를 불러와 변경할 수 있습니다.</p>}
        <div className="product-plan-caption"><div><h2>{hasPlan ? "공간부터 구체적으로" : "후보지 도면을 준비하세요"}</h2><p>{hasPlan ? "도면의 구조와 좌석 배치를 확인한 뒤 운영 조건을 연결합니다." : "도면을 불러오면 치수 확인과 2D·3D 공간 검토로 이어집니다."}</p></div><button type="button" className="product-button product-button-secondary" onClick={onOpenSpace}><FileUp size={16} />{hasPlan ? "도면 확인 · 변경" : "PDF 도면 불러오기"}</button></div>
        <div className="product-site-journey" aria-label="검토 과정"><span><b>공간</b>매장 배치</span><ArrowRight size={14} aria-hidden="true" /><span><b>운영</b>하루의 영업</span><ArrowRight size={14} aria-hidden="true" /><span><b>수익</b>조건별 비교</span></div>
      </aside>
    </div>
  </div>;
}

export default SiteStep;
