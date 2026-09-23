import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildProposalWorkbook, type ProposalWorkbookInput } from "./exportProposal";
import { createTesterSampleInput } from "./testerSample";
import { executeWorkflowAnalysis } from "./workflowAnalysis";

const template = new Uint8Array(readFileSync("public/proposal-template.xlsx"));
let input: ProposalWorkbookInput;
const cell = (sheet: string, address: string) => {
  const body = new RegExp(`<x:c\\b[^>]*r="${address}"[^>]*>([\\s\\S]*?)</x:c>`).exec(sheet)?.[1];
  if (!body) throw new Error(`Missing cell ${address}`);
  const numeric = /<x:v>([^<]+)<\/x:v>/.exec(body);
  return numeric ? Number(numeric[1]) : /<x:t[^>]*>([\s\S]*?)<\/x:t>/.exec(body)?.[1];
};

beforeAll(async () => {
  const sample = createTesterSampleInput("2026-09-24T00:00:00.000Z");
  const result = await executeWorkflowAnalysis({ kind: "sample", input: sample });
  if (result.kind !== "sample" || !result.evaluation.ok) throw new Error("Sample analysis failed");
  input = { candidate: sample.candidate, layout: result.evaluation.resolved.layout!, market: result.prepared.market,
    operation: result.evaluation, financial: result.financial, comparison: result.comparison, sensitivity: result.sensitivity,
    exportedAt: sample.now };
}, 15000);

describe("proposal workbook snapshot", () => {
  it("exports actual engine values and reconciled financials without mutating the analysis", async () => {
    const original = JSON.stringify(input);
    const archive = unzipSync(await buildProposalWorkbook(input, template));
    const summary = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const comparison = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const reference = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(cell(summary, "B7")).toBe(input.candidate.projectName);
    expect(cell(summary, "B9")).toBe(input.candidate.address);
    expect(cell(summary, "B12")).toBe(94.44);
    expect(cell(summary, "F12")).toBe(input.layout.totalAreaM2);
    expect(cell(summary, "F20")).toBe(input.financial.monthlyRevenue);
    expect(cell(summary, "F24")).toBe(input.financial.monthlyOperatingProfit);
    expect(Number(cell(summary, "F18")) + Number(cell(summary, "F19"))).toBeCloseTo(Number(cell(summary, "F20")), 6);
    expect([20, 21, 22, 23].reduce((sum, row) => sum + Number(cell(summary, `F${row}`)), 0)).toBeCloseTo(Number(cell(summary, "F24")), 6);
    expect(cell(summary, "F29")).toBe(input.operation.aggregate.metrics.averageWaitingSeconds.mean / 60);
    expect(cell(summary, "F30")).toBe(input.operation.aggregate.channelMetrics["delivery.ordersCompleted"].mean);
    for (const [index, kind] of ["Conservative", "Baseline", "Optimistic", "Custom"].entries()) {
      const evaluation = input.comparison.rows.find(row => row.kind === kind)!.evaluation;
      if (!evaluation.ok) throw new Error("Failed scenario");
      expect(cell(comparison, `${["D", "F", "H", "J"][index]}20`)).toBe(evaluation.financial!.monthlyOperatingProfit);
    }
    expect(cell(reference, "F25")).toBe(input.financial.rent);
    expect(cell(reference, "B46")).toContain(input.operation.runs[0].id);
    expect(cell(reference, "B46")).toContain(input.operation.replication.seeds.join(", "));
    expect(JSON.stringify(input)).toBe(original);
  });

  it("preserves the exact logo, three named sheets and readable print settings", async () => {
    const archive = unzipSync(await buildProposalWorkbook(input, template));
    const logo = new Uint8Array(readFileSync("public/baek-sushi-logo.jpg"));
    const images = Object.keys(archive).filter(name => /^xl\/media\//.test(name));
    expect(images).toHaveLength(3);
    for (const name of images) expect(archive[name]).toEqual(logo);
    const book = strFromU8(archive["xl/workbook.xml"]);
    expect(book.match(/<x:sheet /g)).toHaveLength(3);
    expect(book).toContain('name="출점 제안서"');
    expect(book).toContain('name="조건별 비교"');
    expect(book).toContain('name="가정과 출처"');
    expect(book.match(/<x:definedNames>/g)).toHaveLength(1);
    expect(book.match(/<x:calcPr /g)).toHaveLength(1);
    expect(book.match(/name="_xlnm.Print_Area"/g)).toHaveLength(3);
    const comparison = strFromU8(archive["xl/worksheets/sheet2.xml"]), styles = strFromU8(archive["xl/styles.xml"]);
    const formatBlock = /<x:cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/x:cellXfs>/.exec(styles)!;
    const formats = formatBlock[2].match(/<x:xf\b[^>]*\/>|<x:xf\b[^>]*>[\s\S]*?<\/x:xf>/g)!;
    expect(formats).toHaveLength(Number(formatBlock[1]));
    expect(formats).toHaveLength(formatBlock[2].match(/<x:xf\b/g)!.length);
    for (const address of ["B28", "B29"]) {
      const styleId = Number(new RegExp(`<x:c r="${address}" s="(\\d+)"`).exec(comparison)![1]);
      const formatId = /numFmtId="(\d+)"/.exec(formats[styleId])![1];
      expect(styles).toContain(`numFmtId="${formatId}" formatCode="0.00%"`);
    }
    expect(cell(comparison, "B28")).toBe(input.sensitivity!.results[0].parameterValue);
    expect(cell(comparison, "B27")).toBe("방문 전환율 (%)");
    for (let i = 1; i <= 3; i++) {
      const sheet = strFromU8(archive[`xl/worksheets/sheet${i}.xml`]);
      expect(sheet).toContain('fitToWidth="1" fitToHeight="1"');
      expect(sheet).toContain(`orientation="${i === 2 ? "landscape" : "portrait"}"`);
      expect(sheet).toContain('<x:drawing');
      expect(sheet).not.toMatch(/NaN|Infinity|<x:f[ >]/);
    }
  });

  it("keeps untrusted text as escaped text and expands long merged blocks", async () => {
    const changed = structuredClone(input);
    changed.candidate.projectName = '=HYPERLINK("https://example.invalid","<>&")' + "점포".repeat(40);
    changed.candidate.address = "매우 긴 주소 ".repeat(30);
    changed.candidate.notes = "검토 메모 <>&\n".repeat(100);
    changed.financial.estimatedPaybackMonths = null;
    const archive = unzipSync(await buildProposalWorkbook(changed, template));
    const summary = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const reference = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    expect(cell(summary, "B7")).toContain('=HYPERLINK(&quot;https://example.invalid&quot;,&quot;&lt;&gt;&amp;&quot;)');
    expect(summary).not.toMatch(/<x:f[ >]/);
    expect(Object.keys(archive).some(name => name.includes("externalLink"))).toBe(false);
    expect(cell(summary, "F36")).toBe("계산 불가");
    expect(Number(/<x:row r="7"[^>]*ht="([^"]+)"/.exec(summary)?.[1])).toBeGreaterThan(23);
    expect(Number(/<x:row r="51"[^>]*ht="([^"]+)"/.exec(reference)?.[1])).toBeGreaterThan(100);
    expect(reference).toContain('fitToHeight="0"');
  });

  it("refuses incomplete results and non-finite amounts", async () => {
    await expect(buildProposalWorkbook({ ...input, comparison: { ...input.comparison, ok: false } }, template)).rejects.toThrow("완료된");
    await expect(buildProposalWorkbook({ ...input, financial: { ...input.financial, monthlyRevenue: Number.NaN } }, template)).rejects.toThrow("유한한 숫자");
    await expect(buildProposalWorkbook({ ...input, candidate: { ...input.candidate, knownAreaM2: 0 } }, template)).rejects.toThrow("면적");
    await expect(buildProposalWorkbook({ ...input, candidate: { ...input.candidate, knownAreaM2: Number.NaN } }, template)).rejects.toThrow("면적");
  });
});
