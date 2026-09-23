import { test, expect } from "@playwright/test";

test("Space notifies detached edits and isolates same-name document sessions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/fixtures/space-harness.html");
  await expect(page.getByTestId("snapshot-count")).toHaveText("125");
  await page.getByRole("button", { name: "콜백 사본 변경", exact: true }).click();
  await expect(page.locator("[data-entity-id]")).toHaveCount(157);
  await page.getByRole("button", { name: "요소 추가", exact: true }).click();
  await expect(page.getByTestId("snapshot-count")).toHaveText("126");
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.getByTestId("snapshot-count")).toHaveText("125");
  await page.getByRole("button", { name: "검토 후 3D 생성", exact: true }).click();
  await page.getByRole("checkbox", { name: "원본과 구조를 확인했으며, 미확인 요소와 가정값을 이해했습니다." }).check();
  await page.getByRole("button", { name: "현재 구조로 3D 생성", exact: true }).click();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
  await page.getByRole("button", { name: "다른 문서 열기", exact: true }).click();
  await expect(page.getByTestId("plan-editor")).toBeVisible();
  await expect(page.locator("[data-entity-id]")).toHaveCount(156);
  await expect(page.getByRole("button", { name: "실행 취소", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export GLB", exact: true })).toBeDisabled();
  await expect(page.getByTestId("snapshot-count")).toHaveText("124");
  expect(errors).toEqual([]);
});

test("switching documents releases an open PDF calibration worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/fixtures/space-harness.html");
  await page.getByLabel("PDF 파일 업로드", { exact: true }).setInputFiles("260712_백초밥-1.pdf");
  await expect(page.getByRole("dialog", { name: "PDF 축척 보정" })).toBeVisible();
  await expect(page.getByLabel("PDF 보정 캔버스", { exact: true })).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(1);
  // A project shell can replace the keyed workspace while its import modal is open.
  await page.getByRole("button", { name: "다른 문서 열기", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-entity-id]")).toHaveCount(156);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
});

test("a PDF that finishes opening after a document switch is disposed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Hold a real worker's document load, after openPdf has started but before its promise resolves.
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, transfer?: any) {
      if (message?.action === "GetDocRequest") {
        (window as any).__releasePdfDocument = () => postMessage.call(this, message, transfer);
        return;
      }
      postMessage.call(this, message, transfer);
    };
  });
  await page.goto("/tests/fixtures/space-harness.html");
  const workerStarted = page.waitForEvent("worker");
  await page.getByLabel("PDF 파일 업로드", { exact: true }).setInputFiles("260712_백초밥-1.pdf");
  await page.waitForFunction(() => typeof (window as any).__releasePdfDocument === "function");
  const worker = await workerStarted;
  const workerClosed = new Promise<void>(resolve => worker.once("close", () => resolve()));
  await page.getByRole("button", { name: "다른 문서 열기", exact: true }).click();
  await expect(page.locator("[data-entity-id]")).toHaveCount(156);
  await page.evaluate(() => (window as any).__releasePdfDocument());
  await workerClosed;
  await expect.poll(() => page.workers().length, { timeout: 30000 }).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("snapshot-count")).toHaveText("124");
  expect(errors).toEqual([]);
});
