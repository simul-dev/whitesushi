import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("tmp/e2e/product");
test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

async function step(page: Page, name: string) {
  await page.getByRole("navigation", { name: "출점 검토 단계" }).getByRole("button", { name: new RegExp(name) }).click();
}
async function candidate(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 });
  await page.getByRole("textbox", { name: "프로젝트 / 점포명" }).fill("송도 검토 후보점");
  await page.getByRole("textbox", { name: "브랜드명" }).fill("검토 브랜드");
  await page.getByRole("textbox", { name: "후보지 주소" }).fill("인천 연수구 예시 후보지");
  await page.getByRole("button", { name: "공간설계로 계속" }).click();
  await expect(page.getByTestId("plan-editor")).toBeVisible();
}
async function prepare(page: Page) {
  await candidate(page);
  await page.getByRole("button", { name: "예시 공간으로 계속" }).click();
  await page.getByRole("button", { name: "상권 자료 다시 불러오기" }).click();
  await expect(page.getByRole("button", { name: "상권 자료 다시 불러오기" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("button", { name: "03 상권분석, 준비됨" })).toBeVisible();
  await step(page, "04 수요가정");
  await page.getByRole("button", { name: "방문 수요 계산" }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "04 수요가정, 준비됨" })).toBeVisible();
}
async function operation(page: Page) {
  await step(page, "05 가상영업");
  await page.getByRole("button", { name: "이 조건으로 다시 실행", exact: true }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "05 가상영업, 준비됨" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("region", { name: "전체 영업 결과" })).toBeVisible({ timeout: 30000 });
}
async function reviewDownload(page: Page, filename: string) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "검토 결과 저장" }).click();
  const file = await downloaded;
  await file.saveAs(path.join(output, filename));
  return JSON.parse(await readFile(path.join(output, filename), "utf8"));
}

test("candidate to review uses real engines and preserves financial/operational freshness", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.screenshot({ path: path.join(output, "01-site.png"), fullPage: true });
  await prepare(page);
  expect(await page.getByRole("img", { name: "편집 가능한 평면도", includeHidden: true }).getAttribute("viewBox")).not.toMatch(/NaN|Infinity/);
  await step(page, "02 공간설계");
  await page.screenshot({ path: path.join(output, "02-space.png"), fullPage: true });
  await step(page, "03 상권분석");
  await page.screenshot({ path: path.join(output, "03-market.png"), fullPage: true });
  await step(page, "04 수요가정");
  await page.getByRole("link", { name: "본문으로 이동" }).focus();
  await page.getByRole("link", { name: "본문으로 이동" }).press("Enter");
  await expect(page).toHaveURL(/#demand$/);
  await expect(page.locator("#product-content")).toBeFocused();
  await page.screenshot({ path: path.join(output, "04-demand.png"), fullPage: true });
  await operation(page);
  const results = page.getByRole("region", { name: "전체 영업 결과" });
  const resultText = await results.innerText();
  const scrubber = page.getByRole("slider", { name: "영업 기록 시각 탐색" });
  await scrubber.fill("18000");
  await expect(page.getByTestId("operation-clock")).toHaveText("16:00");
  await expect(page.locator(".operation-table-occupied")).not.toHaveCount(0);
  await page.screenshot({ path: path.join(output, "05-operation.png"), fullPage: true });
  await page.getByRole("button", { name: "영업 기록 재생" }).click();
  await expect(page.getByRole("button", { name: "재생 일시정지" })).toBeVisible();
  await page.getByRole("button", { name: "재생 일시정지" }).click();
  await scrubber.fill("36000");
  await expect(page.getByTestId("operation-clock")).toHaveText("21:00");
  expect(await results.innerText()).toBe(resultText);
  await page.getByRole("button", { name: "처음부터", exact: true }).click();
  await expect(page.getByTestId("operation-clock")).toHaveText("11:00");

  await step(page, "06 시나리오");
  await page.getByRole("button", { name: "4개 시나리오 비교" }).click();
  await expect(page.getByRole("button", { name: "4개 시나리오 비교" })).toBeEnabled({ timeout: 45000 });
  await expect(page.locator(".analysis-comparison tbody tr")).toHaveCount(10, { timeout: 45000 });
  await expect(page.locator(".analysis-comparison thead th")).toHaveCount(5);
  await expect(page.locator(".analysis-failed")).toHaveCount(0);
  await page.getByRole("button", { name: "민감도 계산", exact: true }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "06 시나리오, 준비됨" })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText("분석 변수:", { exact: false })).toBeVisible({ timeout: 45000 });
  await page.screenshot({ path: path.join(output, "06-scenario.png"), fullPage: true });
  await step(page, "07 수익성");
  await page.getByRole("button", { name: "수익성 다시 계산" }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "07 수익성, 준비됨" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "한 달의 매출에서 이익까지" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "07-financial.png"), fullPage: true });
  await step(page, "08 출점검토");
  const before = await reviewDownload(page, "before.json");
  expect(before.candidate.projectName).toBe("송도 검토 후보점");
  expect(before.market.provenance.kind).toBe("demo");
  expect(before.layout.confirmedCapacity).toBe(80);
  expect(before.operation.metrics.customersServed.mean).toBeGreaterThan(0);
  expect(before.scenarios).toHaveLength(4);
  expect(before.sensitivity.points.length).toBeGreaterThanOrEqual(3);
  expect(before.sensitivity.parameter.path).toBe("demandParameters.visitConversionRate");
  expect(before.scenarios[2].assumptions.demand.visitConversionRate).toBeCloseTo(0.3);
  expect(before.financial.conditions.replicationCount).toBe(3);
  expect(before.financial.input.runIds).toHaveLength(3);
  expect(before).not.toHaveProperty("score");
  await page.screenshot({ path: path.join(output, "08-review.png"), fullPage: true });

  await step(page, "07 수익성");
  const rent = page.getByRole("spinbutton", { name: "월 임차료" });
  await rent.fill("3100000"); await rent.press("Tab");
  await expect(page.getByRole("navigation").getByRole("button", { name: "07 수익성, 재계산 필요" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("button", { name: "05 가상영업, 준비됨" })).toBeVisible();
  await page.getByRole("button", { name: "수익성 다시 계산" }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "07 수익성, 준비됨" })).toBeVisible();
  await step(page, "08 출점검토");
  await expect(page.getByRole("button", { name: "검토 결과 저장" })).toBeDisabled();
  await step(page, "06 시나리오");
  await page.getByRole("button", { name: "4개 시나리오 비교" }).click();
  await expect(page.getByRole("button", { name: "4개 시나리오 비교" })).toBeEnabled({ timeout: 45000 });
  await page.getByRole("button", { name: "민감도 계산", exact: true }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "06 시나리오, 준비됨" })).toBeVisible({ timeout: 45000 });
  await step(page, "08 출점검토");
  const after = await reviewDownload(page, "after.json");
  expect(after.financial.input.runIds).toEqual(before.financial.input.runIds);
  expect(after.financial.monthlyRevenue).toBe(before.financial.monthlyRevenue);
  expect(before.financial.operatingProfit - after.financial.operatingProfit).toBeCloseTo(100000);

  await step(page, "01 후보지");
  await page.getByRole("textbox", { name: "브랜드명" }).fill("");
  await step(page, "08 출점검토");
  await expect(page.getByRole("button", { name: "검토 결과 저장" })).toBeDisabled();
  await step(page, "01 후보지");
  await page.getByRole("textbox", { name: "브랜드명" }).fill("검토 브랜드");
  await step(page, "08 출점검토");
  await expect(page.getByRole("button", { name: "검토 결과 저장" })).toBeEnabled();

  await step(page, "04 수요가정");
  await page.getByRole("spinbutton", { name: "방문 전환율", exact: true }).fill("30");
  await page.getByRole("spinbutton", { name: "방문 전환율", exact: true }).press("Tab");
  await step(page, "05 가상영업");
  await expect(page.getByRole("button", { name: "이 조건으로 다시 실행" })).toBeDisabled();
  await expect(page.getByText("아래 재생과 결과는 이전 실행의 배치·조건입니다.", { exact: false })).toBeVisible();
  await step(page, "04 수요가정");
  await page.getByRole("button", { name: "방문 수요 계산" }).click();
  await step(page, "05 가상영업");
  await expect(page.getByRole("button", { name: "이 조건으로 다시 실행" })).toBeEnabled();
  await page.getByRole("button", { name: "이 조건으로 다시 실행" }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "05 가상영업, 준비됨" })).toBeVisible({ timeout: 30000 });
  expect(errors).toEqual([]);
});

test("invalid visible assumptions cannot silently run with previous values", async ({ page }) => {
  await prepare(page);
  const conversion = page.getByRole("spinbutton", { name: "방문 전환율", exact: true });
  await conversion.fill("101");
  await page.getByRole("button", { name: "방문 수요 계산" }).click();
  await expect(conversion).toHaveAttribute("aria-invalid", "true");
  await expect(conversion).toBeFocused();
  await conversion.fill("30");
  await page.getByRole("button", { name: "방문 수요 계산" }).click();
  await step(page, "05 가상영업");
  const previousOperation = await page.getByRole("region", { name: "전체 영업 결과" }).innerText();
  const cooks = page.getByRole("spinbutton", { name: "조리 직원", exact: false });
  await cooks.fill("-1");
  await page.getByRole("button", { name: "이 조건으로 다시 실행", exact: true }).click();
  await expect(cooks).toHaveAttribute("aria-invalid", "true");
  expect(await page.getByRole("region", { name: "전체 영업 결과" }).innerText()).toBe(previousOperation);
  await expect(page.getByRole("navigation").getByRole("button", { name: "05 가상영업, 재계산 필요" })).toBeVisible();
  await cooks.fill("2"); await cooks.press("Tab");
  await page.getByRole("button", { name: "이 조건으로 다시 실행", exact: true }).click();
  await expect(page.getByRole("navigation").getByRole("button", { name: "05 가상영업, 준비됨" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("region", { name: "전체 영업 결과" })).toBeVisible({ timeout: 30000 });
  await step(page, "07 수익성");
  const previousFinancial = await page.locator(".analysis-finance-summary").innerText();
  const days = page.getByRole("spinbutton", { name: "월 영업일" });
  await days.fill("32");
  await page.getByRole("button", { name: "수익성 다시 계산" }).click();
  await expect(days).toHaveAttribute("aria-invalid", "true");
  await expect(days).toBeFocused();
  await expect(page.getByRole("heading", { name: "한 달의 매출에서 이익까지" })).toBeVisible();
  expect(await page.locator(".analysis-finance-summary").innerText()).toBe(previousFinancial);
  await expect(page.getByRole("navigation").getByRole("button", { name: "07 수익성, 재계산 필요" })).toBeVisible();
});

test("Space history survives navigation and replacement clears operational confirmation", async ({ page }) => {
  await candidate(page);
  await page.getByRole("textbox", { name: "요소 검색" }).fill("다이닝 테이블 01");
  await page.locator(".object-list button").first().click();
  const width = page.getByRole("spinbutton", { name: "너비", exact: true });
  const before = await width.inputValue();
  await width.fill("1150"); await width.press("Enter");
  await step(page, "01 후보지");
  await page.locator("#product-content").focus(); await page.keyboard.press("Control+z");
  await step(page, "02 공간설계");
  await expect(width).toHaveValue("1150");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(width).toHaveValue(before);
  await page.getByRole("checkbox", { name: "출입구·주방과 테이블별 운영 정원을 확인했습니다." }).check();
  await page.getByRole("button", { name: "공간 확인하고 상권으로" }).click();
  await step(page, "02 공간설계");
  await page.getByLabel("FloorPlan JSON 파일 업로드", { exact: true }).setInputFiles("floorplan.json");
  await expect(page.getByRole("button", { name: "공간 확인하고 상권으로" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "출입구·주방과 테이블별 운영 정원을 확인했습니다." })).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "고객 출입구" })).toHaveValue("");
  await expect(page.locator(".product-space-summary")).toContainText("미확정");
});

test("unprepared steps explain dependencies and mobile pages remain inside viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("sample-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 });
  await page.screenshot({ path: path.join(output, "01-site-mobile.png"), fullPage: true });
  await page.getByRole("textbox", { name: "브랜드명" }).fill("");
  await step(page, "05 가상영업");
  await expect(page.getByRole("button", { name: "이 조건으로 다시 실행", exact: true })).toBeDisabled();
  await expect(page.getByText("후보지에서 점포명·브랜드·주소를 먼저 입력해 주세요.")).toBeVisible();
  await step(page, "08 출점검토");
  await expect(page.getByRole("button", { name: "검토 결과 저장" })).toBeDisabled();
  await prepare(page);
  await operation(page);
  await page.getByRole("slider", { name: "영업 기록 시각 탐색" }).fill("18000");
  await page.screenshot({ path: path.join(output, "05-operation-mobile.png"), fullPage: true });
  for (const name of ["01 후보지", "02 공간설계", "03 상권분석", "04 수요가정", "05 가상영업", "06 시나리오", "07 수익성", "08 출점검토"]) {
    await step(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), name).toBeLessThanOrEqual(1);
  }
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("이 조건에서 얼마가 남을까요?");
  await expect(page.getByLabel("현재 후보지")).toContainText("송도 검토 후보점");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const current = page.getByRole("navigation").locator('[aria-current="step"]');
  await expect(current).toBeInViewport();
});
