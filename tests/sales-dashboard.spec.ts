import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

const output = path.resolve("tmp/e2e/sales");
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });
async function ready(page: Page) {
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 });
  await expect(page.getByRole("navigation", { name: "출점 검토 단계" }).getByRole("button", { name: /준비됨$/ })).toHaveCount(8);
}
async function step(page: Page, number: string) {
  await page.getByRole("navigation", { name: "출점 검토 단계" }).getByRole("button", { name: new RegExp(`^${number} `) }).click();
}
async function cell(page: Page, xml: string, address: string) {
  return page.evaluate(({ xml, address }) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XLSX worksheet XML");
    const entry = Array.from(doc.getElementsByTagNameNS("*", "c")).find(item => item.getAttribute("r") === address);
    if (!entry) throw new Error(`Missing ${address}`);
    return entry.textContent;
  }, { xml, address });
}

test("sales dashboard refreshes finance and scenarios in place and exports the edited Excel proposal", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => {
          if (event.data?.ok && ["sample", "refresh"].includes(event.data.result?.kind)) {
            const result = event.data.result;
            (window as any).__salesAnalysis = {
              revenue: result.financial.monthlyRevenue, profit: result.financial.monthlyOperatingProfit,
              runs: result.evaluation.runs.map((run: { id: string }) => run.id),
              customRevenue: result.comparison.rows.find((row: { kind: string }) => row.kind === "Custom").evaluation.financial.monthlyRevenue,
            };
          }
        });
      }
    };
  });
  await page.goto("/#financial");
  await ready(page);
  await expect(page.getByRole("heading", { name: "수익성 분석", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "출점 검토 단계" });
  await expect(navigation.getByRole("button").nth(5)).toHaveAccessibleName("06 수익성 분석, 준비됨");
  await expect(navigation.getByRole("button").nth(6)).toHaveAccessibleName("07 시나리오 비교, 준비됨");
  expect(await page.getByRole("img", { name: "백초밥", exact: true }).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 753)).toBe(true);
  for (const selector of [".analysis-primary-fields", ".analysis-finance-summary", ".analysis-cost-rows"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.y + box!.height, selector).toBeLessThanOrEqual(900);
  }
  await page.screenshot({ path: path.join(output, "financial-desktop.png"), fullPage: true });
  const initial = await page.evaluate(() => (window as any).__salesAnalysis);
  await page.getByRole("spinbutton", { name: "월 임차료", exact: true }).fill("3500000");
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "edited");
  await ready(page);
  const rent = await page.evaluate(() => (window as any).__salesAnalysis);
  expect(rent.runs).toEqual(initial.runs);
  expect(rent.revenue).toBe(initial.revenue);
  expect(rent.profit).toBeCloseTo(initial.profit - 500000);
  await expect(page).toHaveURL(/#financial$/);
  await page.getByRole("spinbutton", { name: "월 임차료", exact: true }).fill("100000000");
  await ready(page);
  await expect(page.locator(".analysis-kpi-negative")).toBeVisible();
  const lossColor = await page.locator(".analysis-kpi-negative strong").evaluate(el => getComputedStyle(el).color);
  const [red, green, blue] = lossColor.match(/\d+/g)!.map(Number);
  expect(red).toBeGreaterThan(green * 1.3);
  expect(red).toBeGreaterThan(blue * 1.3);
  await page.screenshot({ path: path.join(output, "financial-loss-desktop.png"), fullPage: true });
  await page.getByRole("spinbutton", { name: "월 임차료", exact: true }).fill("3500000");
  await ready(page);
  await step(page, "07");
  const control = await page.getByRole("spinbutton", { name: "객단가 변화", exact: true }).boundingBox();
  const table = await page.locator(".analysis-comparison").boundingBox();
  expect(control!.y + control!.height).toBeLessThan(table!.y);
  const beforeCustom = await page.evaluate(() => (window as any).__salesAnalysis);
  await page.getByRole("spinbutton", { name: "객단가 변화", exact: true }).fill("20");
  await ready(page);
  const latest = await page.evaluate(() => (window as any).__salesAnalysis);
  expect(latest.customRevenue).toBeGreaterThan(beforeCustom.customRevenue);
  expect(latest.runs).toEqual(initial.runs);
  await expect(page).toHaveURL(/#scenario$/);
  await page.screenshot({ path: path.join(output, "scenario-desktop.png"), fullPage: true });
  await step(page, "08");
  await page.screenshot({ path: path.join(output, "review-desktop.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "엑셀 제안서 다운로드" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("백초밥 명지점_출점검토_제안서.xlsx");
  const file = path.join(output, download.suggestedFilename());
  await download.saveAs(file);
  const archive = unzipSync(new Uint8Array(await readFile(file)));
  const book = strFromU8(archive["xl/workbook.xml"]);
  for (const title of ["출점 제안서", "조건별 비교", "가정과 출처"]) expect(book).toContain(title);
  const summary = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const comparison = strFromU8(archive["xl/worksheets/sheet2.xml"]);
  const assumptions = strFromU8(archive["xl/worksheets/sheet3.xml"]);
  expect(await cell(page, summary, "B7")).toBe("백초밥 명지점");
  expect(Number(await cell(page, summary, "B12"))).toBe(94.44);
  expect(Number(await cell(page, summary, "F20"))).toBeCloseTo(latest.revenue);
  expect(Number(await cell(page, summary, "F24"))).toBeCloseTo(latest.profit);
  expect(Number(await cell(page, comparison, "J19"))).toBeCloseTo(latest.customRevenue);
  expect(Number(await cell(page, assumptions, "F25"))).toBe(3500000);
  expect(assumptions).toContain("DEMO");
  expect(Object.keys(archive).some(name => name.startsWith("xl/media/"))).toBe(true);
  expect(summary).toContain("fitToWidth=\"1\"");
  expect(errors).toEqual([]);
});

test("brand dashboards remain readable on mobile with advanced inputs available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#financial");
  await ready(page);
  await page.getByText("고급 비용 설정 · 수수료와 인건비", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "결제 수수료율", exact: true })).toBeVisible();
  await page.getByText("고급 비용 설정 · 수수료와 인건비", { exact: true }).click();
  for (const [number, name] of [["06", "financial"], ["07", "scenario"], ["08", "review"]]) {
    await step(page, number);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
  }
  await step(page, "01");
  await page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" }).fill("0");
  await expect(page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" })).toHaveValue("0");
  await step(page, "08");
  await expect(page.getByRole("button", { name: "엑셀 제안서 다운로드" })).toBeDisabled();
  await step(page, "01");
  await page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" }).fill("94.44");
  await ready(page);
  await step(page, "08");
  await expect(page.getByRole("button", { name: "엑셀 제안서 다운로드" })).toBeEnabled();
});
