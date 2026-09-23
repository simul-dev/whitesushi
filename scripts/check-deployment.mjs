import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

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
  // Verify the product entry point and actual worker at the deployment subpath.
  const workerUrls = [];
  page.on("worker", worker => workerUrls.push(worker.url()));
  const productResponse = await page.goto(base.href, { waitUntil: "networkidle" });
  assert.equal(productResponse.status(), 200);
  assert.equal(await page.getByRole("textbox", { name: "프로젝트 / 점포명" }).inputValue(), "백초밥 명지점");
  assert.equal(await page.getByRole("spinbutton", { name: "알고 있는 면적 (제곱미터)" }).inputValue(), "94.44");
  await page.locator('[data-testid="sample-status"][data-state="ready"]').waitFor({ state: "attached", timeout: 30000 });
  const navigation = page.getByRole("navigation", { name: "출점 검토 단계" });
  assert.equal(await navigation.getByRole("button", { name: /준비됨$/ }).count(), 8);
  assert.ok(await page.getByRole("img", { name: "백초밥", exact: true }).first().evaluate(img => img.complete && img.naturalWidth === 753));
  assert.match(await navigation.getByRole("button").nth(5).getAttribute("aria-label"), /^06 수익성 분석/);
  assert.match(await navigation.getByRole("button").nth(6).getAttribute("aria-label"), /^07 시나리오 비교/);
  await page.getByRole("button", { name: "샘플 영업 바로 보기" }).click();
  await page.getByRole("region", { name: "전체 영업 결과" }).waitFor({ timeout: 30000 });
  assert.ok(workerUrls.some(workerUrl => new URL(workerUrl).pathname.startsWith(base.pathname) && workerUrl.includes("analysis.worker")), "product analysis worker loaded under base path");
  await page.getByRole("slider", { name: "영업 기록 시각 탐색" }).fill("36000");
  assert.equal(await page.getByTestId("operation-clock").innerText(), "21:00");
  await navigation.getByRole("button", { name: /^08 출점검토/ }).click();
  const proposalDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "엑셀 제안서 다운로드" }).click();
  const proposal = await proposalDownload;
  assert.match(proposal.suggestedFilename(), /출점검토_제안서\.xlsx$/);
  const proposalStream = await proposal.createReadStream(), proposalChunks = [];
  for await (const chunk of proposalStream) proposalChunks.push(chunk);
  const workbook = unzipSync(new Uint8Array(Buffer.concat(proposalChunks)));
  assert.match(strFromU8(workbook["xl/workbook.xml"]), /출점 제안서/);
  assert.match(strFromU8(workbook["xl/worksheets/sheet1.xml"]), /백초밥 명지점/);
  assert.ok(Object.keys(workbook).some(path => path.startsWith("xl/media/")), "proposal logo embedded");
  const response = await page.goto(new URL("?workspace=space", base).href, { waitUntil: "networkidle" });
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
  console.log(JSON.stringify({ url: base.href, productWorkflow: "passed", analysisWorker: "passed", brandLogo: "passed", excelProposal: "passed", entities: 157, pdfUpload: "passed", jsonOverlay: "embedded", model: "GLB", glbBytes: glb.length, browserErrors: errors }));
} finally { await browser.close(); }
