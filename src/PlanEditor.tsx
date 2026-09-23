import { useEffect, useRef, useState } from "react";
import {
  Expand,
  Hand,
  MousePointer2,
  Minus,
  Plus,
  Image as ImageIcon,
} from "lucide-react";
import {
  allEntities,
  confidenceColor,
  type Entity,
  type FloorPlan,
  type Point,
} from "./types";
import { getWallSegments } from "./wallGeometry";
import { resolveOverlayUrl } from "./assets";
interface Props {
  plan: FloorPlan;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Entity>, checkpoint?: boolean) => void;
  onDragStart: () => void;
  grid: boolean;
  overlayOpacity: number;
  labels: boolean;
  visible: Record<string, boolean>;
}
export default function PlanEditor({
  plan,
  selectedId,
  onSelect,
  onChange,
  onDragStart,
  grid,
  overlayOpacity,
  labels,
  visible,
}: Props) {
  const svg = useRef<SVGSVGElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 800 }),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [tool, setTool] = useState<"select" | "pan">("select"),
    [fullPage, setFullPage] = useState(false);
  const drag = useRef<{
    mode: "pan" | "object";
    start: Point;
    client: Point;
    pan: Point;
    entity?: Entity;
    moved: boolean;
  } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  useEffect(() => {
    const ob = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (container.current) ob.observe(container.current);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFullPage(false);
  }, [plan.name]);
  const target =
    fullPage && plan.overlay
      ? {
          x: plan.overlay.x,
          y: plan.overlay.y,
          width: plan.overlay.width,
          depth: plan.overlay.depth,
        }
      : {
          x: -500,
          y: -500,
          width: plan.bounds.width + 1000,
          depth: plan.bounds.depth + 1000,
        };
  const aspect = size.w / Math.max(size.h, 1),
    baseW = Math.max(target.width, target.depth * aspect) * 1.08,
    vw = baseW / zoom,
    vh = vw / aspect;
  const cx = target.x + target.width / 2 + pan.x,
    cy = target.y + target.depth / 2 + pan.y;
  const point = (clientX: number, clientY: number): Point => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const fit = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setFullPage(false);
  };
  const scaleLength =
    [10000, 5000, 2000, 1000, 500, 200, 100].find(
      (n) => (n / vw) * size.w <= 140,
    ) || 100;
  const selection = allEntities(plan).find(
    (x) => x.entity.id === selectedId,
  )?.entity;
  return (
    <div className="plan-editor" ref={container} data-testid="plan-editor">
      <div className="canvas-tools">
        <button
          className={tool === "select" ? "active" : ""}
          title="선택 및 이동"
          aria-label="선택 도구"
          onClick={() => setTool("select")}
        >
          <MousePointer2 size={17} />
        </button>
        <button
          className={tool === "pan" ? "active" : ""}
          title="화면 이동 · 가운데 버튼"
          aria-label="화면 이동 도구"
          onClick={() => setTool("pan")}
        >
          <Hand size={17} />
        </button>
        <span />
        <button
          title="확대"
          aria-label="확대"
          onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
        >
          <Plus size={17} />
        </button>
        <button
          title="축소"
          aria-label="축소"
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}
        >
          <Minus size={17} />
        </button>
        <button title="도면에 맞춤" aria-label="도면에 맞춤" onClick={fit}>
          <Expand size={17} />
        </button>
        <button
          className={fullPage ? "active" : ""}
          title="PDF 전체 페이지"
          aria-label="PDF 전체 페이지"
          onClick={() => {
            setFullPage((v) => !v);
            setPan({ x: 0, y: 0 });
            setZoom(1);
          }}
        >
          <ImageIcon size={17} />
        </button>
      </div>
      <div className="canvas-tag">
        2D PLAN <span>·</span> mm
      </div>
      <svg
        ref={svg}
        role="img"
        aria-label="편집 가능한 평면도"
        viewBox={`${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`}
        style={{ cursor: tool === "pan" ? "grab" : "default" }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          setZoom((z) => Math.min(8, Math.max(0.25, z * factor)));
        }}
        onPointerDown={(e) => {
          if (
            e.target === e.currentTarget ||
            (e.target as SVGElement).dataset.background ||
            tool === "pan" ||
            e.button === 1 ||
            e.altKey
          ) {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              mode: "pan",
              start: point(e.clientX, e.clientY),
              client: { x: e.clientX, y: e.clientY },
              pan: { ...pan },
              moved: false,
            };
            if (tool === "select" && e.button === 0) onSelect(null);
          }
        }}
        onPointerMove={(e) => {
          const p = point(e.clientX, e.clientY);
          setCursor(p);
          const d = drag.current;
          if (!d) return;
          if (
            !d.moved &&
            Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) > 3
          ) {
            if (d.mode === "object") onDragStart();
            d.moved = true;
          }
          if (d.mode === "pan") {
            setPan({
              x: d.pan.x - ((e.clientX - d.client.x) * vw) / size.w,
              y: d.pan.y - ((e.clientY - d.client.y) * vh) / size.h,
            });
          } else if (d.entity && d.moved) {
            onChange(
              d.entity.id,
              {
                x: Math.round((d.entity.x + p.x - d.start.x) / 50) * 50,
                y: Math.round((d.entity.y + p.y - d.start.y) / 50) * 50,
              },
              false,
            );
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern
            id="plan-grid"
            width="500"
            height="500"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 500 0 L 0 0 0 500"
              fill="none"
              stroke="#c9d1d0"
              strokeWidth={(vw / size.w) * 0.65}
            />
          </pattern>
        </defs>
        <rect
          data-background="true"
          x={cx - vw}
          y={cy - vh}
          width={vw * 2}
          height={vh * 2}
          fill="#eef1ef"
        />
        {grid && (
          <rect
            data-background="true"
            x={cx - vw}
            y={cy - vh}
            width={vw * 2}
            height={vh * 2}
            fill="url(#plan-grid)"
          />
        )}
        {plan.floorOutline ? (
          <polygon
            data-background="true"
            points={plan.floorOutline.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#fff"
            stroke="#b1bfbb"
            strokeWidth="25"
          />
        ) : (
          <rect
            data-background="true"
            x="0"
            y="0"
            width={plan.bounds.width}
            height={plan.bounds.depth}
            fill="#fff"
            stroke="#b1bfbb"
            strokeWidth="25"
          />
        )}
        {plan.overlay && overlayOpacity > 0 && (
          <image
            data-testid="pdf-overlay"
            data-background="true"
            href={resolveOverlayUrl(plan.overlay.url)}
            x={plan.overlay.x}
            y={plan.overlay.y}
            width={plan.overlay.width}
            height={plan.overlay.depth}
            opacity={overlayOpacity}
            preserveAspectRatio="none"
          />
        )}
        {["zones", "walls", "objects", "windows", "doors"].flatMap(
          (category) =>
            visible[category]
              ? plan[category as "walls"].map((e) => {
                  const selected = e.id === selectedId,
                    wall = category === "walls",
                    zone = category === "zones",
                    opening = category === "doors" || category === "windows",
                    isChair = e.type === "chair";
                  const color = confidenceColor(e),
                    fill =
                      e.color ||
                      (wall
                        ? "#334c52"
                        : zone
                          ? "#a6bfae"
                          : opening
                            ? "#eef8fc"
                            : isChair
                              ? "#d5e2d9"
                              : e.type === "table" || e.type === "bench"
                                ? "#e4ccb0"
                                : "#cddbdc");
                  return (
                    <g
                      key={e.id}
                      data-entity-id={e.id}
                      data-testid={`entity-${e.id}`}
                      aria-label={e.name}
                      transform={
                        e.polygon
                          ? undefined
                          : `rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.depth / 2})`
                      }
                      style={{ cursor: tool === "select" ? "move" : "grab" }}
                      onPointerDown={(ev) => {
                        if (tool === "pan" || ev.button === 1 || ev.altKey)
                          return;
                        ev.stopPropagation();
                        svg.current?.setPointerCapture(ev.pointerId);
                        onSelect(e.id);
                        drag.current = {
                          mode: "object",
                          start: point(ev.clientX, ev.clientY),
                          client: { x: ev.clientX, y: ev.clientY },
                          pan: { ...pan },
                          entity: structuredClone(e),
                          moved: false,
                        };
                      }}
                    >
                      <title>
                        {e.name} · {Math.round(e.width)} × {Math.round(e.depth)}{" "}
                        mm ·{" "}
                        {e.reviewed
                          ? "검토됨"
                          : Math.round(e.confidence * 100) + "%"}{" "}
                        {String(e.notes || "")}
                      </title>
                      {wall ? (
                        getWallSegments(
                          e,
                          [...plan.doors, ...plan.windows],
                          plan.settings.wallHeight,
                        )
                          .filter((s) => s.y - s.height / 2 < 0.01)
                          .map((s, i) => (
                            <rect
                              key={i}
                              x={e.x + e.width / 2 + s.x - s.width / 2}
                              y={e.y + e.depth / 2 + s.z - s.depth / 2}
                              width={s.width}
                              height={s.depth}
                              fill={fill}
                              fillOpacity=".86"
                              stroke={selected ? "#128175" : color}
                              strokeWidth={selected ? 70 : 12}
                            />
                          ))
                      ) : e.polygon ? (
                        <polygon
                          points={e.polygon
                            .map((p) => `${p.x},${p.y}`)
                            .join(" ")}
                          fill={fill}
                          fillOpacity={0.13}
                          stroke={selected ? "#128175" : color}
                          strokeWidth={selected ? 70 : 20}
                        />
                      ) : (
                        <rect
                          x={e.x}
                          y={e.y}
                          width={e.width}
                          height={e.depth}
                          rx={isChair ? 50 : 0}
                          fill={fill}
                          fillOpacity={zone ? 0.12 : opening ? 1 : 0.82}
                          stroke={selected ? "#128175" : color}
                          strokeWidth={selected ? 70 : 20}
                          strokeDasharray={
                            e.confidence < 0.5 ? "60 45" : undefined
                          }
                        />
                      )}
                      {opening && (
                        <path
                          d={`M ${e.x} ${e.y + e.depth / 2} h ${e.width}`}
                          stroke="#557d91"
                          strokeWidth="25"
                          strokeDasharray="70 35"
                        />
                      )}
                      {isChair && (
                        <path
                          d={`M ${e.x + 35} ${e.y + 65} h ${e.width - 70}`}
                          stroke="#688477"
                          strokeWidth="45"
                        />
                      )}
                      {labels && !wall && !isChair && e.width > 500 && (
                        <text
                          x={e.x + e.width / 2}
                          y={e.y + e.depth / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={zone ? "#345e50" : "#314447"}
                          fontSize={
                            zone
                              ? 220
                              : Math.min(
                                  140,
                                  (e.width / Math.max(e.name.length, 4)) * 1.3,
                                )
                          }
                          fontWeight={zone ? 600 : 400}
                          pointerEvents="none"
                        >
                          {zone
                            ? e.name
                            : e.type === "table"
                              ? `${Math.round(e.width)}×${Math.round(e.depth)}`
                              : e.name}
                        </text>
                      )}
                      {selected && !e.polygon && (
                        <>
                          <line
                            x1={e.x}
                            y1={e.y - 140}
                            x2={e.x + e.width}
                            y2={e.y - 140}
                            stroke="#0c786b"
                            strokeWidth="20"
                          />
                          <text
                            x={e.x + e.width / 2}
                            y={e.y - 240}
                            textAnchor="middle"
                            fontSize="180"
                            fill="#086a60"
                          >
                            {Math.round(e.width)} mm
                          </text>
                        </>
                      )}
                    </g>
                  );
                })
              : [],
        )}
      </svg>
      <div className="scale-bar">
        <div style={{ width: (scaleLength / vw) * size.w }} />
        {scaleLength.toLocaleString()} mm <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="coordinate-readout">
        {cursor
          ? `X ${Math.round(cursor.x).toLocaleString()}  Y ${Math.round(cursor.y).toLocaleString()}`
          : "도면 좌표 · mm"}
        {selection && ` · ${selection.name}`}
      </div>
    </div>
  );
}
