import { getDocument, GlobalWorkerOptions, OPS, Util } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FloorPlan, Entity, PlanSettings } from "./types";
import {
  extractVectorLines,
  findWallCandidates,
  validateCalibration,
} from "./pdfGeometry";
import type { Matrix, PdfCalibration, PdfLine, PdfText } from "./pdfGeometry";

export type {
  PdfCalibration,
  PdfCrop,
  PdfPoint,
  PdfLine,
  PdfText,
} from "./pdfGeometry";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfAnalysis {
  fileName: string;
  page: number;
  pageCount: number;
  width: number;
  height: number;
  imageUrl: string;
  texts: PdfText[];
  lines: PdfLine[];
  warnings: string[];
}

export interface PdfSession {
  name: string;
  pageCount: number;
  renderPage(page: number): Promise<PdfAnalysis>;
  destroy(): Promise<void>;
}

function readableError(error: unknown): Error {
  const name = (error as { name?: string })?.name;
  if (name === "PasswordException")
    return new Error(
      "암호가 있는 PDF는 지원하지 않습니다. 암호를 해제한 사본을 업로드하세요.",
    );
  if (name === "InvalidPDFException" || name === "FormatError")
    return new Error(
      "PDF 형식이 손상되었거나 읽을 수 없습니다. 다른 PDF 사본을 사용하세요.",
    );
  return error instanceof Error
    ? error
    : new Error("PDF를 처리하지 못했습니다.");
}

/** Local-only import: no upload, OCR service, or external API. */
export async function openPdf(
  data: Uint8Array,
  fileName: string,
): Promise<PdfSession> {
  if (!data.byteLength || data.byteLength > 30 * 1024 * 1024)
    throw new Error("PDF는 30MB 이하의 비어 있지 않은 파일이어야 합니다.");
  const header = new TextDecoder("latin1").decode(data.subarray(0, 1024));
  if (!header.includes("%PDF-")) throw new Error("PDF 파일을 선택하세요.");
  const base = import.meta.env.BASE_URL;
  const task = getDocument({
    data: data.slice(), // PDF.js transfers its buffer; preserve caller's hash input.
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    isEvalSupported: false,
    maxImageSize: 16000000,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw readableError(error);
  }
  if (pdf.numPages > 100) {
    await task.destroy();
    throw new Error(
      "최대 100페이지까지 지원합니다. 필요한 도면 페이지만 분리해 업로드하세요.",
    );
  }
  let destroyed = false;
  return {
    name: fileName,
    pageCount: pdf.numPages,
    async renderPage(pageNumber: number): Promise<PdfAnalysis> {
      if (destroyed)
        throw new Error("PDF 세션이 종료되었습니다. 다시 업로드하세요.");
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pdf.numPages
      )
        throw new Error("올바른 PDF 페이지를 선택하세요.");
      const page = await pdf.getPage(pageNumber);
      try {
        const natural = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(natural.width + natural.height) ||
          natural.width <= 0 ||
          natural.height <= 0
        )
          throw new Error("PDF 페이지 크기가 올바르지 않습니다.");
        const viewport = page.getViewport({
          scale: Math.min(3, 1800 / Math.max(natural.width, natural.height)),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("브라우저에서 PDF 캔버스를 만들 수 없습니다.");
        const results = await Promise.allSettled([
          page.render({
            canvasContext: context,
            viewport,
            background: "#ffffff",
            annotationMode: 0,
          }).promise,
          page.getTextContent(),
          page.getOperatorList({ annotationMode: 0 }),
        ]);
        if (results[0].status === "rejected") throw results[0].reason;
        const warnings: string[] = [];
        const texts: PdfText[] = [];
        if (results[1].status === "fulfilled") {
          for (const item of results[1].value.items.slice(0, 30000)) {
            if (!("str" in item) || !item.str.trim()) continue;
            const matrix = Util.transform(viewport.transform, item.transform);
            const angle = Math.atan2(matrix[1], matrix[0]);
            const itemHeight = Math.hypot(matrix[2], matrix[3]);
            const itemWidth = item.width * viewport.scale;
            const style = results[1].value.styles[item.fontName];
            const ascent = (style?.ascent ?? 0.8) * itemHeight;
            const x = matrix[4] + ascent * Math.sin(angle),
              y = matrix[5] - ascent * Math.cos(angle);
            const corners = [
              [x, y],
              [
                x + itemWidth * Math.cos(angle),
                y + itemWidth * Math.sin(angle),
              ],
              [
                x - itemHeight * Math.sin(angle),
                y + itemHeight * Math.cos(angle),
              ],
              [
                x + itemWidth * Math.cos(angle) - itemHeight * Math.sin(angle),
                y + itemWidth * Math.sin(angle) + itemHeight * Math.cos(angle),
              ],
            ];
            const xs = corners.map((p) => p[0]),
              ys = corners.map((p) => p[1]);
            texts.push({
              text: item.str,
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            });
          }
        } else
          warnings.push(
            "텍스트 추출에 실패했습니다. 원본 이미지의 치수와 라벨을 직접 확인하세요.",
          );
        let lines: PdfLine[] = [];
        if (results[2].status === "fulfilled") {
          const extracted = extractVectorLines(
            results[2].value,
            viewport.transform as Matrix,
            OPS,
          );
          lines = extracted.lines;
          if (extracted.truncated)
            warnings.push(
              "복잡한 도면으로 벡터 추출 상한에 도달했습니다. 일부 선이 생략되었습니다.",
            );
        } else
          warnings.push(
            "벡터 선 추출에 실패했습니다. 원본 위에서 벽을 직접 추가하세요.",
          );
        if (!lines.length)
          warnings.push(
            "추출 가능한 직선 벡터가 없습니다. 스캔/이미지 PDF는 치수 보정 후 수동으로 작성하세요.",
          );
        if (!texts.length)
          warnings.push(
            "읽을 수 있는 텍스트가 없습니다. 윤곽선 글자 또는 스캔일 수 있으며 OCR은 수행하지 않습니다.",
          );
        warnings.push(
          "직선 쌍은 벽 후보일 뿐입니다. 치수선·가구·외곽선이 섞일 수 있으므로 원본과 비교해 검토하세요.",
        );
        const imageUrl = canvas.toDataURL("image/png");
        canvas.width = 1;
        canvas.height = 1;
        return {
          fileName,
          page: pageNumber,
          pageCount: pdf.numPages,
          width: viewport.width,
          height: viewport.height,
          imageUrl,
          texts,
          lines,
          warnings,
        };
      } catch (error) {
        throw readableError(error);
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      destroyed = true;
      await task.destroy();
    },
  };
}

/** Builds an editable draft. This function never assigns semantic furniture labels. */
export function calibratePage(
  analysis: PdfAnalysis,
  calibration: PdfCalibration,
  settings: PlanSettings,
): FloorPlan {
  const { crop, mmPerPixel, width, depth } = validateCalibration(
    analysis.width,
    analysis.height,
    calibration,
  );
  const walls: Entity[] = findWallCandidates(
    analysis.lines,
    analysis.texts,
    crop,
    mmPerPixel,
  ).map((wall, index) => ({
    ...wall,
    id: `pdf-wall-${analysis.page}-${index + 1}`,
    type: "wall",
    name: `벽 후보 ${index + 1}`,
    z: 0,
    height: settings.wallHeight,
    confidence: 0.45,
    source: `pdf-vector-pair:page-${analysis.page}`,
    reviewed: false,
    color: "#d59c42",
  }));
  return {
    version: "1.0",
    name: analysis.fileName.replace(/\.pdf$/i, ""),
    units: "mm",
    bounds: { width, depth },
    settings: { ...settings },
    walls,
    doors: [],
    windows: [],
    zones: [],
    objects: [],
    overlay: {
      x: -crop.x * mmPerPixel,
      y: -crop.y * mmPerPixel,
      width: analysis.width * mmPerPixel,
      depth: analysis.height * mmPerPixel,
      pageWidth: analysis.width,
      pageHeight: analysis.height,
      page: analysis.page,
      url: analysis.imageUrl,
    },
    metadata: {
      fileName: analysis.fileName,
      page: analysis.page,
      pageCount: analysis.pageCount,
      importMethod: "pdfjs-vector-review",
      textCount: analysis.texts.length,
      lineCount: analysis.lines.length,
    },
    calibration: {
      method: "two-point-known-length",
      ...calibration,
      crop,
      mmPerPixel,
      reviewedByUser: true,
    },
    notes: [
      ...analysis.warnings,
      "실제 길이는 사용자가 지정한 2점의 거리로 보정했습니다. 기준 치수가 틀리면 전체 모델의 크기도 틀려집니다.",
      "작업 영역은 선택한 사각형입니다. 건물 바닥 외곽을 자동으로 확정한 결과가 아닙니다.",
      `${walls.length}개 벽 후보를 생성했습니다. 공간·문·창·가구·설비는 자동 분류하지 않으며 직접 추가해야 합니다.`,
      "벽/천장/문/가구 높이와 재질·조명은 설정의 기본값입니다. 도면에 명시된 사실이 아닙니다.",
    ],
  };
}
