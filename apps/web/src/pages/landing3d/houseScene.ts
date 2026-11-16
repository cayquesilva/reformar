/**
 * Cena 3D da página de teste: a casa é construída de acordo com o progresso de cada etapa (0..1).
 * Unidades em metros. Frente da casa voltada para +z. Chão em y = 0.
 *
 * Desempenho: as fiadas de tijolo de cada altura viram uma única malha (geometrias mescladas),
 * e o quadro só é desenhado enquanto algo se move (sem laço infinito com a página parada).
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineSegments,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface HouseScene {
  /** Progresso das etapas 1..6 (índices 0..5). */
  setStages(b: number[]): void;
  /** Progresso do terreno (abertura). */
  setIntro(b0: number): void;
  setPointer(x: number, y: number): void;
  resize(): void;
  dispose(): void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const easeBack = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

// ---------------------------------------------------------------- medidas
const W = 8; // frente
const D = 6; // fundo
const T = 0.2; // espessura da parede
const BASE = 0.3; // topo do baldrame
const COURSE = 0.27; // altura de uma fiada
const COURSES = 10;
const SLAB = 0.25;
const FLOOR_H = COURSE * COURSES; // 2,70
const UP_BASE = BASE + FLOOR_H + SLAB; // 3,25
const TOP = UP_BASE + FLOOR_H; // 5,95
const RIDGE = TOP + 1.65;
const EAVE = D / 2 + 0.6;

interface Opening {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  door?: boolean;
}
interface WallDef {
  /** posição do início da parede e direção (eixo x ou z) */
  axis: 'x' | 'z';
  start: Vector3;
  length: number;
  /** normal para fora (para posicionar esquadrias) */
  out: 1 | -1;
  openings: Opening[];
}

const yc = (k: number, base: number) => base + k * COURSE; // fronteiras das fiadas
const groundWin = (u0: number, u1: number): Opening => ({ u0, u1, y0: yc(3, BASE), y1: yc(8, BASE) });
const upperWin = (u0: number, u1: number): Opening => ({ u0, u1, y0: yc(3, UP_BASE), y1: yc(8, UP_BASE) });

function walls(level: 0 | 1): WallDef[] {
  const g = level === 0;
  const win = g ? groundWin : upperWin;
  return [
    {
      axis: 'x',
      start: new Vector3(-W / 2, 0, D / 2 - T / 2),
      length: W,
      out: 1,
      openings: g
        ? [groundWin(1, 2.4), { u0: 3.5, u1: 4.5, y0: BASE, y1: yc(8, BASE), door: true }, groundWin(5.6, 7)]
        : [win(1, 2.2), win(3.4, 4.6), win(5.8, 7)],
    },
    { axis: 'x', start: new Vector3(-W / 2, 0, -D / 2 + T / 2), length: W, out: -1, openings: [win(1.4, 2.6), win(5.4, 6.6)] },
    { axis: 'z', start: new Vector3(-W / 2 + T / 2, 0, -D / 2 + T), length: D - 2 * T, out: -1, openings: [win(2.2, 3.4)] },
    { axis: 'z', start: new Vector3(W / 2 - T / 2, 0, -D / 2 + T), length: D - 2 * T, out: 1, openings: [win(2.2, 3.4)] },
  ];
}

/** Trechos [u0,u1] de uma fiada, descontando as aberturas que a atravessam. */
function segments(length: number, openings: Opening[], y0: number, y1: number): [number, number][] {
  let segs: [number, number][] = [[0, length]];
  for (const o of openings) {
    if (!(y0 < o.y1 - 1e-6 && y1 > o.y0 + 1e-6)) continue;
    segs = segs.flatMap(([a, b]): [number, number][] => {
      if (o.u1 <= a || o.u0 >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (o.u0 > a) out.push([a, o.u0]);
      if (o.u1 < b) out.push([o.u1, b]);
      return out;
    });
  }
  return segs.filter(([a, b]) => b - a > 0.02);
}

function wallPoint(w: WallDef, u: number): Vector3 {
  return w.axis === 'x' ? new Vector3(w.start.x + u, 0, w.start.z) : new Vector3(w.start.x, 0, w.start.z + u);
}

/** Uma fiada (todas as paredes de um andar) mesclada numa geometria só, com origem no centro da fiada. */
function courseGeometry(defs: WallDef[], y0: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const y1 = y0 + COURSE;
  const cy = (y0 + y1) / 2;
  for (const w of defs) {
    for (const [a, b] of segments(w.length, w.openings, y0, y1)) {
      const len = b - a;
      const g = w.axis === 'x' ? new BoxGeometry(len, COURSE * 0.93, T) : new BoxGeometry(T, COURSE * 0.93, len);
      const mid = wallPoint(w, (a + b) / 2);
      g.applyMatrix4(new Matrix4().makeTranslation(mid.x, 0, mid.z));
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  merged.userData.cy = cy;
  return merged;
}

interface Piece {
  stage: number; // 0..6
  o: number; // atraso dentro da etapa
  k: number; // velocidade
  apply(p: number): void;
}

export function createHouseScene(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean; mobile: boolean }): HouseScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.mobile ? 1.75 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const NIGHT = new Color('#0b1622');
  const scene = new Scene();
  scene.background = NIGHT.clone();
  scene.fog = new Fog(NIGHT.clone(), 34, 80);

  const camera = new PerspectiveCamera(32, 1, 0.1, 200);

  // ------------------------------------------------------------ luzes
  const hemi = new HemisphereLight(new Color('#cfe3ff'), new Color('#0b1622'), 1.25);
  scene.add(hemi);
  const sun = new DirectionalLight(new Color('#ffffff'), 2.4);
  sun.position.set(12, 20, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.mobile ? 1024 : 2048, opts.mobile ? 1024 : 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const warmLow = new PointLight(new Color('#ffc46b'), 0, 9, 2);
  warmLow.position.set(0, 1.7, 0);
  const warmUp = new PointLight(new Color('#ffc46b'), 0, 9, 2);
  warmUp.position.set(0, 4.7, 0);
  const porch = new PointLight(new Color('#ffcf80'), 0, 7, 2);
  porch.position.set(0, 2.6, D / 2 + 0.9);
  scene.add(warmLow, warmUp, porch);

  // ------------------------------------------------------------ materiais
  const disposables: { dispose(): void }[] = [];
  const mat = <M extends Material>(m: M) => {
    disposables.push(m);
    return m;
  };
  const geo = <G extends BufferGeometry>(g: G) => {
    disposables.push(g);
    return g;
  };
  const BRICK_A = new Color('#b8643e');
  const BRICK_B = new Color('#a9583a');
  const PLASTER = new Color('#e6e0d4');
  const PLASTER_UP = new Color('#dcd6ca');
  const groundMat = mat(new MeshStandardMaterial({ color: '#0f1e2e', roughness: 1 }));
  const concrete = mat(new MeshStandardMaterial({ color: '#8f9aa6', roughness: 0.95 }));
  const brickA = mat(new MeshStandardMaterial({ color: BRICK_A.clone(), roughness: 0.9 }));
  const brickB = mat(new MeshStandardMaterial({ color: BRICK_B.clone(), roughness: 0.9 }));
  const brickUpA = mat(new MeshStandardMaterial({ color: BRICK_A.clone(), roughness: 0.9 }));
  const brickUpB = mat(new MeshStandardMaterial({ color: BRICK_B.clone(), roughness: 0.9 }));
  const tile = mat(new MeshStandardMaterial({ color: '#9a4b33', roughness: 0.8 }));
  const frame = mat(new MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.5 }));
  const glass = mat(
    new MeshStandardMaterial({ color: '#1c3550', roughness: 0.15, metalness: 0.2, emissive: new Color('#ffb547'), emissiveIntensity: 0 }),
  );
  const wood = mat(new MeshStandardMaterial({ color: '#6b4428', roughness: 0.7 }));
  const steel = mat(new MeshStandardMaterial({ color: '#c9d6e4', roughness: 0.4, metalness: 0.6 }));
  const plank = mat(new MeshStandardMaterial({ color: '#c79a5b', roughness: 0.85 }));
  const leaf = mat(new MeshStandardMaterial({ color: '#3f7a4f', roughness: 0.9 }));
  const grass = mat(new MeshStandardMaterial({ color: '#1f3d2b', roughness: 1 }));
  const path = mat(new MeshStandardMaterial({ color: '#7d8894', roughness: 0.95 }));
  const stringMat = mat(new LineBasicMaterial({ color: '#f5b700', transparent: true }));
  const ghostMat = mat(new LineBasicMaterial({ color: '#7fb2e5', transparent: true, opacity: 0.55, depthWrite: false }));

  const pieces: Piece[] = [];
  const add = (obj: Object3D, cast = true) => {
    obj.traverse((o) => {
      if ((o as Mesh).isMesh) {
        (o as Mesh).castShadow = cast;
        (o as Mesh).receiveShadow = true;
      }
    });
    scene.add(obj);
    return obj;
  };
  const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geo(new BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    return mesh;
  };
  /** cresce de baixo para cima */
  const grow = (mesh: Mesh, stage: number, o: number, k = 3) => {
    const h = (mesh.geometry as BoxGeometry).parameters?.height ?? 1;
    const baseY = mesh.position.y - h / 2;
    pieces.push({
      stage,
      o,
      k,
      apply(p) {
        const e = easeOut(p);
        mesh.visible = p > 0.001;
        mesh.scale.y = Math.max(0.001, e);
        mesh.position.y = baseY + (h * mesh.scale.y) / 2;
      },
    });
    add(mesh);
  };
  /** desce até o lugar (fiadas, peças assentadas) */
  const drop = (obj: Object3D, stage: number, o: number, k = 4, height = 1.1) => {
    const y = obj.position.y;
    pieces.push({
      stage,
      o,
      k,
      apply(p) {
        const e = easeOut(p);
        obj.visible = p > 0.001;
        obj.position.y = y + (1 - e) * height;
        obj.scale.setScalar(0.9 + 0.1 * e);
      },
    });
    add(obj);
  };
  /** estica no eixo x (vigas, laje) */
  const extend = (obj: Object3D, stage: number, o: number, k = 3) => {
    pieces.push({
      stage,
      o,
      k,
      apply(p) {
        obj.visible = p > 0.001;
        obj.scale.x = Math.max(0.001, easeOut(p));
      },
    });
    add(obj);
  };
  const pop = (obj: Object3D, stage: number, o: number, k = 4) => {
    pieces.push({
      stage,
      o,
      k,
      apply(p) {
        obj.visible = p > 0.001;
        obj.scale.setScalar(Math.max(0.001, easeBack(clamp01(p))));
      },
    });
    add(obj);
  };

  // ------------------------------------------------------------ terreno
  const ground = new Mesh(geo(new PlaneGeometry(160, 160)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new GridHelper(60, 60, new Color('#2b4864'), new Color('#1a2d42'));
  grid.position.y = 0.003;
  (grid.material as Material).transparent = true;
  (grid.material as Material).opacity = 0.7;
  disposables.push(grid.geometry, grid.material as Material);
  scene.add(grid);

  // gabarito: estacas e linha amarela
  const stakes = new Group();
  const LX = W / 2 + 0.7;
  const LZ = D / 2 + 0.7;
  const corners: [number, number][] = [
    [-LX, -LZ],
    [LX, -LZ],
    [-LX, LZ],
    [LX, LZ],
  ];
  for (const [x, z] of corners) {
    stakes.add(box(0.09, 0.6, 0.09, plank, x, 0.3, z));
  }
  const strGeo = geo(new BufferGeometry());
  strGeo.setAttribute('position', new Float32BufferAttribute([-LX, 0.5, -LZ, LX, 0.5, -LZ, LX, 0.5, LZ, -LX, 0.5, LZ, -LX, 0.5, -LZ], 3));
  const string = new Line(strGeo, stringMat);
  stakes.add(string);
  add(stakes);

  // projeto em linhas (a casa pronta, só contorno): é preenchido pela obra
  const ghost = new Group();
  const ghostBox = (w: number, h: number, d: number, y: number) => {
    const e = new LineSegments(geo(new EdgesGeometry(geo(new BoxGeometry(w, h, d)))), ghostMat);
    e.position.y = y;
    ghost.add(e);
  };
  ghostBox(W, FLOOR_H + BASE, D, (FLOOR_H + BASE) / 2);
  ghostBox(W, FLOOR_H, D, UP_BASE + FLOOR_H / 2);
  const roofLines = geo(new BufferGeometry());
  const hx = W / 2 + 0.5;
  roofLines.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        [-hx, TOP, EAVE, -hx, RIDGE, 0],
        [-hx, RIDGE, 0, -hx, TOP, -EAVE],
        [hx, TOP, EAVE, hx, RIDGE, 0],
        [hx, RIDGE, 0, hx, TOP, -EAVE],
        [-hx, RIDGE, 0, hx, RIDGE, 0],
        [-hx, TOP, EAVE, hx, TOP, EAVE],
        [-hx, TOP, -EAVE, hx, TOP, -EAVE],
      ].flat(),
      3,
    ),
  );
  ghost.add(new LineSegments(roofLines, ghostMat));
  scene.add(ghost);

  // ------------------------------------------------------------ 1 · fundação
  const footings: [number, number][] = [
    [-W / 2 + 0.2, -D / 2 + 0.2],
    [0, -D / 2 + 0.2],
    [W / 2 - 0.2, -D / 2 + 0.2],
    [-W / 2 + 0.2, D / 2 - 0.2],
    [0, D / 2 - 0.2],
    [W / 2 - 0.2, D / 2 - 0.2],
  ];
  footings.forEach(([x, z], i) => grow(box(1.0, 0.16, 1.0, concrete, x, 0.08, z), 1, i * 0.05, 3.2));
  // baldrame
  const beamFront = box(W + 0.1, BASE, 0.3, concrete, 0, BASE / 2, D / 2 - 0.15);
  const beamBack = box(W + 0.1, BASE, 0.3, concrete, 0, BASE / 2, -D / 2 + 0.15);
  const beamL = box(0.3, BASE, D, concrete, -W / 2 + 0.15, BASE / 2, 0);
  const beamR = box(0.3, BASE, D, concrete, W / 2 - 0.15, BASE / 2, 0);
  extend(beamFront, 1, 0.35, 2.6);
  extend(beamBack, 1, 0.42, 2.6);
  grow(beamL, 1, 0.5, 2.6);
  grow(beamR, 1, 0.55, 2.6);
  const subfloor = box(W - 0.4, 0.1, D - 0.4, concrete, 0, BASE - 0.05, 0);
  extend(subfloor, 1, 0.7, 3.5);

  // ------------------------------------------------------------ 2 e 3 · alvenaria
  const lower = walls(0);
  const upper = walls(1);
  const buildCourses = (defs: WallDef[], base: number, stage: number, from: number, span: number, a: Material, b: Material) => {
    for (let c = 0; c < COURSES; c++) {
      const g = geo(courseGeometry(defs, yc(c, base)));
      const m = new Mesh(g, c % 2 ? b : a);
      m.position.y = g.userData.cy;
      drop(m, stage, from + (c / COURSES) * span, 1 / (span / COURSES) / 1.6, 0.9);
    }
  };
  buildCourses(lower, BASE, 2, 0, 0.85, brickA, brickB);

  // laje
  const slab = box(W + 0.3, SLAB, D + 0.3, concrete, 0, BASE + FLOOR_H + SLAB / 2, 0);
  extend(slab, 3, 0, 4);
  buildCourses(upper, UP_BASE, 3, 0.2, 0.7, brickUpA, brickUpB);

  // andaime (lado direito), sai no acabamento
  const scaffold = new Group();
  const SX0 = W / 2 + 0.7;
  const SX1 = W / 2 + 1.7;
  for (const x of [SX0, SX1]) {
    for (const z of [-2.2, 0, 2.2]) {
      const pole = new Mesh(geo(new CylinderGeometry(0.04, 0.04, TOP + 0.6, 8)), steel);
      pole.position.set(x, (TOP + 0.6) / 2, z);
      scaffold.add(pole);
    }
  }
  for (const y of [1.6, 3.2, 4.8]) {
    scaffold.add(box(1.1, 0.06, 4.8, plank, (SX0 + SX1) / 2, y, 0));
  }
  add(scaffold);
  pieces.push({
    stage: 3,
    o: 0,
    k: 2.4,
    apply(p) {
      scaffold.visible = p > 0.001;
      scaffold.userData.build = easeOut(p);
    },
  });

  // ------------------------------------------------------------ 4 · telhado
  const gableShape = new Shape();
  gableShape.moveTo(-D / 2, 0);
  gableShape.lineTo(D / 2, 0);
  gableShape.lineTo(0, RIDGE - TOP - 0.05);
  gableShape.closePath();
  const gableGeo = geo(new ExtrudeGeometry(gableShape, { depth: T, bevelEnabled: false }));
  for (const side of [-1, 1]) {
    const gable = new Mesh(gableGeo, brickUpA);
    gable.rotation.y = Math.PI / 2;
    gable.position.set(side < 0 ? -W / 2 : W / 2 - T, TOP, 0);
    const holder = new Group();
    holder.add(gable);
    grow0(holder, 4, side < 0 ? 0 : 0.08);
  }
  function grow0(obj: Group, stage: number, o: number) {
    pieces.push({
      stage,
      o,
      k: 3,
      apply(p) {
        obj.visible = p > 0.001;
        obj.scale.y = Math.max(0.001, easeOut(p));
        obj.position.y = TOP * (1 - obj.scale.y);
      },
    });
    add(obj);
  }
  const slopeAngle = Math.atan2(RIDGE - TOP, EAVE);
  const slopeLen = Math.hypot(EAVE, RIDGE - TOP);
  for (const side of [1, -1]) {
    const plane = box(W + 1.0, 0.14, slopeLen + 0.05, tile, 0, (TOP + RIDGE) / 2 + 0.1, (side * EAVE) / 2);
    plane.rotation.x = side * slopeAngle;
    const y = plane.position.y;
    const z = plane.position.z;
    pieces.push({
      stage: 4,
      o: side > 0 ? 0.25 : 0.4,
      k: 2.6,
      apply(p) {
        const e = easeOut(p);
        plane.visible = p > 0.001;
        // desliza pela água do telhado
        plane.position.y = y + (1 - e) * 1.6;
        plane.position.z = z + side * (1 - e) * 1.2;
      },
    });
    add(plane);
    // fiadas de telha (relevo)
    for (let r = 1; r < 6; r++) {
      const f = r / 6;
      const rib = box(W + 1.0, 0.05, 0.08, tile, 0, lerp(TOP, RIDGE, f) + 0.2, side * EAVE * (1 - f));
      drop(rib, 4, 0.55 + r * 0.06, 6, 0.4);
    }
  }
  const ridge = box(W + 1.1, 0.16, 0.36, tile, 0, RIDGE + 0.12, 0);
  extend(ridge, 4, 0.75, 4);

  // ------------------------------------------------------------ 5 · acabamento
  const finishOpenings = (defs: WallDef[]) => {
    let i = 0;
    for (const w of defs) {
      for (const o of w.openings) {
        const mid = wallPoint(w, (o.u0 + o.u1) / 2);
        const ow = o.u1 - o.u0;
        const oh = o.y1 - o.y0;
        const cy = (o.y0 + o.y1) / 2;
        const offset = (T / 2 + 0.01) * w.out;
        const g = new Group();
        const along = (len: number, h: number, d: number) => (w.axis === 'x' ? new BoxGeometry(len, h, d) : new BoxGeometry(d, h, len));
        const place = (m: Mesh, u: number, y: number, n = 0) => {
          if (w.axis === 'x') m.position.set(mid.x + u, y, mid.z + n);
          else m.position.set(mid.x + n, y, mid.z + u);
          g.add(m);
        };
        if (o.door) {
          place(new Mesh(geo(along(ow - 0.06, oh - 0.04, 0.08)), wood), 0, cy, offset * 0.5);
          place(new Mesh(geo(along(0.36, 0.26, 0.02)), glass), 0, o.y1 - 0.45, offset * 0.5 + w.out * 0.05);
        } else {
          place(new Mesh(geo(along(ow - 0.04, oh - 0.04, 0.04)), glass), 0, cy, 0);
          place(new Mesh(geo(along(ow + 0.12, 0.08, 0.12)), frame), 0, o.y1 + 0.02, offset);
          place(new Mesh(geo(along(ow + 0.24, 0.07, 0.24)), frame), 0, o.y0 - 0.02, offset);
          place(new Mesh(geo(along(0.06, oh, 0.06)), frame), 0, cy, offset);
          place(new Mesh(geo(along(ow, 0.05, 0.06)), frame), 0, cy, offset);
          place(new Mesh(geo(along(0.06, oh, 0.08)), frame), -ow / 2, cy, offset);
          place(new Mesh(geo(along(0.06, oh, 0.08)), frame), ow / 2, cy, offset);
        }
        pop(g, 5, 0.05 + (i++ % 8) * 0.05, 4);
        // a escala parte do centro da janela
        g.children.forEach((c) => c.position.sub(new Vector3(mid.x, cy, mid.z)));
        g.position.set(mid.x, cy, mid.z);
      }
    }
  };
  finishOpenings(lower);
  finishOpenings(upper);

  // degraus, calçada e jardim
  extend(box(2.2, 0.15, 0.8, concrete, 0, 0.075, D / 2 + 0.4), 5, 0.4, 4);
  extend(box(1.4, 0.04, 5, path, 0, 0.02, D / 2 + 3.3), 5, 0.5, 3);
  extend(box(W + 6, 0.03, 4.2, grass, -0.0, 0.015, D / 2 + 3.2), 5, 0.45, 2.4);
  const tree = new Group();
  const trunk = new Mesh(geo(new CylinderGeometry(0.12, 0.16, 1.6, 8)), wood);
  trunk.position.y = 0.8;
  const crown = new Mesh(geo(new SphereGeometry(1.1, 18, 14)), leaf);
  crown.position.y = 2.2;
  tree.add(trunk, crown);
  tree.position.set(-W / 2 - 2.6, 0, D / 2 + 1.6);
  pop(tree, 5, 0.6, 3.5);
  const shrubGeo = geo(new ConeGeometry(0.45, 1.1, 10));
  [-2.8, -1.6, 1.6, 2.8].forEach((x, i) => {
    const s = new Mesh(shrubGeo, leaf);
    s.position.set(x, 0.55, D / 2 + 0.55);
    pop(s, 5, 0.7 + i * 0.05, 4);
  });

  // ------------------------------------------------------------ estado
  type B7 = [number, number, number, number, number, number, number];
  const target = { b: [0, 0, 0, 0, 0, 0, 0] as B7, px: 0, py: 0 };
  const cur = { b: [0, 0, 0, 0, 0, 0, 0] as B7, px: 0, py: 0 };
  let raf = 0;
  let last = 0;
  const lookAt = new Vector3();

  const applyAll = () => {
    const b = cur.b;
    for (const pc of pieces) pc.apply(clamp01(((b[pc.stage] ?? 0) - pc.o) * pc.k));

    const t = (b[1] + b[2] + b[3] + b[4] + b[5] + b[6]) / 6;
    // terreno
    stakes.visible = b[0] > 0.001 && b[5] < 0.6;
    stakes.scale.y = Math.max(0.001, easeOut(clamp01(b[0] * 1.4)) * (1 - smooth(0.2, 0.6, b[5])));
    stringMat.opacity = clamp01(b[0] * 2 - 0.6) * (1 - smooth(0.1, 0.4, b[5]));
    ghostMat.opacity = clamp01(b[0] * 1.6) * lerp(0.6, 0.0, smooth(0.15, 0.95, t));
    ghost.visible = ghostMat.opacity > 0.01;

    // pintura: tijolo vira reboco pintado
    const paint = smooth(0, 0.5, b[5]);
    brickA.color.copy(BRICK_A).lerp(PLASTER, paint);
    brickB.color.copy(BRICK_B).lerp(PLASTER, paint);
    brickUpA.color.copy(BRICK_A).lerp(PLASTER_UP, paint);
    brickUpB.color.copy(BRICK_B).lerp(PLASTER_UP, paint);

    // andaime monta na laje e desmonta no acabamento
    const sb = (scaffold.userData.build as number) ?? 0;
    const sOut = smooth(0.05, 0.35, b[5]);
    scaffold.scale.y = Math.max(0.001, sb * (1 - sOut));
    scaffold.visible = scaffold.scale.y > 0.01;

    // chaves: luzes acesas, entardecer
    const keys = smooth(0, 0.8, b[6]);
    glass.emissiveIntensity = keys * 1.6;
    glass.color.set('#1c3550').lerp(new Color('#ffcf7a'), keys * 0.35);
    warmLow.intensity = keys * 26;
    warmUp.intensity = keys * 26;
    porch.intensity = keys * 14;
    hemi.intensity = lerp(1.25, 0.5, keys);
    sun.intensity = lerp(2.4, 0.9, keys);
    sun.color.set('#ffffff').lerp(new Color('#ffb877'), keys);

    // câmera: começa vendo a planta de cima e desce girando conforme a obra sobe
    const aspect = camera.aspect;
    const fit = aspect < 1 ? lerp(1.9, 1.22, clamp01((aspect - 0.45) / 0.55)) : aspect < 1.6 ? 1.22 : 1;
    let phi: number;
    let theta: number;
    let radius: number;
    if (opts.reducedMotion) {
      phi = 1.12;
      theta = 0.5;
      radius = 25 * fit;
    } else {
      phi = lerp(0.32, 1.12, smooth(0, 0.42, t)) + 0.08 * smooth(0.8, 1, t);
      theta = lerp(0.85, -0.45, smooth(0, 1, t)) + cur.px * 0.12;
      phi += cur.py * 0.05;
      radius = lerp(30, 24, smooth(0, 0.7, t)) * fit;
    }
    lookAt.set(0, lerp(1.2, aspect < 1.6 ? 2.9 : 3.4, smooth(0, 0.8, t)), 0);
    camera.position.set(
      lookAt.x + radius * Math.sin(phi) * Math.sin(theta),
      lookAt.y + radius * Math.cos(phi),
      lookAt.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(lookAt);
  };

  const frameLoop = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now;
    let moving = false;
    const f = opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    for (let i = 0; i < 7; i++) {
      const d = (target.b[i] ?? 0) - (cur.b[i] ?? 0);
      if (Math.abs(d) > 0.0005) {
        cur.b[i] = (cur.b[i] ?? 0) + d * f;
        moving = true;
      } else cur.b[i] = target.b[i] ?? 0;
    }
    for (const key of ['px', 'py'] as const) {
      const d = target[key] - cur[key];
      if (Math.abs(d) > 0.0005) {
        cur[key] += d * (1 - Math.exp(-dt * 4));
        moving = true;
      } else cur[key] = target[key];
    }
    applyAll();
    renderer.render(scene, camera);
    if (moving) raf = requestAnimationFrame(frameLoop);
    else last = 0;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frameLoop);
  };

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    kick();
  };
  resize();

  return {
    setStages(b) {
      for (let i = 0; i < 6; i++) target.b[i + 1] = b[i] ?? 0;
      kick();
    },
    setIntro(b0) {
      target.b[0] = b0;
      kick();
    },
    setPointer(x, y) {
      if (opts.reducedMotion) return;
      target.px = x;
      target.py = y;
      kick();
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
