import * as THREE from "three";
import { footprintCorners, getWallSegments } from "./wallGeometry";
export { footprintCorners, getWallSegments } from "./wallGeometry";
export type { WallSegment } from "./wallGeometry";
import type { Entity, FloorPlan, ViewPreset } from "./types";

export type { ViewPreset } from "./types";
export const VIEW_PRESETS: ViewPreset[] = [
  "Perspective",
  "Top",
  "Front",
  "Back",
  "Left",
  "Right",
];
const M = 0.001;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const positive = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;

function material(color: string, metalness = 0, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: metalness ? 0.48 : 0.85,
    metalness,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

function box(
  parent: THREE.Group,
  size: [number, number, number],
  center: [number, number, number],
  mat: THREE.Material,
  name = "",
) {
  if (size.some((v) => !Number.isFinite(v) || v <= 0)) return;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      ...(size.map((v) => v * M) as [number, number, number]),
    ),
    mat,
  );
  mesh.position.set(...(center.map((v) => v * M) as [number, number, number]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function entityGroup(entity: Entity, category: string) {
  const group = new THREE.Group();
  group.name = `${entity.id} · ${entity.name}`;
  group.position.set(
    (entity.x + entity.width / 2) * M,
    (entity.z || 0) * M,
    (entity.y + entity.depth / 2) * M,
  );
  group.rotation.y = -radians(entity.rotation || 0);
  group.userData = {
    entityId: entity.id,
    category,
    type: entity.type,
    name: entity.name,
    source: entity.source,
    confidence: entity.confidence,
    reviewed: entity.reviewed ?? false,
    sourceUnits: "mm",
    dimensions: {
      width: entity.width,
      depth: entity.depth,
      height: entity.height,
    },
    sourcePosition: { x: entity.x, y: entity.y, z: entity.z },
    rotation: entity.rotation,
  };
  return group;
}

function validColor(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function openingModel(
  entity: Entity,
  category: "door" | "window",
  defaultHeight: number,
  finish = "warm-neutral",
) {
  const group = entityGroup(entity, category);
  const w = positive(entity.width, 900),
    d = positive(entity.depth, 150),
    h = positive(entity.height, defaultHeight);
  const horizontal = w >= d,
    long = horizontal ? w : d,
    thick = horizontal ? d : w;
  const jamb = Math.min(45, long / 12, h / 12);
  const frameMat = material(finish === "white" ? "#bdc7c7" : "#627d84", 0.3);
  const glassMat = material(
    finish === "white" ? "#dbe6e2" : "#93c8d0",
    0.08,
    category === "door" ? 0.22 : 0.4,
  );
  const localBox = (
    length: number,
    height: number,
    depth: number,
    along: number,
    elevation: number,
    name: string,
    mat = frameMat,
  ) =>
    box(
      group,
      horizontal ? [length, height, depth] : [depth, height, length],
      horizontal ? [along, elevation, 0] : [0, elevation, along],
      mat,
      name,
    );
  localBox(jamb, h, thick, -(long - jamb) / 2, h / 2, "left frame");
  localBox(jamb, h, thick, (long - jamb) / 2, h / 2, "right frame");
  localBox(long - jamb * 2, jamb, thick, 0, h - jamb / 2, "head frame");
  if (category === "window")
    localBox(long - jamb * 2, jamb, thick, 0, jamb / 2, "sill frame");
  localBox(
    Math.max(1, long - jamb * 2),
    Math.max(1, h - jamb * 2),
    Math.min(12, thick),
    0,
    h / 2,
    "schematic transparent panel",
    glassMat,
  );
  if (/slid|double/i.test(entity.type) || /슬라이딩/.test(entity.name))
    localBox(jamb / 2, h - jamb, thick / 2, 0, h / 2, "panel meeting frame");
  return group;
}

function furnitureModel(entity: Entity, plan: FloorPlan) {
  const group = entityGroup(entity, "object");
  const w = positive(entity.width, 600),
    d = positive(entity.depth, 600),
    h = positive(entity.height, plan.settings.furnitureHeight);
  const type = entity.type.toLowerCase();
  const white = plan.settings.material === "white",
    neutral = plan.settings.material === "neutral";
  const wood = material(
    validColor(
      entity.color,
      white ? "#f0f1ed" : neutral ? "#a9b3b4" : "#bc9876",
    ),
  );
  const steel = material(
    validColor(entity.color, white ? "#e8ebe8" : "#a6b4bc"),
    0.22,
  );
  const dark = material(white ? "#b8c1c1" : "#33484c");
  const upholstery = material(
    validColor(
      entity.color,
      white ? "#e1e5df" : neutral ? "#75848a" : "#476c65",
    ),
  );
  const topThickness = Math.min(55, h * 0.09);
  const legWidth = Math.min(45, w * 0.12, d * 0.12);
  const legs = (height: number, inset = 0.1, mat = dark) => {
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        box(
          group,
          [legWidth, height, legWidth],
          [
            x * (w * (0.5 - inset) - legWidth / 2),
            height / 2,
            z * (d * (0.5 - inset) - legWidth / 2),
          ],
          mat,
          "leg",
        );
  };
  if (type === "table" || type === "dining_table") {
    box(
      group,
      [w, topThickness, d],
      [0, h - topThickness / 2, 0],
      wood,
      "table top",
    );
    legs(h - topThickness);
  } else if (type === "chair" || type === "stool") {
    const seatY = type === "stool" ? h - topThickness / 2 : h * 0.53;
    box(group, [w, topThickness, d], [0, seatY, 0], upholstery, "seat");
    legs(seatY - topThickness / 2);
    if (type !== "stool")
      box(
        group,
        [w, h - seatY - topThickness / 2, Math.min(d * 0.13, 70)],
        [
          0,
          (h + seatY + topThickness / 2) / 2,
          -d / 2 + Math.min(d * 0.13, 70) / 2,
        ],
        upholstery,
        "back",
      );
  } else if (/bench|banquette/.test(type)) {
    const seatY = h * 0.52,
      alongDepth = d > w,
      backDepth = Math.min(w, d) * 0.2;
    box(group, [w, seatY, d], [0, seatY / 2, 0], wood, "bench base");
    box(
      group,
      [w, topThickness, d],
      [0, seatY + topThickness / 2, 0],
      upholstery,
      "bench seat",
    );
    box(
      group,
      alongDepth ? [backDepth, h - seatY, d] : [w, h - seatY, backDepth],
      alongDepth
        ? [-w / 2 + backDepth / 2, seatY + (h - seatY) / 2, 0]
        : [0, seatY + (h - seatY) / 2, -d / 2 + backDepth / 2],
      upholstery,
      "bench back",
    );
  } else if (/sink/.test(type)) {
    box(group, [w, h * 0.82, d], [0, h * 0.41, 0], steel, "sink cabinet");
    const rim = Math.min(w, d) * 0.1,
      rimH = h * 0.08;
    box(
      group,
      [w, rimH, rim],
      [0, h - rimH / 2, -d / 2 + rim / 2],
      steel,
      "back rim",
    );
    box(
      group,
      [w, rimH, rim],
      [0, h - rimH / 2, d / 2 - rim / 2],
      steel,
      "front rim",
    );
    box(
      group,
      [rim, rimH, d - rim * 2],
      [-w / 2 + rim / 2, h - rimH / 2, 0],
      steel,
      "left rim",
    );
    box(
      group,
      [rim, rimH, d - rim * 2],
      [w / 2 - rim / 2, h - rimH / 2, 0],
      steel,
      "right rim",
    );
    box(
      group,
      [w - rim * 2, rimH / 3, d - rim * 2],
      [0, h * 0.84, 0],
      dark,
      "recessed basin",
    );
  } else if (/counter|worktop|workbench|prep/.test(type)) {
    box(
      group,
      [w * 0.95, h - topThickness, d * 0.95],
      [0, (h - topThickness) / 2, 0],
      /counter/.test(type) ? wood : steel,
      "cabinet",
    );
    box(
      group,
      [w, topThickness, d],
      [0, h - topThickness / 2, 0],
      /counter/.test(type) ? wood : steel,
      "work surface",
    );
  } else if (/shelf/.test(type)) {
    const shelfThickness = Math.min(35, h * 0.05);
    for (let level = 0; level < 4; level++) {
      const elevation = shelfThickness / 2 + (level * (h - shelfThickness)) / 3;
      box(group, [w, shelfThickness, d], [0, elevation, 0], steel, "shelf");
    }
    legs(h, 0, steel);
  } else if (/showcase|display/.test(type)) {
    box(group, [w, h * 0.45, d], [0, h * 0.225, 0], steel, "showcase base");
    box(
      group,
      [w, h * 0.55, d],
      [0, h * 0.725, 0],
      material("#9fbdb9", 0.05, 0.4),
      "showcase glass",
    );
    box(
      group,
      [w, Math.min(35, h * 0.04), d],
      [0, h - Math.min(35, h * 0.04) / 2, 0],
      dark,
      "showcase top",
    );
  } else if (/fryer|range|stove/.test(type)) {
    box(group, [w, h * 0.9, d], [0, h * 0.45, 0], steel, "cooking base");
    box(
      group,
      [w * 0.78, h * 0.06, d * 0.68],
      [0, h * 0.93, 0],
      dark,
      "cooking surface",
    );
    box(
      group,
      [w, h * 0.04, d * 0.15],
      [0, h * 0.98, -d * 0.425],
      steel,
      "rear control",
    );
  } else {
    const mat =
      type === "column"
        ? material(white ? "#f2f3ee" : "#e5e9e7")
        : /refriger|freezer|dishwash|equipment|ice|rice|steriliz/.test(type)
          ? steel
          : wood;
    box(group, [w, h, d], [0, h / 2, 0], mat, "dimensioned body");
    if (/refriger|freezer|dishwash/.test(type)) {
      const handleH = h * 0.23,
        handleW = Math.min(25, w * 0.06),
        handleD = Math.min(20, d * 0.04);
      box(
        group,
        [handleW, handleH, handleD],
        [w * 0.33, h * 0.68, d / 2 - handleD / 2],
        dark,
        "flush handle",
      );
    }
  }
  // Unused shared materials have never reached a renderer, but dispose them as well.
  for (const mat of [wood, steel, dark, upholstery]) {
    let used = false;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material === mat) used = true;
    });
    if (!used) mat.dispose();
  }
  return group;
}

function polygonMesh(
  points: { x: number; y: number }[],
  thicknessMm: number,
  color: string,
) {
  const shape = new THREE.Shape();
  points.forEach((p, index) =>
    index ? shape.lineTo(p.x * M, p.y * M) : shape.moveTo(p.x * M, p.y * M),
  );
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: thicknessMm * M,
      bevelEnabled: false,
      steps: 1,
    }),
    material(color),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildPlanModel(plan: FloorPlan): THREE.Group {
  const model = new THREE.Group();
  model.name = "FloorPlan";
  model.userData = {
    sourceUnits: "mm",
    exportUnits: "m",
    coordinateSystem: "x right, y up, z drawing down",
    drawingRotation: "clockwise degrees",
    settings: { ...plan.settings },
    bounds: { ...plan.bounds },
  };
  const outline = plan.floorOutline?.length
    ? plan.floorOutline
    : [
        { x: 0, y: 0 },
        { x: plan.bounds.width, y: 0 },
        { x: plan.bounds.width, y: plan.bounds.depth },
        { x: 0, y: plan.bounds.depth },
      ];
  const floorColor =
    plan.settings.material === "white"
      ? "#eff0eb"
      : plan.settings.material === "neutral"
        ? "#dfe4e5"
        : plan.settings.material === "concrete"
          ? "#d2d5d2"
          : "#dedbd1";
  const floor = polygonMesh(outline, 100, floorColor);
  floor.name = "Floor slab · schematic 100 mm";
  floor.userData = { category: "floor", assumedSlabThicknessMm: 100 };
  model.add(floor);
  for (const zone of plan.zones) {
    const points = zone.polygon?.length ? zone.polygon : footprintCorners(zone);
    const mesh = polygonMesh(
      points,
      2,
      plan.settings.material === "white"
        ? "#e9ede9"
        : validColor(
            zone.color,
            /kitchen|주방/i.test(zone.name + zone.type) ? "#d1dce0" : "#dcded3",
          ),
    );
    mesh.name = `${zone.id} · ${zone.name}`;
    mesh.position.y = 0.003;
    mesh.userData = {
      entityId: zone.id,
      category: "zone",
      confidence: zone.confidence,
      source: zone.source,
    };
    model.add(mesh);
  }
  for (const wall of plan.walls) {
    const group = entityGroup(wall, "wall"),
      mat = material(
        validColor(
          wall.color,
          plan.settings.material === "white" ? "#f2f3ee" : "#e5e9e7",
        ),
      );
    for (const segment of getWallSegments(
      wall,
      [...plan.doors, ...plan.windows],
      plan.settings.wallHeight,
    ))
      box(
        group,
        [segment.width, segment.height, segment.depth],
        [segment.x, segment.y, segment.z],
        mat,
        "wall solid",
      );
    if (!group.children.length) mat.dispose();
    model.add(group);
  }
  for (const door of plan.doors)
    model.add(
      openingModel(
        door,
        "door",
        plan.settings.doorHeight,
        plan.settings.material,
      ),
    );
  for (const window of plan.windows)
    model.add(openingModel(window, "window", 1200, plan.settings.material));
  for (const entity of plan.objects) model.add(furnitureModel(entity, plan));
  model.updateMatrixWorld(true);
  return model;
}

export function getModelBounds(model: THREE.Object3D) {
  const bounds = new THREE.Box3().setFromObject(model, true);
  if (bounds.isEmpty())
    bounds.set(
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 1, 0.5),
    );
  return bounds;
}

export function boundsCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        points.push(new THREE.Vector3(x, y, z));
  return points;
}

/** Fits every 3D bounding-box corner with 6% margin, at the requested aspect. */
export function createFittedCamera(
  view: ViewPreset,
  bounds: THREE.Box3,
  aspect: number,
): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  const center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.1);
  const direction = new THREE.Vector3(
    ...({
      Perspective: [1, 1.1, 1.15],
      Top: [0, 1, 0],
      Front: [0, 0, 1],
      Back: [0, 0, -1],
      Left: [-1, 0, 0],
      Right: [1, 0, 0],
    }[view] as [number, number, number]),
  ).normalize();
  const camera =
    view === "Perspective"
      ? new THREE.PerspectiveCamera(38, aspect, 0.01, radius * 30 + 100)
      : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 30 + 100);
  if (view === "Top") camera.up.set(0, 0, -1);
  camera.position.copy(center).addScaledVector(direction, radius * 4 + 1);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const points = boundsCorners(bounds).map((p) => p.sub(center));
  if (camera instanceof THREE.PerspectiveCamera) {
    const tanY = Math.tan(radians(camera.fov) / 2),
      tanX = tanY * aspect;
    const distance =
      Math.max(
        ...points.map(
          (p) =>
            Math.max(
              (Math.abs(p.dot(right)) * 1.06) / tanX,
              (Math.abs(p.dot(up)) * 1.06) / tanY,
            ) + p.dot(direction),
        ),
      ) + 0.05;
    camera.position
      .copy(center)
      .addScaledVector(direction, Math.max(distance, 0.1));
  } else {
    const extentX = Math.max(...points.map((p) => Math.abs(p.dot(right))));
    const extentY = Math.max(...points.map((p) => Math.abs(p.dot(up))));
    const halfHeight = Math.max(extentY, extentX / aspect, 0.05) * 1.06;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

export function createReviewScene(
  plan: FloorPlan,
  options: { grid?: boolean } = {},
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f2f4f2");
  const model = buildPlanModel(plan);
  scene.add(model);
  const bounds = getModelBounds(model),
    center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3());
  const intensity = Math.max(
    0,
    Number.isFinite(plan.settings.lighting) ? plan.settings.lighting : 1,
  );
  scene.add(new THREE.HemisphereLight("#ffffff", "#849095", 2.0 * intensity));
  const light = new THREE.DirectionalLight("#ffffff", 2.7 * intensity);
  const span = Math.max(size.x, size.z, 1);
  light.position.set(
    center.x - span * 0.6,
    Math.max(12, span * 1.1),
    center.z + span * 0.4,
  );
  light.target.position.copy(center);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
    near: 0.1,
    far: span * 5 + 50,
  });
  light.shadow.normalBias = 0.03;
  light.shadow.bias = -0.0001;
  scene.add(light, light.target);
  const gridSize = Math.ceil((span * 1.25) / 2) * 2;
  const gridHelper = new THREE.GridHelper(
    gridSize,
    Math.max(2, Math.ceil(gridSize / 0.5)),
    "#aab8b6",
    "#d5dedb",
  );
  gridHelper.position.set(center.x, 0.006, center.z);
  gridHelper.visible = options.grid ?? false;
  scene.add(gridHelper);
  return { scene, model, bounds, gridHelper };
}

export function configureRenderer(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function setWallOpacity(model: THREE.Group, opacity = 1) {
  const value = Math.max(0.05, Math.min(1, opacity));
  model.children
    .filter((child) => child.userData.category === "wall")
    .forEach((group) =>
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        for (const mat of Array.isArray(child.material)
          ? child.material
          : [child.material]) {
          mat.opacity = value;
          mat.transparent = value < 1;
          mat.depthWrite = value >= 1;
          mat.needsUpdate = true;
        }
      }),
    );
}

export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments
    ) {
      geometries.add(child.geometry);
      for (const mat of Array.isArray(child.material)
        ? child.material
        : [child.material])
        materials.add(mat);
    }
    if (child instanceof THREE.DirectionalLight) child.shadow.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((mat) => mat.dispose());
}
