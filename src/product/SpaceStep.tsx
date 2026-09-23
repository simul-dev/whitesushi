import { useEffect, useState, type ReactNode } from "react";
import type { StoreLayout } from "../core";
import type { FloorPlan, LayoutMapping } from "../modules/space";
import type { Entity } from "../modules/space/types";
import "./integration.css";

export function PlanThumbnail({ plan }: { plan: FloorPlan }) {
  const shape = (e: Entity, fill: string, opacity = 1) => <g key={e.id} fill={fill} opacity={opacity}>
    {e.polygon?.length ? <polygon points={e.polygon.map(p => `${p.x},${p.y}`).join(" ")} /> : <rect x={e.x} y={e.y} width={e.width} height={e.depth}
      transform={`rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.depth / 2})`} />}
  </g>;
  return <svg className="product-plan-thumbnail" viewBox={`-500 -500 ${plan.bounds.width + 1000} ${plan.bounds.depth + 1000}`} role="img" aria-label={`${plan.name} 공간 배치 미리보기`}>
    {plan.floorOutline?.length ? <polygon points={plan.floorOutline.map(p => `${p.x},${p.y}`).join(" ")} fill="#f6f7f2" /> : <rect x="0" y="0" width={plan.bounds.width} height={plan.bounds.depth} fill="#f6f7f2" />}
    {plan.zones.map(e => shape(e, e.color ?? "#e6ece7", 0.5))}
    {plan.walls.map(e => shape(e, "#657b77"))}
    {plan.objects.filter(e => e.type === "table" || e.type === "range" || e.type === "counter").map(e => <rect key={e.id}
      x={e.x} y={e.y} width={e.width} height={e.depth} rx="60" transform={`rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.depth / 2})`}
      fill={e.type === "table" ? "#bbcbb6" : "#d5cbb3"} stroke="#70877d" strokeWidth="25" />)}
  </svg>;
}

export function SpaceStep({ plan, mapping, layout, confirmed, onMappingChange, onConfirm, children }: {
  plan: FloorPlan; mapping: LayoutMapping; layout: StoreLayout | null; confirmed: boolean;
  onMappingChange: (mapping: LayoutMapping) => void; onConfirm: () => void; children: ReactNode;
}) {
  const [defaultSeats, setDefaultSeats] = useState(4);
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [plan, mapping]);
  const tables = plan.objects.filter(o => o.type === "table");
  const ready = !!layout?.confirmedCapacity && !!mapping.entranceIds?.length && !!mapping.kitchenStationIds?.length && !!mapping.serviceStationIds?.length;
  return <div className="product-space-step">
    <div className="product-page product-space-intro">
      <div className="product-page-heading"><span className="product-eyebrow">02 / SPACE DESIGN</span><h1>이 공간에 우리 매장을 배치합니다.</h1><p>도면을 편집하고, 가상영업에 사용할 출입구와 좌석 정원을 확인하세요.</p></div>
      <dl className="product-space-summary">
        <div><dt>도면 면적</dt><dd>{layout?.totalAreaM2.toFixed(1) ?? "—"}<small> m² · 형상 기준</small></dd></div>
        <div><dt>홀 / 주방</dt><dd>{layout?.hallAreaM2?.toFixed(1) ?? "—"} / {layout?.kitchenAreaM2?.toFixed(1) ?? "—"}<small> m²</small></dd></div>
        <div><dt>테이블</dt><dd>{tables.length}<small> 개</small></dd></div>
        <div><dt>운영 좌석 정원</dt><dd>{layout?.confirmedCapacity ?? "미확정"}<small>{layout?.confirmedCapacity ? " 석" : ""}</small></dd></div>
      </dl>
      <details className="product-mapping" open={!ready}>
        <summary>운영에 사용할 공간 정보 {confirmed ? "· 확인 완료" : "· 확인 필요"}</summary>
        <p className="product-note">기준 예시는 테이블당 4석으로 지정되어 있습니다. 실제 정원과 다르면 수정하세요. 새 도면을 불러오면 다시 지정해야 합니다.</p>
        <div className="product-form-grid">
          <label className="product-field">고객 출입구<select className="product-select" value={mapping.entranceIds?.[0] ?? ""} onChange={e => onMappingChange({ ...mapping, entranceIds: e.target.value ? [e.target.value] : [] })}><option value="">출입구 선택</option>{plan.doors.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="product-field">주방 설비<select className="product-select" value={mapping.kitchenStationIds?.[0] ?? ""} onChange={e => onMappingChange({ ...mapping, kitchenStationIds: e.target.value ? [e.target.value] : [] })}><option value="">주방 설비 선택</option>{plan.objects.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="product-field">서비스 거점<select className="product-select" value={mapping.serviceStationIds?.[0] ?? ""} onChange={e => onMappingChange({ ...mapping, serviceStationIds: e.target.value ? [e.target.value] : [] })}><option value="">서비스 거점 선택</option>{plan.objects.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <div className="product-field"><label htmlFor="default-table-seats">테이블당 정원 일괄 입력</label><div className="product-actions"><input id="default-table-seats" className="product-input" type="number" min="1" max="100" value={defaultSeats} onChange={e => setDefaultSeats(Number(e.target.value))} /><button className="product-button product-button-secondary" disabled={!Number.isInteger(defaultSeats) || defaultSeats < 1 || defaultSeats > 100} onClick={() => onMappingChange({ ...mapping, tableCapacities: Object.fromEntries(tables.map(t => [t.id, defaultSeats])) })}>정원 적용</button></div></div>
        </div>
        <details className="product-table-mapping"><summary>테이블별 정원과 공간 역할 조정</summary><div className="product-table-mapping-grid">
          {tables.map(t => <label className="product-field" key={t.id}>{t.name}<input className="product-input" aria-label={`${t.name} 정원`} type="number" min="1" max="100" value={mapping.tableCapacities?.[t.id] ?? ""} onChange={e => onMappingChange({ ...mapping, tableCapacities: { ...mapping.tableCapacities, [t.id]: e.target.value === "" ? null : Number(e.target.value) } })} /></label>)}
          {plan.zones.map(z => <label className="product-field" key={z.id}>{z.name} 역할<select className="product-select" value={mapping.zoneRoles?.[z.id] ?? "other"} onChange={e => onMappingChange({ ...mapping, zoneRoles: { ...mapping.zoneRoles, [z.id]: e.target.value as "hall" | "kitchen" | "service" | "other" } })}><option value="other">미지정 / 기타</option><option value="hall">홀</option><option value="kitchen">주방</option><option value="service">서비스</option></select></label>)}
        </div></details>
      </details>
      <div className="product-space-confirm"><label><input type="checkbox" checked={confirmed || checked} onChange={e => setChecked(e.target.checked)} /> 출입구·주방과 테이블별 운영 정원을 확인했습니다.</label>
        <button className="product-button product-button-primary" disabled={!ready || (!confirmed && !checked)} onClick={onConfirm}>공간 확인하고 상권으로</button></div>
      {!ready && <p className="product-note">도면에 테이블·출입구·주방·서비스 설비를 추가한 뒤 운영 정보를 지정하면 가상영업을 실행할 수 있습니다.</p>}
    </div>
    <div className="product-space-editor">{children}</div>
  </div>;
}
