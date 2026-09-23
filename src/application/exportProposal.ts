import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { publicAsset } from "../assets";
import type { MarketProfile, StoreLayout } from "../core";
import type { FinancialAnalysisResult } from "../modules/financial";
import type { ScenarioEvaluation, SensitivityResult } from "../modules/scenario";
import type { ScenarioComparison } from "./scenarioAnalysis";
import { isValidCandidateArea, type CandidateDetails } from "./workflow";

export interface ProposalWorkbookInput {
  candidate: CandidateDetails;
  layout: StoreLayout;
  market: MarketProfile;
  operation: Extract<ScenarioEvaluation<FinancialAnalysisResult>, { ok: true }>;
  financial: FinancialAnalysisResult;
  comparison: ScenarioComparison<FinancialAnalysisResult>;
  sensitivity: SensitivityResult<FinancialAnalysisResult> | null;
  exportedAt?: string;
}

type CellValue = string | number | null;
type Cells = Record<string, CellValue>;
const SHEETS = ["출점 제안서", "조건별 비교", "가정과 출처"];
const DAY = { weekday: "평일", weekend: "주말", holiday: "공휴일" };
const RESOURCE: Record<string, string> = { tables: "테이블", seats: "좌석", kitchen: "주방", cooks: "조리 인력", servers: "홀 인력", cashiers: "결제 인력" };
const number = (value: number, digits = 1) => value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function proposalCells(input: ProposalWorkbookInput, exportedAt: string): Cells[] {
  const { candidate, layout, operation: evaluation, financial: f, comparison, sensitivity } = input;
  if (!evaluation.ok || !comparison.ok || comparison.rows.length !== 4 || comparison.rows.some(row => !row.evaluation.ok))
    throw new Error("완료된 가상영업과 네 가지 시나리오 결과가 필요합니다.");
  if (!candidate.projectName.trim() || !candidate.brandName.trim() || !candidate.address.trim())
    throw new Error("제안서에 사용할 점포명·브랜드·주소를 확인해 주세요.");
  if (!isValidCandidateArea(candidate.knownAreaM2)) throw new Error("후보지 면적은 0.1 m² 이상으로 입력하거나 비워 주세요.");
  if (f.currency !== "KRW") throw new Error("현재 제안서 서식은 원화(KRW) 결과를 지원합니다.");
  const config = evaluation.resolved.configuration.simulation!;
  const parameters = evaluation.resolved.configuration.demandParameters!;
  const assumption = f.input.assumption;
  const metrics = evaluation.aggregate.metrics;
  const source = evaluation.resolved.configuration.market ?? input.market;
  const rates = evaluation.aggregate.channelMetrics;
  const blockers = evaluation.aggregate.bottlenecks.filter(item => item.replicationCount > 0).slice(0, 3)
    .map(item => `${RESOURCE[item.resource] ?? item.resource} (${item.replicationCount}/${evaluation.replication.count}회)`);
  const dayBasis = f.conditions.dayEstimates.map(day => `${DAY[day.dayType]} ${clock(day.startMinute)}부터 ${number(day.durationMinutes, 0)}분 관측 완료량 × ${number(day.runToDayMultiplier, 2)}배, 월 ${number(day.daysPerMonth)}일`);
  const issue: string[] = [];
  issue.push(f.monthlyOperatingProfit < 0 ? `월 영업손실 ${number(Math.abs(f.monthlyOperatingProfit), 0)}원. 객단가·완료량·비용을 함께 검토해야 합니다.` : `현재 가정의 월 영업이익 ${number(f.monthlyOperatingProfit, 0)}원.`);
  if (blockers.length) issue.push(`자원 대기가 기록된 곳: ${blockers.join(", ")}. 증설 효과는 별도 비교가 필요합니다.`);
  if (metrics.customersLost.mean > 0 || metrics.customersUnfinished.mean > 0)
    issue.push(`홀 평균 이탈 ${number(metrics.customersLost.mean)}명, 종료 시 미완료 ${number(metrics.customersUnfinished.mean)}명. 완료량만 매출에 반영했습니다.`);
  const overview: Cells = {
    B7: candidate.projectName, B9: candidate.address, B12: candidate.knownAreaM2, F12: layout.totalAreaM2,
    B14: `입력 면적은 사용자 제공 값, 도면 면적은 연결된 형상 기준입니다. 모델 운영 정원 ${layout.confirmedCapacity ?? "미확정"}석 / ${layout.tableCount}개 테이블.`,
    F18: f.monthlyDineInRevenue, F19: f.monthlyDeliveryRevenue, F20: f.monthlyRevenue,
    F21: -f.variableCost, F22: -f.laborCost, F23: -(f.rent + f.otherFixedCosts), F24: f.monthlyOperatingProfit,
    F25: f.operatingMargin, F28: metrics.customersServed.mean, F29: metrics.averageWaitingSeconds.mean / 60,
    F30: rates["delivery.ordersCompleted"]?.mean ?? "미적용", F31: metrics.kitchenUtilization.mean,
    F32: f.breakEvenRevenue, F33: f.initialInvestment, F34: f.refundableDeposit, F35: f.nonRefundableInvestment, F36: f.estimatedPaybackMonths,
    B39: issue.join("\n"),
    B43: `${evaluation.replication.count}회 반복실험 평균. ${dayBasis.join(" / ")}.\n보증금은 회수기간에서 제외합니다. ${f.nullReasons.estimatedPaybackMonths ? "회수기간 계산 불가: " + f.nullReasons.estimatedPaybackMonths : "회수기간은 현재 월 영업이익이 유지된다는 가정입니다."}`,
    B47: `${source.provenance.kind === "demo" ? "DEMO 상권 기반. " : ""}저장 시점의 결과이며 출점 권고나 매출 보장이 아닙니다. 가정 변경·재계산은 웹 앱에서 진행하세요.`,
  };
  const compare: Cells = { B7: `${candidate.projectName} · ${DAY[config.dayType]} ${clock(config.startMinute)}부터 ${number(config.durationSeconds / 3600, 2)}시간 · ${evaluation.replication.count}회 반복` };
  const kinds = ["Conservative", "Baseline", "Optimistic", "Custom"];
  for (const [index, kind] of kinds.entries()) {
    const evaluation = comparison.rows.find(row => row.kind === kind)?.evaluation;
    if (!evaluation?.ok || !evaluation.financial) throw new Error("시나리오별 재무 결과가 완성되지 않았습니다.");
    const col = ["D", "F", "H", "J"][index], cfg = evaluation.resolved.configuration;
    const m = evaluation.aggregate.metrics, finance = evaluation.financial;
    const values: CellValue[] = [cfg.demandParameters!.visitConversionRate, finance.conditions.averageSpendingPerCustomer,
      cfg.operation!.resources.cooks, cfg.operation!.resources.kitchenConcurrentOrders,
      m.customersArrived.mean, m.customersServed.mean, m.averageWaitingSeconds.mean / 60,
      evaluation.aggregate.channelMetrics["delivery.ordersCompleted"]?.mean ?? "미적용",
      m.kitchenUtilization.mean, finance.monthlyRevenue, finance.monthlyOperatingProfit, finance.operatingMargin];
    values.forEach((value, row) => { compare[`${col}${row + 10}`] = value; });
  }
  if (sensitivity && sensitivity.results.length > 5) throw new Error("제안서는 현재 화면의 최대 5개 민감도 조건을 지원합니다.");
  for (let index = 0; index < 5; index++) {
    const point = sensitivity?.results[index];
    const evaluation = point?.evaluation, row = index + 28;
    compare[`B${row}`] = point?.parameterValue ?? "";
    compare[`D${row}`] = evaluation?.ok ? evaluation.aggregate.metrics.customersServed.mean : point ? "계산 실패" : "";
    compare[`F${row}`] = evaluation?.ok ? evaluation.aggregate.metrics.averageWaitingSeconds.mean / 60 : point ? "계산 실패" : "";
    compare[`H${row}`] = evaluation?.ok ? evaluation.financial?.monthlyRevenue ?? null : point ? "계산 실패" : "";
    compare[`J${row}`] = evaluation?.ok ? evaluation.financial?.monthlyOperatingProfit ?? null : point ? "계산 실패" : "";
  }
  compare.B26 = sensitivity ? `민감도 · ${sensitivity.parameter.label}` : "민감도 · 미실행";
  const sensitivityUnit = sensitivity ? ({ ratio: "%", seats: "석", orders: "건", "KRW/customer": "원/명" }[sensitivity.parameter.unit] ?? sensitivity.parameter.unit) : "";
  compare.B27 = sensitivity ? `${sensitivity.parameter.label} (${sensitivityUnit})` : "시험한 조건";
  compare.B34 = sensitivity ? `기준값 ${number(sensitivity.baseValue * (sensitivity.parameter.unit === "ratio" ? 100 : 1), 4)} ${sensitivityUnit}. ${sensitivity.parameter.description}.\n${sensitivity.parameter.path.startsWith("layout.") ? "좌석 변경은 운영 정원만 바꾼 가정이며 실제 배치 가능성을 검증하지 않았습니다." : "다른 조건을 유지하고 선택한 가정만 바꾸어 실제로 실행했습니다."}` : "민감도 분석은 실행하지 않았습니다. 웹 앱에서 계산한 뒤 제안서를 다시 저장할 수 있습니다.";
  const reference: Cells = {
    F8: candidate.brandName, F9: exportedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC"),
    F10: `${DAY[config.dayType]} ${clock(config.startMinute)} / ${number(config.durationSeconds / 3600, 2)}시간`, F11: evaluation.replication.count,
    F12: `${layout.tableCount}개 / ${layout.confirmedCapacity ?? "미확정"}석`, F13: parameters.categoryParticipationRate,
    F14: parameters.brandShare, F15: parameters.visitConversionRate, F16: f.conditions.averageSpendingPerCustomer,
    F17: f.conditions.averageDeliveryOrderValue, F18: f.conditions.operatingDaysPerMonth,
    F19: assumption.foodCostRatio, F20: assumption.paymentFeeRatio ?? 0, F21: assumption.deliveryFeeRatio, F22: assumption.royaltyRatio,
    F23: assumption.deliveryVariableCostPerOrder ?? 0, F24: f.conditions.laborBasis === "operation-linked" ? "인력 수 × 1인당 월 비용" : "월 총액 입력",
    F25: f.rent, F26: f.otherFixedCosts, B29: dayBasis.join("\n"),
    B33: `연결 도면 ${layout.source.documentId} (문서 버전 ${layout.source.documentVersion}, 수정 ${layout.source.documentRevision}). 입력 면적 ${candidate.knownAreaM2 === null ? "미제공" : number(candidate.knownAreaM2, 2) + " m²"}, 형상 면적 ${number(layout.totalAreaM2, 1)} m². 기본 공개 예시 도면은 후보지 실측 도면이 아닙니다. 도면을 입력 면적에 맞춰 자동 축척하지 않았습니다.`,
    B38: `${source.provenance.kind === "demo" ? "DEMO 예시 자료 · 실제 주소의 관측값 아님" : source.provenance.kind}\n공급자 ${source.provider.id} ${source.provider.version}, 출처 ${source.provenance.source}\n기간 ${source.period.from.slice(0, 10)} ~ ${source.period.to.slice(0, 10)}`,
    B42: "상권 유동인구에 업종·점포선택·방문 전환 가정을 적용했습니다. 홀 고객과 배달 주문은 별도 단위이며 같은 주방을 사용합니다. 세금·이자·감가상각·운전자금 변화는 제외합니다. 관측 처리량은 최대 물리적 처리 용량이 아닙니다.",
    B46: `프로젝트 ${evaluation.resolved.projectRef.id} 수정 ${evaluation.resolved.projectRef.revision}\n운영 실행 ${evaluation.runs.map(run => run.id).join(", ")}\n난수 재현 번호 ${evaluation.replication.seeds.join(", ")}`,
    B51: candidate.notes || "담당자 메모 없음",
  };
  return [overview, compare, reference];
}

/** Template cell styles, embedded logo and conditional formatting remain intact. */
function fillSheet(source: string, cells: Cells): string {
  for (const [address, value] of Object.entries(cells)) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${address}: 유한한 숫자만 제안서에 저장할 수 있습니다.`);
    const pattern = new RegExp(`<x:c\\b([^>]*\\br="${address}"[^>]*)(?:\\s*/>|>[\\s\\S]*?</x:c>)`);
    if (!pattern.test(source)) throw new Error(`제안서 서식의 ${address} 셀을 찾지 못했습니다.`);
    source = source.replace(pattern, (_whole, attributes: string) => {
      const style = /\bs="(\d+)"/.exec(attributes)?.[1];
      const opening = `<x:c r="${address}"${style ? ` s="${style}"` : ""}`;
      // Inline strings cannot become formulas, links or external references, even when text begins with '='.
      return typeof value === "number" ? `${opening}><x:v>${value}</x:v></x:c>`
        : `${opening} t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value === null ? "계산 불가" : value)}</x:t></x:is></x:c>`;
    });
  }
  return source;
}

function printLayout(source: string, landscape: boolean, fitHeight = 1): string {
  source = source.replace(/<x:(?:pageMargins|pageSetup|printOptions)\b[^>]*\/>/g, "");
  if (!source.includes("<x:pageSetUpPr")) source = source.replace("</x:sheetPr>", '<x:pageSetUpPr fitToPage="1"/></x:sheetPr>');
  const settings = `<x:printOptions horizontalCentered="1"/><x:pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><x:pageSetup paperSize="9" orientation="${landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="${fitHeight}"/>`;
  return source.includes("<x:drawing") ? source.replace("<x:drawing", `${settings}<x:drawing`) : source.replace("</x:worksheet>", `${settings}</x:worksheet>`);
}

function fitTextBlock(source: string, text: CellValue, startRow: number, endRow: number, fontSize: number, width = 102): string {
  if (typeof text !== "string" || !text) return source;
  const lineWidth = width * 10.5 / fontSize;
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1), 0) / lineWidth)), 0);
  const height = Math.ceil((lines * fontSize * 1.4 + 4) / (endRow - startRow + 1));
  for (let row = startRow; row <= endRow; row++) source = source.replace(new RegExp(`(<x:row r="${row}"[^>]*ht=")([^"]*)`), (_whole, prefix: string, old: string) => `${prefix}${Math.min(409, Math.max(Number(old), height))}`);
  return source;
}

function formatSensitivity(archive: Record<string, Uint8Array>, ratio: boolean): void {
  const path = "xl/worksheets/sheet2.xml";
  let sheet = strFromU8(archive[path]), styles = strFromU8(archive["xl/styles.xml"]);
  const formatBlock = /<x:cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/x:cellXfs>/.exec(styles);
  const formats = formatBlock?.[2].match(/<x:xf\b[^>]*\/>|<x:xf\b[^>]*>[\s\S]*?<\/x:xf>/g);
  if (!formats || formats.length !== Number(formatBlock?.[1])) throw new Error("제안서의 숫자 표시 서식을 읽을 수 없습니다.");
  const formatId = Math.max(163, ...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  styles = styles.replace(/<x:numFmts count="(\d+)">([\s\S]*?)<\/x:numFmts>/, (_whole, count: string, contents: string) => `<x:numFmts count="${Number(count) + 1}">${contents}<x:numFmt numFmtId="${formatId}" formatCode="${ratio ? "0.00%" : "#,##0.##"}"/></x:numFmts>`);
  const added = new Map<string, number>();
  for (let row = 28; row <= 32; row++) sheet = sheet.replace(new RegExp(`(<x:c r="B${row}" s=")(\\d+)`), (_whole, prefix: string, old: string) => {
    if (!added.has(old)) {
      const original = formats[Number(old)];
      if (!original) throw new Error("제안서의 민감도 서식이 올바르지 않습니다.");
      added.set(old, formats.length);
      formats.push(original.replace(/numFmtId="\d+"/, `numFmtId="${formatId}"`));
    }
    return `${prefix}${added.get(old)}`;
  });
  styles = styles.replace(/<x:cellXfs\b[^>]*>[\s\S]*?<\/x:cellXfs>/, `<x:cellXfs count="${formats.length}">${formats.join("")}</x:cellXfs>`);
  archive[path] = strToU8(sheet); archive["xl/styles.xml"] = strToU8(styles);
}

/** Builds a three-sheet, read-only analysis snapshot. Excel does not rerun DES. */
export async function buildProposalWorkbook(input: ProposalWorkbookInput, templateBytes?: Uint8Array): Promise<Uint8Array> {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("제안서 저장 일시가 올바르지 않습니다.");
  const cells = proposalCells(input, exportedAt);
  if (!templateBytes) {
    const response = await fetch(publicAsset("proposal-template.xlsx"));
    if (!response.ok) throw new Error("엑셀 제안서 서식을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    templateBytes = new Uint8Array(await response.arrayBuffer());
  }
  const archive = unzipSync(templateBytes);
  cells.forEach((sheet, index) => {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    if (!archive[path]) throw new Error("엑셀 제안서 서식이 올바르지 않습니다.");
    let content = fillSheet(strFromU8(archive[path]), sheet);
    // Excel does not auto-fit merged cells; size user text and provenance blocks explicitly.
    const blocks = index === 0 ? [["B7", 7, 8, 17], ["B9", 9, 10, 10.5], ["B14", 14, 15, 9], ["B39", 39, 41, 10.5], ["B43", 43, 45, 9], ["B47", 47, 48, 9]]
      : index === 1 ? [["B7", 7, 8, 11], ["B34", 34, 36, 9.5]]
      : [["F8", 8, 8, 10.5], ["B29", 29, 31, 9.5], ["B33", 33, 35, 9.5], ["B38", 38, 40, 9.5], ["B42", 42, 44, 9.5], ["B46", 46, 49, 9], ["B51", 51, 54, 9.5]];
    for (const [address, start, end, font] of blocks) content = fitTextBlock(content, sheet[address as string], start as number, end as number, font as number, address === "F8" ? 48 : index === 1 ? 124 : 102);
    archive[path] = strToU8(printLayout(content, index === 1, index === 2 && input.candidate.notes.length > 500 ? 0 : 1));
  });
  formatSensitivity(archive, input.sensitivity?.parameter.unit === "ratio");
  let book = strFromU8(archive["xl/workbook.xml"]);
  const areas = ["$B$2:$I$49", "$B$2:$K$41", "$B$2:$I$55"];
  const names = SHEETS.map((name, index) => `<x:definedName name="_xlnm.Print_Area" localSheetId="${index}">'${xml(name)}'!${areas[index]}</x:definedName>`).join("");
  book = book.replace(/<x:definedNames>[\s\S]*?<\/x:definedNames>|<x:calcPr\b[^>]*\/>/g, "");
  book = book.replace("</x:workbook>", `<x:definedNames>${names}</x:definedNames><x:calcPr calcMode="auto" fullCalcOnLoad="1"/></x:workbook>`);
  archive["xl/workbook.xml"] = strToU8(book);
  return zipSync(archive, { level: 6 });
}

export async function exportProposalWorkbook(input: ProposalWorkbookInput): Promise<void> {
  const bytes = await buildProposalWorkbook(input);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  const name = input.candidate.projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "후보점";
  anchor.href = url; anchor.download = `${name}_출점검토_제안서.xlsx`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
