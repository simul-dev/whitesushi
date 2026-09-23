import { useEffect, useState, type ReactNode } from "react";
import type { NumericAggregate } from "../../modules/scenario";
import { AnalysisStatus, EmptyAnalysis, formatNumber, LineChart, manwon, NumberField, pct, runAfterValidation, StepHeading } from "./common";
import type { ScenarioStepProps, SensitivityChoice } from "./types";

const names: Record<string, string> = { Conservative: "보수적", Baseline: "기준", Optimistic: "낙관적", Custom: "사용자 설정" };
const choiceLabels: Record<SensitivityChoice, string> = { conversion: "방문 전환율", seats: "좌석 수", kitchen: "주방 동시 조리 수", spending: "홀 객단가" };
const aggregateText = (value: NumericAggregate, scale = 1, unit = "") => <><strong>{formatNumber(value.mean * scale)}{unit}</strong><small>{formatNumber(value.min * scale)}–{formatNumber(value.max * scale)}{unit}</small></>;

export function ScenarioStep(props: ScenarioStepProps) {
  const { comparison, sensitivity, custom, onCustomChange, onRun, onRunSensitivity, sensitivityParameter, onSensitivityParameterChange, busy, sensitivityBusy, disabledReason } = props;
  const [response, setResponse] = useState<"served" | "waiting" | "revenue">("served");
  useEffect(() => { setResponse(sensitivityParameter === "spending" ? "revenue" : "served"); }, [sensitivityParameter]);
  const rows = comparison?.rows ?? [];
  const baseline = rows.find(row => row.kind === "Baseline")?.evaluation;
  const customResult = rows.find(row => row.kind === "Custom")?.evaluation;
  const profitChange = baseline?.ok && baseline.financial && customResult?.ok && customResult.financial
    ? customResult.financial.monthlyOperatingProfit - baseline.financial.monthlyOperatingProfit : null;
  const tests = sensitivity?.results ?? [];
  const isConversion = sensitivity?.parameter.path === "demandParameters.visitConversionRate";
  const parameterUnit = isConversion ? "%" : ({ seats: "석", orders: "건", "KRW/customer": "원/명", ratio: "비율" }[sensitivity?.parameter.unit ?? ""] ?? sensitivity?.parameter.unit ?? "");
  const responseValues = tests.map(point => !point.evaluation.ok ? null : response === "served" ? point.evaluation.aggregate.metrics.customersServed.mean : response === "waiting" ? point.evaluation.aggregate.metrics.averageWaitingSeconds.mean / 60 : point.evaluation.financial ? point.evaluation.financial.monthlyRevenue / 10000 : null);
  const row = (label: string, value: (evaluation: Extract<NonNullable<typeof baseline>, { ok: true }>) => ReactNode, className?: string) => <tr key={label} className={className}><th scope="row">{label}</th>{rows.map(item => <td key={item.scenarioId} className={item.kind === "Baseline" ? "analysis-baseline" : undefined}>{item.evaluation.ok ? value(item.evaluation) : <span className="analysis-failed">계산 실패</span>}</td>)}</tr>;
  return <div className="analysis-page analysis-dashboard analysis-scenario-dashboard"><StepHeading number="07" title="시나리오 비교" description="같은 공간과 난수 조건에서 가격·수요·인력을 바꾸어 결과를 나란히 비교합니다." action={<button className="analysis-button analysis-button-secondary" onClick={event => runAfterValidation(event, onRun)} disabled={busy || !!disabledReason}>{busy ? "반영 중…" : "지금 반영"}</button>} />
    <AnalysisStatus {...props} />
    <section className="analysis-scenario-controls" aria-labelledby="analysis-custom-heading"><div className="analysis-panel-heading"><div><h2 id="analysis-custom-heading">사용자 시나리오</h2><p>아래 조건이 비교 표의 ‘사용자 설정’에 적용됩니다.</p></div><span className="analysis-tag">기준 대비 변화</span></div>
      <div className="analysis-fields analysis-fields-four">
        <NumberField label="전환율 변화" value={custom.conversionChangePercent} min={-100} max={props.maxConversionChangePercent} unit="%" step={5} onChange={value => onCustomChange({ ...custom, conversionChangePercent: value })} />
        <NumberField label="객단가 변화" value={custom.spendingChangePercent} min={-100} unit="%" step={5} onChange={value => onCustomChange({ ...custom, spendingChangePercent: value })} />
        <NumberField label="조리 인력" value={custom.cooks} unit="명" step={1} onChange={value => onCustomChange({ ...custom, cooks: value })} />
        <NumberField label="주방 동시 조리" value={custom.kitchenConcurrentOrders} unit="건" step={1} onChange={value => onCustomChange({ ...custom, kitchenConcurrentOrders: value })} />
      </div><p className="analysis-note">전환율·홀 객단가는 상대 변화입니다(+20% → 기준의 1.2배). 적용 전환율은 100% 이내입니다. 월 총액 인건비를 쓰면 인력 수를 늘려도 그 비용은 유지됩니다.</p>
    </section>
    <p className="analysis-mobile-scroll-hint">비교 표와 그래프를 가로로 이동하면 전체 조건을 볼 수 있습니다.</p>
    <section className="analysis-scenario-results"><div className="analysis-panel-heading"><div><h2>조건별 영업 결과</h2><p>보수적: 전환율 −20% · 객단가 −10% / 낙관적: +20% · +10% · 낙관 전환율은 100% 상한 적용</p></div>{profitChange !== null && <div className="analysis-scenario-delta"><span>사용자 설정 − 기준 · 월 영업이익</span><strong className={profitChange < 0 ? "analysis-negative" : profitChange > 0 ? "analysis-positive" : undefined}>{profitChange > 0 ? "+" : ""}{manwon(profitChange)}</strong>{props.stale && <small>변경 전 결과 기준</small>}</div>}</div>
      {!comparison ? <EmptyAnalysis title="하나의 숫자 대신 조건별 범위를 비교합니다.">가상영업 설정을 준비한 뒤 4개 시나리오를 실행하세요. 반복실험 평균과 최솟값–최댓값을 함께 보여줍니다.</EmptyAnalysis> : <>
        {props.stale && <p className="analysis-tag analysis-tag-demo">변경 전 비교 결과 · 다시 계산 필요</p>}
        <div className="analysis-table-scroll" role="region" aria-label="시나리오 비교 표" tabIndex={0}><table className="analysis-table analysis-comparison"><caption>운영 값은 관측 구간당 반복실험 평균, 작은 값은 최솟값–최댓값입니다.</caption><thead><tr><th scope="col">비교 항목</th>{rows.map(item => <th key={item.scenarioId} scope="col" className={item.kind === "Baseline" ? "analysis-baseline" : undefined}>{names[item.kind]}<small>{item.evaluation.replication?.count ?? 0}회 반복</small></th>)}</tr></thead><tbody>
          {row("조건부 월 매출", evaluation => evaluation.financial ? <strong className="analysis-positive">{manwon(evaluation.financial.monthlyRevenue)}</strong> : "재무 미계산", "analysis-financial-row")}
          {row("조건부 월 영업이익", evaluation => evaluation.financial ? <strong className={evaluation.financial.monthlyOperatingProfit < 0 ? "analysis-negative" : "analysis-profit"}>{manwon(evaluation.financial.monthlyOperatingProfit)}</strong> : "재무 미계산", "analysis-financial-row")}
          {row("영업이익률", evaluation => evaluation.financial ? <span className={evaluation.financial.operatingMargin !== null && evaluation.financial.operatingMargin < 0 ? "analysis-negative" : undefined}>{pct(evaluation.financial.operatingMargin)}</span> : "—", "analysis-financial-row analysis-financial-row-last")}
          {row("적용 방문 전환율", evaluation => pct(evaluation.resolved.configuration.demandParameters!.visitConversionRate, 2))}
          {row("홀 방문 유입 · 명", evaluation => aggregateText(evaluation.aggregate.metrics.customersArrived))}
          {row("홀 처리 완료 · 명", evaluation => aggregateText(evaluation.aggregate.metrics.customersServed))}
          {row("홀 이탈 · 명", evaluation => aggregateText(evaluation.aggregate.metrics.customersLost))}
          {row("배달 완료 · 건", evaluation => evaluation.aggregate.channelMetrics["delivery.ordersCompleted"] ? aggregateText(evaluation.aggregate.channelMetrics["delivery.ordersCompleted"]) : "미적용")}
          {row("평균 대기 · 분", evaluation => aggregateText(evaluation.aggregate.metrics.averageWaitingSeconds, 1 / 60))}
          {row("주방 가동률", evaluation => aggregateText(evaluation.aggregate.metrics.kitchenUtilization, 100, "%"))}
        </tbody></table></div>
        <p className="analysis-note">표의 범위는 반복실험 관측 범위이며 신뢰구간이 아닙니다. 월간 결과는 완료 처리량·객단가·영업일 가정을 적용한 조건부 계산입니다.</p>
        {rows.some(item => !item.evaluation.ok) && <div className="analysis-notice analysis-notice-error">실패한 시나리오는 다른 결과로 대체하지 않았습니다.{rows.filter(item => !item.evaluation.ok).map(item => <p key={item.scenarioId}>{names[item.kind]}: {item.evaluation.issues.map(issue => issue.message).join(" · ")}</p>)}</div>}
      </>}
    </section>
    <details className="analysis-details analysis-sensitivity-panel"><summary>고급 분석 · 한 가지 가정의 영향</summary><p className="analysis-note">다른 조건은 유지하면서 처리량·대기·매출의 변화를 확인합니다. 위의 4개 시나리오 비교와 별도 분석입니다.</p>
      <div className="analysis-sensitivity-controls"><label>바꿀 가정<select aria-label="민감도 변수" value={sensitivityParameter} onChange={event => onSensitivityParameterChange(event.target.value as SensitivityChoice)}>{Object.entries(choiceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>확인할 결과<select aria-label="민감도 결과 지표" value={response} onChange={event => setResponse(event.target.value as typeof response)}><option value="served">홀 처리 완료</option><option value="waiting">평균 대기시간</option><option value="revenue">월 매출</option></select></label><button className="analysis-button analysis-button-secondary" onClick={event => runAfterValidation(event, onRunSensitivity)} disabled={busy || sensitivityBusy || !!disabledReason}>{sensitivityBusy ? "변화 계산 중…" : "민감도 계산"}</button></div>
      {!sensitivity ? <p className="analysis-note">변수를 선택하고 계산하면 실제 실행 결과의 반응 곡선이 나타납니다.</p> : <>
        {props.stale && <p className="analysis-tag analysis-tag-demo">변경 전 민감도 결과 · 다시 계산 필요</p>}
        <p className="analysis-chart-context">분석 변수: {sensitivity.parameter.label} · 기준값 {formatNumber(sensitivity.baseValue * (isConversion ? 100 : 1), 3)} {parameterUnit} · 각 점의 조건을 독립적으로 실행했습니다.</p>
        <LineChart title={response === "served" ? "조건 변화에 따른 홀 처리 완료" : response === "waiting" ? "조건 변화에 따른 평균 대기" : "조건 변화에 따른 월 매출"} labels={tests.map(point => `${formatNumber(point.parameterValue * (isConversion ? 100 : 1), 3)}${isConversion ? "%" : ""}`)} xValues={tests.map(point => point.parameterValue)} unit={response === "served" ? "명/관측 구간" : response === "waiting" ? "분" : "만원/월"} xLabel={`${sensitivity.parameter.label} (${parameterUnit})`} baseIndex={tests.findIndex(point => Math.abs(point.parameterValue - sensitivity.baseValue) < 1e-9)} series={[{ name: "반복실험 평균에 따른 결과", color: response === "revenue" ? "#27815A" : "#BC1930", values: responseValues }]} />
        {tests.some(point => !point.evaluation.ok) && <p className="analysis-notice analysis-notice-warning">실패한 조건은 그래프에서 비워 두었습니다. 입력 범위와 실행 오류를 확인하세요.</p>}
        <p className="analysis-note">{sensitivity.parameter.path.startsWith("layout.") ? "좌석 변경은 운영 정원만 바꾼 가상 개입입니다. 가구 간격과 실제 배치 가능성은 별도로 검토해야 합니다." : "값을 올렸을 때 처리량이 얼마나 늘어나는지, 대기도 함께 늘어나는지 확인하세요. 한 번의 비교로 최대 처리 용량을 확정하지 않습니다."}</p>
      </>}
    </details>
  </div>;
}
