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
  /** Chocs reçus et chocs avant destruction (aléatoire ; Infinity pour les monuments). */
  hits: number;
  maxHits: number;
  /** Instance du décor (pièces et indice), pour la détruire. */
  ps?: Part[];
  k?: number;
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
  /** Décor animé qui flotte : amplitude de flottement (monde) et rotation (rad/s). */
  float?: { bob: number; spin?: number };
  /** Se tourne toujours vers le véhicule (blocs de la forteresse). */
  face?: boolean;
  /** Monument emblématique du monde (affiché aussi sur la planète du menu). */
  monument?: boolean;
  /** Gros monument indestructible (infranchissable) ; tout le reste vole en éclats. */
  solid?: boolean;
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

/** Panneau flottant « HILL VALLEY » (lettres rouges, cadre crème). */
const hillValleyTexture = () =>
  canvasTex(256, (g, n) => {
    g.fillStyle = '#f4ead2';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#3a2a1a';
    g.lineWidth = 10;
    g.strokeRect(8, 70, n - 16, n - 140);
    g.font = 'bold 30px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3a2a1a';
    g.fillText('WELCOME TO', n / 2, 98);
    g.font = 'bold 58px serif';
    g.fillStyle = '#c8261e';
    g.fillText('HILL VALLEY', n / 2, 142);
    g.font = 'bold 20px serif';
    g.fillStyle = '#3a2a1a';
    g.fillText('A NICE PLACE TO LIVE', n / 2, 172);
  });

/** Visage de citrouille (yeux et bouche lumineux sur fond transparent). */
const pumpkinFace = () =>
  canvasTex(64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#ffe28a';
    g.beginPath(); g.moveTo(14, 26); g.lineTo(24, 14); g.lineTo(28, 28); g.fill();
    g.beginPath(); g.moveTo(50, 26); g.lineTo(40, 14); g.lineTo(36, 28); g.fill();
    g.beginPath();
    g.moveTo(12, 38); g.lineTo(20, 46); g.lineTo(26, 40); g.lineTo(32, 48); g.lineTo(38, 40); g.lineTo(44, 46); g.lineTo(52, 38); g.lineTo(46, 54); g.lineTo(18, 54);
    g.fill();
  });

/** Taches de vache (noir sur blanc). */
const cowTexture = () =>
  canvasTex(64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1a1a1a';
    for (const [x, y, r] of [[12, 14, 9], [40, 10, 7], [28, 38, 11], [54, 44, 8], [8, 52, 6], [50, 26, 5]]) {
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, x * 0.1, 0, Math.PI * 2);
      g.fill();
    }
  });

/** Rayures de sucre d'orge (rouge et blanc, en biais). */
const caneTexture = () =>
  canvasTex(64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e8233a';
    for (let i = -64; i < 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 8 - 32, 64); g.lineTo(i - 32, 64);
      g.fill();
    }
  });

/** Bottes de foin (anneaux concentriques). */
const hayTexture = () =>
  canvasTex(64, (g) => {
    g.fillStyle = '#f0c85a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(160, 110, 30, 0.6)';
    g.lineWidth = 2;
    for (let i = 0; i < 64; i += 6) {
      g.beginPath(); g.moveTo(0, i + (i % 12)); g.lineTo(64, i + 3); g.stroke();
    }
  });

function spiralHill(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * Math.PI * 1.6;
    const r = 0.35 * (1 - t * 0.55);
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0.05 + Math.sin(t * Math.PI * 0.95) * 0.7 + t * 0.25, Math.sin(a) * r));
  }
  // Boucle finale : la fameuse spirale
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const a = Math.PI * 1.6 + t * Math.PI * 2;
    const r = 0.16 * (1 - t * 0.85);
    pts.push(new THREE.Vector3(Math.cos(a) * (0.16 + r), 0.92 + Math.sin(t * Math.PI * 2) * r, Math.sin(a) * 0.1));
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.06, 8, false);
  return merge([tube, new THREE.SphereGeometry(0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1)]);
}

function caneGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.45, 0)];
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector3(0.09 - Math.cos(a) * 0.09, 0.45 + Math.sin(a) * 0.1, 0));
  }
  pts.push(new THREE.Vector3(0.18, 0.36, 0));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.03, 8, false);
}

function xmasLights(): THREE.BufferGeometry {
  const cols = [[1, 0.2, 0.2], [1, 0.85, 0.2], [0.3, 0.6, 1], [0.4, 1, 0.4], [1, 0.4, 1]];
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    const t = i / 22;
    const h = 0.12 + t * 0.55;
    const r = 0.21 * (1 - t * 0.8);
    const a = i * 2.4;
    const g = new THREE.SphereGeometry(0.018, 6, 4).translate(Math.cos(a) * r, h, Math.sin(a) * r).toNonIndexed();
    const c = cols[i % cols.length];
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < arr.length; k += 3) arr.set(c, k);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    gs.push(g);
  }
  return mergeGeometries(gs)!;
}

function barnRoof(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.36, 0); sh.lineTo(0, 0.24); sh.lineTo(0.36, 0); sh.lineTo(-0.36, 0);
  return new THREE.ExtrudeGeometry(sh, { depth: 0.56, bevelEnabled: false }).translate(0, 0.36, -0.28);
}

function hogwarts(): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const walls: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.7, 0.32, 0.36).translate(0, 0.16, 0), new THREE.BoxGeometry(0.3, 0.5, 0.3).translate(-0.12, 0.25, -0.05)];
  const roofs: THREE.BufferGeometry[] = [];
  const wins: THREE.BufferGeometry[] = [];
  for (const [x, z, h, r] of [[-0.38, 0.12, 0.62, 0.07], [0.36, 0.14, 0.5, 0.065], [0.05, -0.2, 0.86, 0.08], [-0.22, -0.22, 0.7, 0.06], [0.3, -0.18, 0.66, 0.06]]) {
    walls.push(new THREE.CylinderGeometry(r, r * 1.08, h, 12).translate(x, h / 2, z));
    roofs.push(new THREE.ConeGeometry(r * 1.35, r * 3.2, 12).translate(x, h + r * 1.6, z));
    for (const y of [h * 0.55, h * 0.8]) wins.push(new THREE.BoxGeometry(0.025, 0.045, 0.02).translate(x, y, z + r));
  }
  for (let i = 0; i < 7; i++) wins.push(new THREE.BoxGeometry(0.03, 0.05, 0.02).translate(-0.3 + i * 0.1, 0.2, 0.181));
  return [merge(walls), merge(roofs), merge(wins)];
}

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

/** Statue géante de l'hoverboard rose (socle de pierre, planche inclinée). */
function hoverboard(): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const sh = new THREE.Shape();
  const w = 0.5;
  const h = 0.13;
  sh.moveTo(-w + h, -h);
  sh.lineTo(w - h, -h);
  sh.absarc(w - h, 0, h, -Math.PI / 2, Math.PI / 2, false);
  sh.lineTo(-w + h, h);
  sh.absarc(-w + h, 0, h, Math.PI / 2, (Math.PI * 3) / 2, false);
  // Planche posée sur la tranche, inclinée, au sommet d'un mât
  const tilt = new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationZ(0.45)).premultiply(new THREE.Matrix4().makeRotationX(-0.35)).premultiply(new THREE.Matrix4().makeTranslation(0, 0.86, 0));
  const board = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }).translate(0, 0, -0.0175).applyMatrix4(tilt);
  const stripes = merge([
    new THREE.BoxGeometry(0.16, 0.2, 0.012).translate(-0.18, 0, 0.034),
    new THREE.BoxGeometry(0.16, 0.2, 0.012).translate(-0.18, 0, -0.034),
    new THREE.BoxGeometry(0.06, 0.2, 0.012).translate(0.3, 0, 0.034),
    new THREE.BoxGeometry(0.06, 0.2, 0.012).translate(0.3, 0, -0.034),
  ]).applyMatrix4(tilt);
  const base = merge([
    new THREE.CylinderGeometry(0.2, 0.24, 0.16, 20).translate(0, 0.08, 0),
    new THREE.CylinderGeometry(0.035, 0.045, 0.7, 10).translate(0, 0.5, 0),
  ]);
  return [board, stripes, base];
}

/** Grande croix de cimetière sur un tertre. */
function crossGeo(): THREE.BufferGeometry {
  return merge([
    new THREE.BoxGeometry(0.075, 0.95, 0.075).translate(0, 0.5, 0),
    new THREE.BoxGeometry(0.46, 0.075, 0.075).translate(0, 0.7, 0),
    new THREE.SphereGeometry(0.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.4, 0.9),
  ]);
}

/** Chauve-souris (silhouette plate). */
function batGeo(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.04);
  s.lineTo(0.05, 0.02);
  s.lineTo(0.12, 0.06);
  s.lineTo(0.2, 0.0);
  s.lineTo(0.15, -0.01);
  s.lineTo(0.12, -0.05);
  s.lineTo(0.08, -0.02);
  s.lineTo(0.03, -0.05);
  s.lineTo(0, -0.03);
  s.lineTo(-0.03, -0.05);
  s.lineTo(-0.08, -0.02);
  s.lineTo(-0.12, -0.05);
  s.lineTo(-0.15, -0.01);
  s.lineTo(-0.2, 0.0);
  s.lineTo(-0.12, 0.06);
  s.lineTo(-0.05, 0.02);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Flocon à six branches. */
function snowflakeGeo(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) gs.push(new THREE.BoxGeometry(0.32, 0.03, 0.02).rotateZ((i * Math.PI) / 3));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    for (const sgn of [-1, 1]) gs.push(new THREE.BoxGeometry(0.07, 0.022, 0.02).rotateZ(a + sgn * 0.8).translate(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0));
  }
  return merge(gs);
}

/** Bonbon emballé (corps + papillotes). */
function candyGeo(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  return [
    new THREE.SphereGeometry(0.07, 16, 10).scale(1.35, 1, 1),
    merge([new THREE.ConeGeometry(0.05, 0.09, 10).rotateZ(Math.PI / 2).translate(0.13, 0, 0), new THREE.ConeGeometry(0.05, 0.09, 10).rotateZ(-Math.PI / 2).translate(-0.13, 0, 0)]),
  ];
}

const pick = (v: string | string[] | undefined, r: URandom, fallback: string): string =>
  Array.isArray(v) ? v[r.rangeInt(0, v.length)] ?? fallback : v ?? fallback;
const fixed = (c: string) => () => c;

const KINDS: Record<string, KindSpec> = {
  // --- Monuments ajoutés
  crosses: { space: 0.4, hit: 0.08, scale: [1.4, 1.9], max: 6, monument: true, parts: [
    { geo: crossGeo, color: (c) => String(c.cross ?? '#8a8496') },
  ] },
  hoverboard: { space: 0.7, hit: 0.24, scale: [2.4, 2.4], max: 1, monument: true, solid: true, parts: [
    { geo: () => hoverboard()[0], color: fixed('#ff5aa8'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x40102a) }) },
    { geo: () => hoverboard()[1], color: fixed('#ffe14d') },
    { geo: () => hoverboard()[2], color: fixed('#b8b2a8') },
  ] },
  bigtree: { space: 0.9, hit: 0.4, scale: [3.2, 3.2], max: 1, monument: true, solid: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.03, 0.04, 0.12, 7).translate(0, 0.06, 0), color: (c) => c.trunk },
    { geo: () => merge([0, 1, 2].map((i) => new THREE.ConeGeometry(0.24 - i * 0.06, 0.26, 12).translate(0, 0.2 + i * 0.16, 0))), color: fixed('#2f8a4a') },
    { geo: xmasLights, color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4), vertexColors: true }) },
    { geo: () => star(0.06).translate(0, 0.66, 0), color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.1, 0.5), side: THREE.DoubleSide }) },
  ] },
  // --- Décorations flottantes (animées)
  qblocks: { space: 0.4, hit: 0, scale: [1.2, 1.2], max: 8, lift: 1.4, float: { bob: 0.08, spin: 0.6 }, parts: [
    { geo: () => new THREE.BoxGeometry(0.22, 0.22, 0.22), color: fixed('#ffc21a'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: questionTexture(), emissive: new THREE.Color(0x3a2a00) }) },
  ] },
  coins: { space: 0.3, hit: 0, scale: [1.3, 1.3], max: 12, lift: 1.0, float: { bob: 0.06, spin: 3 }, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.09, 0.09, 0.022, 22).rotateX(Math.PI / 2), new THREE.BoxGeometry(0.025, 0.09, 0.03)]), color: fixed('#ffd23a'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x8a6a10) }) },
  ] },
  dragonballs: { space: 0.4, hit: 0, scale: [1.6, 1.6], max: 7, lift: 1.3, float: { bob: 0.1, spin: 0.8 }, parts: [
    { geo: () => new THREE.SphereGeometry(0.1, 20, 14), color: fixed('#ffa21a'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x6a3000) }) },
    { geo: () => merge([star(0.035).translate(0, 0, 0.101), star(0.035).rotateY(Math.PI).translate(0, 0, -0.101)]), color: fixed('#e8233a'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.15, 0.1), side: THREE.DoubleSide }) },
  ] },
  balloons: { space: 0.3, hit: 0, scale: [1.2, 1.6], max: 10, lift: 1.3, float: { bob: 0.12, spin: 0.3 }, parts: [
    { geo: () => merge([new THREE.SphereGeometry(0.12, 18, 12).scale(1, 1.18, 1), new THREE.ConeGeometry(0.025, 0.04, 8).rotateX(Math.PI).translate(0, -0.15, 0)]), color: (c, r) => pick(c.balloon, r, '#ff3b4e') },
    { geo: () => new THREE.CylinderGeometry(0.003, 0.003, 0.5, 4).translate(0, -0.42, 0), color: fixed('#f4f4f4') },
  ] },
  snowflakes: { space: 0.3, hit: 0, scale: [1.2, 1.7], max: 10, lift: 1.3, float: { bob: 0.1, spin: 0.7 }, parts: [
    { geo: snowflakeGeo, color: fixed('#ffffff'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x6a8aaa) }) },
  ] },
  bats: { space: 0.3, hit: 0, scale: [1.2, 1.6], max: 10, lift: 1.4, float: { bob: 0.15, spin: 1.2 }, parts: [
    { geo: batGeo, color: fixed('#1a1424'), mat: () => new THREE.MeshBasicMaterial({ color: 0x1a1424, side: THREE.DoubleSide }) },
  ] },
  candies: { space: 0.3, hit: 0, scale: [1.3, 1.7], max: 10, lift: 1.2, float: { bob: 0.1, spin: 1.5 }, parts: [
    { geo: () => candyGeo()[0], color: (c, r) => pick(c.canopy, r, '#ff3b8e') },
    { geo: () => candyGeo()[1], color: fixed('#fff4f8') },
  ] },
  skyblocks: { space: 0.4, hit: 0, scale: [1.2, 1.6], max: 8, lift: 1.5, float: { bob: 0.06, spin: 0.2 }, parts: [
    { geo: () => new THREE.BoxGeometry(0.28, 0.2, 0.28).translate(0, -0.04, 0), color: (c) => c.trunk, flat: true },
    { geo: () => new THREE.BoxGeometry(0.29, 0.08, 0.29).translate(0, 0.1, 0), color: (c, r) => pick(c.canopy, r, '#4fbf45'), flat: true },
  ] },
  houses: { space: 0.5, hit: 0.34, scale: [1, 1], max: 4, monument: true, solid: true, parts: [
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
  palms: { space: 0.3, hit: 0.08, scale: [0.85, 1.25], max: 12, monument: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.028, 0.05, 0.58, 7, 4).translate(0, 0.29, 0).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.12, 0, 0, 0)), color: (c) => c.trunk },
    { geo: palmLeaves, color: (c, r) => pick(c.canopy, r, '#3fbf4a') },
  ] },
  mushrooms: { space: 0.35, hit: 0.12, scale: [0.9, 1.4], max: 12, monument: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10).translate(0, 0.11, 0), color: (c) => c.trunk },
    { geo: () => new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.2, 0), color: (c) => c.canopy[0] ?? '#e8302a' },
    { geo: mushroomSpots, color: fixed('#ffffff') },
  ] },
  pipes: { space: 0.35, hit: 0.17, scale: [1, 1], max: 12, noYaw: true, monument: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.13, 0.13, 0.3, 16).translate(0, 0.15, 0), color: (c) => c.house },
    { geo: () => new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16).translate(0, 0.33, 0), color: (c) => c.house },
  ] },
  // Blocs « ? » flottants : décor seul, la voiture passe dessous
  blocks: { space: 0.25, hit: 0.1, scale: [1, 1], max: 12, parts: [
    { geo: () => new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.36, 0), color: (c) => c.roof, map: questionTexture },
  ] },
  cubetrees: { space: 0.28, hit: 0.1, scale: [0.85, 1.25], max: 12, monument: true, parts: [
    { geo: () => new THREE.BoxGeometry(0.07, 0.3, 0.07).translate(0, 0.15, 0), color: (c) => c.trunk },
    { geo: () => new THREE.BoxGeometry(0.3, 0.26, 0.3).translate(0, 0.4, 0), color: (c, r) => pick(c.canopy, r, '#3f8f2a'), flat: true },
  ] },
  // --- Astéroïde B 612
  roses: { space: 0.3, hit: 0.1, scale: [2, 2], max: 2, monument: true, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.012, 0.014, 0.16, 6).translate(0, 0.08, 0), new THREE.SphereGeometry(0.03, 6, 4).scale(1.6, 0.4, 0.8).translate(0.03, 0.07, 0)]), color: fixed('#3f9a3a') },
    { geo: () => merge([0, 1, 2, 3].map((i) => new THREE.SphereGeometry(0.035, 10, 8).translate(Math.cos(i * 1.57) * 0.02, 0.18 + (i === 3 ? 0.02 : 0), Math.sin(i * 1.57) * 0.02))), color: (c) => String(c.rose ?? '#e8233a') },
    { geo: () => new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.35, 1).translate(0, 0.02, 0), color: fixed('#d8f4ff'),
      mat: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }) },
  ] },
  baobabs: { space: 0.3, hit: 0.1, scale: [0.9, 1.3], max: 6, monument: true, parts: [
    { geo: baobabTrunk, color: (c) => c.trunk },
    { geo: baobabCanopy, color: (c, r) => pick(c.canopy, r, '#4f9a3a') },
  ] },
  volcanoes: { space: 0.3, hit: 0.14, scale: [1.3, 1.7], max: 4, monument: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.06, 0.18, 0.16, 14).translate(0, 0.08, 0), color: (c) => String(c.volcano ?? '#8a5a3a') },
    { geo: () => new THREE.CircleGeometry(0.055, 14).rotateX(-Math.PI / 2).translate(0, 0.161, 0), color: fixed('#ff7a2a'),
      mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.3) }) },
  ] },
  // --- Planète Bonbons
  lollipops: { space: 0.3, hit: 0.08, scale: [0.9, 1.3], max: 12, monument: true, parts: [
    { geo: () => new THREE.CylinderGeometry(0.014, 0.014, 0.34, 8).translate(0, 0.17, 0), color: fixed('#ffffff') },
    { geo: () => new THREE.CylinderGeometry(0.16, 0.16, 0.05, 28).rotateX(Math.PI / 2).translate(0, 0.42, 0), color: (c, r) => pick(c.canopy, r, '#ff3b4e') },
    { geo: lollipopSwirl, color: fixed('#ffffff') },
  ] },
  gumdrops: { space: 0.22, hit: 0.1, scale: [0.8, 1.3], max: 16, parts: [
    { geo: () => new THREE.SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1), color: (c, r) => pick(c.canopy, r, '#3fd65a') },
  ] },
  // --- Hill Valley
  clocktowers: { space: 0.6, hit: 0.34, scale: [1.9, 1.9], max: 1, monument: true, solid: true, parts: [
    { geo: () => merge([new THREE.BoxGeometry(0.62, 0.42, 0.42).translate(0, 0.21, 0), new THREE.BoxGeometry(0.24, 0.36, 0.24).translate(0, 0.6, 0)]), color: (c) => String(c.tower ?? '#e8dcc0') },
    { geo: () => merge([new THREE.ConeGeometry(0.2, 0.22, 4).rotateY(Math.PI / 4).translate(0, 0.89, 0), new THREE.BoxGeometry(0.66, 0.05, 0.46).translate(0, 0.43, 0)]), color: (c) => c.roof },
    { geo: () => new THREE.CircleGeometry(0.09, 24).translate(0, 0.64, 0.122), color: fixed('#ffffff'), map: clockTexture },
    { geo: () => merge([-0.2, -0.07, 0.07, 0.2].map((x) => new THREE.BoxGeometry(0.06, 0.16, 0.02).translate(x, 0.2, 0.212))), color: fixed('#3a4a6a') },
  ] },
  // --- La Comté : collines-terriers à porte ronde
  hills: { space: 0.5, hit: 0.42, scale: [1.1, 1.5], max: 5, monument: true, solid: true, parts: [
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
  castles: { space: 0.7, hit: 0.42, scale: [1.8, 1.8], max: 1, monument: true, solid: true, parts: [
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
  lamps: { space: 0.4, hit: 0.15, scale: [2.8, 2.8], max: 2, monument: true, solid: true, parts: [
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
  thwomps: { space: 0.4, hit: 0.22, scale: [1, 1.25], max: 6, lift: 0.3, face: true, float: { bob: 0.08 }, monument: true, solid: true, parts: [
    { geo: () => new THREE.BoxGeometry(0.4, 0.44, 0.4).translate(0, 0.22, 0), color: fixed('#a8a4b0'), map: angryTexture, flat: true },
  ] },
  torches: { space: 0.3, hit: 0.06, scale: [1, 1.2], max: 10, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.03, 0.04, 0.5, 8).translate(0, 0.25, 0), new THREE.CylinderGeometry(0.09, 0.05, 0.08, 10).translate(0, 0.52, 0)]), color: fixed('#3a3438') },
    { geo: () => new THREE.ConeGeometry(0.07, 0.2, 10).translate(0, 0.65, 0), color: fixed('#ff8a2a'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) }) },
  ] },
  ghosts: { space: 0.3, hit: 0, scale: [0.9, 1.3], max: 8, lift: 0.6, float: { bob: 0.1, spin: 0.5 }, parts: [
    { geo: ghostBody, color: fixed('#f6f4ff'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x3a3a50) }) },
    { geo: () => merge([-1, 1].map((sx) => new THREE.SphereGeometry(0.022, 8, 6).scale(1, 1.5, 0.6).translate(sx * 0.045, 0.02, 0.12))), color: fixed('#1a1a2a') },
  ] },
  lanterns: { space: 0.25, hit: 0, scale: [0.9, 1.2], max: 12, lift: 1.1, float: { bob: 0.1 }, parts: [
    { geo: () => new THREE.SphereGeometry(0.06, 14, 10), color: (c, r) => pick(c.lantern, r, '#8affd8'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) }) },
  ] },
  deadtrees: { space: 0.3, hit: 0.07, scale: [1, 1.5], max: 8, parts: [
    { geo: deadTree, color: (c) => c.trunk },
  ] },
  stars: { space: 0.3, hit: 0, scale: [1.2, 1.8], max: 16, lift: 1.3, float: { bob: 0.12, spin: 1.2 }, parts: [
    { geo: () => new THREE.ExtrudeGeometry((() => { const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2; const rr = i % 2 ? 0.05 : 0.12; if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } return sh; })(), { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 }).translate(0, 0, -0.02),
      color: fixed('#ffe14d'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x8a6a10) }) },
  ] },
  // --- Arc-en-ciel : anneaux dorés à traverser
  goldrings: { space: 0.6, hit: 0, scale: [1.4, 1.8], max: 6, monument: true, parts: [
    { geo: () => new THREE.TorusGeometry(0.55, 0.055, 10, 48).translate(0, 0.6, 0), color: fixed('#ffc93a'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0xb07a10) }) },
  ] },
  // --- Hill Valley : panneau flottant
  signs: { space: 0.6, hit: 0, scale: [1.8, 1.8], max: 3, lift: 1.7, float: { bob: 0.1 }, monument: true, parts: [
    { geo: () => new THREE.BoxGeometry(1.0, 0.56, 0.04), color: fixed('#5a3a22') },
    { geo: () => merge([new THREE.PlaneGeometry(0.96, 0.52).translate(0, 0, 0.022), new THREE.PlaneGeometry(0.96, 0.52).rotateY(Math.PI).translate(0, 0, -0.022)]), color: fixed('#ffffff'), map: hillValleyTexture },
  ] },
  // --- Poudlard
  hogcastle: { space: 0.8, hit: 0.45, scale: [2.4, 2.4], max: 1, monument: true, solid: true, parts: [
    { geo: () => hogwarts()[0], color: (c) => c.house, flat: true },
    { geo: () => hogwarts()[1], color: (c) => c.roof },
    { geo: () => hogwarts()[2], color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.0, 0.8) }) },
  ] },
  hoops: { space: 0.5, hit: 0.05, scale: [1.8, 2.2], max: 6, monument: true, parts: [
    { geo: () => merge([new THREE.CylinderGeometry(0.018, 0.024, 1.0, 8).translate(0, 0.5, 0), new THREE.TorusGeometry(0.16, 0.022, 8, 28).translate(0, 1.16, 0)]), color: (c) => String(c.gold ?? '#ffc93a'), mat: () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: new THREE.Color(0x6a4a08) }) },
  ] },
  candles: { space: 0.25, hit: 0, scale: [1.1, 1.5], max: 16, lift: 1.4, float: { bob: 0.08 }, parts: [
    { geo: () => new THREE.CylinderGeometry(0.024, 0.026, 0.13, 10), color: fixed('#fff6e0') },
    { geo: () => new THREE.ConeGeometry(0.018, 0.05, 8).translate(0, 0.09, 0), color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.8) }) },
  ] },
  // --- Ville d'Halloween
  spiralhill: { space: 0.8, hit: 0.35, scale: [2.4, 2.4], max: 1, monument: true, solid: true, parts: [
    { geo: spiralHill, color: fixed('#5a5468') },
  ] },
  pumpkins: { space: 0.22, hit: 0.1, scale: [0.8, 1.4], max: 14, parts: [
    { geo: () => new THREE.SphereGeometry(0.11, 16, 10).scale(1.15, 0.85, 1.15).translate(0, 0.09, 0), color: (c) => String(c.pumpkin ?? '#ff8a1a') },
    { geo: () => new THREE.CylinderGeometry(0.012, 0.018, 0.06, 6).translate(0, 0.2, 0), color: fixed('#3a5a2a') },
    { geo: () => new THREE.PlaneGeometry(0.14, 0.14).translate(0, 0.09, 0.128), color: fixed('#ffffff'), map: pumpkinFace,
      mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.6), transparent: true, depthWrite: false }) },
  ] },
  gravestones: { space: 0.22, hit: 0.08, scale: [0.8, 1.2], max: 12, parts: [
    { geo: () => merge([new THREE.BoxGeometry(0.16, 0.16, 0.05).translate(0, 0.08, 0), new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.16, 0)]), color: (c) => c.rock },
  ] },
  // --- Village de Noël
  xmastrees: { space: 0.35, hit: 0.14, scale: [0.9, 1.4], max: 10, parts: [
    { geo: () => new THREE.CylinderGeometry(0.03, 0.04, 0.12, 7).translate(0, 0.06, 0), color: (c) => c.trunk },
    { geo: () => merge([0, 1, 2].map((i) => new THREE.ConeGeometry(0.24 - i * 0.06, 0.26, 12).translate(0, 0.2 + i * 0.16, 0))), color: (c, r) => pick(c.canopy, r, '#2f8a4a') },
    { geo: xmasLights, color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4), vertexColors: true }) },
    { geo: () => star(0.06).translate(0, 0.66, 0), color: fixed('#ffffff'), mat: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.1, 0.5), side: THREE.DoubleSide }) },
  ] },
  gifts: { space: 0.2, hit: 0.1, scale: [0.8, 1.4], max: 14, parts: [
    { geo: () => new THREE.BoxGeometry(0.18, 0.15, 0.18).translate(0, 0.075, 0), color: (c, r) => pick(c.gift, r, '#e8333a') },
    { geo: () => merge([new THREE.BoxGeometry(0.19, 0.155, 0.035).translate(0, 0.075, 0), new THREE.BoxGeometry(0.035, 0.155, 0.19).translate(0, 0.075, 0), new THREE.TorusGeometry(0.035, 0.012, 6, 12).translate(-0.03, 0.17, 0), new THREE.TorusGeometry(0.035, 0.012, 6, 12).translate(0.03, 0.17, 0)]), color: fixed('#ffe28a') },
  ] },
  candycanes: { space: 0.25, hit: 0.05, scale: [1, 1.6], max: 10, parts: [
    { geo: caneGeo, color: fixed('#ffffff'), map: caneTexture },
  ] },
  snowmen: { space: 0.3, hit: 0.12, scale: [0.9, 1.2], max: 6, parts: [
    { geo: () => merge([new THREE.SphereGeometry(0.13, 16, 10).translate(0, 0.12, 0), new THREE.SphereGeometry(0.095, 16, 10).translate(0, 0.3, 0), new THREE.SphereGeometry(0.07, 14, 10).translate(0, 0.43, 0)]), color: fixed('#ffffff') },
    { geo: () => merge([new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12).translate(0, 0.53, 0), new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14).translate(0, 0.49, 0)]), color: fixed('#1a1a1a') },
    { geo: () => new THREE.ConeGeometry(0.014, 0.08, 8).rotateX(Math.PI / 2).translate(0, 0.43, 0.1), color: fixed('#ff8a1a') },
  ] },
  // --- Prairie Meuh Meuh
  cows: { space: 0.35, hit: 0.14, scale: [0.9, 1.15], max: 10, monument: true, parts: [
    { geo: () => merge([new THREE.CapsuleGeometry(0.09, 0.2, 4, 12).rotateX(Math.PI / 2).translate(0, 0.2, 0), new THREE.BoxGeometry(0.11, 0.11, 0.12).translate(0, 0.27, 0.19)]), color: fixed('#ffffff'), map: cowTexture },
    { geo: () => merge([[-0.05, -0.1], [0.05, -0.1], [-0.05, 0.1], [0.05, 0.1]].map(([x, z]) => new THREE.CylinderGeometry(0.018, 0.02, 0.13, 6).translate(x, 0.065, z))), color: fixed('#3a3a3a') },
    { geo: () => merge([new THREE.BoxGeometry(0.09, 0.05, 0.03).translate(0, 0.24, 0.26), new THREE.ConeGeometry(0.012, 0.05, 6).rotateZ(0.7).translate(-0.055, 0.34, 0.18), new THREE.ConeGeometry(0.012, 0.05, 6).rotateZ(-0.7).translate(0.055, 0.34, 0.18)]), color: fixed('#f2b8b0') },
  ] },
  fences: { space: 0.3, hit: 0.08, scale: [1, 1], max: 12, parts: [
    { geo: () => merge([-0.36, 0, 0.36].map((x) => new THREE.BoxGeometry(0.035, 0.2, 0.035).translate(x, 0.1, 0)).concat([new THREE.BoxGeometry(0.78, 0.03, 0.02).translate(0, 0.14, 0), new THREE.BoxGeometry(0.78, 0.03, 0.02).translate(0, 0.07, 0)])), color: (c) => String(c.wood ?? '#a8784a') },
  ] },
  barn: { space: 0.8, hit: 0.4, scale: [1.8, 1.8], max: 1, monument: true, solid: true, parts: [
    { geo: () => new THREE.BoxGeometry(0.72, 0.36, 0.56).translate(0, 0.18, 0), color: (c) => c.house },
    { geo: barnRoof, color: fixed('#6a2a24') },
    { geo: () => merge([new THREE.BoxGeometry(0.24, 0.26, 0.02).translate(0, 0.13, 0.285), new THREE.BoxGeometry(0.3, 0.025, 0.025).rotateZ(0.8).translate(0, 0.13, 0.297), new THREE.BoxGeometry(0.3, 0.025, 0.025).rotateZ(-0.8).translate(0, 0.13, 0.297)]), color: (c) => c.roof },
  ] },
  haybales: { space: 0.22, hit: 0.12, scale: [0.9, 1.2], max: 10, parts: [
    { geo: () => new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16).rotateZ(Math.PI / 2).translate(0, 0.11, 0), color: (c) => String(c.hay ?? '#f0c85a'), map: hayTexture },
  ] },
};

/** Ordre de placement : les gros objets d'abord (ils trouvent toujours leur place). */
const ORDER = ['hogcastle', 'bigtree', 'hoverboard', 'barn', 'spiralhill', 'crosses', 'signs', 'goldrings', 'thwomps', 'floodlights', 'castles', 'clocktowers', 'hills', 'houses', 'cabins', 'lamps', 'volcanoes', 'roses', 'baobabs', 'pipes', 'luxoballs', 'lollipops', 'mushrooms', 'palms', 'trees', 'cubetrees', 'toyblocks', 'gumdrops', 'balls', 'rocks', 'blocks', 'tallgrass', 'tirestacks', 'torches', 'deadtrees', 'ghosts', 'lanterns', 'stars', 'hoops', 'candles', 'pumpkins', 'gravestones', 'xmastrees', 'gifts', 'candycanes', 'snowmen', 'cows', 'fences', 'haybales', 'qblocks', 'coins', 'dragonballs', 'balloons', 'snowflakes', 'bats', 'candies', 'skyblocks'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Instance animée (flotte, tourne, regarde le véhicule). */
interface Anim {
  ps: Part[];
  k: number;
  dir: THREE.Vector3;
  yaw: number;
  sc: number;
  lift: number;
  phase: number;
  spec: KindSpec;
  /** Cap courant (objets qui regardent le véhicule). */
  look: number;
}

export class Decor {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  private readonly parts = new Map<string, Part[]>();
  private anims: Anim[] = [];
  private radius = 5;
  private scale = 1;

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

  /** La planète a-t-elle des monuments (décor du menu) ? */
  static hasMonuments(def: PlanetDef): boolean {
    return Object.entries(def.decor).some(([k, n]) => n && (KINDS[k]?.monument || KINDS[k]?.float));
  }

  /**
   * Place le décor d'une planète (graine fixe par planète). `monuments` : seulement
   * les monuments et décorations flottantes (planètes du menu).
   */
  build(def: PlanetDef, radius: number, scale: number, avoid?: (dir: THREE.Vector3, margin: number) => boolean, monuments = false, sizeMul = 1): void {
    this.obstacles.length = 0;
    this.anims = [];
    this.radius = radius;
    this.scale = scale;
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
    const place = (minDist: number, flying: boolean): THREE.Vector3 | null => {
      for (let tries = 0; tries < 60; tries++) {
        const d = rng.onUnitSphere();
        if (!flying && d.angleTo(start) < 0.5) continue; // départ dégagé
        if (placed.some((o) => o.dir.angleTo(d) * radius < minDist + o.r)) continue;
        if (!flying && avoid?.(d, minDist / radius)) continue; // pas sur la route
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
      // Même tirage aléatoire que la planète de jeu, mais seuls les monuments sont posés
      const skip = monuments && !spec.monument && !spec.float;
      const ps = skip ? null : this.partsOf(kind);
      for (let i = 0; i < n; i++) {
        const sc = rng.range(spec.scale[0], spec.scale[1]);
        const d = place(spec.space * Math.max(1, sc * 0.8), !!spec.float && !spec.face);
        if (!d) break;
        const yaw = spec.noYaw ? 0 : rng.range(0, Math.PI * 2);
        const tint = rng.range(0.93, 1.07);
        const colors = spec.parts.map((p) => p.color(col, rng));
        placed.push({ dir: d, r: spec.float && !spec.face ? 0.05 : Math.max(spec.hit * sc, 0.05) });
        if (!ps) continue;
        const k = ps[0].mesh.count;
        spec.parts.forEach((_s, j) => {
          const mesh = ps[j].mesh;
          mesh.count++;
          mesh.setColorAt(k, _c.set(colors[j]).multiplyScalar(tint));
        });
        this.setInstance(ps, k, d, yaw, sc * sizeMul, (spec.lift ?? 0) * sizeMul);
        if (spec.float || spec.face) this.anims.push({ ps, k, dir: d, yaw, sc: sc * sizeMul, lift: (spec.lift ?? 0) * sizeMul, phase: rng.range(0, Math.PI * 2), spec, look: yaw });
        if (spec.hit > 0) {
          // Gros monuments infranchissables ; le reste vole en éclats au premier choc
          const maxHits = spec.solid ? Infinity : 1;
          this.obstacles.push({ dir: d, radius: spec.hit * sc, hits: 0, maxHits, ps, k });
        }
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

  private setInstance(ps: Part[], k: number, d: THREE.Vector3, yaw: number, sc: number, lift: number): void {
    _q.setFromUnitVectors(UP, d);
    _q2.setFromAxisAngle(UP, yaw);
    _q.multiply(_q2);
    // Taille constante en unités monde malgré l'échelle de la planète
    _p.copy(d).multiplyScalar((this.radius + lift - 0.01) / this.scale);
    _s.setScalar(sc / this.scale);
    _m.compose(_p, _q, _s);
    for (const p of ps) p.mesh.setMatrixAt(k, _m);
  }

  /**
   * Animation des décorations flottantes ; `carDir` (espace planète) : les
   * blocs de la forteresse se tournent vers le véhicule.
   */
  update(dt: number, t: number, carDir?: THREE.Vector3): void {
    if (!this.anims.length) return;
    const touched = new Set<Part[]>();
    for (const a of this.anims) {
      const f = a.spec.float;
      let yaw = a.yaw + (f?.spin ?? 0) * t;
      if (a.spec.face && carDir) {
        // Cap vers le véhicule dans le plan tangent (repère de l'instance)
        _q.setFromUnitVectors(UP, a.dir);
        const fx = _v1.set(0, 0, 1).applyQuaternion(_q);
        const fz = _v2.set(1, 0, 0).applyQuaternion(_q);
        const to = _v3.copy(carDir).addScaledVector(a.dir, -carDir.dot(a.dir));
        const want = Math.atan2(to.dot(fz), to.dot(fx));
        let dd = want - a.look;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        a.look += dd * (1 - Math.exp(-dt * 4));
        yaw = a.look;
      }
      const lift = a.lift + (f ? Math.sin(t * 1.6 + a.phase) * f.bob : 0);
      this.setInstance(a.ps, a.k, a.dir, yaw, a.sc, lift);
      touched.add(a.ps);
    }
    for (const ps of touched) for (const p of ps) p.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Détruit un élément de décor (obstacle) : il disparaît. Renvoie sa couleur
   * principale (pour les éclats).
   */
  destroy(o: Obstacle): THREE.Color {
    const color = new THREE.Color(0.8, 0.8, 0.8);
    const i = this.obstacles.indexOf(o);
    if (i >= 0) this.obstacles.splice(i, 1);
    if (!o.ps || o.k === undefined) return color;
    o.ps[0].mesh.getColorAt(o.k, color);
    _m.makeScale(0, 0, 0);
    for (const p of o.ps) {
      p.mesh.setMatrixAt(o.k, _m);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    this.anims = this.anims.filter((a) => !(a.ps === o.ps && a.k === o.k));
    return color;
  }

  /** Libère les maillages (décor des planètes du menu). */
  dispose(): void {
    for (const ps of this.parts.values()) for (const p of ps) p.mesh.dispose();
    this.group.removeFromParent();
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
