import { describe, expect, it } from "vitest";
import {
  extractVectorLines,
  findWallCandidates,
  validateCalibration,
} from "./pdfGeometry";
import type { PdfLine } from "./pdfGeometry";

describe("PDF coordinate extraction and calibration", () => {
  it("composes nested PDF form matrices with top-left viewport and ignores unpainted clipping paths", () => {
    const ops = {
      save: 10,
      restore: 11,
      transform: 12,
      moveTo: 13,
      lineTo: 14,
      curveTo: 15,
      curveTo2: 16,
      curveTo3: 17,
      closePath: 18,
      rectangle: 19,
      stroke: 20,
      fill: 22,
      endPath: 28,
      setStrokeRGBColor: 58,
      paintFormXObjectBegin: 74,
      paintFormXObjectEnd: 75,
      constructPath: 91,
    };
    const extracted = extractVectorLines(
      {
        fnArray: [58, 74, 91, 20, 75, 91, 28, 91, 20],
        argsArray: [
          new Uint8ClampedArray([25, 51, 255]) as unknown as unknown[],
          [[2, 0, 0, 2, 10, 20]],
          [
            [13, 14],
            [0, 0, 100, 0],
          ],
          [],
          [],
          [
            [13, 14],
            [1, 1, 5, 1],
          ],
          [],
          [
            [13, 14],
            [0, 0, 10, 0],
          ],
          [],
        ],
      },
      [1, 0, 0, -1, 0, 300],
      ops,
    );
    expect(extracted.lines).toHaveLength(2);
    expect(extracted.lines[0]).toMatchObject({
      x1: 10,
      y1: 280,
      x2: 210,
      y2: 280,
      strokeWidth: 2,
      color: "#1933ff",
    });
    expect(extracted.lines[1]).toMatchObject({
      x1: 0,
      y1: 300,
      x2: 10,
      y2: 300,
      strokeWidth: 1,
    });
  });

  it("calibrates by Euclidean reference length and yields only supported in-crop wall pairs", () => {
    const calibration = validateCalibration(900, 600, {
      p1: { x: 100, y: 100 },
      p2: { x: 400, y: 500 },
      distanceMm: 5000,
      crop: { x: 50, y: 50, width: 700, height: 500 },
    });
    expect(calibration.mmPerPixel).toBe(10);
    expect(calibration.width).toBe(7000);
    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      dashed = false,
    ): PdfLine => ({
      x1,
      y1,
      x2,
      y2,
      strokeWidth: 1,
      color: "#000000",
      dashed,
    });
    const walls = findWallCandidates(
      [
        line(100, 100, 600, 100),
        line(100, 110, 600, 110), // 100 mm wall
        line(100, 200, 600, 200, true),
        line(100, 210, 600, 210, true), // dimension strokes
        line(100, 300, 160, 300),
        line(100, 310, 160, 310), // short furniture symbol
        line(100, 600, 600, 600),
        line(100, 610, 600, 610), // outside chosen crop
      ],
      [],
      calibration.crop,
      calibration.mmPerPixel,
    );
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({
      x: 500,
      y: 500,
      width: 5000,
      depth: 100,
      rotation: 0,
    });
    expect(() =>
      validateCalibration(100, 100, {
        p1: { x: 10, y: 10 },
        p2: { x: 10, y: 10 },
        distanceMm: 1000,
      }),
    ).toThrow();
  });
});
