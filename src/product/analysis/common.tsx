import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { AnalysisStatusProps } from "./types";

export const formatNumber = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);
export const won = (value: number | null | undefined) => value === null || value === undefined ? "계산 불가" : `${formatNumber(value, 0)}원`;
export const manwon = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${formatNumber(value / 10000, 1)}만원`;
export const pct = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : `${formatNumber(value * 100, digits)}%`;
export const dayLabel = (day: string) => ({ weekday: "평일", weekend: "주말", holiday: "공휴일" }[day] ?? day);
export const resourceLabel = (name: string) => ({ tables: "테이블", seats: "좌석", kitchen: "주방 조리 자리", cooks: "조리 인력", servers: "홀 직원", cashiers: "결제 인력" }[name] ?? name);

export function StepHeading({ number, title, description, action }: { number: string; title: string; description: string; action?: ReactNode }) {
  return <header className="analysis-heading"><div><p className="analysis-eyebrow">STEP {number}</p><h1>{title}</h1><p className="analysis-lead">{description}</p></div>{action}</header>;
}
export function AnalysisStatus({ busy, stale, error, disabledReason }: AnalysisStatusProps) {
  return <div aria-live="polite" className="analysis-status">
    {busy && <p className="analysis-notice">입력한 조건으로 계산하고 있습니다.</p>}
    {stale && <p className="analysis-notice analysis-notice-warning">조건이 변경되었습니다. 아래는 이전 결과이며 다시 계산해야 합니다.</p>}
    {error && <p className="analysis-notice analysis-notice-error" role="alert">{error}</p>}
    {disabledReason && <p className="analysis-note">{disabledReason}</p>}
  </div>;
}
export function EmptyAnalysis({ title, children }: { title: string; children: ReactNode }) {
  return <div className="analysis-empty"><span className="analysis-empty-line" /><h2>{title}</h2><p>{children}</p></div>;
}
export function NumberField({ label, value, onChange, unit, help, min = 0, max, step = "any", disabled }: {
  label: string; value: number; onChange(value: number): void; unit?: string; help?: string; min?: number; max?: number; step?: number | "any"; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value)), [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  const integer = step === 1 && ["명", "건", "일", "석"].includes(unit ?? "");
  useEffect(() => { if (input.current) setInvalid(!input.current.validity.valid); }, [min, max, integer]);
  return <div className="analysis-field"><label htmlFor={id}>{label}</label><div className="analysis-input-unit"><input ref={input} id={id} type="number" required inputMode="decimal" value={draft} min={min} max={max} step={integer ? 1 : "any"} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={[unit ? `${id}-unit` : "", help ? `${id}-help` : "", invalid ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} onChange={event => {
    setDraft(event.target.value); setInvalid(!event.target.validity.valid);
    if (event.target.validity.valid && Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber !== value) onChange(event.target.valueAsNumber);
  }} onBlur={() => setInvalid(input.current ? !input.current.validity.valid : false)} />{unit && <span id={`${id}-unit`}>{unit}</span>}</div>{invalid && <p id={`${id}-error`} className="analysis-input-error">{formatNumber(min)}{max === undefined ? " 이상" : `–${formatNumber(max)}`}의 {integer ? "정수" : "숫자"}를 입력하세요.</p>}{help && <p id={`${id}-help`}>{help}</p>}</div>;
}
/** Invalid visible drafts must never trigger a run with the last saved value. */
export function runAfterValidation(event: MouseEvent<HTMLElement>, onRun: () => void) {
  const inputs = event.currentTarget.closest(".analysis-page")?.querySelectorAll<HTMLInputElement>("input:not(:disabled), select:not(:disabled)");
  for (const input of inputs ?? []) if (!input.checkValidity()) {
    let parent = input.parentElement;
    while (parent && !parent.classList.contains("analysis-page")) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    input.reportValidity(); return;
  }
  onRun();
}
export interface ChartSeries { name: string; color: string; values: (number | null)[] }
/** Accessible SVG with an equivalent native table; no decorative or simulated values. */
export function LineChart({ title, labels, series, unit, xLabel, baseIndex, xValues }: { title: string; labels: string[]; series: ChartSeries[]; unit: string; xLabel?: string; baseIndex?: number; xValues?: number[] }) {
  const id = useId();
  const present = series.flatMap(item => item.values).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!present.length) return <p className="analysis-note">표시할 계산 결과가 없습니다.</p>;
  const min = Math.min(0, ...present), max = Math.max(1, ...present), span = max - min || 1;
  if (xValues && (xValues.length !== labels.length || xValues.some(value => !Number.isFinite(value))))
    return <p className="analysis-note">가로축 수치가 없어 그래프를 표시할 수 없습니다.</p>;
  const xMinimum = xValues ? Math.min(...xValues) : 0, xMaximum = xValues ? Math.max(...xValues) : labels.length - 1;
  const x = (index: number) => 58 + ((xValues?.[index] ?? index) - xMinimum) / (xMaximum - xMinimum || 1) * 692;
  const y = (value: number) => 225 - (value - min) / span * 175;
  const points = (values: (number | null)[]) => values.map((value, index) => value === null ? "" : `${index === 0 || values[index - 1] === null ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
  const labelCandidates = labels.map((_, index) => index).filter(index => xValues || labels.length <= 9 || index % Math.ceil(labels.length / 8) === 0 || index === labels.length - 1);
  const tickIndices = new Set<number>(labels.length ? [0, labels.length - 1] : []);
  const priorities = [...(baseIndex !== undefined && baseIndex >= 0 ? [baseIndex] : []), ...labelCandidates];
  for (const index of priorities) if ([...tickIndices].every(selected => Math.abs(x(index) - x(selected)) >= (labels[index].length + labels[selected].length) * 3.4 + 14)) tickIndices.add(index);
  return <figure className="analysis-chart" aria-labelledby={id}><figcaption id={id}><strong>{title}</strong><span>{unit}</span></figcaption>
    <svg viewBox="0 0 790 270" role="img" aria-label={`${title}. ${series.map(item => item.name).join(", ")}. 아래 수치 표에서 전체 값을 확인할 수 있습니다.`}>
      {[0, 1, 2, 3].map(index => { const value = min + span * index / 3; return <g key={index}><line x1="58" x2="750" y1={y(value)} y2={y(value)} stroke="#e4eae6" /><text x="46" y={y(value) + 4} textAnchor="end" fill="#667b74" fontSize="12">{formatNumber(value, max > 1000 ? 0 : 1)}</text></g>; })}
      {baseIndex !== undefined && baseIndex >= 0 && <g><line x1={x(baseIndex)} x2={x(baseIndex)} y1="38" y2="225" stroke="#a0aaa4" strokeDasharray="4 4" /><text x={x(baseIndex)} y="28" textAnchor="middle" fontSize="11" fill="#667b74">기준값</text></g>}
      {series.map(item => <g key={item.name}><path d={points(item.values)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />{labels.length <= 8 && item.values.map((value, index) => value !== null && <circle key={index} cx={x(index)} cy={y(value)} r="4" fill="white" stroke={item.color} strokeWidth="2"><title>{labels[index]}: {formatNumber(value)} {unit}</title></circle>)}</g>)}
      {labels.map((label, index) => tickIndices.has(index) && <text key={index} x={x(index)} y="247" textAnchor="middle" fill="#667b74" fontSize="12">{label}</text>)}
    </svg>
    <div className="analysis-chart-legend">{series.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}{xLabel && <span className="analysis-chart-axis">{xLabel}</span>}</div>
    <details className="analysis-chart-data"><summary>수치 표 보기</summary><div className="analysis-table-scroll"><table className="analysis-table"><thead><tr><th scope="col">{xLabel ?? "시간"}</th>{series.map(item => <th key={item.name} scope="col">{item.name} ({unit})</th>)}</tr></thead><tbody>{labels.map((label, index) => <tr key={index}><th scope="row">{label}</th>{series.map(item => <td key={item.name}>{formatNumber(item.values[index])}</td>)}</tr>)}</tbody></table></div></details>
  </figure>;
}
