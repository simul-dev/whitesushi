import { useEffect, useState } from "react";
import { X, RotateCcw, ArrowRight } from "lucide-react";
import { calibratePage, type PdfAnalysis, type PdfSession } from "./pdfImport";
import { DEFAULT_SETTINGS, type FloorPlan, type Point } from "./types";
export default function ImportDialog({
  session,
  onClose,
  onImport,
}: {
  session: PdfSession;
  onClose: () => void;
  onImport: (plan: FloorPlan) => void;
}) {
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null),
    [page, setPage] = useState(1),
    [points, setPoints] = useState<Point[]>([]),
    [distance, setDistance] = useState(8800),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setAnalysis(null);
    setError("");
    setPoints([]);
    session
      .renderPage(page)
      .then((a) => {
        if (active) setAnalysis(a);
      })
      .catch((e) => {
        if (active) setError(String(e.message || e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, page]);
  const crop =
    points.length >= 2
      ? {
          x: Math.min(points[0].x, points[1].x),
          y: Math.min(points[0].y, points[1].y),
          width: Math.abs(points[0].x - points[1].x),
          height: Math.abs(points[0].y - points[1].y),
        }
      : null;
  function generate() {
    try {
      if (!analysis || !crop || points.length !== 4) return;
      const plan = calibratePage(
        analysis,
        { crop, p1: points[2], p2: points[3], distanceMm: distance },
        DEFAULT_SETTINGS,
      );
      onImport(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="PDF 축척 보정"
      >
        <header>
          <div>
            <span className="eyebrow">IMPORT / CALIBRATE</span>
            <h2>도면 영역과 기준 치수 지정</h2>
          </div>
          <button onClick={onClose} aria-label="가져오기 닫기">
            <X size={20} />
          </button>
        </header>
        <div className="import-content">
          <div className="calibration-image">
            {loading ? (
              <div className="loading">PDF 페이지를 렌더링하는 중…</div>
            ) : (
              analysis && (
                <svg
                  viewBox={`0 0 ${analysis.width} ${analysis.height}`}
                  aria-label="PDF 보정 캔버스"
                  onClick={(e) => {
                    if (points.length >= 4) return;
                    const m = e.currentTarget.getScreenCTM();
                    if (!m) return;
                    const p = new DOMPoint(
                      e.clientX,
                      e.clientY,
                    ).matrixTransform(m.inverse());
                    setPoints([...points, { x: p.x, y: p.y }]);
                  }}
                >
                  <image
                    href={analysis.imageUrl}
                    width={analysis.width}
                    height={analysis.height}
                  />
                  {crop && (
                    <rect
                      x={crop.x}
                      y={crop.y}
                      width={crop.width}
                      height={crop.height}
                      fill="#14a68d"
                      fillOpacity=".08"
                      stroke="#008674"
                      strokeWidth="3"
                    />
                  )}
                  {points.length === 4 && (
                    <line
                      x1={points[2].x}
                      y1={points[2].y}
                      x2={points[3].x}
                      y2={points[3].y}
                      stroke="#dc7947"
                      strokeWidth="3"
                    />
                  )}
                  {points.map((p, i) => (
                    <g key={i}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="6"
                        fill={i < 2 ? "#008674" : "#dc7947"}
                      />
                      <text
                        x={p.x + 10}
                        y={p.y - 10}
                        fontSize="20"
                        fill="#192e32"
                        fontWeight="700"
                      >
                        {i + 1}
                      </text>
                    </g>
                  ))}
                </svg>
              )
            )}
          </div>
          <aside>
            <label className="field">
              페이지
              <select
                aria-label="PDF 페이지"
                value={page}
                onChange={(e) => setPage(+e.target.value)}
              >
                {Array.from({ length: session.pageCount }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} / {session.pageCount}
                  </option>
                ))}
              </select>
            </label>
            <div
              className={`wizard-step ${points.length < 2 ? "current" : ""}`}
            >
              <b>01 · 도면 영역</b>
              <p>
                제목란과 치수선을 제외한 건물 영역의 왼쪽 위와 오른쪽 아래를
                클릭하세요.
              </p>
            </div>
            <div
              className={`wizard-step ${points.length >= 2 && points.length < 4 ? "current" : ""}`}
            >
              <b>02 · 기준 길이</b>
              <p>
                치수를 알고 있는 선분의 양 끝점을 클릭하세요. 치수선 위의 두
                점도 가능합니다.
              </p>
            </div>
            <label className="field">
              두 기준점의 실제 거리 (mm)
              <input
                aria-label="기준 거리 mm"
                type="number"
                min="1"
                value={distance}
                onChange={(e) => setDistance(+e.target.value)}
              />
            </label>
            <button className="text-button" onClick={() => setPoints([])}>
              <RotateCcw size={14} /> 점 다시 지정 ({points.length}/4)
            </button>
            <p className="hint">
              긴 평행선으로부터 벽 후보만 추출합니다. 문·공간·가구는 직접
              추가하세요. 이미지형 도면은 원본 위에서 수동 작성할 수 있습니다.
            </p>
            {analysis && (
              <p className="meta">
                벡터 선 {analysis.lines.length.toLocaleString()}개 · 텍스트{" "}
                {analysis.texts.length.toLocaleString()}개
              </p>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button
              className="primary"
              disabled={loading || points.length !== 4 || distance <= 0}
              onClick={generate}
            >
              초안 생성 <ArrowRight size={16} />
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}
