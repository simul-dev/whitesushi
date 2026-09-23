import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const output = path.resolve("tmp/e2e/tester-sample");
const address = "부산광역시 강서구 명지국제2로 80 비주거시설동 1층 1-86, 1-87호";
const steps = ["01 후보지", "02 공간설계", "03 상권분석", "04 수요가정", "05 가상영업", "06 수익성 분석", "07 시나리오 비교", "08 출점검토"];
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

async function step(page: Page, name: string) {
  await page.getByRole("navigation", { name: "출점 검토 단계" }).getByRole("button", { name: new RegExp(name) }).click();
}

async function auditComputedResults(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => {
          const result = event.data?.result;
          if (!event.data?.ok || !["sample", "refresh"].includes(result?.kind) || !result.evaluation?.ok) return;
          (window as Window & { __workflowAudit?: unknown }).__workflowAudit = {
            candidate: result.prepared.candidate, layout: result.evaluation.resolved.layout, market: result.prepared.market,
            operation: result.evaluation.aggregate,
            financial: { ...result.financial, input: { runIds: result.financial.input.simulationRuns.map((run: { id: string }) => run.id) } },
            scenarios: result.comparison.rows.map((row: { evaluation: { aggregate: unknown } }) => ({ aggregate: row.evaluation.aggregate })),
            sensitivity: { points: result.sensitivity.results.map((point: { parameterValue: number }) => point.parameterValue) },
          };
        });
      }
    };
  });
}

async function expectCandidateDefaults(page: Page) {
  await expect(page.getByRole("textbox", { name: "프로젝트 / 점포명" })).toHaveValue("백초밥 명지점");
  await expect(page.getByRole("textbox", { name: "브랜드명" })).toHaveValue("백초밥");
  await expect(page.getByRole("textbox", { name: "후보지 주소" })).toHaveValue(address);
  await expect(page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" })).toHaveValue("94.44");
  await expect(page.getByText("상권·가격·비용은 예시 가정이며", { exact: false })).toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, hash: "" },
  { name: "mobile", width: 390, height: 844, hash: "#financial" },
]) {
  test(`tester sample is usable without typing on ${viewport.name} and exports actual analysis`, async ({ page }) => {
    await auditComputedResults(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/${viewport.hash}`);
    if (!viewport.hash) {
      await expectCandidateDefaults(page);
      await page.getByRole("button", { name: "샘플 영업 바로 보기" }).click();
      await expect(page).toHaveURL(/#operation$/);
    }
    await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 });
    if (viewport.hash) await expect(page).toHaveURL(/#financial$/);
    const navigation = page.getByRole("navigation", { name: "출점 검토 단계" });
    for (const name of steps) await expect(navigation.getByRole("button", { name: `${name}, 준비됨`, exact: true })).toBeVisible();

    await step(page, "01 후보지");
    await expectCandidateDefaults(page);
    await page.screenshot({ path: path.join(output, `site-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "공간설계로 계속" }).click();
    await expect(page.getByTestId("plan-editor")).toBeVisible();
    const summary = page.locator(".product-space-summary");
    await expect(summary.locator("div").filter({ has: page.getByText("입력 면적", { exact: true }) })).toContainText("94.44");
    await expect(summary.locator("div").filter({ has: page.getByText("도면 면적", { exact: true }) })).toContainText("159.9");
    await expect(page.getByRole("checkbox", { name: "출입구·주방과 테이블별 운영 정원을 확인했습니다." })).toHaveCount(0);
    await page.getByRole("button", { name: "예시 공간으로 계속" }).click();
    await expect(page.getByRole("button", { name: "상권 자료 다시 불러오기" })).toBeVisible();
    await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready");

    await step(page, "05 가상영업");
    const result = page.getByRole("region", { name: "전체 영업 결과" });
    await expect(result).toBeVisible();
    const completedResult = await result.innerText();
    await expect(page.getByTestId("operation-clock")).toHaveText("11:00");
    await expect(page.getByText("실제 상태 기록 1,201개", { exact: false })).toBeVisible();
    const slider = page.getByRole("slider", { name: "영업 기록 시각 탐색" });
    await expect(slider).toBeEnabled();
    await slider.fill("18000");
    await expect(page.getByTestId("operation-clock")).toHaveText("16:00");
    await expect(page.locator(".operation-table-occupied")).not.toHaveCount(0);
    expect(await page.locator(".operation-stage").innerHTML()).not.toMatch(/NaN|Infinity/);
    await page.screenshot({ path: path.join(output, `operation-${viewport.name}.png`), fullPage: true });
    await slider.fill("36000");
    await expect(page.getByTestId("operation-clock")).toHaveText("21:00");
    expect(await result.innerText()).toBe(completedResult);

    await step(page, "07 시나리오 비교");
    await expect(page.locator(".analysis-comparison tbody tr")).toHaveCount(10);
    await expect(page.locator(".analysis-comparison thead th")).toHaveCount(5);
    await page.getByText("고급 분석 · 한 가지 가정의 영향", { exact: true }).click();
    await expect(page.getByText("분석 변수:", { exact: false })).toBeVisible();
    await step(page, "06 수익성 분석");
    await expect(page.getByRole("heading", { name: "한 달의 매출에서 이익까지" })).toBeVisible();
    await expect(page.locator(".analysis-financial-basis")).toContainText("600분");
    await expect(page.locator(".analysis-financial-basis")).toContainText("× 1배");
    await step(page, "08 출점검토");
    await expect(page.getByRole("button", { name: "엑셀 제안서 다운로드" })).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "엑셀 제안서 다운로드" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const file = path.join(output, `review-${viewport.name}.xlsx`);
    await download.saveAs(file);
    const archive = unzipSync(await readFile(file));
    expect(archive["xl/workbook.xml"]).toBeDefined();
    const workbookText = Object.entries(archive).filter(([name]) => name.endsWith(".xml")).map(([, value]) => strFromU8(value)).join("\n");
    expect(workbookText).toContain("백초밥 명지점");
    expect(workbookText).toContain(address);
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const numberAt = (cellAddress: string) => {
      const cell = sheet.match(new RegExp(`<(?:\\w+:)?c\\b[^>]*\\br="${cellAddress}"[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?c>`))?.[1];
      return Number(cell?.match(/<(?:\w+:)?v>([^<]+)<\/(?:\w+:)?v>/)?.[1]);
    };
    const review = await page.evaluate(() => (window as Window & { __workflowAudit: any }).__workflowAudit);
    expect(review.candidate).toMatchObject({ projectName: "백초밥 명지점", brandName: "백초밥", address, knownAreaM2: 94.44 });
    expect(review.layout.totalAreaM2).toBeCloseTo(159.9, 1);
    expect(review.layout.confirmedCapacity).toBe(80);
    expect(review.market.provenance.kind).toBe("demo");
    expect(review.operation.seeds).toEqual([1001, 1002, 1003]);
    expect(review.operation.metrics.customersServed.mean).toBeGreaterThan(0);
    expect(review.operation.metrics.customersServed.count).toBe(3);
    expect(review.financial.conditions.replicationCount).toBe(3);
    expect(review.financial.input.runIds).toEqual(review.operation.runIds);
    expect(review.financial.conditions.dayEstimates[0]).toMatchObject({ startMinute: 660, durationMinutes: 600, runToDayMultiplier: 1, daysPerMonth: 26 });
    expect(review.financial.monthlyDineInRevenue).toBeGreaterThan(0);
    expect(review.financial.monthlyDeliveryRevenue).toBeGreaterThan(0);
    expect(review.financial.monthlyRevenue).toBeCloseTo(review.financial.monthlyDineInRevenue + review.financial.monthlyDeliveryRevenue);
    expect(numberAt("B12")).toBe(94.44);
    expect(numberAt("F12")).toBeCloseTo(review.layout.totalAreaM2);
    expect(numberAt("F20")).toBeCloseTo(review.financial.monthlyRevenue);
    expect(numberAt("F24")).toBeCloseTo(review.financial.operatingProfit);
    expect(Number.isFinite(review.financial.operatingProfit)).toBe(true);
    expect(review.scenarios).toHaveLength(4);
    expect(review.scenarios.every((scenario: { aggregate: { seeds: number[] } }) => JSON.stringify(scenario.aggregate.seeds) === JSON.stringify(review.operation.seeds))).toBe(true);
    expect(review.sensitivity.points).toHaveLength(5);
    expect(review).not.toHaveProperty("score");
    for (const name of steps) {
      await step(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), name).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}

interface DelayedSampleAudit {
  held: boolean;
  delivered: number;
  terminations: number;
  release?: () => void;
  refreshedCandidate?: { projectName: string; address: string; knownAreaM2: number };
}
type TestWindow = Window & { __delayedSample: DelayedSampleAudit };

test("editing a candidate cancels bootstrap and ignores a real worker reply delivered late", async ({ page }) => {
  await page.addInitScript(() => {
    const state: DelayedSampleAudit = { held: false, delivered: 0, terminations: 0 };
    (window as TestWindow).__delayedSample = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let callback: Worker["onmessage"] = null;
        Object.defineProperty(this, "onmessage", { configurable: true, get: () => callback, set: value => { callback = value; } });
        this.addEventListener("message", event => {
          if (event.data?.ok && event.data.result?.kind === "refresh") state.refreshedCandidate = event.data.result.prepared.candidate;
          const handler = callback;
          if (!state.held && event.data?.ok === true && event.data.result?.kind === "sample") {
            state.held = true;
            // Hold the real computed result, then deliberately invoke its captured handler
            // after terminate() to exercise the application's stale-generation guard.
            state.release = () => { state.delivered++; handler?.call(this, event); };
          } else handler?.call(this, event);
        });
      }
      terminate() { state.terminations++; super.terminate(); }
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => (window as TestWindow).__delayedSample.held, undefined, { timeout: 60000 });
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "loading");
  await expect(page.getByRole("button", { name: "샘플 영업 바로 보기" })).toBeEnabled();
  await page.getByRole("button", { name: "샘플 영업 바로 보기" }).click();
  await expect(page).toHaveURL(/#operation$/);
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "loading");
  await step(page, "01 후보지");
  const terminationsBeforeEdit = await page.evaluate(() => (window as TestWindow).__delayedSample.terminations);
  await page.getByRole("textbox", { name: "프로젝트 / 점포명" }).fill("자동 준비 중 수정한 점포");
  await page.getByRole("textbox", { name: "후보지 주소" }).fill("부산광역시 다른 후보지 123");
  await page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" }).fill("88.8");
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "edited");
  expect(await page.evaluate(() => (window as TestWindow).__delayedSample.terminations)).toBeGreaterThan(terminationsBeforeEdit);
  await page.evaluate(async () => {
    (window as TestWindow).__delayedSample.release?.();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => (window as TestWindow).__delayedSample.delivered)).toBe(1);
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "edited");
  await expect(page.getByRole("textbox", { name: "프로젝트 / 점포명" })).toHaveValue("자동 준비 중 수정한 점포");
  await expect(page.getByRole("textbox", { name: "후보지 주소" })).toHaveValue("부산광역시 다른 후보지 123");
  await expect(page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" })).toHaveValue("88.8");
  // A new generation must compute the user's changed candidate automatically.
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 });
  expect(await page.evaluate(() => (window as TestWindow).__delayedSample.refreshedCandidate)).toMatchObject({
    projectName: "자동 준비 중 수정한 점포", address: "부산광역시 다른 후보지 123", knownAreaM2: 88.8,
  });
  await step(page, "03 상권분석");
  await expect(page.getByRole("heading", { name: "부산광역시 다른 후보지 123" })).toBeVisible();
  await step(page, "05 가상영업");
  await expect(page.getByRole("region", { name: "전체 영업 결과" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "영업 기록 시각 탐색" })).toBeEnabled();
  await step(page, "06 수익성 분석");
  await expect(page.getByRole("heading", { name: "한 달의 매출에서 이익까지" })).toBeVisible();
  await step(page, "08 출점검토");
  await expect(page.getByRole("button", { name: "엑셀 제안서 다운로드" })).toBeEnabled();
});
