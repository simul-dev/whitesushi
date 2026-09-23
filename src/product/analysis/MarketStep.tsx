import { useState } from "react";
import type { MarketIntelligenceProfile } from "../../modules/market";
import { AnalysisStatus, EmptyAnalysis, formatNumber, LineChart, StepHeading } from "./common";
import type { MarketStepProps } from "./types";

export function MarketStep(props: MarketStepProps) {
  const { profile, site, onRun, busy, disabledReason } = props;
  const [metric, setMetric] = useState<"traffic" | "population">("traffic");
  const enriched = profile as MarketIntelligenceProfile | null;
  const isDemo = profile?.provenance.kind === "demo";
  const sourceLocation = enriched?.location ? enriched.location.address || enriched.location.name : props.stale ? "이전 후보지의 상권 자료" : site.address || site.name;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return <div className="analysis-page"><StepHeading number="03" title="주변의 하루를 살펴보세요." description="시간대와 요일에 따라 달라지는 유동인구를 먼저 확인합니다." action={<button className="analysis-button analysis-button-primary" onClick={onRun} disabled={busy || !!disabledReason}>{busy ? "상권 자료 준비 중…" : profile ? "상권 자료 다시 불러오기" : "Demo 상권 자료 불러오기"}</button>} />
    <AnalysisStatus {...props} />
    {!profile ? <EmptyAnalysis title="상권 자료를 불러오면 패턴이 보입니다.">현재는 예시 상권 공급자를 사용합니다. 입력한 주소의 실제 관측 데이터가 아닌, 서비스 흐름을 확인하기 위한 Demo입니다.</EmptyAnalysis> : <>
      <section className="analysis-market-source"><div><span className={`analysis-tag ${isDemo ? "analysis-tag-demo" : ""}`}>{isDemo ? "DEMO MARKET DATA" : profile.provenance.kind === "observed" ? "관측 상권 자료" : "상권 입력 자료"}</span>{props.stale && <span className="analysis-tag analysis-tag-demo">변경 전 자료</span>}<h2>{sourceLocation}</h2><p>{isDemo ? "이 주소의 실측 자료가 아닙니다. 모든 후보지에 같은 예시 패턴이 적용됩니다." : profile.provenance.source}</p></div><dl><div><dt>자료 공급자</dt><dd>{profile.provider.id} · {profile.provider.version}</dd></div><div><dt>{isDemo ? "분석 기준 기간" : "관측 기간"}</dt><dd>{profile.period.from.slice(0, 10)} — {profile.period.to.slice(0, 10)}</dd></div><div><dt>공간 범위</dt><dd>{enriched?.coverage?.spatial ? `반경 ${formatNumber(enriched.coverage.spatial.radiusMeters, 0)}m${isDemo ? " (예시)" : ""}` : "미제공"}</dd></div></dl></section>
      <section className="analysis-section"><div className="analysis-section-heading"><div><h2>언제 통행이 많아지나요?</h2><p>요일별 같은 시간의 패턴을 비교합니다.</p></div><div className="analysis-segment" role="group" aria-label="상권 지표"><button aria-pressed={metric === "traffic"} onClick={() => setMetric("traffic")}>유동인구</button><button aria-pressed={metric === "population"} onClick={() => setMetric("population")}>생활인구</button></div></div>
        <LineChart title={metric === "traffic" ? "평일·주말 시간대별 유동인구" : "평일·주말 시간대별 생활인구"} labels={hours.map(hour => `${hour}시`)} unit={metric === "traffic" ? "통행 명/시간" : "명 (해당 시점)"} series={[{ day: "weekday", name: "평일", color: "#176f5f" }, { day: "weekend", name: "주말", color: "#bc8650" }].map(item => ({ ...item, values: hours.map(hour => { const bucket = profile.buckets.find(bucket => bucket.dayType === item.day && bucket.hour === hour); return metric === "traffic" ? bucket?.footTrafficPersons ?? null : bucket?.population ?? null; }) }))} />
        <p className="analysis-note">{metric === "traffic" ? "유동인구는 반복 통행이 포함된 상권 자료입니다. 매장 방문 고객 수는 다음 단계의 전환 가정으로 계산합니다." : "생활인구는 시간대별 인구 규모입니다. 시간별 값을 더해 하루의 고유 인원으로 해석하지 않습니다."}</p>
      </section>
      <section className="analysis-section"><div className="analysis-section-heading"><div><h2>주변 업종과 경쟁점</h2><p>{isDemo ? "사업체 이름과 거리도 가상의 예시입니다." : "공급자가 제공한 사업체 목록입니다."}</p></div></div>
        {profile.nearbyBusinesses.length ? <div className="analysis-table-scroll"><table className="analysis-table"><thead><tr><th>사업체</th><th>업종</th><th>거리</th><th>분류</th></tr></thead><tbody>{profile.nearbyBusinesses.map(business => <tr key={business.id}><th scope="row">{business.name}</th><td>{business.category}</td><td>{formatNumber(business.distanceMeters, 0)}m</td><td>{business.competitor ? "동종 경쟁점" : "주변 업종"}</td></tr>)}</tbody></table></div> : <p className="analysis-note">제공된 주변 사업체 자료가 없습니다.</p>}
      </section>
      <details className="analysis-details"><summary>출처와 자료의 한계</summary><dl className="analysis-definition-list"><div><dt>출처</dt><dd>{profile.provenance.source}</dd></div><div><dt>실제 관측 시점</dt><dd>{profile.provenance.observedAt ?? "미제공"}</dd></div><div><dt>미제공 항목</dt><dd>{enriched?.dataQuality?.missingFields?.join(", ") || "공급자별 자료 설명을 확인하세요."}</dd></div></dl>{isDemo && <p className="analysis-note">실제 공공데이터 API, 위치별 보정, 지오코딩을 연결하지 않았습니다. 주소를 바꾸어도 지역 차이를 추정하지 않습니다.</p>}</details>
    </>}
  </div>;
}
