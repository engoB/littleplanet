/**
 * Décor des planètes toon (arbres ronds, rochers, maisons-dômes), rendu en
 * InstancedMesh (un appel de dessin par type) avec contours, et obstacles
 * simples : cercle (voiture) contre cercle (décor) sur la sphère.
 */
import * as THREE from 'three';
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

function part(geo: THREE.BufferGeometry, parent: THREE.Object3D, flat = false): Part {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
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

  constructor(parent: THREE.Object3D) {
    this.trunk = part(new THREE.CylinderGeometry(0.035, 0.06, 0.42, 7).translate(0, 0.21, 0), this.group);
    this.canopy = part(new THREE.IcosahedronGeometry(0.26, 3).translate(0, 0.52, 0), this.group);
    this.rock = part(new THREE.DodecahedronGeometry(0.16, 0).translate(0, 0.05, 0), this.group, true);
    this.house = part(new THREE.CylinderGeometry(0.3, 0.32, 0.26, 18).translate(0, 0.13, 0), this.group);
    this.roof = part(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.24, 0), this.group);
    this.door = part(new THREE.BoxGeometry(0.11, 0.17, 0.04).translate(0, 0.085, 0.31), this.group);
    parent.add(this.group);
  }

  /** Place le décor d'une planète (graine fixe par planète). */
  build(def: PlanetDef, radius: number, scale: number): void {
    this.obstacles.length = 0;
    const parts = [this.trunk, this.canopy, this.rock, this.house, this.roof, this.door];
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
    for (const p of parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }
}
