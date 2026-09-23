import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { FloorPlan } from "./types";
import {
  configureRenderer,
  createFittedCamera,
  createReviewScene,
  disposeObject,
  setWallOpacity,
} from "./scene";
import type { ViewPreset } from "./scene";

export interface Preview3DProps {
  plan: FloorPlan;
  view: ViewPreset;
  grid: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onError?: (message: string) => void;
  wallOpacity?: number;
}

type Bundle = ReturnType<typeof createReviewScene>;

export function Preview3D(props: Preview3DProps) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props);
  const sync = useRef<(() => void) | null>(null);
  const [error, setError] = useState("");
  current.current = props;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "WebGL 2를 시작할 수 없습니다.";
      setError(message);
      current.current.onError?.(message);
      return;
    }
    configureRenderer(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute(
      "aria-label",
      "Three.js 3D floor plan viewport",
    );
    renderer.domElement.setAttribute("data-testid", "three-canvas");
    element.appendChild(renderer.domElement);
    let bundle: Bundle | null = null,
      camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    let controls: OrbitControls | null = null,
      selected: THREE.BoxHelper | null = null;
    let lastPlan: FloorPlan | null = null,
      lastView: ViewPreset | null = null,
      lastSelection: string | null | undefined;
    let frame = 0,
      stopped = false;
    const clearSelection = () => {
      if (!selected) return;
      selected.removeFromParent();
      disposeObject(selected);
      selected = null;
    };
    const fit = () => {
      if (!bundle) return;
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      controls?.dispose();
      camera = createFittedCamera(
        current.current.view,
        bundle.bounds,
        width / height,
      );
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(bundle.bounds.getCenter(new THREE.Vector3()));
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      // Orthographic presets keep exact axes; only zoom and pan are allowed.
      controls.enableRotate = current.current.view === "Perspective";
      controls.maxPolarAngle =
        current.current.view === "Perspective" ? Math.PI * 0.495 : Math.PI;
      controls.minDistance = 0.2;
      controls.maxDistance = Math.max(
        100,
        bundle.bounds.getSize(new THREE.Vector3()).length() * 8,
      );
      controls.minZoom = 0.1;
      controls.maxZoom = 40;
      controls.update();
      lastView = current.current.view;
      renderer.domElement.dataset.view = lastView;
      renderer.domElement.dataset.projection =
        camera instanceof THREE.OrthographicCamera
          ? "orthographic"
          : "perspective";
    };
    const update = () => {
      if (stopped) return;
      const next = current.current;
      const rebuild = next.plan !== lastPlan;
      if (rebuild) {
        clearSelection();
        if (bundle) disposeObject(bundle.scene);
        bundle = createReviewScene(next.plan, { grid: next.grid });
        lastPlan = next.plan;
      }
      if (!bundle) return;
      bundle.gridHelper.visible = next.grid;
      setWallOpacity(bundle.model, next.wallOpacity ?? 1);
      if (rebuild || lastView !== next.view) fit();
      if (rebuild || next.selectedId !== lastSelection) {
        clearSelection();
        lastSelection = next.selectedId;
        if (next.selectedId) {
          const entity = bundle.model.children.find(
            (child) => child.userData.entityId === next.selectedId,
          );
          if (entity) {
            selected = new THREE.BoxHelper(entity, "#e7a640");
            selected.material.depthTest = false;
            selected.renderOrder = 1000;
            bundle.scene.add(selected);
          }
        }
      }
      renderer.render(bundle.scene, camera);
    };
    const report = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      current.current.onError?.(message);
    };
    sync.current = () => {
      try {
        update();
      } catch (reason) {
        report(reason);
      }
    };
    sync.current();
    const animate = () => {
      if (stopped) return;
      try {
        controls?.update();
        if (bundle && camera) renderer.render(bundle.scene, camera);
      } catch (reason) {
        report(reason);
        return;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const observer = new ResizeObserver(() => {
      if (!stopped) fit();
    });
    observer.observe(element);
    const raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerStart =
        event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (
        !bundle ||
        !pointerStart ||
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 5
      )
        return;
      pointerStart = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      for (const hit of raycaster.intersectObjects(
        bundle.model.children,
        true,
      )) {
        let object: THREE.Object3D | null = hit.object;
        while (object && !object.userData.entityId) object = object.parent;
        if (object?.userData.entityId) {
          current.current.onSelect?.(object.userData.entityId);
          break;
        }
      }
    };
    const onContextLost = (event: Event) => {
      if (stopped) return;
      event.preventDefault();
      report(
        new Error("3D 그래픽 연결이 끊겼습니다. 페이지를 새로고침해 주세요."),
      );
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    return () => {
      stopped = true;
      sync.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls?.dispose();
      clearSelection();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      if (bundle) disposeObject(bundle.scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    sync.current?.();
  }, [props.plan, props.view, props.grid, props.selectedId, props.wallOpacity]);

  return (
    <div
      ref={host}
      className="three-viewport"
      data-testid="three-viewport"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {error && (
        <div
          role="alert"
          className="three-error"
          style={{
            position: "absolute",
            inset: 20,
            zIndex: 2,
            background: "#fff",
            padding: 24,
            border: "1px solid #d5a09a",
            borderRadius: 8,
          }}
        >
          <strong>3D 미리보기를 표시할 수 없습니다.</strong>
          <p>{error}</p>
          <p>
            WebGL 2를 지원하는 브라우저에서 다시 열어 주세요. JSON 검토와 모델
            내보내기는 계속 사용할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}

export default Preview3D;
