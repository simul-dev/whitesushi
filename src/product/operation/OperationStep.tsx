import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LayoutElement, OperationPolicy, SimulationConfig, SimulationFrame, SimulationRun, StoreLayout } from "../../core";
import "./operation.css";

export interface OperationStepProps {
  run: SimulationRun | null;
  frames: SimulationFrame[];
  layout: StoreLayout | null;
  policy: OperationPolicy;
  config: SimulationConfig;
  onPolicyChange: (policy: OperationPolicy) => void;
  onConfigChange: (config: SimulationConfig) => void;
  onRun: () => void;
  busy: boolean;
  stale: boolean;
  disabledReason?: string;
}

const format = (value: number, digits = 0) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
const resourceName: Record<string, string> = { tables: "테이블", seats: "좌석", kitchen: "주방 조리 공간", cooks: "조리 직원", servers: "홀 직원", cashiers: "결제 직원" };
const dayNames = { weekday: "평일", weekend: "주말", holiday: "공휴일" };

/** Replay selects recorded states only. It never advances or interpolates the DES. */
function frameAt(frames: SimulationFrame[], seconds: number): SimulationFrame | undefined {
  let low = 0, high = frames.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].elapsedSeconds <= seconds) low = middle + 1;
    else high = middle - 1;
  }
  return frames[Math.max(0, high)];
}

function NumberSetting({ label, value, onChange, unit, min = 0, max = 100, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; unit: string; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(String(value)); setError(false); input.current?.setCustomValidity(""); }, [value]);
  function commit() {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max || (step === 1 && !Number.isInteger(number))) {
      setError(true); input.current?.setCustomValidity("표시된 범위 안의 값을 입력하세요."); return;
    }
    setError(false); input.current?.setCustomValidity(""); if (number !== value) onChange(number);
  }
  return <label className="product-field operation-number-field"><span>{label}</span>
    <span className="operation-input-unit"><input ref={input} className="product-input" type="number" required aria-invalid={error || undefined}
      value={draft} min={min} max={max} step={step === 1 ? 1 : "any"} onChange={event => { setDraft(event.target.value); event.target.setCustomValidity(""); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /><span>{unit}</span></span>
    {error && <small className="operation-input-error">{format(min, 2)}–{format(max, 2)} {unit}{step === 1 ? " 정수" : ""}로 입력하세요.</small>}
  </label>;
}

function ClockSetting({ label, value, onChange, min = 0, max = 1440 }: { label: string; value: number; onChange: (minutes: number) => void; min?: number; max?: number }) {
  const [draft, setDraft] = useState(clock(value)), [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(clock(value)); setError(false); input.current?.setCustomValidity(""); }, [value]);
  function commit() {
    const match = /^(\d{1,2}):(\d{2})$/.exec(draft.trim());
    const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    if (!match || Number(match[2]) >= 60 || !Number.isFinite(minutes) || minutes < min || minutes > max) { setError(true); input.current?.setCustomValidity("표시된 범위의 HH:MM 시각을 입력하세요."); return; }
    setError(false); input.current?.setCustomValidity(""); setDraft(clock(minutes)); if (minutes !== value) onChange(minutes);
  }
  return <label className="product-field"><span>{label}</span><input ref={input} className="product-input" required value={draft} placeholder="11:00"
    aria-invalid={error || undefined} onChange={event => { setDraft(event.target.value); event.target.setCustomValidity(""); }} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    {error && <small className="operation-input-error">{clock(min)}–{clock(max)} 사이 시각을 HH:MM으로 입력하세요.</small>}
  </label>;
}

function Shape({ element, className, children }: { element: LayoutElement; className: string; children?: ReactNode }) {
  const center = { x: element.x + element.width / 2, y: element.y + element.depth / 2 };
  return <g className={className}>
    {element.polygon?.length ? <polygon points={element.polygon.map(point => `${point.x},${point.y}`).join(" ")}>
      <title>{element.name}</title></polygon> : <rect x={element.x} y={element.y} width={element.width} height={element.depth}
      transform={element.rotationDegrees ? `rotate(${element.rotationDegrees} ${center.x} ${center.y})` : undefined}>
      <title>{element.name}</title></rect>}
    {children}
  </g>;
}

function FloorScene({ layout, frame }: { layout: StoreLayout; frame?: SimulationFrame }) {
  const { width, depth } = layout.geometry.bounds;
  const unit = Math.max(width, depth) / 48, margin = unit * 3;
  const tableResource = frame?.resources.find(resource => resource.resourceId === "tables");
  const occupied = new Set(tableResource?.occupiedUnitIndices ?? []);
  const tableIndices = new Map(layout.assignments.tables.map((table, index) => [table.elementId, index]));
  const kitchenIds = new Set(layout.assignments.kitchenStationIds);
  const kitchen = frame?.resources.find(resource => resource.resourceId === "kitchen");
  const entry = layout.geometry.elements.find(element => layout.assignments.entranceIds.includes(element.id));
  const entranceQueue = frame?.entities.filter(entity => entity.channel === "dine-in" && entity.status === "waiting" && !entity.allocations.some(allocation => allocation.resourceId === "tables"))
    .reduce((sum, entity) => sum + entity.size, 0) ?? 0;
  const kitchenZoneIds = new Set(layout.assignments.zoneRoles.filter(zone => zone.role === "kitchen").map(zone => zone.elementId));
  const ordered = [...layout.geometry.elements].sort((a, b) => {
    const order = { zone: 0, wall: 1, window: 2, door: 3, object: 4 };
    return order[a.kind] - order[b.kind];
  });
  return <svg className="operation-floor" role="img" aria-label={`실제 배치도. 테이블 ${occupied.size}/${layout.tableCount}개 사용 중, 입장 대기 ${entranceQueue}명`}
    viewBox={`${-margin} ${-margin} ${width + margin * 2} ${depth + margin * 2}`}>
    {layout.geometry.outline?.length ? <polygon className="operation-floor-boundary" points={layout.geometry.outline.map(point => `${point.x},${point.y}`).join(" ")} />
      : <rect className="operation-floor-boundary" x={0} y={0} width={width} height={depth} />}
    {ordered.map(element => {
      const tableIndex = tableIndices.get(element.id);
      const tableUsed = tableIndex !== undefined && occupied.has(tableIndex);
      const isKitchen = kitchenIds.has(element.id);
      const kitchenActive = isKitchen && (kitchen?.busyUnits ?? 0) > 0;
      const classes = ["operation-geometry", `operation-geometry-${element.kind}`, element.type === "chair" ? "operation-chair" : "",
        kitchenZoneIds.has(element.id) ? "operation-kitchen-zone" : "", isKitchen ? "operation-kitchen-station" : "",
        kitchenActive ? "operation-kitchen-active" : "", tableIndex !== undefined ? "operation-table" : "", tableUsed ? "operation-table-occupied" : ""].join(" ");
      const label = tableIndex !== undefined ? `${tableIndex + 1}` : isKitchen ? "조리" : "";
      return <Shape key={element.id} element={element} className={classes}>
        {label && <text className="operation-geometry-label" x={element.x + element.width / 2} y={element.y + element.depth / 2}
          dominantBaseline="central" textAnchor="middle" fontSize={unit * 0.7}>{label}</text>}
      </Shape>;
    })}
    {entry && <g className="operation-entry-marker" transform={`translate(${entry.x + entry.width / 2} ${entry.y + entry.depth / 2})`}>
      <circle r={unit * 0.45} /><text textAnchor="middle" dominantBaseline="central" fontSize={unit * 0.55}>↗</text>
      <rect x={unit * 0.65} y={-unit * 0.55} width={unit * 4.4} height={unit * 1.1} rx={unit * 0.25} />
      <text x={unit * 0.9} y={0} dominantBaseline="central" fontSize={unit * 0.6}>입장 대기 {entranceQueue}명</text>
    </g>}
  </svg>;
}

function Pool({ frame, id, label }: { frame?: SimulationFrame; id: string; label: string }) {
  const pool = frame?.resources.find(resource => resource.resourceId === id);
  return <div className="operation-pool"><div><span>{label}</span><strong>{pool ? `${format(pool.busyUnits)} / ${format(pool.capacityUnits)}` : "—"}</strong></div>
    <div className="operation-pool-track"><span style={{ width: `${pool && pool.capacityUnits ? Math.min(100, pool.busyUnits / pool.capacityUnits * 100) : 0}%` }} /></div></div>;
}

function ArrivalsTimeline({ frames, position, startMinute }: { frames: SimulationFrame[]; position: number; startMinute: number }) {
  const end = frames.at(-1)!, horizon = end.elapsedSeconds || 1, peak = Math.max(1, end.customers.arrived);
  const x = (seconds: number) => 35 + seconds / horizon * 925;
  const y = (value: number) => 130 - value / peak * 110;
  // Stair steps show actual sampled states without inventing intermediate arrivals or completions.
  const path = (key: "arrived" | "served") => frames.map((frame, index) => `${index ? "H" : "M"}${x(frame.elapsedSeconds)}${index ? "V" : ","}${y(frame.customers[key])}`).join(" ");
  const ticks = Array.from({ length: 6 }, (_, index) => index / 5 * horizon);
  return <div className="operation-hourly"><div className="operation-section-title"><h3>영업 중 누적 유입과 처리</h3><span><i className="operation-key-arrived" />유입 <i className="operation-key-served" />처리 · 명</span></div>
    <div className="operation-flow-scroll"><svg className="operation-flow-chart" viewBox="0 0 1000 165" role="img" aria-label={`홀 누적 유입 ${end.customers.arrived}명, 누적 처리 ${end.customers.served}명. 시간별 실제 기록의 변화.`}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}><line x1="35" x2="960" y1={y(peak * ratio)} y2={y(peak * ratio)} className="operation-chart-grid" /><text x="28" y={y(peak * ratio) + 4} textAnchor="end">{format(peak * ratio)}</text></g>)}
      <path d={path("arrived")} className="operation-line-arrived" /><path d={path("served")} className="operation-line-served" />
      <line x1={x(position)} x2={x(position)} y1="14" y2="132" className="operation-chart-playhead" />
      {ticks.map(seconds => <text key={seconds} x={x(seconds)} y="153" textAnchor="middle">{clock(startMinute + seconds / 60)}</text>)}
    </svg></div><p className="product-note">현재 재생 시각은 세로선으로 표시합니다. 두 선의 차이는 진행 중이거나 포기한 고객이며, 대기 고객 수와 같지는 않습니다.</p></div>;
}

export function OperationStep({ run, frames, layout, policy, config, onPolicyChange, onConfigChange, onRun, busy, stale, disabledReason }: OperationStepProps) {
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(600), [position, setPosition] = useState(0);
  const settings = useRef<HTMLFieldSetElement>(null);
  const horizon = frames.at(-1)?.elapsedSeconds ?? 0;
  const frame = frameAt(frames, position);
  // Historical frames always retain the geometry and clock of their own immutable run.
  const displayLayout = run?.snapshot.input.layout ?? layout;
  const displayConfig = run?.snapshot.input.config ?? config;
  const result = run?.result;
  const hasFrames = !!frames.length;
  useEffect(() => { setPlaying(false); setPosition(0); }, [frames, run?.id]);
  useEffect(() => {
    if (!playing || !hasFrames) return;
    let request = 0, last: number | undefined;
    function tick(now: number) {
      const elapsed = last === undefined ? 0 : (now - last) / 1000 * speed;
      setPosition(previous => Math.min(horizon, previous + elapsed));
      last = now; request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, speed, horizon, hasFrames]);
  useEffect(() => { if (position >= horizon) setPlaying(false); }, [position, horizon]);
  const arrivalQueue = frame?.entities.filter(entity => entity.channel === "dine-in" && entity.status === "waiting" && !entity.allocations.some(allocation => allocation.resourceId === "tables"))
    .reduce((sum, entity) => sum + entity.size, 0) ?? 0;
  const occupiedSeats = frame?.resources.find(resource => resource.resourceId === "seats");
  const occupiedTables = frame?.resources.find(resource => resource.resourceId === "tables");
  const cookingDelivery = frame?.entities.filter(entity => entity.channel === "delivery" && entity.status === "active").length ?? 0;
  const dayWindows = policy.operatingWindows.map((window, index) => ({ ...window, index })).filter(window => window.dayType === config.dayType);
  const changeResource = (key: keyof OperationPolicy["resources"], value: number) => onPolicyChange({ ...policy, resources: { ...policy.resources, [key]: value } });
  const changeDuration = (key: keyof OperationPolicy["durations"], minutes: number) => onPolicyChange({ ...policy, durations: { ...policy.durations, [key]: minutes * 60 } });
  function changeWindow(index: number, key: "startMinute" | "endMinute", value: number) {
    onPolicyChange({ ...policy, operatingWindows: policy.operatingWindows.map((window, i) => i === index ? { ...window, [key]: value } : window) });
  }
  const bottleneckNames = [...new Set(result?.bottlenecks.map(item => resourceName[item.resource] ?? item.resource) ?? [])];

  return <section className="product-page operation-step" aria-label="가상영업">
    <header className="product-page-heading"><p className="product-eyebrow">05 · VIRTUAL OPERATION</p><h1>이 공간에서 먼저 영업해 보세요.</h1>
      <p>설계한 매장에 고객과 배달 주문을 흘려보내고, 대기가 생기는 순간을 살펴봅니다.</p></header>

    <fieldset ref={settings} className="operation-settings" disabled={busy}><legend className="operation-visually-hidden">가상영업 운영 조건</legend>
      <div className="operation-settings-primary">
        <NumberSetting label="조리 직원" value={policy.resources.cooks} unit="명" onChange={value => changeResource("cooks", value)} />
        <NumberSetting label="홀 직원" value={policy.resources.servers} unit="명" onChange={value => changeResource("servers", value)} />
        <NumberSetting label="동시 조리" value={policy.resources.kitchenConcurrentOrders} unit="주문" onChange={value => changeResource("kitchenConcurrentOrders", value)} />
        <div className="operation-run-action"><button className="product-button product-button-primary" type="button" disabled={busy || !!disabledReason}
          onClick={() => {
            const invalid = [...(settings.current?.querySelectorAll("input") ?? [])].find(input => !input.checkValidity());
            if (invalid) { invalid.closest("details")?.setAttribute("open", ""); invalid.reportValidity(); return; }
            onRun();
          }}>{busy ? "가상 영업 계산 중…" : run ? "이 조건으로 다시 실행" : "가상 영업 실행"}</button>
          <span className="product-note">{dayNames[config.dayType]} {clock(config.startMinute)}부터 {format(config.durationSeconds / 3600, 2)}시간</span></div>
      </div>
      <details className="operation-advanced"><summary>영업시간 · 서비스 시간 설정</summary><div className="operation-advanced-grid">
        <div><h3>관찰할 시간</h3><div className="product-form-grid">
          <label className="product-field"><span>요일</span><select className="product-select" value={config.dayType} onChange={event => onConfigChange({ ...config, dayType: event.target.value as SimulationConfig["dayType"] })}>
            <option value="weekday">평일</option><option value="weekend">주말</option><option value="holiday">공휴일</option></select></label>
          <ClockSetting label="관찰 시작" value={config.startMinute} max={Math.floor(1440 - config.durationSeconds / 60)} onChange={startMinute => onConfigChange({ ...config, startMinute })} />
          <NumberSetting label="관찰 기간" value={config.durationSeconds / 3600} unit="시간" step={0.5} min={1 / 60} max={(1440 - config.startMinute) / 60} onChange={hours => onConfigChange({ ...config, durationSeconds: hours * 3600 })} />
          <NumberSetting label="반복 재현 번호" value={config.seed} unit="" max={2147483647} onChange={seed => onConfigChange({ ...config, seed })} />
        </div><p className="product-note">관찰 시작에는 매장이 비어 있습니다. 종료 시각에 남은 대기·식사 고객은 진행 중으로 집계합니다.</p>
        <h3>{dayNames[config.dayType]} 실제 입장 허용 시간</h3><div className="product-form-grid">
          {dayWindows.map((window, i) => <div key={window.index} className="operation-window-pair">
            <ClockSetting label={`영업 시작${dayWindows.length > 1 ? ` ${i + 1}` : ""}`} value={window.startMinute} max={window.endMinute - 1}
              min={i ? dayWindows[i - 1].endMinute : 0} onChange={value => changeWindow(window.index, "startMinute", value)} />
            <ClockSetting label={`영업 종료${dayWindows.length > 1 ? ` ${i + 1}` : ""}`} value={window.endMinute} min={window.startMinute + 1}
              max={dayWindows[i + 1]?.startMinute ?? 1440} onChange={value => changeWindow(window.index, "endMinute", value)} />
          </div>)}
        </div>{!dayWindows.length && <button className="product-button product-button-secondary" type="button" onClick={() => onPolicyChange({ ...policy,
          operatingWindows: [...policy.operatingWindows, { dayType: config.dayType, startMinute: config.startMinute, endMinute: Math.min(1440, Math.ceil(config.startMinute + config.durationSeconds / 60)) }] })}>관찰 시간에 영업 허용</button>}</div>
        <div><h3>주문 한 건의 서비스 시간</h3><div className="product-form-grid">
          <NumberSetting label="주문 접수" value={policy.durations.orderingSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("orderingSeconds", value)} />
          <NumberSetting label="조리" value={policy.durations.cookingSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("cookingSeconds", value)} />
          <NumberSetting label="서빙" value={policy.durations.servingSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("servingSeconds", value)} />
          <NumberSetting label="식사" value={policy.durations.diningSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("diningSeconds", value)} />
          <NumberSetting label="결제" value={policy.durations.paymentSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("paymentSeconds", value)} />
          <NumberSetting label="정리" value={policy.durations.cleaningSeconds / 60} unit="분" step={0.1} max={240} onChange={value => changeDuration("cleaningSeconds", value)} />
          <NumberSetting label="결제 직원" value={policy.resources.cashiers} unit="명" onChange={value => changeResource("cashiers", value)} />
          {policy.delivery && <NumberSetting label="배달 포장" value={policy.delivery.packagingSeconds / 60} unit="분" step={0.1} max={240}
            onChange={value => onPolicyChange({ ...policy, delivery: { ...policy.delivery!, packagingSeconds: value * 60 } })} />}
        </div><p className="product-note">홀과 배달은 같은 주방·조리 직원을 사용합니다. 포장에도 조리 직원의 시간이 필요합니다.</p></div>
      </div></details>
    </fieldset>
    {disabledReason && <p className="product-callout product-callout-warning" role="status">{disabledReason}</p>}
    {stale && run && <p className="product-callout product-callout-warning" role="status">입력 조건이 바뀌었습니다. 아래 재생과 결과는 이전 실행의 배치·조건입니다. 다시 실행하면 현재 조건을 반영합니다.</p>}

    <div className="operation-theatre" data-testid="operation-theatre">
      <div className="operation-playback"><div className="operation-transport">
        <button className="product-button product-button-secondary" type="button" disabled={!hasFrames} onClick={() => { if (position >= horizon) setPosition(0); setPlaying(!playing); }} aria-label={playing ? "재생 일시정지" : "영업 기록 재생"}>{playing ? "Ⅱ 일시정지" : "▶ 재생"}</button>
        <button className="operation-text-button" type="button" disabled={!hasFrames} onClick={() => { setPlaying(false); setPosition(0); }}>처음부터</button>
        <label className="operation-speed"><span className="operation-visually-hidden">재생 속도</span><select value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {[1, 5, 20, 120, 600].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      </div><div className="operation-clock"><span>{hasFrames ? dayNames[displayConfig.dayType] : "실행 전"}</span><strong data-testid="operation-clock">{clock(displayConfig.startMinute + position / 60)}</strong><small>{hasFrames && position >= horizon ? "관찰 종료" : hasFrames ? playing ? "재생 중" : "기록 탐색" : "배치 미리보기"}</small></div></div>
      <div className="operation-stage"><div className="operation-canvas">
        <div className="operation-canvas-label"><span>STORE FLOOR</span><span>{displayLayout ? `${format(displayLayout.totalAreaM2, 1)} m² · ${displayLayout.tableCount}개 테이블` : "공간 설계 필요"}</span></div>
        {displayLayout ? <FloorScene layout={displayLayout} frame={frame} /> : <div className="product-empty">공간설계에서 배치를 준비하면 여기에 표시됩니다.</div>}
        <div className="operation-map-legend"><span><i className="operation-legend-free" />빈 테이블</span><span><i className="operation-legend-used" />사용 중</span><span><i className="operation-legend-kitchen" />조리 진행</span></div>
        <p className="operation-map-note">배치에 운영 상태를 표시합니다. 보행 경로·이동 거리·배달 기사는 모델링하지 않습니다.</p>
      </div>
      <aside className="operation-state" aria-label="현재 영업 상태"><div className="operation-section-title"><h2>현재 상태</h2><span>{hasFrames ? "기록된 시점" : "실행 전"}</span></div>
        <div className="operation-waiting"><span>홀 전체 대기</span><strong>{frame ? format(frame.customers.waiting) : "—"}<small>명</small></strong>
          <p>입장 대기 {frame ? format(arrivalQueue) : "—"}명 · 착석 후 대기 {frame ? format(frame.customers.waiting - arrivalQueue) : "—"}명</p></div>
        <dl className="operation-counts"><div><dt>누적 유입</dt><dd>{frame ? format(frame.customers.arrived) : "—"}<small>명</small></dd></div>
          <div><dt>처리 완료</dt><dd>{frame ? format(frame.customers.served) : "—"}<small>명</small></dd></div><div><dt>대기 포기</dt><dd>{frame ? format(frame.customers.lost) : "—"}<small>명</small></dd></div></dl>
        <div className="operation-occupancy"><span>테이블 사용</span><strong>{occupiedTables ? `${occupiedTables.busyUnits} / ${occupiedTables.capacityUnits}` : "—"}<small>개</small></strong>
          <small>좌석 사용 {occupiedSeats ? `${occupiedSeats.busyUnits} / ${occupiedSeats.capacityUnits}` : "—"}석 · 정리까지 테이블 사용에 포함</small></div>
        <Pool frame={frame} id="kitchen" label="동시 조리 사용" /><Pool frame={frame} id="cooks" label="조리 직원 작업 중" /><Pool frame={frame} id="servers" label="홀 직원 작업 중" />
        <p className="product-note operation-pool-note">현재 사용 / 설정 용량입니다. 전체 영업시간의 평균 가동률과 다릅니다.</p>
        <div className="operation-delivery"><h3>배달 주문 <span>별도 주문 단위</span></h3><dl className="operation-counts">
          <div><dt>대기</dt><dd>{frame ? format(frame.delivery.waiting) : "—"}<small>건</small></dd></div><div><dt>조리·포장</dt><dd>{frame ? format(cookingDelivery) : "—"}<small>건</small></dd></div>
          <div><dt>완료</dt><dd>{frame ? format(frame.delivery.completed) : "—"}<small>건</small></dd></div></dl>
          <p className="product-note">누적 접수 {frame ? format(frame.delivery.arrived) : "—"}건 · 포기 {frame ? format(frame.delivery.lost) : "—"}건</p></div>
      </aside></div>
      <div className="operation-scrubber"><label className="operation-visually-hidden" htmlFor="operation-playhead">영업 기록 시각 탐색</label>
        <input id="operation-playhead" type="range" min={0} max={horizon || 1} step={1} value={position} disabled={!hasFrames}
          onChange={event => { setPlaying(false); setPosition(Number(event.target.value)); }} aria-valuetext={clock(displayConfig.startMinute + position / 60)} />
        <div><span>{clock(displayConfig.startMinute)}</span><span>{hasFrames ? `실제 상태 기록 ${format(frames.length)}개 · ${clock(displayConfig.startMinute + horizon / 60)}` : "실행 후 시간 막대로 대기가 생기는 순간을 확인하세요."}</span></div>
      </div>
    </div>

    {result && <section className="operation-results" aria-label="전체 영업 결과"><div className="operation-section-title"><h2>전체 영업에서 확인한 것</h2><span>{format(displayConfig.durationSeconds / 3600, 2)}시간 · 첫 실행 1회 기록</span></div>
      <div className="operation-result-summary"><div><span>홀 처리량</span><strong>{format(result.throughputCustomersPerHour, 1)}<small>명/시간</small></strong></div>
        <div><span>홀 평균 대기</span><strong>{format(result.averageWaitingSeconds / 60, 1)}<small>분</small></strong></div>
        <div><span>주방 평균 가동률</span><strong>{format(result.kitchenUtilization * 100, 1)}<small>%</small></strong></div>
        <div><span>배달 처리량</span><strong>{format(result.delivery?.throughputOrdersPerHour ?? 0, 1)}<small>건/시간</small></strong></div></div>
      <div className="operation-finding"><span className="operation-finding-label">대기가 기록된 자원</span><div><strong>{bottleneckNames.length ? bottleneckNames.join(" · ") : "이 실행에서 자원 부족 대기는 기록되지 않았습니다."}</strong>
        <p>{bottleneckNames.length ? "이 자원을 사용할 수 없어 멈춘 시간이 실제로 기록됐습니다. 어느 조건을 바꾸는 것이 효과적인지는 시나리오에서 비교할 수 있습니다." : "현재 수요와 운영 가정에 따른 결과입니다. 더 높은 수요에서도 여유가 있다는 뜻은 아닙니다."}</p></div></div>
      <p className="product-note">평균 홀 체류 {format(result.averageCustomerTimeInSystemSeconds / 60, 1)}분 · 테이블 평균 가동률 {format(result.tableUtilization * 100, 1)}% · 직원 평균 가동률 {format(result.staffUtilization * 100, 1)}% · 종료 시 홀 {format(result.customersUnfinished ?? 0)}명, 배달 {format(result.delivery?.ordersUnfinished ?? 0)}건 진행 중. 홀 평균 대기는 완료·포기·진행 중 고객의 관찰된 대기를 포함합니다. 재생과 위 결과는 반복 분석의 첫 실행이며, 시나리오의 반복 평균과 구분됩니다.</p>
      {hasFrames && <ArrivalsTimeline frames={frames} position={position} startMinute={displayConfig.startMinute} />}
    </section>}
  </section>;
}
