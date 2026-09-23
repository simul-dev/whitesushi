/** Pure PDF geometry helpers. Coordinates are top-left rendered-page pixels. */
export interface PdfPoint {
  x: number;
  y: number;
}
export interface PdfCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PdfText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
  color: string;
  dashed: boolean;
}
export interface PdfCalibration {
  p1: PdfPoint;
  p2: PdfPoint;
  distanceMm: number;
  crop?: PdfCrop;
}
export interface WallCandidate {
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}
export type Matrix = [number, number, number, number, number, number];

export function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function transformPoint(matrix: Matrix, x: number, y: number): PdfPoint {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

interface GraphicsState {
  matrix: Matrix;
  lineWidth: number;
  color: string;
  dashed: boolean;
}
interface OperatorListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown[]>;
}

/**
 * PDF.js 4.10 constructPath uses [pathOperators, coordinates, boundingBox].
 * Only painted straight strokes are returned. Curves, fills, clipping and text
 * outlines cannot establish wall semantics and are intentionally not inferred.
 */
export function extractVectorLines(
  list: OperatorListLike,
  viewportTransform: Matrix,
  ops: Record<string, number>,
): { lines: PdfLine[]; truncated: boolean } {
  const lines: PdfLine[] = [];
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    matrix: viewportTransform,
    lineWidth: 1,
    color: "#000000",
    dashed: false,
  };
  let pending: PdfLine[] = [];
  let current: PdfPoint | null = null;
  let start: PdfPoint | null = null;
  let pathOperationCount = 0;
  let truncated = list.fnArray.length > 250000;
  const save = () =>
    stack.push({ ...state, matrix: [...state.matrix] as Matrix });
  const restore = () => {
    const previous = stack.pop();
    if (previous) state = previous;
  };
  const addLine = (from: PdfPoint, to: PdfPoint) => {
    if (pending.length >= 50000 || lines.length >= 50000) {
      truncated = true;
      return;
    }
    const scale = Math.sqrt(
      Math.abs(
        state.matrix[0] * state.matrix[3] - state.matrix[1] * state.matrix[2],
      ),
    );
    if (
      [from.x, from.y, to.x, to.y, scale].every(Number.isFinite) &&
      Math.hypot(to.x - from.x, to.y - from.y) > 0.3
    ) {
      pending.push({
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        strokeWidth: state.lineWidth * scale,
        color: state.color,
        dashed: state.dashed,
      });
    }
  };
  const close = () => {
    if (current && start) {
      addLine(current, start);
      current = start;
    }
  };
  const clear = () => {
    pending = [];
    current = null;
    start = null;
  };
  const commit = (closed: boolean) => {
    if (closed) close();
    const room = Math.max(0, 50000 - lines.length);
    if (pending.length > room) truncated = true;
    lines.push(...pending.slice(0, room));
    clear();
  };
  for (let i = 0; i < Math.min(list.fnArray.length, 250000); i++) {
    if (lines.length >= 50000 || pathOperationCount >= 400000) {
      truncated = true;
      break;
    }
    const fn = list.fnArray[i];
    const args = list.argsArray[i] || [];
    if (fn === ops.save) save();
    else if (fn === ops.restore) restore();
    else if (fn === ops.transform && args.length >= 6)
      state.matrix = multiplyMatrix(state.matrix, args.slice(0, 6) as Matrix);
    else if (fn === ops.paintFormXObjectBegin) {
      save();
      if (args[0])
        state.matrix = multiplyMatrix(
          state.matrix,
          Array.from(args[0] as ArrayLike<number>) as Matrix,
        );
    } else if (fn === ops.paintFormXObjectEnd) restore();
    else if (fn === ops.beginGroup) {
      save();
      const group = args[0] as { matrix?: Matrix } | undefined;
      if (group?.matrix)
        state.matrix = multiplyMatrix(state.matrix, group.matrix);
    } else if (fn === ops.endGroup) restore();
    else if (fn === ops.setLineWidth) state.lineWidth = Number(args[0]);
    else if (fn === ops.setDash)
      state.dashed = Boolean((args[0] as unknown[])?.length);
    else if (fn === ops.setGState) {
      for (const entry of (args[0] as [string, unknown][]) || []) {
        if (entry[0] === "LW") state.lineWidth = Number(entry[1]);
        if (entry[0] === "D")
          state.dashed = Boolean(
            ((entry[1] as unknown[])?.[0] as unknown[])?.length,
          );
      }
    } else if (fn === ops.setStrokeRGBColor) {
      // PDF.js may use a Uint8ClampedArray here; its .map would coerce hex
      // strings back to numbers. Convert to a plain Array first.
      state.color =
        "#" +
        Array.from(args)
          .slice(0, 3)
          .map((v) => Math.round(Number(v)).toString(16).padStart(2, "0"))
          .join("");
    } else if (fn === ops.setStrokeTransparent) state.color = "transparent";
    else if (fn === ops.constructPath) {
      const pathOps = args[0] as ArrayLike<number>;
      const coords = args[1] as ArrayLike<number>;
      if (!pathOps || !coords) continue;
      let j = 0;
      for (let k = 0; k < pathOps.length; k++) {
        pathOperationCount++;
        if (pathOperationCount >= 400000) {
          truncated = true;
          break;
        }
        const pathOp = pathOps[k];
        if (pathOp === ops.moveTo) {
          current = transformPoint(state.matrix, coords[j++], coords[j++]);
          start = current;
        } else if (pathOp === ops.lineTo) {
          const next = transformPoint(state.matrix, coords[j++], coords[j++]);
          if (current) addLine(current, next);
          current = next;
        } else if (pathOp === ops.rectangle) {
          const x = coords[j++],
            y = coords[j++],
            w = coords[j++],
            h = coords[j++];
          const corners = [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ].map((p) => transformPoint(state.matrix, p[0], p[1]));
          for (let c = 0; c < 4; c++) addLine(corners[c], corners[(c + 1) % 4]);
          current = corners[0];
          start = corners[0];
        } else if (pathOp === ops.closePath) close();
        else if (pathOp === ops.curveTo) {
          current = transformPoint(state.matrix, coords[j + 4], coords[j + 5]);
          j += 6;
        } else if (pathOp === ops.curveTo2 || pathOp === ops.curveTo3) {
          current = transformPoint(state.matrix, coords[j + 2], coords[j + 3]);
          j += 4;
        }
      }
    } else if (fn === ops.closePath) close();
    else if (
      fn === ops.stroke ||
      fn === ops.fillStroke ||
      fn === ops.eoFillStroke
    )
      commit(false);
    else if (
      fn === ops.closeStroke ||
      fn === ops.closeFillStroke ||
      fn === ops.closeEOFillStroke
    )
      commit(true);
    else if (fn === ops.endPath || fn === ops.fill || fn === ops.eoFill)
      clear();
  }
  return {
    lines: lines.filter((line) => line.color !== "transparent"),
    truncated,
  };
}

export function validateCalibration(
  width: number,
  height: number,
  calibration: PdfCalibration,
) {
  const { p1, p2, distanceMm } = calibration;
  if (
    ![width, height, p1?.x, p1?.y, p2?.x, p2?.y, distanceMm].every(
      Number.isFinite,
    )
  ) {
    throw new Error("유효한 기준점 2개와 실제 길이(mm)를 입력하세요.");
  }
  const pixels = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (pixels < 8 || distanceMm < 10 || distanceMm > 1000000) {
    throw new Error(
      "기준점은 8px 이상 떨어져야 하며 실제 길이는 10–1,000,000mm여야 합니다.",
    );
  }
  if ([p1, p2].some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) {
    throw new Error("기준점은 도면 이미지 안에 있어야 합니다.");
  }
  const crop = calibration.crop || { x: 0, y: 0, width, height };
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.width < 8 ||
    crop.height < 8 ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.x + crop.width > width + 0.5 ||
    crop.y + crop.height > height + 0.5
  ) {
    throw new Error(
      "작업 영역은 도면 이미지 내부의 유효한 사각형이어야 합니다.",
    );
  }
  const mmPerPixel = distanceMm / pixels;
  if (Math.max(crop.width, crop.height) * mmPerPixel > 2000000) {
    throw new Error(
      "보정된 도면이 2km를 초과합니다. 기준 치수와 점을 확인하세요.",
    );
  }
  return {
    crop,
    mmPerPixel,
    width: crop.width * mmPerPixel,
    depth: crop.height * mmPerPixel,
  };
}

function clipLine(line: PdfLine, crop: PdfCrop): PdfLine | null {
  const dx = line.x2 - line.x1,
    dy = line.y2 - line.y1;
  let t0 = 0,
    t1 = 1;
  for (const [p, q] of [
    [-dx, line.x1 - crop.x],
    [dx, crop.x + crop.width - line.x1],
    [-dy, line.y1 - crop.y],
    [dy, crop.y + crop.height - line.y1],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return {
    ...line,
    x1: line.x1 + t0 * dx,
    y1: line.y1 + t0 * dy,
    x2: line.x1 + t1 * dx,
    y2: line.y1 + t1 * dy,
  };
}

/** Heuristic draft only: long, nearly parallel stroked pairs, never wall certainty. */
export function findWallCandidates(
  lines: PdfLine[],
  texts: PdfText[],
  crop: PdfCrop,
  mmPerPixel: number,
): WallCandidate[] {
  const filtered = lines
    .filter((line) => !line.dashed && line.color !== "#ffffff")
    .map((line) => clipLine(line, crop))
    .filter((line): line is PdfLine => Boolean(line))
    .filter(
      (line) =>
        Math.hypot(line.x2 - line.x1, line.y2 - line.y1) * mmPerPixel >= 1200,
    )
    .filter(
      (line) =>
        !texts.some((text) => {
          if (!text.text.trim()) return false;
          return (
            clipLine(line, {
              x: text.x - 1,
              y: text.y - 1,
              width: text.width + 2,
              height: text.height + 2,
            }) !== null
          );
        }),
    )
    .sort(
      (a, b) =>
        Math.hypot(b.x2 - b.x1, b.y2 - b.y1) -
        Math.hypot(a.x2 - a.x1, a.y2 - a.y1),
    )
    .slice(0, 1200);
  const candidates: WallCandidate[] = [];
  const used = new Set<number>();
  for (let i = 0; i < filtered.length && candidates.length < 80; i++) {
    if (used.has(i)) continue;
    const a = filtered[i];
    const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    let ux = (a.x2 - a.x1) / length,
      uy = (a.y2 - a.y1) / length;
    let origin = { x: a.x1, y: a.y1 };
    if (ux < -0.00001 || (Math.abs(ux) < 0.00001 && uy < 0)) {
      ux = -ux;
      uy = -uy;
      origin = { x: a.x2, y: a.y2 };
    }
    const nx = -uy,
      ny = ux;
    let best: {
      index: number;
      gap: number;
      signedGap: number;
      start: number;
      end: number;
    } | null = null;
    for (let j = i + 1; j < filtered.length; j++) {
      if (used.has(j)) continue;
      const b = filtered[j],
        bl = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
      const parallel = Math.abs(
        ((b.x2 - b.x1) / bl) * ux + ((b.y2 - b.y1) / bl) * uy,
      );
      if (parallel < Math.cos(Math.PI / 180)) continue;
      const d1 = (b.x1 - origin.x) * nx + (b.y1 - origin.y) * ny;
      const d2 = (b.x2 - origin.x) * nx + (b.y2 - origin.y) * ny;
      const signedGap = (d1 + d2) / 2,
        gap = Math.abs(signedGap);
      if (
        gap * mmPerPixel < 60 ||
        gap * mmPerPixel > 500 ||
        Math.abs(d1 - d2) * mmPerPixel > 30
      )
        continue;
      const t1 = (b.x1 - origin.x) * ux + (b.y1 - origin.y) * uy;
      const t2 = (b.x2 - origin.x) * ux + (b.y2 - origin.y) * uy;
      const start = Math.max(0, Math.min(t1, t2)),
        end = Math.min(length, Math.max(t1, t2));
      if (
        (end - start) * mmPerPixel < 1200 ||
        end - start < Math.min(length, bl) * 0.7
      )
        continue;
      if (!best || gap < best.gap)
        best = { index: j, gap, signedGap, start, end };
    }
    if (!best) continue;
    const centerX =
      origin.x + (ux * (best.start + best.end)) / 2 + (nx * best.signedGap) / 2;
    const centerY =
      origin.y + (uy * (best.start + best.end)) / 2 + (ny * best.signedGap) / 2;
    const width = (best.end - best.start) * mmPerPixel,
      depth = best.gap * mmPerPixel;
    const candidate = {
      x: (centerX - crop.x) * mmPerPixel - width / 2,
      y: (centerY - crop.y) * mmPerPixel - depth / 2,
      width,
      depth,
      rotation: (Math.atan2(uy, ux) * 180) / Math.PI,
    };
    if (
      !candidates.some(
        (c) =>
          Math.hypot(
            c.x + c.width / 2 - (candidate.x + candidate.width / 2),
            c.y + c.depth / 2 - (candidate.y + candidate.depth / 2),
          ) < 40 && Math.abs(c.width - width) < 80,
      )
    ) {
      candidates.push(candidate);
    }
    used.add(i);
    used.add(best.index);
  }
  return candidates;
}
