/**
 * Décor des planètes toon, décrit par une table de types (arbre, rocher,
 * colline-terrier, sucette, château…). Chaque type est fait de pièces rendues
 * en InstancedMesh (un appel de dessin par pièce, couleur par instance).
 * Obstacles simples : cercle (voiture) contre cercle (décor) sur la sphère.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { URandom } from '../unity/math';
import type { PlanetDef } from './planets';
import { toonGradient } from './toon';

export interface Obstacle {
  /** Direction unitaire (espace planète). */
  dir: THREE.Vector3;
  /** Rayon de collision (unités monde). */
  radius: number;
}

interface Part {
  mesh: THREE.InstancedMesh;
}

const MAX = 40;
const UP = new THREE.Vector3(0, 1, 0);

function part(geo: THREE.BufferGeometry, parent: THREE.Object3D, opts: { flat?: boolean; map?: THREE.Texture; mat?: THREE.Material } = {}): Part {
  const mat = opts.mat ?? new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: opts.map ?? null });
  if (opts.flat) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { mesh };
}

// ------------------------------------------------------------ textures dessinées
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bloc « ? » (ton chaud, teinté par instance). */
const questionTexture = () =>
  canvasTex(64, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(120,70,0,0.55)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 58, 58);
    g.fillStyle = 'rgba(120,70,0,0.9)';
    for (const [x, y] of [[10, 10], [54, 10], [10, 54], [54, 54]]) g.fillRect(x - 3, y - 3, 6, 6);
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#7a4a10';
    g.fillText('?', 34, 36);
    g.fillStyle = '#fff8e0';
    g.fillText('?', 32, 34);
  });

/** Cube à lettre de jouet : fond (teinté), cadre clair, lettre sombre. */
const letterTexture = (letter: string) =>
  canvasTex(64, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 52, 52);
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3a3a3a';
    g.fillText(letter, 32, 35);
  });

/** Cadran d'horloge arrêté à 10 h 04. */
const clockTexture = () =>
  canvasTex(128, (g, n) => {
    const c = n / 2;
    g.fillStyle = '#fffdf2';
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 6;
    g.stroke();
    g.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (c - 10), c + Math.sin(a) * (c - 10));
      g.lineTo(c + Math.cos(a) * (c - 22), c + Math.sin(a) * (c - 22));
      g.stroke();
    }
    const hand = (a: number, len: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len);
      g.stroke();
    };
    hand(((10 + 4 / 60) / 12) * Math.PI * 2, c * 0.5, 7);
    hand((4 / 60) * Math.PI * 2, c * 0.78, 5);
  });

// ------------------------------------------------------------ géométries
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)))!;

/** Cylindre entre deux points. */
function beam(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  return g.translate(a.x, a.y, a.z);
}

function palmLeaves(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.SphereGeometry(0.2, 8, 4);
    g.scale(0.32, 0.08, 1);
    g.translate(0, 0, 0.19);
    g.rotateX(0.45);
    g.rotateY((i / 6) * Math.PI * 2 + 0.3);
    leaves.push(g);
  }
  return merge(leaves).translate(0.06, 0.56, 0);
}

function mushroomSpots(): THREE.BufferGeometry {
  const spots: THREE.BufferGeometry[] = [];
  for (const [x, y, z] of [[0, 1, 0], [0.75, 0.55, 0], [-0.75, 0.55, 0], [0, 0.55, 0.75], [0, 0.55, -0.75], [0.5, 0.35, 0.6], [-0.5, 0.35, -0.6]]) {
    const v = new THREE.Vector3(x, y, z).normalize();
    const g = new THREE.SphereGeometry(0.055, 8, 6).scale(1, 0.35, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, v));
    g.translate(v.x * 0.22, 0.2 + v.y * 0.15, v.z * 0.22);
    spots.push(g);
  }
  return merge(spots);
}

function lollipopSwirl(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 6;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.15 * t, Math.sin(a) * 0.15 * t, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const front = new THREE.TubeGeometry(curve, 80, 0.012, 5, false).translate(0, 0, 0.028);
  const back = front.clone().translate(0, 0, -0.056);
  return merge([front, back]).translate(0, 0.42, 0);
}

function star(r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ShapeGeometry(s);
}

function grassTuft(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = 0.12 + (i % 3) * 0.035;
    const g = new THREE.ConeGeometry(0.022, h, 4).translate(0, h / 2, 0);
    g.rotateZ(Math.cos(a) * 0.25);
    g.rotateX(Math.sin(a) * 0.25);
    gs.push(g.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05));
  }
  return merge(gs);
}

function baobabTrunk(): THREE.BufferGeometry {
  const prof = [[0.0, 0], [0.11, 0], [0.12, 0.08], [0.1, 0.25], [0.07, 0.4], [0.05, 0.46], [0.0, 0.46]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 12);
  const branches = [0, 1, 2, 3].map((i) => beam(new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(Math.cos(i * 1.6) * 0.14, 0.52, Math.sin(i * 1.6) * 0.14), 0.02));
  return merge([g, ...branches]);
}

function baobabCanopy(): THREE.BufferGeometry {
  return merge([0, 1, 2, 3].map((i) => new THREE.SphereGeometry(0.08, 10, 6).scale(1.3, 0.55, 1.3).translate(Math.cos(i * 1.6) * 0.14, 0.54, Math.sin(i * 1.6) * 0.14)));
}

function castleWalls(): THREE.BufferGeometry {
  const gs = [new THREE.CylinderGeometry(0.2, 0.22, 0.48, 16).translate(0, 0.24, 0), new THREE.BoxGeometry(0.62, 0.22, 0.62).translate(0, 0.11, 0)];
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) gs.push(new THREE.CylinderGeometry(0.075, 0.08, 0.42, 12).translate(x, 0.21, z));
  gs.push(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 12).translate(0, 0.6, 0));
  return merge(gs);
}

function castleSpires(): THREE.BufferGeometry {
  const gs = [new THREE.ConeGeometry(0.25, 0.3, 16).translate(0, 0.63, 0), new THREE.ConeGeometry(0.13, 0.3, 12).translate(0, 0.87, 0)];
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) gs.push(new THREE.ConeGeometry(0.1, 0.24, 12).translate(x, 0.54, z));
  return merge(gs);
}

function lampArms(): THREE.BufferGeometry {
  const a = new THREE.Vector3(0, 0.04, 0);
  const b = new THREE.Vector3(0.1, 0.36, 0);
  const c = new THREE.Vector3(-0.08, 0.6, 0);
  return merge([new THREE.CylinderGeometry(0.14, 0.15, 0.04, 20).translate(0, 0.02, 0), beam(a, b, 0.018), beam(b, c, 0.018), new THREE.SphereGeometry(0.03, 8, 6).translate(b.x, b.y, b.z)]);
}

function lampHead(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.04, 0.11, 0.16, 16, 1, true);
  g.rotateZ(-2.2);
  return g.translate(-0.12, 0.58, 0);
}

// ------------------------------------------------------------ types de décor
type Colors = NonNullable<PlanetDef['decorColors']>;
interface PartSpec {
  geo: () => THREE.BufferGeometry;
  color: (c: Colors, r: URandom) => string;
  flat?: boolean;
  map?: () => THREE.Texture;
  mat?: () => THREE.Material;
}
interface KindSpec {
  parts: PartSpec[];
  /** Espacement minimal avec les autres objets (unités monde). */
  space: number;
  /** Rayon d'obstacle (unités monde, × échelle) ; 0 = traversable. */
  hit: number;
  scale: [number, number];
  max: number;
  /** Sans rotation aléatoire (objets alignés, ex. tuyaux). */
  noYaw?: boolean;
  /** Hauteur de flottement (unités monde). */
  lift?: number;
}

/** Visage fâché du bloc écraseur (pierre teintée par instance). */
const angryTexture = () =>
  canvasTex(64, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) g.fillRect(4 + (i % 3) * 20, 4 + Math.floor(i / 3) * 40, 16, 16);
    g.fillStyle = '#1a1a1a';
    g.beginPath();
    g.moveTo(12, 22); g.lineTo(28, 28); g.lineTo(12, 30); g.fill();
    g.beginPath();
    g.moveTo(52, 22); g.lineTo(36, 28); g.lineTo(52, 30); g.fill();
    g.fillRect(16, 42, 32, 8);
    g.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) g.fillRect(18 + i * 8, 42, 4, 8);
  });

function ghostBody(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.13, 18, 12);
  const tail = new THREE.ConeGeometry(0.1, 0.16, 12).rotateX(Math.PI).rotateZ(0.5).translate(0.09, -0.07, 0);
  const arms = [-1, 1].map((sx) => new THREE.SphereGeometry(0.035, 8, 6).translate(sx * 0.12, -0.03, 0.06));
  return merge([head, tail, ...arms]);
}

function deadTree(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return merge([
    beam(v(0, 0, 0), v(0.03, 0.32, 0), 0.035),
    beam(v(0.03, 0.3, 0), v(0.16, 0.45, 0.03), 0.018),
    beam(v(0.02, 0.22, 0), v(-0.14, 0.36, -0.04), 0.016),
    beam(v(0.03, 0.31, 0), v(0.0, 0.5, -0.1), 0.014),
  ]);
}

function tireStack(): THREE.BufferGeometry {
  return merge([0, 1, 2].map((i) => new THREE.TorusGeometry(0.1, 0.045, 8, 18).rotateX(Math.PI / 2).translate(0, 0.045 + i * 0.085, 0)));
}

const pick = (v: string | string[] | undefined, r: URandom, fallback: string): string =>
  Array.isArray(v) ? v[r.rangeInt(0, v.length)] ?? fallback : v ?? fallback;
const fixed = (c: string) => () => c;

const KINDS: Record<string, KindSpec> = {
  houses: { space: 0.5, hit: 0.34, scale: [1, 1], max: 4, parts: [
    { geo: () => new THREE.CylinderGeometry(0.3, 0.32, 0.26, 18).translate(0, 0.13, 0), color: (c) => c.house },
    { geo: () => new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.24, 0), color: (c) => c.roof },
    { geo: () => new THREE.BoxGeometry(0.11, 0.17, 0.04).translate(0, 0.085, 0.31), color: (c) => c.trunk },
  ] },
  trees: { space: 0.25, hit: 0.1, scale: [0.8, 1.3], max: MAX, parts: [
    { geo: () => new THREE.CylinderGeometry(0.035, 0.06, 0.42, 7).translate(0, 0.21, 0), color: (c) => c.trunk },
    { geo: () => new THREE.IcosahedronGeometry(0.26, 3).translate(0, 0.52, 0), color: (c, r) => pick(c.canopy, r, '#4fbf45') },
  ] },
  rocks: { space: 0.2, hit: 0.13, scale: [0.6, 1.4], max: MAX, parts: [
    { geo: () => new THREE.DodecahedronGeometry(0.16, 0).translate(0, 0.05, 0), color: (c) => c.rock, flat: true },
  ] },
  palms: { space: 0.3, hit: 0.08, scale: [0.85, 1.25], max: 12, parts: [
    { geo: () => new THREE.CylinderGeometry(0.028, 0.05, 0.58, 7, 4).translate(0, 0.29, 0).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.12, 0, 0, 0)), color: (c) => c.trunk },
    { geo: palmLeaves, color: (c, r) => pick(c.canopy, r, '#3fbf4a') },
  ] },
  mushrooms: { space: 0.35, hit: 0.12, scale: [0.9, 1.4], max: 12, parts: [
    { geo: () => new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10).translate(0, 0.11, 0), color: (c) => c.trunk },
    { geo: () => new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.2, 0), color: (c) => c.canopy[0] ?? '#e8302a' },
    { geo: mushroomSpots, color: fixed('#ffffff') },
  ] },
  pipes: { space: 0.35, hit: 0.17, scale: [1, 1], max: 12, noYaw: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.13, 0.13, 0.3, 16).translate(0, 0.15, 0), color: (c) => c.house },
    { geo: () => new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16).translate(0, 0.33, 0), color: (c) => c.house },
  ] },
  // Blocs « ? » flottants : décor seul, la voiture passe dessous
  blocks: { space: 0.25, hit: 0, scale: [1, 1], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.36, 0), color: (c) => c.roof, map: questionTexture },
  ] },
  cubetrees: { space: 0.28, hit: 0.1, scale: [0.85, 1.25], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.07, 0.3, 0.07).translate(0, 0.15, 0), color: (c) => c.trunk },
    { geo: () => new THREE.BoxGeometry(0.3, 0.26, 0.3).translate(0, 0.4, 0), color: (c, r) => pick(c.canopy, r, '#3f8f2a'), flat: true },
  ] },
  // --- Astéroïde B 612
  roses: { space: 0.3, hit: 0.1, scale: [1, 1], max: 2, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.012, 0.014, 0.16, 6).translate(0, 0.08, 0), new THREE.SphereGeometry(0.03, 6, 4).scale(1.6, 0.4, 0.8).translate(0.03, 0.07, 0)]), color: fixed('#3f9a3a') },
    { geo: () => merge([0, 1, 2, 3].map((i) => new THREE.SphereGeometry(0.035, 10, 8).translate(Math.cos(i * 1.57) * 0.02, 0.18 + (i === 3 ? 0.02 : 0), Math.sin(i * 1.57) * 0.02))), color: (c) => String(c.rose ?? '#e8233a') },
    { geo: () => new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.35, 1).translate(0, 0.02, 0), color: fixed('#d8f4ff'),
      mat: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }) },
  ] },
  baobabs: { space: 0.3, hit: 0.1, scale: [0.9, 1.3], max: 6, parts: [
    { geo: baobabTrunk, color: (c) => c.trunk },
    { geo: baobabCanopy, color: (c, r) => pick(c.canopy, r, '#4f9a3a') },
  ] },
  volcanoes: { space: 0.3, hit: 0.14, scale: [0.9, 1.2], max: 4, parts: [
    { geo: () => new THREE.CylinderGeometry(0.06, 0.18, 0.16, 14).translate(0, 0.08, 0), color: (c) => String(c.volcano ?? '#8a5a3a') },
    { geo: () => new THREE.CircleGeometry(0.055, 14).rotateX(-Math.PI / 2).translate(0, 0.161, 0), color: fixed('#ff7a2a'),
      mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.3) }) },
  ] },
  // --- Planète Bonbons
  lollipops: { space: 0.3, hit: 0.08, scale: [0.9, 1.3], max: 12, parts: [
    { geo: () => new THREE.CylinderGeometry(0.014, 0.014, 0.34, 8).translate(0, 0.17, 0), color: fixed('#ffffff') },
    { geo: () => new THREE.CylinderGeometry(0.16, 0.16, 0.05, 28).rotateX(Math.PI / 2).translate(0, 0.42, 0), color: (c, r) => pick(c.canopy, r, '#ff3b4e') },
    { geo: lollipopSwirl, color: fixed('#ffffff') },
  ] },
  gumdrops: { space: 0.22, hit: 0.1, scale: [0.8, 1.3], max: 16, parts: [
    { geo: () => new THREE.SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1), color: (c, r) => pick(c.canopy, r, '#3fd65a') },
  ] },
  // --- Hill Valley
  clocktowers: { space: 0.6, hit: 0.34, scale: [1, 1], max: 1, parts: [
    { geo: () => merge([new THREE.BoxGeometry(0.62, 0.42, 0.42).translate(0, 0.21, 0), new THREE.BoxGeometry(0.24, 0.36, 0.24).translate(0, 0.6, 0)]), color: (c) => String(c.tower ?? '#e8dcc0') },
    { geo: () => merge([new THREE.ConeGeometry(0.2, 0.22, 4).rotateY(Math.PI / 4).translate(0, 0.89, 0), new THREE.BoxGeometry(0.66, 0.05, 0.46).translate(0, 0.43, 0)]), color: (c) => c.roof },
    { geo: () => new THREE.CircleGeometry(0.09, 24).translate(0, 0.64, 0.122), color: fixed('#ffffff'), map: clockTexture },
    { geo: () => merge([-0.2, -0.07, 0.07, 0.2].map((x) => new THREE.BoxGeometry(0.06, 0.16, 0.02).translate(x, 0.2, 0.212))), color: fixed('#3a4a6a') },
  ] },
  // --- La Comté : collines-terriers à porte ronde
  hills: { space: 0.5, hit: 0.42, scale: [0.9, 1.15], max: 5, parts: [
    { geo: () => new THREE.SphereGeometry(0.5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), color: (c) => c.house },
    { geo: () => new THREE.CircleGeometry(0.1, 24).rotateX(-0.5).translate(0, 0.12, 0.445), color: (c, r) => pick(c.door, r, '#2f8a3a') },
    { geo: () => new THREE.RingGeometry(0.1, 0.125, 24).rotateX(-0.5).translate(0, 0.12, 0.443), color: fixed('#7a5230') },
    { geo: () => merge([-1, 1].map((sx) => new THREE.CircleGeometry(0.045, 16).rotateY(sx * 0.6).rotateX(-0.55).translate(sx * 0.24, 0.13, 0.385))), color: (c) => String(c.window ?? '#ffe9a0') },
    { geo: () => new THREE.CylinderGeometry(0.025, 0.03, 0.12, 8).translate(0.18, 0.27, -0.12), color: fixed('#8a7a6a') },
  ] },
  // --- Route des Herbes Hautes
  cabins: { space: 0.45, hit: 0.3, scale: [1, 1], max: 3, parts: [
    { geo: () => new THREE.BoxGeometry(0.44, 0.26, 0.34).translate(0, 0.13, 0), color: (c) => c.house },
    { geo: () => merge([new THREE.BoxGeometry(0.5, 0.08, 0.4).translate(0, 0.3, 0), new THREE.BoxGeometry(0.46, 0.05, 0.02).translate(0, 0.2, 0.172)]), color: (c) => c.roof },
    { geo: () => new THREE.BoxGeometry(0.13, 0.16, 0.02).translate(0, 0.08, 0.172), color: fixed('#5ac8ff') },
  ] },
  tallgrass: { space: 0.12, hit: 0, scale: [0.9, 1.4], max: MAX, parts: [
    { geo: grassTuft, color: (c, r) => pick(c.grass, r, '#3fae45') },
  ] },
  balls: { space: 0.2, hit: 0.07, scale: [0.9, 1.2], max: 8, parts: [
    { geo: () => new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.075, 0), color: fixed('#e8333a') },
    { geo: () => new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, 0.075, 0), color: fixed('#f6f6f6') },
    { geo: () => new THREE.TorusGeometry(0.075, 0.009, 6, 24).rotateX(Math.PI / 2).translate(0, 0.075, 0), color: fixed('#222222') },
    { geo: () => merge([new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14).rotateX(Math.PI / 2).translate(0, 0.075, 0.076)]), color: fixed('#ffffff') },
  ] },
  // --- Royaume Enchanté
  castles: { space: 0.7, hit: 0.42, scale: [1, 1], max: 1, parts: [
    { geo: castleWalls, color: (c) => c.house },
    { geo: castleSpires, color: (c) => c.roof },
    { geo: () => new THREE.BoxGeometry(0.12, 0.16, 0.02).translate(0, 0.08, 0.312), color: fixed('#7a5a8a') },
  ] },
  // --- Chambre de Jouets
  toyblocks: { space: 0.22, hit: 0.11, scale: [0.9, 1.3], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(0, 0.09, 0), color: (c, r) => pick(c.canopy, r, '#ff4a3a'), map: () => letterTexture('A') },
  ] },
  toyblocksB: { space: 0.22, hit: 0.11, scale: [0.9, 1.3], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(0, 0.09, 0), color: (c, r) => pick(c.canopy, r, '#3a8bff'), map: () => letterTexture('B') },
  ] },
  toyblocksC: { space: 0.22, hit: 0.11, scale: [0.9, 1.3], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(0, 0.09, 0), color: (c, r) => pick(c.canopy, r, '#ffd23a'), map: () => letterTexture('C') },
  ] },
  luxoballs: { space: 0.3, hit: 0.13, scale: [1, 1.2], max: 4, parts: [
    { geo: () => new THREE.SphereGeometry(0.14, 24, 16).translate(0, 0.14, 0), color: fixed('#ffd23a') },
    { geo: () => new THREE.TorusGeometry(0.14, 0.03, 8, 32).translate(0, 0.14, 0), color: fixed('#2f6bff') },
    { geo: () => merge([star(0.06).translate(0, 0, 0.141), star(0.06).rotateY(Math.PI).translate(0, 0, -0.141)]).translate(0, 0.14, 0), color: fixed('#ff3a3a') },
  ] },
  lamps: { space: 0.4, hit: 0.15, scale: [1.6, 1.6], max: 2, parts: [
    { geo: lampArms, color: (c) => c.trunk },
    { geo: lampHead, color: (c) => c.trunk, mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), side: THREE.DoubleSide }) },
    { geo: () => new THREE.SphereGeometry(0.035, 10, 8).translate(-0.17, 0.52, 0), color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 1.8) }) },
  ] },
  // --- Circuits
  floodlights: { space: 0.4, hit: 0.08, scale: [1, 1], max: 8, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.035, 0.05, 1.1, 8).translate(0, 0.55, 0), new THREE.BoxGeometry(0.42, 0.24, 0.08).rotateX(-0.4).translate(0, 1.14, 0.02)]), color: fixed('#9aa3ad') },
    { geo: () => new THREE.PlaneGeometry(0.36, 0.18).rotateX(-0.4).translate(0, 1.13, 0.065), color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2) }) },
  ] },
  tirestacks: { space: 0.25, hit: 0.11, scale: [0.9, 1.1], max: 16, parts: [
    { geo: tireStack, color: fixed('#1e1e22') },
  ] },
  thwomps: { space: 0.4, hit: 0.22, scale: [0.9, 1.1], max: 6, parts: [
    { geo: () => new THREE.BoxGeometry(0.4, 0.44, 0.4).translate(0, 0.22, 0), color: fixed('#a8a4b0'), map: angryTexture, flat: true },
  ] },
  torches: { space: 0.3, hit: 0.06, scale: [1, 1.2], max: 10, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.03, 0.04, 0.5, 8).translate(0, 0.25, 0), new THREE.CylinderGeometry(0.09, 0.05, 0.08, 10).translate(0, 0.52, 0)]), color: fixed('#3a3438') },
    { geo: () => new THREE.ConeGeometry(0.07, 0.2, 10).translate(0, 0.65, 0), color: fixed('#ff8a2a'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) }) },
  ] },
  ghosts: { space: 0.3, hit: 0, scale: [0.9, 1.3], max: 8, lift: 0.45, parts: [
    { geo: ghostBody, color: fixed('#f6f4ff'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x3a3a50) }) },
    { geo: () => merge([-1, 1].map((sx) => new THREE.SphereGeometry(0.022, 8, 6).scale(1, 1.5, 0.6).translate(sx * 0.045, 0.02, 0.12))), color: fixed('#1a1a2a') },
  ] },
  lanterns: { space: 0.25, hit: 0, scale: [0.9, 1.2], max: 12, lift: 0.55, parts: [
    { geo: () => new THREE.SphereGeometry(0.06, 14, 10), color: (c, r) => pick(c.lantern, r, '#8affd8'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) }) },
  ] },
  deadtrees: { space: 0.3, hit: 0.07, scale: [1, 1.5], max: 8, parts: [
    { geo: deadTree, color: (c) => c.trunk },
  ] },
  stars: { space: 0.3, hit: 0, scale: [0.9, 1.4], max: 16, lift: 0.5, parts: [
    { geo: () => new THREE.ExtrudeGeometry((() => { const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2; const rr = i % 2 ? 0.05 : 0.12; if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } return sh; })(), { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }).translate(0, 0, -0.02),
      color: fixed('#ffe14d'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x8a6a10) }) },
  ] },
};

/** Ordre de placement : les gros objets d'abord (ils trouvent toujours leur place). */
const ORDER = ['thwomps', 'floodlights', 'castles', 'clocktowers', 'hills', 'houses', 'cabins', 'lamps', 'volcanoes', 'roses', 'baobabs', 'pipes', 'luxoballs', 'lollipops', 'mushrooms', 'palms', 'trees', 'cubetrees', 'toyblocks', 'gumdrops', 'balls', 'rocks', 'blocks', 'tallgrass', 'tirestacks', 'torches', 'deadtrees', 'ghosts', 'lanterns', 'stars'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Decor {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  private readonly parts = new Map<string, Part[]>();

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  /** Pièces d'un type, créées à la première utilisation (aucune pour les types absents). */
  private partsOf(kind: string): Part[] {
    let p = this.parts.get(kind);
    if (!p) {
      p = KINDS[kind].parts.map((s) => part(s.geo(), this.group, { flat: s.flat, map: s.map?.(), mat: s.mat?.() }));
      this.parts.set(kind, p);
    }
    return p;
  }

  /** Crée d'avance les pièces de toutes les planètes (précompilation des shaders). */
  prepare(defs: PlanetDef[]): void {
    for (const d of defs) for (const k of Object.keys(d.decor)) if (KINDS[k] && d.decor[k as keyof PlanetDef['decor']]) this.partsOf(k);
    for (const k of ['toyblocksB', 'toyblocksC']) if (defs.some((d) => d.decor.toyblocks)) this.partsOf(k);
  }

  /** Place le décor d'une planète (graine fixe par planète). */
  build(def: PlanetDef, radius: number, scale: number, avoid?: (dir: THREE.Vector3, margin: number) => boolean): void {
    this.obstacles.length = 0;
    for (const ps of this.parts.values()) for (const p of ps) p.mesh.count = 0;
    if (def.style !== 'toon' || !def.decorColors) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const rng = new URandom([...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    const col = def.decorColors;
    const start = new THREE.Vector3(0, 1, 0);
    const placed: { dir: THREE.Vector3; r: number }[] = [];
    const place = (minDist: number): THREE.Vector3 | null => {
      for (let tries = 0; tries < 50; tries++) {
        const d = rng.onUnitSphere();
        if (d.angleTo(start) < 0.5) continue; // départ dégagé
        if (placed.some((o) => o.dir.angleTo(d) * radius < minDist + o.r)) continue;
        if (avoid?.(d, minDist / radius)) continue; // pas sur la piste
        return d;
      }
      return null;
    };
    const counts: Record<string, number> = { ...(def.decor as Record<string, number>) };
    // Cubes à lettres : répartis entre A, B et C
    if (counts.toyblocks) {
      const n = counts.toyblocks;
      counts.toyblocks = Math.ceil(n / 3);
      counts.toyblocksB = Math.ceil((n - counts.toyblocks) / 2);
      counts.toyblocksC = n - counts.toyblocks - counts.toyblocksB;
    }
    const kinds = [...ORDER, 'toyblocksB', 'toyblocksC'];
    for (const kind of kinds) {
      const spec = KINDS[kind];
      const n = Math.min(counts[kind] ?? 0, spec?.max ?? 0);
      if (!spec || n <= 0) continue;
      const ps = this.partsOf(kind);
      for (let i = 0; i < n; i++) {
        const sc = rng.range(spec.scale[0], spec.scale[1]);
        const d = place(spec.space);
        if (!d) break;
        const yaw = spec.noYaw ? 0 : rng.range(0, Math.PI * 2);
        const tint = rng.range(0.93, 1.07);
        _q.setFromUnitVectors(UP, d);
        _q2.setFromAxisAngle(UP, yaw);
        _q.multiply(_q2);
        // Taille constante en unités monde malgré l'échelle de la planète
        _p.copy(d).multiplyScalar((radius + (spec.lift ?? 0) - 0.01) / scale);
        _s.setScalar(sc / scale);
        _m.compose(_p, _q, _s);
        spec.parts.forEach((s, j) => {
          const mesh = ps[j].mesh;
          const k = mesh.count++;
          mesh.setMatrixAt(k, _m);
          mesh.setColorAt(k, _c.set(s.color(col, rng)).multiplyScalar(tint));
        });
        placed.push({ dir: d, r: Math.max(spec.hit * sc, 0.05) });
        if (spec.hit > 0) this.obstacles.push({ dir: d, radius: spec.hit * sc });
      }
    }
    for (const ps of this.parts.values()) {
      for (const p of ps) {
        p.mesh.visible = p.mesh.count > 0;
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
