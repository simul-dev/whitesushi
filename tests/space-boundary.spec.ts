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
