import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const url = process.argv[2];
if (!url) throw new Error("Usage: node scripts/check-deployment.mjs <site-url/>");
const base = new URL(url.endsWith("/") ? url : `${url}/`);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_PATH || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined),
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto(base.href, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.getByTestId("plan-editor").waitFor();
  assert.equal(await page.locator("[data-entity-id]").count(), 157);
  const overlay = await page.getByTestId("pdf-overlay").getAttribute("href");
  assert.equal(new URL(overlay, base).href, new URL("sample-plan.png", base).href);
  assert.ok(await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth > 2000; }, overlay));
  for (const asset of ["sample.pdf", "assumptions.md", "pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap"]) {
    assert.equal((await page.request.get(new URL(asset, base).href)).status(), 200, asset);
  }
  assert.equal(new URL(await page.getByLabel("원본 PDF 열기").getAttribute("href"), base).href, new URL("sample.pdf", base).href);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 저장", exact: true }).click();
  const stream = await (await jsonDownload).createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const plan = JSON.parse(Buffer.concat(chunks).toString());
  assert.match(plan.overlay.url, /^data:image\/png;base64,/);
  await page.getByLabel("PDF 파일 업로드", { exact: true }).setInputFiles("260906_백초밥-3.pdf");
  await page.waitForFunction(() => document.querySelector('[data-testid="pdf-overlay"]')?.getAttribute("href")?.startsWith("data:image/png;base64,"));
  await page.getByRole("button", { name: "검토 후 3D 생성", exact: true }).click();
  await page.getByRole("checkbox", { name: "원본과 구조를 확인했으며, 미확인 요소와 가정값을 이해했습니다." }).check();
  await page.getByRole("button", { name: "현재 구조로 3D 생성", exact: true }).click();
  await page.getByTestId("three-canvas").waitFor();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  const glbDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GLB", exact: true }).click();
  const glbStream = await (await glbDownload).createReadStream();
  const glbChunks = []; for await (const chunk of glbStream) glbChunks.push(chunk);
  const glb = Buffer.concat(glbChunks);
  assert.equal(glb.toString("ascii", 0, 4), "glTF");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url: base.href, entities: 157, pdfUpload: "passed", jsonOverlay: "embedded", model: "GLB", glbBytes: glb.length, browserErrors: errors }));
} finally { await browser.close(); }
