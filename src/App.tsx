import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Upload,
  Download,
  Box,
  Layers,
  FileJson,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RotateCw,
  Undo2,
  Redo2,
  SlidersHorizontal,
  ArrowUpRight,
  X,
  Ruler,
  Grid2X2,
  PackageOpen,
  Search,
  FileText,
  Settings2,
} from "lucide-react";
import sampleData from "../floorplan.json";
import {
  allEntities,
  CATEGORIES,
  CATEGORY_LABELS,
  VIEWS,
  confidenceColor,
  type Category,
  type Entity,
  type FloorPlan,
  type ViewPreset,
} from "./types";
import {
  download,
  newEntity,
  patchEntity,
  TYPE_LABELS,
  validatePlan,
} from "./model";
import PlanEditor from "./PlanEditor";
import ImportDialog from "./ImportDialog";
import { openPdf, type PdfSession } from "./pdfImport";
import { publicAsset, resolveOverlayUrl } from "./assets";
const Preview3D = lazy(() => import("./Preview3D"));
const sample = validatePlan(sampleData);
export default function App() {
  const [plan, setPlan] = useState<FloorPlan>(() => structuredClone(sample)),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [mode, setMode] = useState<"2d" | "3d">("2d"),
    [view, setView] = useState<ViewPreset>("Perspective");
  const [grid, setGrid] = useState(true),
    [labels, setLabels] = useState(true),
    [opacity, setOpacity] = useState(0.32),
    [visible, setVisible] = useState<Record<string, boolean>>({
      walls: true,
      doors: true,
      windows: true,
      zones: true,
      objects: true,
    });
  const [search, setSearch] = useState(""),
    [onlyReview, setOnlyReview] = useState(false),
    [settings, setSettings] = useState(false),
    [addType, setAddType] = useState("table"),
    [reviewDialog, setReviewDialog] = useState(false),
    [ack, setAck] = useState(false),
    [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [session, setSession] = useState<PdfSession | null>(null),
    [exportOpen, setExportOpen] = useState(false),
    [wallOpacity, setWallOpacity] = useState(1);
  const undo = useRef<FloorPlan[]>([]),
    redo = useRef<FloorPlan[]>([]),
    pdfInput = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLInputElement>(null),
    [historyVersion, setHistoryVersion] = useState(0);
  const entries = allEntities(plan),
    selected = entries.find((x) => x.entity.id === selectedId),
    needsReview = entries.filter(
      (x) => !x.entity.reviewed && x.entity.confidence < 0.85,
    ).length;
  function checkpoint() {
    undo.current.push(structuredClone(plan));
    if (undo.current.length > 60) undo.current.shift();
    redo.current = [];
    setHistoryVersion((v) => v + 1);
  }
  function commit(next: FloorPlan, history = true) {
    if (history) checkpoint();
    setPlan(next);
    setApproved(false);
  }
  function edit(id: string, patch: Partial<Entity>, history = true) {
    commit(patchEntity(plan, id, patch), history);
  }
  function undoEdit() {
    const p = undo.current.pop();
    if (p) {
      redo.current.push(plan);
      setPlan(p);
      setApproved(false);
      setHistoryVersion((v) => v + 1);
    }
  }
  function redoEdit() {
    const p = redo.current.pop();
    if (p) {
      undo.current.push(plan);
      setPlan(p);
      setApproved(false);
      setHistoryVersion((v) => v + 1);
    }
  }
  function remove() {
    if (!selectedId) return;
    commit({
      ...plan,
      ...Object.fromEntries(
        CATEGORIES.map((c) => [c, plan[c].filter((e) => e.id !== selectedId)]),
      ),
    });
    setSelectedId(null);
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest("input,textarea,select") ||
        session ||
        reviewDialog
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redoEdit() : undoEdit();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 100 : 10;
        edit(selectedId!, {
          x:
            selected.entity.x +
            (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
          y:
            selected.entity.y +
            (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
        });
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  });
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  function replace(next: FloorPlan) {
    commit(validatePlan(next));
    setSelectedId(null);
    setMode("2d");
    setError("");
    setNotice("도면을 불러왔습니다. 치수와 추출 결과를 검토하세요.");
  }
  async function uploadPdf(file: File) {
    setBusy("PDF 분석 중");
    setError("");
    try {
      if (file.size > 30 * 1024 * 1024)
        throw new Error("PDF는 30MB 이하로 업로드하세요.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (sha === sample.sourceSha256) {
        const pdf = await openPdf(bytes, file.name);
        try {
          const page = await pdf.renderPage(1);
          replace({
            ...structuredClone(sample),
            overlay: { ...sample.overlay!, url: page.imageUrl },
          });
        } finally {
          await pdf.destroy();
        }
      } else {
        setSession(await openPdf(bytes, file.name));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function uploadJson(file: File) {
    setError("");
    try {
      if (file.size > 30 * 1024 * 1024)
        throw new Error("JSON은 30MB 이하로 업로드하세요.");
      replace(validatePlan(JSON.parse(await file.text())));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function add() {
    const e = newEntity(addType, plan);
    const category: Category =
      addType === "wall"
        ? "walls"
        : addType.includes("door")
          ? "doors"
          : addType === "window"
            ? "windows"
            : addType === "zone"
              ? "zones"
              : "objects";
    commit({ ...plan, [category]: [...plan[category], e] });
    setSelectedId(e.id);
    setSettings(false);
  }
  async function exportFile(kind: "json" | "glb" | "gltf" | "png" | "zip") {
    setError("");
    setBusy("내보내기 준비 중");
    try {
      if (kind === "json") {
        const out = structuredClone(plan);
        if (out.overlay?.url.startsWith("/")) {
          const response = await fetch(resolveOverlayUrl(out.overlay.url));
          if (!response.ok) throw new Error("원본 이미지를 불러오지 못했습니다. 다시 시도하세요.");
          const blob = await response.blob();
          out.overlay.url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        download(
          new Blob(
            [
              JSON.stringify(
                {
                  ...out,
                  review: {
                    acknowledged: approved,
                    unreviewed: needsReview,
                    exportedAt: new Date().toISOString(),
                  },
                },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
          "floorplan.json",
        );
      } else {
        if (!approved)
          throw new Error("먼저 도면과 가정을 검토하고 3D 생성을 완료하세요.");
        const m = await import("./exports");
        if (kind === "glb" || kind === "gltf")
          download(await m.exportModel(plan, kind), `floorplan.${kind}`);
        else if (kind === "png")
          download(
            await m.exportPng(plan, view, {
              width: 1600,
              height: 1200,
              grid: false,
            }),
            `${view.toLowerCase()}.png`,
          );
        else download(await m.exportViewZip(plan), "floorplan-views.zip");
      }
      setNotice("파일을 내보냈습니다. 브라우저 다운로드를 확인하세요.");
      setExportOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  function generate() {
    setAck(false);
    setReviewDialog(true);
  }
  return (
    <div className="app" data-history-version={historyVersion}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Layers size={22} />
          </div>
          <div>
            <strong>
              Floor Plan <span>to</span> 3D
            </strong>
            <small>REVIEW WORKSPACE</small>
          </div>
        </div>
        <div className="project-heading">
          <span className="project-dot" />
          <span>{plan.name}</span>
          <span className="version-pill">MVP · 01</span>
        </div>
        <button
          className="upload-button"
          onClick={() => pdfInput.current?.click()}
          disabled={!!busy}
        >
          <Upload size={16} /> PDF 업로드
        </button>
        <input
          ref={pdfInput}
          type="file"
          accept=".pdf,application/pdf"
          aria-label="PDF 파일 업로드"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadPdf(f);
            e.target.value = "";
          }}
        />
        <input
          ref={jsonInput}
          type="file"
          accept=".json,application/json"
          aria-label="FloorPlan JSON 파일 업로드"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadJson(f);
            e.target.value = "";
          }}
        />
      </header>
      <div className="workflow-bar">
        <div className="workflow-steps">
          <span className="done">
            <Check size={13} /> 01 도면 불러오기
          </span>
          <ChevronRight />
          <span className={mode === "2d" ? "current" : "done"}>
            02 구조 검토
          </span>
          <ChevronRight />
          <span className={mode === "3d" ? "current" : ""}>
            03 3D 검토 · 내보내기
          </span>
        </div>
        <span className="local-badge">
          <span /> 브라우저 내부 처리
        </span>
      </div>
      <div className="workspace">
        <aside className="left-sidebar">
          <div className="sidebar-top">
            <span className="eyebrow">PROJECT</span>
            <h2>{String(plan.sourceFile || plan.name).replace(".pdf", "")}</h2>
            <div className="plan-stats">
              <span>
                <b>{(plan.bounds.width / 1000).toFixed(2)}</b> m 폭
              </span>
              <span>
                <b>{(plan.bounds.depth / 1000).toFixed(2)}</b> m 깊이
              </span>
            </div>
          </div>
          <div className="source-card">
            <FileText size={19} />
            <div>
              <b>원본 도면</b>
              <small>
                {plan.overlay
                  ? `PDF · ${plan.overlay.page} 페이지`
                  : "원본 이미지 없음"}
              </small>
            </div>
            {plan.sourceSha256 === sample.sourceSha256 && (
              <a
                href={publicAsset("sample.pdf")}
                target="_blank"
                rel="noreferrer"
                aria-label="원본 PDF 열기"
              >
                <ArrowUpRight size={16} />
              </a>
            )}
          </div>
          {plan.metadata?.importMethod === "pdfjs-vector-review" && (
            <p className="import-note">
              ?? ?? ? ? ?? ??
              <br />
              ???????? ?? ?????.
            </p>
          )}
          <div className="overlay-control">
            <label htmlFor="opacity">
              원본 겹쳐 보기 <span>{Math.round(opacity * 100)}%</span>
            </label>
            <input
              id="opacity"
              aria-label="PDF 오버레이 투명도"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={opacity}
              onChange={(e) => setOpacity(+e.target.value)}
            />
          </div>
          <div className="section-heading">
            <h3>도면 요소</h3>
            <span>{entries.length}</span>
          </div>
          <div className="layer-list">
            {CATEGORIES.map((c) => (
              <div key={c}>
                <button
                  className="layer-toggle"
                  onClick={() => setVisible({ ...visible, [c]: !visible[c] })}
                  aria-label={`${CATEGORY_LABELS[c]} 표시 전환`}
                >
                  {visible[c] ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <span>{CATEGORY_LABELS[c]}</span>
                <b>{plan[c].length}</b>
              </div>
            ))}
          </div>
          <div className="element-search">
            <Search size={14} />
            <input
              aria-label="요소 검색"
              placeholder="이름으로 요소 찾기"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="review-filter">
            <input
              type="checkbox"
              checked={onlyReview}
              onChange={(e) => setOnlyReview(e.target.checked)}
            />{" "}
            검토 필요만 보기 <span>{needsReview}</span>
          </label>
          <div className="object-list">
            {entries
              .filter(
                ({ entity: e }) =>
                  (!search ||
                    e.name.toLowerCase().includes(search.toLowerCase()) ||
                    e.type.toLowerCase().includes(search.toLowerCase())) &&
                  (!onlyReview || (!e.reviewed && e.confidence < 0.85)),
              )
              .map(({ entity: e }) => (
                <button
                  key={e.id}
                  className={e.id === selectedId ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(e.id);
                    setSettings(false);
                  }}
                >
                  <span
                    className="confidence-dot"
                    style={{ background: confidenceColor(e) }}
                  />
                  <span>{e.name}</span>
                  <small>
                    {e.reviewed ? (
                      <Check size={12} />
                    ) : (
                      Math.round(e.confidence * 100) + "%"
                    )}
                  </small>
                </button>
              ))}
          </div>
          <div className="add-element">
            <select
              aria-label="추가할 요소"
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button aria-label="요소 추가" onClick={add}>
              <Plus size={17} />
            </button>
          </div>
          <button
            className="sidebar-action"
            onClick={() => jsonInput.current?.click()}
          >
            <FileJson size={15} /> JSON 불러오기
          </button>
          <button
            className="sidebar-action"
            onClick={() => replace(structuredClone(sample))}
          >
            <RotateCw size={15} /> 기준 도면 다시 불러오기
          </button>
        </aside>
        <main className="main-surface">
          <div className="viewport-toolbar">
            <div className="view-tabs">
              <button
                className={mode === "2d" ? "active" : ""}
                onClick={() => setMode("2d")}
              >
                <Layers size={16} /> 2D Plan
              </button>
              <button
                className={mode === "3d" ? "active" : ""}
                onClick={() => setMode("3d")}
              >
                <Box size={16} /> 3D Preview
              </button>
            </div>
            <div className="toolbar-actions">
              <button
                aria-label="실행 취소"
                title="실행 취소 (Ctrl+Z)"
                disabled={!undo.current.length}
                onClick={undoEdit}
              >
                <Undo2 size={16} />
              </button>
              <button
                aria-label="다시 실행"
                title="다시 실행 (Ctrl+Shift+Z)"
                disabled={!redo.current.length}
                onClick={redoEdit}
              >
                <Redo2 size={16} />
              </button>
              <span />
              <button
                aria-label="그리드 표시 전환"
                title="그리드"
                className={grid ? "active" : ""}
                onClick={() => setGrid(!grid)}
              >
                <Grid2X2 size={16} />
              </button>
              <button
                aria-label="이름 표시 전환"
                title="이름 표시"
                className={labels ? "active" : ""}
                onClick={() => setLabels(!labels)}
              >
                <Ruler size={16} />
              </button>
            </div>
          </div>
          <div className="review-banner">
            <AlertCircle size={15} />
            <span>
              {approved
                ? "검토를 확인한 모델입니다. 변경 시 다시 생성하세요."
                : `${needsReview}개 요소 검토 필요 · 높이와 재질은 가정값입니다.`}
            </span>
            <button
              onClick={() => {
                setSettings(true);
                setSelectedId(null);
              }}
            >
              가정값 확인 <ChevronRight size={13} />
            </button>
          </div>
          <div className="viewport">
            {mode === "2d" ? (
              <PlanEditor
                plan={plan}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={edit}
                onDragStart={checkpoint}
                grid={grid}
                overlayOpacity={opacity}
                labels={labels}
                visible={visible}
              />
            ) : (
              <Suspense
                fallback={<div className="loading">3D 모듈 불러오는 중…</div>}
              >
                <Preview3D
                  plan={plan}
                  view={view}
                  grid={grid}
                  selectedId={selectedId || undefined}
                  onSelect={(id) => setSelectedId(id)}
                  onError={setError}
                  wallOpacity={wallOpacity}
                />
              </Suspense>
            )}
            {busy && (
              <div className="busy-overlay">
                <div className="spinner" />
                {busy}
              </div>
            )}
            {mode === "3d" && !approved && (
              <div className="draft-chip">DRAFT · 검토 전 미리보기</div>
            )}
          </div>
          <div className="viewport-footer">
            {mode === "3d" ? (
              <>
                <div className="camera-presets">
                  {VIEWS.map((v) => (
                    <button
                      key={v}
                      className={view === v ? "active" : ""}
                      onClick={() => setView(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <label className="wall-opacity">
                  벽 투명도
                  <input
                    type="range"
                    min=".15"
                    max="1"
                    step=".05"
                    value={wallOpacity}
                    onChange={(e) => setWallOpacity(+e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <span>드래그 이동 · 휠 확대 · Alt+드래그 화면 이동</span>
                <span>스냅 50 mm</span>
              </>
            )}
          </div>
        </main>
        <aside className="properties">
          <div className="properties-heading">
            <h3>{settings ? "모델 기본값" : "속성"}</h3>
            <button
              aria-label="모델 기본값"
              className={settings ? "active" : ""}
              onClick={() => setSettings(!settings)}
            >
              <Settings2 size={17} />
            </button>
          </div>
          <div className="properties-content">
            {settings ? (
              <>
                <div className="property-intro">
                  <SlidersHorizontal size={22} />
                  <h2>도면 밖의 정보</h2>
                  <p>
                    높이·재질·조명은 확인된 도면 정보가 아닙니다. 프로젝트에
                    맞게 조정하세요.
                  </p>
                </div>
                {(
                  [
                    ["wallHeight", "벽 높이"],
                    ["ceilingHeight", "천장 높이"],
                    ["wallThickness", "새 벽 두께"],
                    ["doorHeight", "문 높이"],
                    ["furnitureHeight", "새 테이블 높이"],
                  ] as const
                ).map(([key, label]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={plan.settings[key]}
                    onChange={(v) =>
                      commit({
                        ...plan,
                        settings: { ...plan.settings, [key]: v },
                      })
                    }
                    min={1}
                  />
                ))}
                <label className="field">
                  기본 재질
                  <select
                    aria-label="기본 재질"
                    value={plan.settings.material}
                    onChange={(e) =>
                      commit({
                        ...plan,
                        settings: {
                          ...plan.settings,
                          material: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="warm-neutral">밝은 목재 · 중성 벽</option>
                    <option value="neutral">중성 회색</option>
                    <option value="white">백색 모형</option>
                  </select>
                </label>
                <NumberField
                  label="조명 강도"
                  value={plan.settings.lighting}
                  min={0.1}
                  max={5}
                  step={0.1}
                  unit="×"
                  onChange={(v) =>
                    commit({
                      ...plan,
                      settings: { ...plan.settings, lighting: v },
                    })
                  }
                />
                <button
                  className="secondary full"
                  onClick={() => {
                    commit({
                      ...plan,
                      walls: plan.walls.map((e) => ({
                        ...e,
                        height: plan.settings.wallHeight,
                        reviewed: false,
                      })),
                      doors: plan.doors.map((e) => ({
                        ...e,
                        height: plan.settings.doorHeight,
                        reviewed: false,
                      })),
                    });
                    setNotice("모든 벽과 문에 기본 높이를 적용했습니다.");
                  }}
                >
                  벽·문에 기본 높이 적용
                </button>
                <p className="hint">
                  천장은 내부 검토를 위해 표시하지 않습니다. 개별 요소의 높이와
                  치수는 선택 후 수정할 수 있습니다. 새 벽 두께는 기존 도면의
                  치수를 덮어쓰지 않습니다.
                </p>
                <details className="outline-editor">
                  <summary>
                    바닥 외곽 편집 <span>mm</span>
                  </summary>
                  <p className="hint">
                    벽 위치와 바닥 외곽은 별도입니다. 순서대로 이어지는 꼭짓점을
                    수정하세요.
                  </p>
                  {(
                    plan.floorOutline || [
                      { x: 0, y: 0 },
                      { x: plan.bounds.width, y: 0 },
                      { x: plan.bounds.width, y: plan.bounds.depth },
                      { x: 0, y: plan.bounds.depth },
                    ]
                  ).map((point, i, points) => (
                    <div className="outline-point" key={i}>
                      <span>{i + 1}</span>
                      <NumberField
                        label={`꼭짓점 ${i + 1} X`}
                        value={point.x}
                        onChange={(v) =>
                          commit({
                            ...plan,
                            floorOutline: points.map((p, j) =>
                              i === j ? { ...p, x: v } : p,
                            ),
                          })
                        }
                      />
                      <NumberField
                        label={`꼭짓점 ${i + 1} Y`}
                        value={point.y}
                        onChange={(v) =>
                          commit({
                            ...plan,
                            floorOutline: points.map((p, j) =>
                              i === j ? { ...p, y: v } : p,
                            ),
                          })
                        }
                      />
                      <button
                        aria-label={`꼭짓점 ${i + 1} 삭제`}
                        disabled={points.length <= 3}
                        onClick={() =>
                          commit({
                            ...plan,
                            floorOutline: points.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="secondary full"
                    onClick={() => {
                      const pts = plan.floorOutline || [
                        { x: 0, y: 0 },
                        { x: plan.bounds.width, y: 0 },
                        { x: plan.bounds.width, y: plan.bounds.depth },
                        { x: 0, y: plan.bounds.depth },
                      ];
                      const a = pts[pts.length - 1],
                        b = pts[0];
                      commit({
                        ...plan,
                        floorOutline: [
                          ...pts,
                          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                        ],
                      });
                    }}
                  >
                    <Plus size={13} /> 마지막 변에 꼭짓점 추가
                  </button>
                </details>
                <a
                  className="doc-link"
                  href={publicAsset("assumptions.md")}
                  target="_blank"
                  rel="noreferrer"
                >
                  전체 가정 및 한계 <ArrowUpRight size={13} />
                </a>
              </>
            ) : selected ? (
              <>
                <div className="selected-label">
                  <span className="eyebrow">
                    {CATEGORY_LABELS[selected.category]}
                  </span>
                  <span
                    className="confidence-pill"
                    style={{ color: confidenceColor(selected.entity) }}
                  >
                    {selected.entity.reviewed
                      ? "검토 완료"
                      : `${Math.round(selected.entity.confidence * 100)}% 신뢰도`}
                  </span>
                </div>
                <label className="field">
                  이름
                  <input
                    aria-label="요소 이름"
                    value={selected.entity.name}
                    onChange={(e) =>
                      edit(selectedId!, { name: e.target.value })
                    }
                  />
                </label>
                <div className="property-section">
                  <h4>
                    위치 <span>mm</span>
                  </h4>
                  <div className="field-grid">
                    <NumberField
                      label="X"
                      value={selected.entity.x}
                      onChange={(v) => edit(selectedId!, { x: v })}
                    />
                    <NumberField
                      label="Y"
                      value={selected.entity.y}
                      onChange={(v) => edit(selectedId!, { y: v })}
                    />
                  </div>
                  <NumberField
                    label="Z · 바닥 기준"
                    value={selected.entity.z}
                    onChange={(v) => edit(selectedId!, { z: v })}
                  />
                </div>
                <div className="property-section">
                  <h4>
                    치수 <span>mm</span>
                  </h4>
                  <div className="field-grid">
                    <NumberField
                      label="너비"
                      value={selected.entity.width}
                      min={1}
                      onChange={(v) => edit(selectedId!, { width: v })}
                    />
                    <NumberField
                      label="깊이"
                      value={selected.entity.depth}
                      min={1}
                      onChange={(v) => edit(selectedId!, { depth: v })}
                    />
                  </div>
                  <NumberField
                    label="높이 · 가정값"
                    value={selected.entity.height}
                    min={1}
                    onChange={(v) => edit(selectedId!, { height: v })}
                  />
                </div>
                <div className="rotation-field">
                  <NumberField
                    label="회전"
                    value={selected.entity.rotation}
                    unit="°"
                    onChange={(v) => edit(selectedId!, { rotation: v })}
                  />
                  <button
                    title="90도 회전"
                    aria-label="90도 회전"
                    onClick={() =>
                      edit(selectedId!, {
                        rotation: (selected.entity.rotation + 90) % 360,
                      })
                    }
                  >
                    <RotateCw size={16} />
                  </button>
                </div>
                {(selected.category === "doors" ||
                  selected.category === "windows") && (
                  <label className="field">
                    연결 벽
                    <select
                      aria-label="연결 벽"
                      value={String(selected.entity.wallId || "")}
                      onChange={(e) =>
                        edit(selectedId!, {
                          wallId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">겹치는 벽 자동 탐색</option>
                      {plan.walls.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  요소 색상
                  <input
                    type="color"
                    aria-label="요소 색상"
                    value={selected.entity.color || "#d6c1a5"}
                    onChange={(e) =>
                      edit(selectedId!, { color: e.target.value })
                    }
                  />
                </label>
                <div className="provenance">
                  <b>
                    출처 ·{" "}
                    {selected.entity.source === "floorplan"
                      ? "원본 도면"
                      : selected.entity.source === "manual"
                        ? "수동 작성"
                        : selected.entity.source}
                  </b>
                  <p>
                    {Array.isArray(selected.entity.notes)
                      ? selected.entity.notes.join(" ")
                      : String(
                          selected.entity.notes ||
                            "위치와 치수를 원본 위에서 검토하세요. 높이는 별도 확인이 필요합니다.",
                        )}
                  </p>
                </div>
                <button
                  className={`secondary full ${selected.entity.reviewed ? "reviewed" : ""}`}
                  onClick={() =>
                    edit(selectedId!, { reviewed: !selected.entity.reviewed })
                  }
                >
                  <CheckCircle2 size={16} />
                  {selected.entity.reviewed
                    ? "검토 완료 · 취소"
                    : "이 요소 검토 완료"}
                </button>
                <button className="danger text-button" onClick={remove}>
                  <Trash2 size={14} /> 요소 삭제
                </button>
              </>
            ) : (
              <>
                <div className="empty-properties">
                  <div>
                    <MouseIcon />
                  </div>
                  <h2>요소를 선택하세요</h2>
                  <p>
                    도면 또는 왼쪽 목록에서 벽, 가구, 공간을 선택해 위치와
                    치수를 수정합니다.
                  </p>
                </div>
                <div className="review-summary">
                  <span className="eyebrow">REVIEW STATUS</span>
                  <h2>
                    {entries.filter((x) => x.entity.reviewed).length}
                    <small> / {entries.length} 검토 완료</small>
                  </h2>
                  <div className="review-progress">
                    <i
                      style={{
                        width: `${(entries.filter((x) => x.entity.reviewed).length / Math.max(entries.length, 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <p>
                    신뢰도는 평면의 근거 수준입니다.
                    <br />
                    높이의 정확성을 보증하지 않습니다.
                  </p>
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: "#409777" }} />
                    높은 신뢰도 ≥ 85%
                  </span>
                  <span>
                    <i style={{ background: "#c58a25" }} />
                    검토 필요 ≥ 50%
                  </span>
                  <span>
                    <i style={{ background: "#d26058" }} />
                    미확인 · 수동 정의
                  </span>
                </div>
                <button
                  className="secondary full"
                  onClick={() => setSettings(true)}
                >
                  <SlidersHorizontal size={15} /> 높이 · 재질 기본값
                </button>
                <div className="hint-card">
                  <b>JSON이 모델의 기준입니다.</b>
                  <p>
                    수정한 구조로 3D를 생성합니다. PDF 이미지는 비교를 위한 참고
                    레이어입니다.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="generate-panel">
            <span>{approved ? "검토 확인됨" : "치수 확인 → 3D 생성"}</span>
            <button className="primary full" onClick={generate}>
              <Box size={17} />
              {approved ? "검토 후 다시 생성" : "검토 후 3D 생성"}
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>
      </div>
      <footer className="app-footer">
        <span>
          <span className="confidence-dot" style={{ background: "#438c76" }} />{" "}
          {plan.units.toUpperCase()} 좌표 · {entries.length}개 요소{" "}
          <span className="footer-divider">|</span>{" "}
          <span>
            {approved ? "검토 확인된 모델" : "편집 중 · JSON으로 저장하세요"}
          </span>
        </span>
        <div className="export-actions">
          <button onClick={() => void exportFile("json")} disabled={!!busy}>
            <FileJson size={15} /> JSON 저장
          </button>
          <button
            onClick={() => void exportFile("glb")}
            disabled={!!busy || !approved}
          >
            <PackageOpen size={15} /> Export GLB
          </button>
          <div className="export-menu-wrap">
            <button
              className="export-main"
              onClick={() => setExportOpen(!exportOpen)}
              disabled={!!busy}
            >
              <Download size={15} /> 내보내기 <ChevronRight size={14} />
            </button>
            {exportOpen && (
              <div className="export-menu">
                <button
                  disabled={!approved}
                  onClick={() => void exportFile("gltf")}
                >
                  GLTF 모델 (.gltf)
                </button>
                <button
                  disabled={!approved}
                  onClick={() => void exportFile("png")}
                >
                  {view} PNG
                </button>
                <button
                  disabled={!approved}
                  onClick={() => void exportFile("zip")}
                >
                  6개 뷰 PNG 묶음 (.zip)
                </button>
                <small>정투영 5개 + 원근 1개 · 1600×1200</small>
                {!approved && <small>검토 후 3D 생성이 필요합니다.</small>}
              </div>
            )}
          </div>
        </div>
      </footer>
      {error && (
        <div className="toast error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="오류 닫기">
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="알림 닫기">
            <X size={15} />
          </button>
        </div>
      )}
      {session && (
        <ImportDialog
          session={session}
          onClose={() => {
            void session.destroy();
            setSession(null);
          }}
          onImport={(p) => {
            replace(p);
            void session.destroy();
            setSession(null);
          }}
        />
      )}
      {reviewDialog && (
        <div className="modal-backdrop">
          <section
            className="review-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="3D 생성 전 검토"
          >
            <header>
              <div>
                <span className="eyebrow">HUMAN REVIEW</span>
                <h2>구조와 가정을 확인하세요</h2>
              </div>
              <button
                aria-label="검토 닫기"
                onClick={() => setReviewDialog(false)}
              >
                <X size={20} />
              </button>
            </header>
            <p>
              현재 JSON의 벽 {plan.walls.length}개, 문 {plan.doors.length}개,
              가구·설비 {plan.objects.length}개로 3D를 생성합니다.
            </p>
            <div className="review-callout">
              <AlertCircle size={19} />
              <div>
                <b>낮은 신뢰도 요소 {needsReview}개</b>
                <p>
                  벽 {plan.settings.wallHeight}mm · 문{" "}
                  {plan.settings.doorHeight}mm · 천장{" "}
                  {plan.settings.ceilingHeight}mm
                  <br />
                  높이·재질·조명은 가정값입니다. 정밀 시공 모델이 아닙니다.
                </p>
              </div>
            </div>
            <label className="acknowledge">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              원본과 구조를 확인했으며, 미확인 요소와 가정값을 이해했습니다.
            </label>
            <button
              className="primary full"
              disabled={!ack}
              onClick={() => {
                setApproved(true);
                setMode("3d");
                setView("Perspective");
                setReviewDialog(false);
              }}
            >
              <Box size={17} /> 현재 구조로 3D 생성
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function MouseIcon() {
  return <Layers size={30} />;
}
function NumberField({
  label,
  value,
  onChange,
  min = -1000000,
  max = 1000000,
  step = 1,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const save = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) {
      if (n !== value) onChange(n);
    } else setDraft(String(value));
  };
  return (
    <label className="field">
      {label}
      <div className="number-input">
        <input
          aria-label={label}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
