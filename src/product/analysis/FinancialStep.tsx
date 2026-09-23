import type { FinancialAssumption } from "../../core";
import { AnalysisStatus, dayLabel, EmptyAnalysis, formatNumber, manwon, NumberField, pct, runAfterValidation, StepHeading, won } from "./common";
import type { FinancialStepProps } from "./types";

export function FinancialStep(props: FinancialStepProps) {
  const { assumptions, operation, result, onChange, onRun, busy, disabledReason, scenarioName = "기준 시나리오" } = props;
  const update = (patch: Partial<FinancialAssumption>) => onChange({ ...structuredClone(assumptions), ...patch });
  const labor = assumptions.labor;
  const updateLabor = (patch: Record<string, number>) => { if (labor?.mode === "operation-linked") update({ labor: { ...labor, ...patch } }); };
  const setDays = (value: number) => update({ operatingDaysPerMonth: value, ...(assumptions.operatingDayMix ? { operatingDayMix: assumptions.operatingDayMix.map(item => ({ ...item, daysPerMonth: assumptions.operatingDayMix!.length === 1 ? value : item.daysPerMonth / assumptions.operatingDaysPerMonth * value })) } : {}) });
  const costs = result ? [
    { label: "매출", value: result.monthlyRevenue, kind: "revenue" },
    { label: "재료·수수료·변동비", value: -result.variableCost, kind: "cost" },
    { label: "인건비", value: -result.laborCost, kind: "cost" },
    { label: "임차료", value: -result.rent, kind: "cost" },
    { label: "기타 고정비", value: -result.otherFixedCosts, kind: "cost" },
    { label: "영업이익", value: result.monthlyOperatingProfit, kind: result.monthlyOperatingProfit < 0 ? "cost" : "profit" },
  ] : [];
  const maxAmount = Math.max(1, ...costs.map(item => Math.abs(item.value)));
  const belowBreakEven = result?.observedThroughputMarginPerDay !== null && result?.observedThroughputMarginPerDay !== undefined && result.observedThroughputMarginPerDay < 0;

  return <div className="analysis-page analysis-dashboard analysis-financial-dashboard">
    <StepHeading number="06" title="수익성 분석" description="완료된 영업량에 가격과 비용을 적용해, 매출이 이익으로 남는 구조를 확인합니다." action={<button className="analysis-button analysis-button-secondary" onClick={event => runAfterValidation(event, onRun)} disabled={busy || !!disabledReason}>{busy ? "반영 중…" : "지금 반영"}</button>} />
    <AnalysisStatus {...props} />
    <div className="analysis-financial-layout">
      <aside className="analysis-assumptions-panel" aria-label="수익성 계산 조건">
        <div className="analysis-panel-heading"><div><span className="analysis-panel-eyebrow">ASSUMPTIONS</span><h2>가격과 운영 비용</h2></div><span className="analysis-tag">{scenarioName}</span></div>
        <p className="analysis-panel-intro">금액은 원, 고정비는 월 기준입니다.</p>
        <div className="analysis-fields analysis-fields-two analysis-primary-fields">
          <NumberField label="홀 고객당 객단가" value={assumptions.averageSpendingPerCustomer ?? operation.averageSpendingPerCustomer} unit="원/명" step={1000} onChange={value => update({ averageSpendingPerCustomer: value })} />
          <NumberField label="배달 주문당 금액" value={assumptions.averageDeliveryOrderValue ?? 0} unit="원/건" step={1000} onChange={value => update({ averageDeliveryOrderValue: value })} />
          <NumberField label="월 영업일" value={assumptions.operatingDaysPerMonth} min={1} max={31} unit="일" step={1} onChange={setDays} />
          <NumberField label="재료 원가율" value={assumptions.foodCostRatio * 100} min={0} max={100} unit="%" step={1} onChange={value => update({ foodCostRatio: value / 100 })} />
          <NumberField label="월 임차료" value={assumptions.monthlyRent} unit="원/월" step={100000} onChange={value => update({ monthlyRent: value })} />
          {labor?.mode === "operation-linked" ? <div className="analysis-field-explanation"><strong>인력 연동 인건비</strong><p>조리 {operation.resources.cooks} · 홀 {operation.resources.servers} · 결제 {operation.resources.cashiers}명</p><p>아래 고급 설정에서 단가 수정</p></div> : <NumberField label="월 총 인건비" value={assumptions.monthlyLabor} unit="원/월" step={100000} onChange={value => update({ monthlyLabor: value })} />}
        </div>
        <details className="analysis-details analysis-compact-details"><summary>고급 비용 설정 · 수수료와 인건비</summary>
          <div className="analysis-fields analysis-fields-two">
            <NumberField label="결제 수수료율" value={(assumptions.paymentFeeRatio ?? 0) * 100} unit="%" min={0} max={100} step={0.1} onChange={value => update({ paymentFeeRatio: value / 100 })} />
            <NumberField label="배달 플랫폼 수수료" value={assumptions.deliveryFeeRatio * 100} unit="%" min={0} max={100} step={1} onChange={value => update({ deliveryFeeRatio: value / 100 })} />
            <NumberField label="배달 건당 추가 비용" value={assumptions.deliveryVariableCostPerOrder ?? 0} unit="원/건" step={100} onChange={value => update({ deliveryVariableCostPerOrder: value })} help="포장 등 플랫폼 수수료 외 비용" />
            <NumberField label="로열티율" value={assumptions.royaltyRatio * 100} unit="%" min={0} max={100} step={0.5} onChange={value => update({ royaltyRatio: value / 100 })} />
            <NumberField label="수도·전기·가스" value={assumptions.monthlyUtilities} unit="원/월" step={10000} onChange={value => update({ monthlyUtilities: value })} />
            <NumberField label="마케팅비" value={assumptions.monthlyMarketing} unit="원/월" step={10000} onChange={value => update({ monthlyMarketing: value })} />
            <NumberField label="유지보수비" value={assumptions.monthlyMaintenance ?? 0} unit="원/월" step={10000} onChange={value => update({ monthlyMaintenance: value })} />
            <NumberField label="보험료" value={assumptions.monthlyInsurance ?? 0} unit="원/월" step={10000} onChange={value => update({ monthlyInsurance: value })} />
            <NumberField label="기타 고정비" value={assumptions.monthlyOtherFixed} unit="원/월" step={10000} onChange={value => update({ monthlyOtherFixed: value })} />
          </div>
          <div className="analysis-field"><label htmlFor="analysis-labor-mode">인건비 계산 방식</label><select id="analysis-labor-mode" value={labor?.mode ?? "fixed-monthly"} onChange={event => update(event.target.value === "fixed-monthly" ? { labor: { mode: "fixed-monthly" } } : { monthlyLabor: 0, labor: { mode: "operation-linked", monthlyCostPerCook: 0, monthlyCostPerServer: 0, monthlyCostPerCashier: 0, otherStaffCount: 0, monthlyCostPerOtherStaff: 0 } })}><option value="fixed-monthly">월 총액 입력</option><option value="operation-linked">운영 인력 수 × 1인당 월 비용</option></select></div>
          {labor?.mode === "operation-linked" && <div className="analysis-fields analysis-fields-two"><NumberField label="조리 인력 1인 월 비용" value={labor.monthlyCostPerCook} unit="원" step={100000} onChange={value => updateLabor({ monthlyCostPerCook: value })} /><NumberField label="홀 직원 1인 월 비용" value={labor.monthlyCostPerServer} unit="원" step={100000} onChange={value => updateLabor({ monthlyCostPerServer: value })} /><NumberField label="결제 인력 1인 월 비용" value={labor.monthlyCostPerCashier} unit="원" step={100000} onChange={value => updateLabor({ monthlyCostPerCashier: value })} /><NumberField label="기타 인력" value={labor.otherStaffCount} unit="명" step={1} onChange={value => updateLabor({ otherStaffCount: value })} /><NumberField label="기타 인력 1인 월 비용" value={labor.monthlyCostPerOtherStaff} unit="원" step={100000} onChange={value => updateLabor({ monthlyCostPerOtherStaff: value })} /></div>}
          <p className="analysis-note">결제비가 플랫폼 수수료에 포함되면 중복 입력하지 마세요. 인력 연동은 근무표·교대를 자동 계산하지 않습니다.</p>
        </details>
        <details className="analysis-details analysis-compact-details"><summary>초기 투자와 보증금</summary><div className="analysis-fields analysis-fields-two">
          <NumberField label="가맹비" value={assumptions.initialFranchiseFee} unit="원" step={1000000} onChange={value => update({ initialFranchiseFee: value })} />
          <NumberField label="인테리어" value={assumptions.initialInteriorCost} unit="원" step={1000000} onChange={value => update({ initialInteriorCost: value })} />
          <NumberField label="장비" value={assumptions.initialEquipmentCost ?? 0} unit="원" step={1000000} onChange={value => update({ initialEquipmentCost: value })} />
          <NumberField label="기타 초기 투자" value={assumptions.initialOtherInvestment ?? 0} unit="원" step={1000000} onChange={value => update({ initialOtherInvestment: value })} />
          <NumberField label="별도 분류되지 않은 투자" value={assumptions.initialCapex} unit="원" step={1000000} onChange={value => update({ initialCapex: value })} help="다른 항목에 포함한 금액은 제외" />
          <NumberField label="회수 가능 보증금" value={assumptions.refundableDeposit ?? 0} unit="원" step={1000000} onChange={value => update({ refundableDeposit: value })} />
        </div></details>
        <p className="analysis-note analysis-assumption-footnote">영업일을 바꾸면 대표 요일의 구성 비율을 유지합니다. 가격·비용은 예시 가정이므로 실제 계약 조건으로 조정하세요.</p>
      </aside>

      {!result ? <EmptyAnalysis title="가상영업 결과에 비용을 연결하세요.">운영에서 완료된 고객과 주문이 준비되면 수익성을 계산합니다. 예상 도착 수요나 이탈 고객에는 매출을 부여하지 않습니다.</EmptyAnalysis> : <div className="analysis-financial-results">
        <section aria-labelledby="analysis-financial-result-heading">
          <div className="analysis-panel-heading"><div><h2 id="analysis-financial-result-heading">한 달의 매출에서 이익까지</h2><p>월 {formatNumber(result.conditions.operatingDaysPerMonth)}일 · {result.conditions.replicationCount}회 반복 평균</p></div><span className={`analysis-tag${props.stale ? " analysis-tag-demo" : ""}`}>{props.stale ? "변경 전 수익성 결과" : "가정에 따른 추정"}</span></div>
          <div className="analysis-finance-summary">
            <div className="analysis-kpi-revenue"><span>조건부 월 매출</span><strong>{manwon(result.monthlyRevenue)}</strong><small>홀 {manwon(result.monthlyDineInRevenue)} · 배달 {manwon(result.monthlyDeliveryRevenue)}</small></div>
            <div className={result.monthlyOperatingProfit < 0 ? "analysis-kpi-negative" : "analysis-kpi-profit"}><span>조건부 월 영업이익</span><strong>{manwon(result.monthlyOperatingProfit)}</strong><small>영업이익률 {pct(result.operatingMargin)}{result.operatingMargin === null ? " · 매출이 없어 계산 불가" : ""}</small></div>
            <div className="analysis-kpi-payback"><span>단순 투자 회수기간</span><strong>{result.estimatedPaybackMonths === null ? "계산 불가" : <>{formatNumber(result.estimatedPaybackMonths)}<em>개월</em></>}</strong><small>{result.estimatedPaybackMonths === null ? "월 영업이익 0 이하" : "현재 월 영업이익 유지 가정"}</small></div>
          </div>
          <div className="analysis-cost-rows" aria-label="월 매출과 비용 구성">{costs.map((item, index) => <div key={item.label} className={`analysis-cost-row analysis-cost-${item.kind}${index === costs.length - 1 ? " analysis-cost-total" : ""}`}><span>{item.label}</span><div className="analysis-cost-track" aria-hidden="true"><div style={{ width: `${Math.abs(item.value) / maxAmount * 100}%` }} className={`analysis-bar-${item.kind}`} /></div><strong>{item.value < 0 ? "−" : ""}{manwon(Math.abs(item.value))}</strong></div>)}</div>
          <details className="analysis-chart-data analysis-cost-detail"><summary>비용 세부 금액 보기</summary><table className="analysis-table"><tbody>{[{ label: "재료비", value: result.foodMaterialCost }, { label: "결제 수수료", value: result.paymentFees }, { label: "배달 플랫폼 수수료", value: result.deliveryPlatformFees }, { label: "배달 건당 비용", value: result.deliveryVariableCost }, { label: "로열티", value: result.royaltyCost }, { label: "인건비", value: result.laborCost }, { label: "임차료", value: result.rent }, { label: "기타 고정비", value: result.otherFixedCosts }].map(item => <tr key={item.label}><th scope="row">{item.label}</th><td>{won(item.value)} / 월</td></tr>)}</tbody></table></details>
          <div className="analysis-financial-basis"><strong>월 환산 기준</strong>{result.conditions.dayEstimates.map(day => <p key={day.dayType}>{dayLabel(day.dayType)} {String(Math.floor(day.startMinute / 60)).padStart(2, "0")}:{String(day.startMinute % 60).padStart(2, "0")}부터 {formatNumber(day.durationMinutes)}분 완료량 × {formatNumber(day.runToDayMultiplier)}배 × 월 {formatNumber(day.daysPerMonth)}일</p>)}<p>관측 시간을 하루 전체로 자동 확대하지 않습니다.</p></div>
        </section>
        <div className="analysis-financial-bottom">
          <section className="analysis-break-even" aria-labelledby="analysis-bep-heading"><div className="analysis-panel-heading"><h2 id="analysis-bep-heading">손익분기 영업량</h2><strong>{manwon(result.breakEvenRevenue)}<small>월 매출 기준</small></strong></div>
            {result.breakEvenRevenue === null ? <p className="analysis-note analysis-negative">{result.monthlyRevenue <= 0 ? "양수 매출 기준이 없어 계산할 수 없습니다." : "공헌이익이 0 이하이므로 계산할 수 없습니다."}</p> : <><table className="analysis-table analysis-bep"><thead><tr><th scope="col">채널</th><th scope="col">손익분기 / 일</th><th scope="col">관측 완료 / 일</th></tr></thead><tbody><tr><th scope="row">홀 고객</th><td>{formatNumber(result.breakEvenDailyDineInCustomers)}명</td><td>{formatNumber(result.observedDailyDineInCustomers)}명</td></tr><tr><th scope="row">배달 주문</th><td>{formatNumber(result.breakEvenDailyDeliveryOrders)}건</td><td>{formatNumber(result.observedDailyDeliveryOrders)}건</td></tr></tbody></table><p className={`analysis-bep-verdict ${belowBreakEven ? "analysis-negative" : "analysis-positive"}`}>{belowBreakEven ? "관측 완료량이 손익분기 영업량보다 적습니다." : "관측 완료량이 손익분기 영업량 이상입니다."}</p></>}
            <p className="analysis-note">현재 홀·배달 구성과 가격 유지 가정. 관측 완료량은 최대 처리 용량이 아닙니다.</p>
          </section>
          <section className="analysis-investment" aria-labelledby="analysis-investment-heading"><h2 id="analysis-investment-heading">초기 투자</h2><dl className="analysis-definition-list"><div><dt>초기 현금 투입</dt><dd>{manwon(result.initialInvestment)}</dd></div><div><dt>비회수성 투자</dt><dd>{manwon(result.nonRefundableInvestment)}</dd></div><div><dt>회수 가능 보증금</dt><dd>{manwon(result.refundableDeposit)}</dd></div></dl><p className="analysis-note">보증금은 초기 현금에 포함하고 회수기간에서는 제외합니다.</p></section>
        </div>
        <details className="analysis-details analysis-compact-details analysis-calculation-details"><summary>계산에 사용한 조건과 환산 근거</summary><p>홀 {won(result.conditions.averageSpendingPerCustomer)}/명 · 배달 {won(result.conditions.averageDeliveryOrderValue)}/건</p>{result.conditions.dayEstimates.map(day => <p key={day.dayType}>{dayLabel(day.dayType)} {formatNumber(day.daysPerMonth)}일/월 · {formatNumber(day.durationMinutes)}분 관측 × {formatNumber(day.runToDayMultiplier)}배 → 대표 영업일 · {day.replicationCount}회 반복</p>)}<p>세금·이자·감가상각·운전자금 변화는 포함하지 않습니다. 영업이익을 운영 현금 기여의 대용치로 쓰는 단순 모델입니다.</p></details>
      </div>}
    </div>
  </div>;
}
