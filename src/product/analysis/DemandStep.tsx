import type { DayType, DemandParameters } from "../../core";
import { AnalysisStatus, dayLabel, EmptyAnalysis, formatNumber, LineChart, NumberField, runAfterValidation, StepHeading } from "./common";
import type { DemandStepProps } from "./types";

export function DemandStep(props: DemandStepProps) {
  const { parameters, profile, market, config, onChange, onRun, busy, disabledReason } = props;
  const update = (patch: Partial<DemandParameters>) => onChange({ ...structuredClone(parameters), ...patch });
  const firstHour = Math.floor(config.startMinute / 60), lastHour = Math.ceil((config.startMinute * 60 + config.durationSeconds) / 3600);
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  const delivery = parameters.deliveryOrdersByHour?.filter(bucket => bucket.dayType === config.dayType && hours.includes(bucket.hour)) ?? [];
  const deliveryRate = delivery[0]?.expectedOrdersPerHour ?? 0;
  const uniformDelivery = delivery.every(bucket => bucket.expectedOrdersPerHour === deliveryRate);
  const setDeliveryRate = (rate: number) => {
    const buckets = structuredClone(parameters.deliveryOrdersByHour ?? []);
    for (const dayType of ["weekday", "weekend", "holiday"] as DayType[]) for (let hour = 0; hour < 24; hour++) {
      const existing = buckets.find(bucket => bucket.dayType === dayType && bucket.hour === hour);
      const expectedOrdersPerHour = hours.includes(hour) ? rate : 0;
      if (existing) existing.expectedOrdersPerHour = expectedOrdersPerHour;
      else buckets.push({ dayType, hour, expectedOrdersPerHour, distribution: "poisson" });
    }
    update({ deliveryRatio: 0, deliveryOrdersByHour: buckets });
  };
  return <div className="analysis-page"><StepHeading number="04" title="얼마나 방문한다고 가정할까요?" description="유동인구가 매장 고객이 되는 과정을 직접 설정합니다. 모든 비율은 변경 가능한 가정입니다." action={<button className="analysis-button analysis-button-primary" onClick={event => runAfterValidation(event, onRun)} disabled={busy || !!disabledReason || !market}>{busy ? "수요 계산 중…" : "방문 수요 계산"}</button>} />
    <AnalysisStatus {...props} />
    {market?.provenance.kind === "demo" && <p className="analysis-source-note"><span className="analysis-tag analysis-tag-demo">DEMO</span>예시 유동인구에 아래 가정을 적용합니다. 실제 방문 고객을 관측한 값이 아닙니다.</p>}
    <section className="analysis-section analysis-section-first"><ol className="analysis-demand-flow"><li><span>01</span>상권 유동인구</li><li><span>02</span>업종 참여</li><li><span>03</span>우리 점포 선택</li><li><span>04</span>방문 전환</li></ol>
      <div className="analysis-fields analysis-fields-three">
        <NumberField label="업종 참여율" value={parameters.categoryParticipationRate * 100} min={0} max={100} unit="%" step={0.1} onChange={value => update({ categoryParticipationRate: value / 100 })} help="통행 중 이 업종을 이용할 잠재 고객의 비율" />
        <NumberField label="브랜드·점포 선택 비율" value={parameters.brandShare * 100} min={0} max={100} unit="%" step={0.1} onChange={value => update({ brandShare: value / 100 })} help="업종 잠재 고객 중 우리 점포를 선택하는 비율" />
        <NumberField label="방문 전환율" value={parameters.visitConversionRate * 100} min={0} max={100} unit="%" step={0.01} onChange={value => update({ visitConversionRate: value / 100 })} help="점포 선택 이후 실제 방문으로 이어지는 비율" />
      </div><p className="analysis-formula">유동인구 × 업종 참여율 × 점포 선택 비율 × 방문 전환율 × 시간·요일 보정</p>
    </section>
    <section className="analysis-section"><div className="analysis-section-heading"><div><h2>배달 주문도 함께 운영하나요?</h2><p>배달은 홀 방문 수요와 별개이며 같은 주방을 사용합니다.</p></div></div><div className="analysis-fields analysis-fields-two"><NumberField label="영업시간당 배달 주문" value={deliveryRate} unit="건/시간" min={0} step={1} onChange={setDeliveryRate} help={`설정 시 평일·주말·공휴일 ${firstHour}~${lastHour}시에 같은 주문률을 적용합니다. 0은 배달 없음입니다.`} /><div className="analysis-field-explanation"><p>홀 고객 수에서 배달 비중을 빼지 않습니다.</p><p>배달 조리와 포장은 가상영업에서 조리 인력을 사용합니다.</p>{!uniformDelivery && <p className="analysis-note">시간대별 주문률이 다릅니다. 이 값을 바꾸면 지정 시간대의 주문률이 같아집니다.</p>}</div></div>{parameters.deliveryRatio > 0 && <p className="analysis-notice analysis-notice-warning">이전 방식의 배달 비율이 설정되어 있습니다. 위 주문 수를 입력하면 독립 배달 주문 방식으로 전환됩니다.</p>}</section>
    <details className="analysis-details"><summary>고급 설정 · 시간대와 요일 보정</summary><div className="analysis-fields analysis-fields-three">
      <NumberField label="점심 수요 보정" value={parameters.lunchMultiplier} unit="배" step={0.1} onChange={value => update({ lunchMultiplier: value })} help="11~14시, 1이면 추가 보정 없음" />
      <NumberField label="저녁 수요 보정" value={parameters.dinnerMultiplier} unit="배" step={0.1} onChange={value => update({ dinnerMultiplier: value })} help="17~21시, 1이면 추가 보정 없음" />
      <NumberField label="평일 수요 보정" value={parameters.weekdayMultiplier} unit="배" step={0.1} onChange={value => update({ weekdayMultiplier: value })} />
      <NumberField label="주말·공휴일 보정" value={parameters.weekendMultiplier} unit="배" step={0.1} onChange={value => update({ weekendMultiplier: value })} />
      <NumberField label="날씨·행사 보정" value={parameters.weatherEventMultiplier} unit="배" step={0.1} onChange={value => update({ weatherEventMultiplier: value })} help="실제 기상 정보를 자동으로 불러오지 않습니다." />
    </div><p className="analysis-note">이미 유동인구에 반영된 피크를 다시 크게 보정하면 수요가 중복 확대될 수 있습니다.</p></details>
    <section className="analysis-section"><div className="analysis-section-heading"><div><h2>가정에 따른 시간대별 유입</h2><p>{dayLabel(config.dayType)} · {firstHour}~{lastHour}시 · 유입은 처리 완료 고객과 다릅니다.</p></div>{props.stale && <span className="analysis-tag analysis-tag-demo">변경 전 수요</span>}</div>
      {!profile ? <EmptyAnalysis title="가정을 정한 뒤 수요를 계산하세요.">계산한 시간대별 홀 고객과 배달 주문을 가상영업에서 사용합니다.</EmptyAnalysis> : <>
        <LineChart title="예상 홀 방문 유입" labels={hours.map(hour => `${hour}시`)} unit="명/시간" series={[{ name: "가정에 따른 홀 유입", color: "#176f5f", values: hours.map(hour => profile.buckets.find(bucket => bucket.dayType === config.dayType && bucket.hour === hour)?.expectedCustomersPerHour ?? null) }]} />
        {profile.deliveryBuckets && <div className="analysis-delivery-summary"><span>별도 배달 유입</span><strong>{formatNumber(profile.deliveryBuckets.find(bucket => bucket.dayType === config.dayType && bucket.hour === firstHour)?.expectedOrdersPerHour)}건/시간</strong><span>{firstHour}시 기준 · 고객 수에 합산하지 않습니다.</span></div>}
      </>}
    </section>
  </div>;
}
