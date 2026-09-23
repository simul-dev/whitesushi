import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { zipSync } from "fflate";
import type { FloorPlan } from "./types";
import {
  buildPlanModel,
  configureRenderer,
  createFittedCamera,
  createReviewScene,
  disposeObject,
  VIEW_PRESETS,
} from "./scene";
import type { ViewPreset } from "./scene";

export async function exportModel(
  plan: FloorPlan,
  format: "glb" | "gltf",
): Promise<Blob> {
  const model = buildPlanModel(plan),
    scene = new THREE.Scene();
  scene.name = "Floor Plan to 3D Review";
  scene.add(model);
  scene.updateMatrixWorld(true);
  try {
    const data = await new GLTFExporter().parseAsync(scene, {
      binary: format === "glb",
      onlyVisible: true,
    });
    if (format === "glb") {
      if (!(data instanceof ArrayBuffer))
        throw new Error("GLB 내보내기 결과가 올바르지 않습니다.");
      return new Blob([data], { type: "model/gltf-binary" });
    }
    return new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "model/gltf+json" },
    );
  } finally {
    disposeObject(scene);
  }
}

export interface ImageExportOptions {
  width?: number;
  height?: number;
  grid?: boolean;
}

function imageRenderer(options: ImageExportOptions) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  configureRenderer(renderer);
  const width = Math.max(1, Math.floor(options.width ?? 1600)),
    height = Math.max(1, Math.floor(options.height ?? 1200));
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  return { renderer, width, height };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("PNG 이미지를 생성하지 못했습니다.")),
      "image/png",
    ),
  );
}

/** Dedicated renderer: exports cannot resize or alter the live viewport/camera. */
export async function exportPng(
  plan: FloorPlan,
  view: ViewPreset,
  options: ImageExportOptions = {},
): Promise<Blob> {
  const { renderer, width, height } = imageRenderer(options);
  const bundle = createReviewScene(plan, { grid: options.grid ?? false });
  try {
    renderer.render(
      bundle.scene,
      createFittedCamera(view, bundle.bounds, width / height),
    );
    return await canvasBlob(renderer.domElement);
  } finally {
    disposeObject(bundle.scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function exportViewZip(
  plan: FloorPlan,
  options: ImageExportOptions = {},
): Promise<Blob> {
  const { renderer, width, height } = imageRenderer(options);
  const bundle = createReviewScene(plan, { grid: options.grid ?? false });
  try {
    const files: Record<string, Uint8Array> = {};
    for (const view of VIEW_PRESETS) {
      renderer.render(
        bundle.scene,
        createFittedCamera(view, bundle.bounds, width / height),
      );
      files[`${view.toLowerCase()}.png`] = new Uint8Array(
        await (await canvasBlob(renderer.domElement)).arrayBuffer(),
      );
    }
    const bytes = zipSync(files, { level: 0 });
    return new Blob([new Uint8Array(bytes).buffer], {
      type: "application/zip",
    });
  } finally {
    disposeObject(bundle.scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
