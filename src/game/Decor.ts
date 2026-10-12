/**
 * Décor des planètes toon (arbres ronds, rochers, maisons-dômes), rendu en
 * InstancedMesh (un appel de dessin par type) avec contours, et obstacles
 * simples : cercle (voiture) contre cercle (décor) sur la sphère.
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

function part(geo: THREE.BufferGeometry, parent: THREE.Object3D, flat = false, map: THREE.Texture | null = null): Part {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map });
  if (flat) geo = geo.toNonIndexed();
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

/** Texture « ? » des blocs (dessinée une fois). */
function questionTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Palmes : six feuilles allongées et retombantes autour du sommet. */
function palmLeaves(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.SphereGeometry(0.2, 8, 4);
    g.scale(0.32, 0.08, 1);
    g.translate(0, 0, 0.19);
    g.rotateX(0.45);
    g.rotateY((i / 6) * Math.PI * 2 + 0.3);
    leaves.push(g.toNonIndexed());
  }
  return mergeGeometries(leaves)!.translate(0.06, 0.56, 0);
}

/** Tronc de palmier légèrement incliné. */
function palmTrunk(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.028, 0.05, 0.58, 7, 4).translate(0, 0.29, 0).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.12, 0, 0, 0));
}

/** Points blancs du chapeau de champignon. */
function mushroomSpots(): THREE.BufferGeometry {
  const spots: THREE.BufferGeometry[] = [];
  const dirs = [[0, 1, 0], [0.75, 0.55, 0], [-0.75, 0.55, 0], [0, 0.55, 0.75], [0, 0.55, -0.75], [0.5, 0.35, 0.6], [-0.5, 0.35, -0.6]];
  for (const [x, y, z] of dirs) {
    const v = new THREE.Vector3(x, y, z).normalize();
    const g = new THREE.SphereGeometry(0.055, 8, 6).scale(1, 0.35, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, v));
    g.translate(v.x * 0.22, 0.2 + v.y * 0.15, v.z * 0.22);
    spots.push(g);
  }
  return mergeGeometries(spots)!;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Decor {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  private readonly trunk: Part;
  private readonly canopy: Part;
  private readonly rock: Part;
  private readonly house: Part;
  private readonly roof: Part;
  private readonly door: Part;
  private readonly palmTrunk: Part;
  private readonly palmLeaves: Part;
  private readonly mushStem: Part;
  private readonly mushCap: Part;
  private readonly mushSpots: Part;
  private readonly pipe: Part;
  private readonly pipeRim: Part;
  private readonly block: Part;
  private readonly cubeTrunk: Part;
  private readonly cubeLeaves: Part;
  private readonly all: Part[];

  constructor(parent: THREE.Object3D) {
    this.trunk = part(new THREE.CylinderGeometry(0.035, 0.06, 0.42, 7).translate(0, 0.21, 0), this.group);
    this.canopy = part(new THREE.IcosahedronGeometry(0.26, 3).translate(0, 0.52, 0), this.group);
    this.rock = part(new THREE.DodecahedronGeometry(0.16, 0).translate(0, 0.05, 0), this.group, true);
    this.house = part(new THREE.CylinderGeometry(0.3, 0.32, 0.26, 18).translate(0, 0.13, 0), this.group);
    this.roof = part(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.24, 0), this.group);
    this.door = part(new THREE.BoxGeometry(0.11, 0.17, 0.04).translate(0, 0.085, 0.31), this.group);
    this.palmTrunk = part(palmTrunk(), this.group);
    this.palmLeaves = part(palmLeaves(), this.group);
    this.mushStem = part(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10).translate(0, 0.11, 0), this.group);
    this.mushCap = part(new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.2, 0), this.group);
    this.mushSpots = part(mushroomSpots(), this.group);
    this.pipe = part(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 16).translate(0, 0.15, 0), this.group);
    this.pipeRim = part(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16).translate(0, 0.33, 0), this.group);
    this.block = part(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.36, 0), this.group, false, questionTexture());
    this.cubeTrunk = part(new THREE.BoxGeometry(0.07, 0.3, 0.07).translate(0, 0.15, 0), this.group);
    this.cubeLeaves = part(new THREE.BoxGeometry(0.3, 0.26, 0.3).translate(0, 0.4, 0), this.group, true);
    this.all = [this.trunk, this.canopy, this.rock, this.house, this.roof, this.door, this.palmTrunk, this.palmLeaves, this.mushStem, this.mushCap, this.mushSpots, this.pipe, this.pipeRim, this.block, this.cubeTrunk, this.cubeLeaves];
    parent.add(this.group);
  }

  /** Place le décor d'une planète (graine fixe par planète). */
  build(def: PlanetDef, radius: number, scale: number): void {
    this.obstacles.length = 0;
    const parts = this.all;
    for (const p of parts) p.mesh.count = 0;
    if (def.style !== 'toon' || !def.decorColors) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const rng = new URandom([...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    const col = def.decorColors;
    const start = new THREE.Vector3(0, 1, 0);
    const place = (minDist: number): THREE.Vector3 | null => {
      for (let tries = 0; tries < 40; tries++) {
        const d = rng.onUnitSphere();
        if (d.angleTo(start) < 0.5) continue; // départ dégagé
        if (this.obstacles.some((o) => o.dir.angleTo(d) * radius < minDist + o.radius)) continue;
        return d;
      }
      return null;
    };
    const put = (p: Part, d: THREE.Vector3, yaw: number, s: number, color: string, tint = 1): void => {
      const i = p.mesh.count++;
      _q.setFromUnitVectors(UP, d);
      _q2.setFromAxisAngle(UP, yaw);
      _q.multiply(_q2);
      // Taille constante en unités monde malgré l'échelle de la planète
      _p.copy(d).multiplyScalar(radius / scale - 0.01 / scale);
      _s.setScalar(s / scale);
      _m.compose(_p, _q, _s);
      p.mesh.setMatrixAt(i, _m);
      p.mesh.setColorAt(i, new THREE.Color(color).multiplyScalar(tint));
    };
    for (let h = 0; h < Math.min(def.decor.houses, 4); h++) {
      const d = place(0.5);
      if (!d) break;
      const yaw = rng.range(0, Math.PI * 2);
      put(this.house, d, yaw, 1, col.house);
      put(this.roof, d, yaw, 1, col.roof);
      put(this.door, d, yaw, 1, col.trunk);
      this.obstacles.push({ dir: d, radius: 0.34 });
    }
    for (let t = 0; t < Math.min(def.decor.trees, MAX); t++) {
      const d = place(0.25);
      if (!d) break;
      const s = rng.range(0.8, 1.3);
      const yaw = rng.range(0, Math.PI * 2);
      put(this.trunk, d, yaw, s, col.trunk);
      put(this.canopy, d, yaw, s, col.canopy[rng.rangeInt(0, col.canopy.length)], rng.range(0.92, 1.08));
      this.obstacles.push({ dir: d, radius: 0.1 * s });
    }
    for (let r = 0; r < Math.min(def.decor.rocks, MAX); r++) {
      const d = place(0.2);
      if (!d) break;
      const s = rng.range(0.6, 1.4);
      put(this.rock, d, rng.range(0, Math.PI * 2), s, col.rock, rng.range(0.85, 1.1));
      this.obstacles.push({ dir: d, radius: 0.13 * s });
    }
    const n = (k: keyof PlanetDef['decor']) => Math.min(def.decor[k] ?? 0, 12);
    for (let i = 0; i < n('palms'); i++) {
      const d = place(0.3);
      if (!d) break;
      const s = rng.range(0.85, 1.25);
      const yaw = rng.range(0, Math.PI * 2);
      put(this.palmTrunk, d, yaw, s, col.trunk);
      put(this.palmLeaves, d, yaw, s, col.canopy[rng.rangeInt(0, col.canopy.length)], rng.range(0.92, 1.08));
      this.obstacles.push({ dir: d, radius: 0.08 * s });
    }
    for (let i = 0; i < n('mushrooms'); i++) {
      const d = place(0.35);
      if (!d) break;
      const s = rng.range(0.9, 1.4);
      const yaw = rng.range(0, Math.PI * 2);
      put(this.mushStem, d, yaw, s, col.trunk);
      put(this.mushCap, d, yaw, s, col.canopy[0]);
      put(this.mushSpots, d, yaw, s, '#ffffff');
      this.obstacles.push({ dir: d, radius: 0.12 * s });
    }
    for (let i = 0; i < n('pipes'); i++) {
      const d = place(0.35);
      if (!d) break;
      put(this.pipe, d, 0, 1, col.house);
      put(this.pipeRim, d, 0, 1, col.house, 1.12);
      this.obstacles.push({ dir: d, radius: 0.17 });
    }
    for (let i = 0; i < n('blocks'); i++) {
      // Blocs « ? » flottants : décor seul, la voiture passe dessous
      const d = place(0.25);
      if (!d) break;
      put(this.block, d, rng.range(0, Math.PI * 2), 1, col.roof);
    }
    for (let i = 0; i < n('cubetrees'); i++) {
      const d = place(0.28);
      if (!d) break;
      const s = rng.range(0.85, 1.25);
      const yaw = rng.range(0, Math.PI * 2);
      put(this.cubeTrunk, d, yaw, s, col.trunk);
      put(this.cubeLeaves, d, yaw, s, col.canopy[rng.rangeInt(0, col.canopy.length)], rng.range(0.9, 1.1));
      this.obstacles.push({ dir: d, radius: 0.1 * s });
    }
    for (const p of parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }
}
