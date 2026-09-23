import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
const output = path.resolve("tmp/e2e");
test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});
function errorLog(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  return errors;
}
async function saveDownload(
  page: Page,
  name: string,
  action: () => Promise<unknown>,
) {
  const wait = page.waitForEvent("download");
  await action();
  const d = await wait;
  await d.saveAs(path.join(output, name));
  return readFile(path.join(output, name));
}
async function approve(page: Page) {
  await page
    .getByRole("button", { name: "검토 후 3D 생성", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "원본과 구조를 확인했으며, 미확인 요소와 가정값을 이해했습니다.",
    })
    .check();
  await page
    .getByRole("button", { name: "현재 구조로 3D 생성", exact: true })
    .click();
  await expect(page.getByTestId("three-canvas")).toBeVisible();
}
test("real source PDF / geometry / portable JSON", async ({ page }) => {
  const errors = errorLog(page);
  await page.goto("/");
  await expect(page.getByTestId("plan-editor")).toBeVisible();
  await expect(page.locator("[data-entity-id]")).toHaveCount(157);
  const image = await page.getByTestId("pdf-overlay").getAttribute("href");
  expect(image).toBe("/sample-plan.png");
  expect(
    await page.evaluate(async () => {
      const im = new Image();
      im.src = "/sample-plan.png";
      await im.decode();
      return im.naturalWidth;
    }),
  ).toBeGreaterThan(2000);
  await expect(
    page.locator('[data-entity-id="wall-east"] rect'),
  ).toHaveAttribute("x", "8800");
  await page.screenshot({ path: path.join(output, "2d-overview.png") });
  const json = JSON.parse(
    (
      await saveDownload(page, "floorplan.json", () =>
        page.getByRole("button", { name: "JSON 저장", exact: true }).click(),
      )
    ).toString(),
  );
  expect(json.bounds).toEqual({ width: 8800, depth: 21200 });
  expect(json.objects.filter((e: any) => e.type === "table")).toHaveLength(20);
  expect(json.overlay.url).toMatch(/^data:image\/png;base64,/);
  expect(errors).toEqual([]);
});
test("edits, drag, rotation, add, delete and undo affect the same JSON", async ({
  page,
}) => {
  const errors = errorLog(page);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "요소 검색" })
    .fill("다이닝 테이블 01");
  await page.locator(".object-list button").first().click();
  await page
    .getByRole("spinbutton", { name: "너비", exact: true })
    .fill("1150");
  await page
    .getByRole("spinbutton", { name: "너비", exact: true })
    .press("Enter");
  const selected = page
    .locator("[data-entity-id]")
    .filter({ has: page.locator("text") });
  expect(selected).toBeTruthy();
  await page.getByRole("button", { name: "90도 회전", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "회전", exact: true }),
  ).toHaveValue("90");
  const id = await page
    .locator("g[data-entity-id]")
    .filter({ has: page.locator("title", { hasText: "다이닝 테이블 01" }) })
    .getAttribute("data-entity-id");
  expect(id).toBeTruthy();
  const item = page.locator(`g[data-entity-id="${id}"]`);
  const box = await item.boundingBox();
  expect(box).not.toBeNull();
  const xBefore = Number(
    await page.getByRole("spinbutton", { name: "X", exact: true }).inputValue(),
  );
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 30,
    box!.y + box!.height / 2 + 15,
    { steps: 6 },
  );
  await page.mouse.up();
  expect(
    Number(
      await page
        .getByRole("spinbutton", { name: "X", exact: true })
        .inputValue(),
    ),
  ).not.toBe(xBefore);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "X", exact: true }),
  ).toHaveValue(String(xBefore));
  await page
    .getByRole("combobox", { name: "추가할 요소" })
    .selectOption("window");
  await page.getByRole("button", { name: "요소 추가", exact: true }).click();
  await expect(page.locator("[data-entity-id]")).toHaveCount(158);
  await page.getByRole("button", { name: "요소 삭제", exact: true }).click();
  await expect(page.locator("[data-entity-id]")).toHaveCount(157);
  const json = JSON.parse(
    (
      await saveDownload(page, "edited.json", () =>
        page.getByRole("button", { name: "JSON 저장", exact: true }).click(),
      )
    ).toString(),
  );
  const entity = json.objects.find((e: any) => e.id === id);
  expect(entity.width).toBe(1150);
  expect(entity.rotation).toBe(90);
  expect(errors).toEqual([]);
});
test("reviewed 3D, six cameras, GLB/GLTF and six orthographic/perspective PNG exports", async ({
  page,
}) => {
  const errors = errorLog(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Export GLB", exact: true }),
  ).toBeDisabled();
  await approve(page);
  for (const view of ["Top", "Front", "Back", "Left", "Right", "Perspective"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByTestId("three-canvas")).toBeVisible();
    await page.screenshot({
      path: path.join(output, `${view.toLowerCase()}-ui.png`),
    });
  }
  const glb = await saveDownload(page, "floorplan.glb", () =>
    page.getByRole("button", { name: "Export GLB", exact: true }).click(),
  );
  expect(glb.toString("ascii", 0, 4)).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const gltf = JSON.parse(
    (
      await saveDownload(page, "floorplan.gltf", () =>
        page
          .getByRole("button", { name: "GLTF 모델 (.gltf)", exact: true })
          .click(),
      )
    ).toString(),
  );
  expect(gltf.asset.version).toBe("2.0");
  expect(gltf.buffers[0].uri).toMatch(/^data:/);
  expect(gltf.nodes.some((n: any) => n.extras?.entityId === "wall-east")).toBe(
    true,
  );
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const zipped = await saveDownload(page, "floorplan-views.zip", () =>
    page
      .getByRole("button", { name: "6개 뷰 PNG 묶음 (.zip)", exact: true })
      .click(),
  );
  const images = unzipSync(zipped);
  expect(Object.keys(images).sort()).toEqual([
    "back.png",
    "front.png",
    "left.png",
    "perspective.png",
    "right.png",
    "top.png",
  ]);
  for (const [name, bytes] of Object.entries(images)) {
    const png = Buffer.from(bytes);
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1600);
    expect(png.readUInt32BE(20)).toBe(1200);
    await writeFile(path.join(output, name), bytes);
  }
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const single = await saveDownload(page, "single.png", () =>
    page.getByRole("button", { name: "Perspective PNG", exact: true }).click(),
  );
  expect(single.readUInt32BE(16)).toBe(1600);
  expect(errors).toEqual([]);
});
test("PDF.js sample fingerprint import and unrelated PDF calibration", async ({
  page,
}) => {
  const errors = errorLog(page);
  await page.goto("/");
  await page
    .getByLabel("PDF 파일 업로드", { exact: true })
    .setInputFiles("260906_백초밥-3.pdf");
  await expect(page.getByTestId("pdf-overlay")).toHaveAttribute(
    "href",
    /^data:image\/png;base64,/,
    { timeout: 30000 },
  );
  await expect(page.locator("[data-entity-id]")).toHaveCount(157);
  await page
    .getByLabel("PDF 파일 업로드", { exact: true })
    .setInputFiles("260712_백초밥-1.pdf");
  await expect(
    page.getByRole("dialog", { name: "PDF 축척 보정" }),
  ).toBeVisible();
  const svg = page.getByLabel("PDF 보정 캔버스", { exact: true });
  await expect(svg).toBeVisible();
  const positions = await svg.evaluate((el) => {
    const s = el as unknown as SVGSVGElement;
    const vb = s.viewBox.baseVal;
    return [
      [0.27, 0.15],
      [0.72, 0.83],
      [0.31, 0.8],
      [0.68, 0.8],
    ].map(([x, y]) => {
      const p = new DOMPoint(vb.width * x, vb.height * y).matrixTransform(
        s.getScreenCTM()!,
      );
      return { x: p.x, y: p.y };
    });
  });
  for (const p of positions) await page.mouse.click(p.x, p.y);
  await page.getByRole("spinbutton", { name: "기준 거리 mm" }).fill("8800");
  await page.getByRole("button", { name: "초안 생성", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const draft = JSON.parse(
    (
      await saveDownload(page, "generic.json", () =>
        page.getByRole("button", { name: "JSON 저장", exact: true }).click(),
      )
    ).toString(),
  );
  expect(draft.metadata.importMethod).toBe("pdfjs-vector-review");
  expect(draft.objects).toHaveLength(0);
  expect(draft.walls.every((w: any) => w.confidence === 0.45)).toBe(true);
  expect(draft.walls.length).toBeGreaterThan(0);
  expect(draft.calibration.distanceMm).toBe(8800);
  await page.screenshot({ path: path.join(output, "generic-import.png") });
  expect(errors).toEqual([]);
});
test("JSON validation rejects malformed uploads and restores exported edits", async ({
  page,
}) => {
  const errors = errorLog(page);
  await page.goto("/");
  await page
    .getByLabel("FloorPlan JSON 파일 업로드", { exact: true })
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"units":"meters"}'),
    });
  await expect(page.getByRole("alert")).toContainText("mm");
  await expect(page.locator("[data-entity-id]")).toHaveCount(157);
  const source = JSON.parse(await readFile("floorplan.json", "utf8"));
  source.objects[0].width = 1234;
  await page
    .getByLabel("FloorPlan JSON 파일 업로드", { exact: true })
    .setInputFiles({
      name: "updated.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
  await page
    .getByRole("textbox", { name: "요소 검색" })
    .fill(source.objects[0].name);
  await page.locator(".object-list button").first().click();
  await expect(
    page.getByRole("spinbutton", { name: "너비", exact: true }),
  ).toHaveValue("1234");
  expect(errors).toEqual([]);
});
test("height, materials, light and floor outline are editable and invalidate prior review", async ({
  page,
}) => {
  const errors = errorLog(page);
  await page.goto("/");
  await approve(page);
  await page.getByRole("button", { name: "모델 기본값", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "벽 높이", exact: true })
    .fill("3100");
  await page
    .getByRole("spinbutton", { name: "벽 높이", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Export GLB", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "벽·문에 기본 높이 적용", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "기본 재질", exact: true })
    .selectOption("white");
  await page
    .getByRole("spinbutton", { name: "조명 강도", exact: true })
    .fill("1.3");
  await page
    .getByRole("spinbutton", { name: "조명 강도", exact: true })
    .press("Enter");
  await page.locator(".outline-editor summary").click();
  const first = page.getByRole("spinbutton", {
    name: "꼭짓점 1 X",
    exact: true,
  });
  await first.fill("25");
  await first.press("Enter");
  const changed = JSON.parse(
    (
      await saveDownload(page, "settings-edited.json", () =>
        page.getByRole("button", { name: "JSON 저장", exact: true }).click(),
      )
    ).toString(),
  );
  expect(changed.settings.material).toBe("white");
  expect(changed.settings.lighting).toBe(1.3);
  expect(changed.walls.every((w: any) => w.height === 3100)).toBe(true);
  expect(changed.floorOutline[0].x).toBe(25);
  expect(changed.review.acknowledged).toBe(false);
  expect(errors).toEqual([]);
});
