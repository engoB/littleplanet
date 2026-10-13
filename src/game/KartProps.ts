/**
 * Objets de course éparpillés sur toute la planète (aucune piste à suivre) :
 *  - baskets du futur (montantes, lacets lumineux) : rechargent le turbo ;
 *  - accélérateurs (dalles à chevrons lumineux) : coup de vitesse ;
 *  - tremplins : le véhicule s'envole (saut) ;
 *  - pylônes tournoyants : le véhicule fait une toupie et accélère.
 * Positions tirées au hasard (graine fixe par planète), en espace planète.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { URandom } from '../unity/math';
import { toonGradient } from './toon';

export interface KartDef {
  boosts: number;
  /** Baskets turbo. */
  items: number;
  ramps: number;
  spinners?: number;
}

/** Objets par défaut d'une planète Arcade (pour une planète de taille 1). */
export const DEFAULT_KART: KartDef = { boosts: 3, items: 2, ramps: 1, spinners: 2 };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const chevronTexture = () =>
  canvasTex(64, 64, (g) => {
    g.fillStyle = 'rgba(255, 140, 0, 0.9)';
    g.fillRect(2, 2, 60, 60);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i % 2 ? '#ffe46a' : '#fff6c0';
      const y = 46 - i * 16;
      g.beginPath();
      g.moveTo(10, y + 8);
      g.lineTo(32, y - 6);
      g.lineTo(54, y + 8);
      g.lineTo(54, y + 16);
      g.lineTo(32, y + 2);
      g.lineTo(10, y + 16);
      g.fill();
    }
  });

const stripeTexture = () =>
  canvasTex(64, 64, (g) => {
    g.fillStyle = '#ffd23a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#222';
    for (let i = -64; i < 128; i += 22) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 11, 0);
      g.lineTo(i + 11 - 64, 64);
      g.lineTo(i - 64, 64);
      g.fill();
    }
  });

/** Rayures en spirale du pylône (rouge et blanc). */
const spiralTexture = () =>
  canvasTex(64, 64, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e8333a';
    for (let i = -64; i < 128; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 + 32, 64);
      g.lineTo(i + 32, 64);
      g.fill();
    }
  });

const toon = (color: number, opts: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });

/** Basket montante du futur : semelle, tige, bride et talon lumineux (3 pièces). */
function sneakerParts(): THREE.BufferGeometry[] {
  const sole = new THREE.BoxGeometry(0.13, 0.05, 0.32);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) if (sp.getZ(i) > 0.1) sp.setY(i, sp.getY(i) + (sp.getY(i) > 0 ? 0 : 0.02));
  sole.translate(0, 0.025, 0);
  const upper = mergeGeometries([
    new THREE.CapsuleGeometry(0.058, 0.18, 4, 12).rotateX(Math.PI / 2).scale(1, 0.8, 1).translate(0, 0.085, 0.03),
    new THREE.CylinderGeometry(0.06, 0.068, 0.15, 14).translate(0, 0.135, -0.085),
  ].map((g) => g.toNonIndexed()))!;
  const glow = mergeGeometries([
    new THREE.TorusGeometry(0.063, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.205, -0.085),
    new THREE.BoxGeometry(0.125, 0.016, 0.06).rotateX(-0.5).translate(0, 0.13, 0.04),
    new THREE.BoxGeometry(0.135, 0.018, 0.3).translate(0, 0.045, 0),
    new THREE.BoxGeometry(0.02, 0.07, 0.02).translate(0, 0.14, -0.155),
  ].map((g) => g.toNonIndexed()))!;
  return [sole, upper, glow];
}

const MAX_ITEM = 12;
const MAX_RAMP = 8;
const MAX_PAD = 12;
const MAX_SPIN = 8;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Pickup {
  dir: THREE.Vector3;
  respawn: number;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = true;
  return m;
}

export class KartProps {
  readonly group = new THREE.Group();
  private readonly sneaker: THREE.InstancedMesh[];
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly rampMesh: THREE.InstancedMesh;
  private readonly padMesh: THREE.InstancedMesh;
  private readonly spinMesh: THREE.InstancedMesh[];
  private items: Pickup[] = [];
  /** Accélérateurs (directions, espace planète). */
  pads: THREE.Vector3[] = [];
  /** Tremplins : direction et axe avant (espace planète). */
  ramps: { dir: THREE.Vector3; fwd: THREE.Vector3 }[] = [];
  /** Pylônes tournoyants (directions, espace planète). */
  spinners: THREE.Vector3[] = [];
  private radius = 5;
  private scale = 1;
  private spin = 0;

  constructor(parent: THREE.Object3D) {
    const [sole, upper, glow] = sneakerParts();
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.8, 2.6) });
    this.sneaker = [inst(sole, toon(0xf4f4f0, { emissive: new THREE.Color(0x303030) }), MAX_ITEM), inst(upper, toon(0xb8bcc4), MAX_ITEM), inst(glow, this.glowMat, MAX_ITEM)];
    const rg = new THREE.BoxGeometry(0.62, 0.16, 0.5);
    const pos = rg.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getZ(i) > 0 ? 0.16 : -0.08);
    rg.translate(0, 0.08, 0);
    rg.computeVertexNormals();
    this.rampMesh = inst(rg, toon(0xffffff, { map: stripeTexture() }), MAX_RAMP);
    this.padMesh = inst(
      new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: chevronTexture(), color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      MAX_PAD,
    );
    this.padMesh.castShadow = false;
    this.padMesh.renderOrder = 1;
    // Pylône : socle sombre, cône rayé en spirale, boule lumineuse au sommet
    this.spinMesh = [
      inst(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 16).translate(0, 0.03, 0), toon(0x2a2a34), MAX_SPIN),
      inst(new THREE.ConeGeometry(0.11, 0.55, 16, 1, true).translate(0, 0.33, 0), toon(0xffffff, { map: spiralTexture(), side: THREE.DoubleSide }), MAX_SPIN),
      inst(new THREE.SphereGeometry(0.05, 12, 8).translate(0, 0.62, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 0.4) }), MAX_SPIN),
    ];
    this.group.add(...this.sneaker, this.rampMesh, this.padMesh, ...this.spinMesh);
    parent.add(this.group);
  }

  /** Éparpille les objets sur la planète (rien si `kart` est absent). */
  build(kart: KartDef | undefined, radius: number, scale: number, seed: number): void {
    this.radius = radius;
    this.scale = scale;
    this.items = [];
    this.ramps = [];
    this.pads = [];
    this.spinners = [];
    for (const m of [...this.sneaker, this.rampMesh, this.padMesh, ...this.spinMesh]) m.count = 0;
    if (!kart) return;
    const rng = new URandom(seed);
    const start = new THREE.Vector3(0, 1, 0);
    const used: THREE.Vector3[] = [];
    const spot = (): { dir: THREE.Vector3; fwd: THREE.Vector3 } | null => {
      for (let i = 0; i < 40; i++) {
        const d = rng.onUnitSphere();
        if (d.angleTo(start) < 0.35 || used.some((u) => u.angleTo(d) * radius < 1.1)) continue;
        used.push(d);
        const a = rng.onUnitSphere();
        return { dir: d, fwd: a.addScaledVector(d, -a.dot(d)).normalize() };
      }
      return null;
    };
    for (let i = 0; i < Math.min(kart.items, MAX_ITEM); i++) {
      const s = spot();
      if (s) this.items.push({ dir: s.dir, respawn: 0 });
    }
    for (let i = 0; i < Math.min(kart.ramps, MAX_RAMP); i++) {
      const s = spot();
      if (s) this.ramps.push(s);
    }
    this.rampMesh.count = this.ramps.length;
    this.ramps.forEach((r, i) => this.rampMesh.setMatrixAt(i, this.place(r.dir, r.fwd, 0)));
    this.rampMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < Math.min(kart.boosts, MAX_PAD); i++) {
      const s = spot();
      if (!s) break;
      this.pads.push(s.dir);
      this.padMesh.setMatrixAt(this.padMesh.count++, this.place(s.dir, s.fwd, 0.015));
    }
    this.padMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < Math.min(kart.spinners ?? 0, MAX_SPIN); i++) {
      const s = spot();
      if (!s) break;
      this.spinners.push(s.dir);
    }
    for (const m of this.spinMesh) m.count = this.spinners.length;
    this.update(0);
  }

  /** Matrice : +Y = normale, +Z = avant ; à la surface (+ lift monde). */
  private place(dir: THREE.Vector3, fwd: THREE.Vector3, lift: number, s = 1): THREE.Matrix4 {
    _z.copy(fwd).addScaledVector(dir, -fwd.dot(dir)).normalize();
    _x.crossVectors(dir, _z).normalize();
    _m.makeBasis(_x, dir, _z);
    _q.setFromRotationMatrix(_m);
    _p.copy(dir).multiplyScalar((this.radius + lift) / this.scale);
    _s.setScalar(s / this.scale);
    return _m.compose(_p, _q, _s);
  }

  update(dt: number): void {
    this.spin += dt;
    // Baskets : rotation lente, flottement, lacets qui pulsent
    let n = 0;
    for (const it of this.items) {
      it.respawn = Math.max(0, it.respawn - dt);
      if (it.respawn > 0) continue;
      _z.set(0, 0, 1).addScaledVector(it.dir, -it.dir.z);
      if (_z.lengthSq() < 1e-4) _z.set(1, 0, 0);
      const m = this.place(it.dir, _z.normalize(), 0.18 + 0.05 * Math.sin(this.spin * 3 + n), 1.6);
      _q2.setFromAxisAngle(UP, this.spin * 1.8 + n);
      m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(_q2));
      for (const s of this.sneaker) s.setMatrixAt(n, m);
      n++;
    }
    for (const s of this.sneaker) {
      s.count = n;
      s.instanceMatrix.needsUpdate = true;
    }
    const k = 1 + 0.35 * Math.sin(this.spin * 6);
    this.glowMat.color.setRGB(0.5 * k, 1.8 * k, 2.6 * k);
    // Pylônes : la partie rayée tourne sur elle-même
    this.spinners.forEach((d, i) => {
      _z.set(0, 0, 1).addScaledVector(d, -d.z);
      if (_z.lengthSq() < 1e-4) _z.set(1, 0, 0);
      const base = this.place(d, _z.normalize(), 0);
      this.spinMesh[0].setMatrixAt(i, base);
      this.spinMesh[2].setMatrixAt(i, base);
      const rot = base.clone().multiply(new THREE.Matrix4().makeRotationY(this.spin * 5));
      this.spinMesh[1].setMatrixAt(i, rot);
    });
    for (const m of this.spinMesh) m.instanceMatrix.needsUpdate = true;
  }

  /** Basket ramassée ? Renvoie sa direction (espace planète) pour les particules. */
  collect(carDir: THREE.Vector3, reach: number, R = this.radius): THREE.Vector3 | null {
    for (const it of this.items) {
      if (it.respawn > 0) continue;
      if (it.dir.angleTo(carDir) * R < reach) {
        it.respawn = 6;
        return it.dir;
      }
    }
    return null;
  }

  rampAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    return this.ramps.some((r) => r.dir.angleTo(carDir) * R < reach);
  }

  padAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    return this.pads.some((d) => d.angleTo(carDir) * R < reach);
  }

  spinnerAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    return this.spinners.some((d) => d.angleTo(carDir) * R < reach);
  }

  /** Baskets visibles (mini-carte), espace planète. */
  itemDirs(): THREE.Vector3[] {
    return this.items.filter((b) => b.respawn <= 0).map((b) => b.dir);
  }
}
