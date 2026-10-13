/**
 * Jouets bousculables (Chambre de Jouets) : ballons et cubes à lettres posés
 * sur la moquette. Le véhicule les percute : ils sont éjectés, rebondissent
 * (gravité vers le centre de la planète), roulent puis s'arrêtent.
 * Rendu en InstancedMesh ; physique simple sur la sphère (espace planète).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { URandom } from '../unity/math';
import { toonGradient } from './toon';

interface Toy {
  kind: 'ball' | 'block';
  /** Index de lettre (cubes) ou 0. */
  variant: number;
  dir: THREE.Vector3;
  /** Hauteur au-dessus du sol (monde). */
  h: number;
  vUp: number;
  /** Vitesse tangentielle (monde, espace planète). */
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  spin: THREE.Vector3;
  size: number;
}

function canvasTex(draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const letter = (l: string, bg: string) =>
  canvasTex((g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 52, 52);
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(l, 32, 35);
  });

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

const toon = (opts: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });
const MAX = 16;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Toys {
  readonly group = new THREE.Group();
  private toys: Toy[] = [];
  private readonly ball: THREE.InstancedMesh[];
  private readonly blocks: THREE.InstancedMesh[];
  private radius = 5;
  private scale = 1;
  /** Appelé quand un jouet est percuté (son). */
  onKick: (strength: number) => void = () => undefined;

  constructor(parent: THREE.Object3D) {
    const inst = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const x = new THREE.InstancedMesh(g, m, MAX);
      x.count = 0;
      x.frustumCulled = false;
      x.castShadow = true;
      return x;
    };
    const R = 0.16;
    this.ball = [
      inst(new THREE.SphereGeometry(R, 24, 16), toon({ color: 0xffd23a })),
      inst(new THREE.TorusGeometry(R, 0.035, 8, 32), toon({ color: 0x2f6bff })),
      inst(mergeGeometries([star(0.07).translate(0, 0, R + 0.002), star(0.07).rotateY(Math.PI).translate(0, 0, -R - 0.002)])!, toon({ color: 0xff3a3a, side: THREE.DoubleSide })),
    ];
    const box = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    this.blocks = [
      inst(box, toon({ color: 0xffffff, map: letter('A', '#e8433a') })),
      inst(box, toon({ color: 0xffffff, map: letter('B', '#3a7bff') })),
      inst(box, toon({ color: 0xffffff, map: letter('C', '#3fbf5a') })),
    ];
    this.group.add(...this.ball, ...this.blocks);
    parent.add(this.group);
  }

  build(def: { balls: number; blocks: number } | undefined, radius: number, scale: number, seed: number): void {
    this.radius = radius;
    this.scale = scale;
    this.toys = [];
    if (!def) {
      this.render();
      return;
    }
    const rng = new URandom(seed);
    const start = new THREE.Vector3(0, 1, 0);
    const add = (kind: Toy['kind'], variant: number, size: number) => {
      for (let t = 0; t < 30; t++) {
        const d = rng.onUnitSphere();
        if (d.angleTo(start) < 0.3 || this.toys.some((o) => o.dir.angleTo(d) * radius < 0.5)) continue;
        const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), 0));
        this.toys.push({ kind, variant, dir: d, h: 0, vUp: 0, vel: new THREE.Vector3(), rot, spin: new THREE.Vector3(), size });
        return;
      }
    };
    for (let i = 0; i < Math.min(def.balls, 6); i++) add('ball', 0, 0.16);
    for (let i = 0; i < def.blocks; i++) add('block', i % 3, 0.11);
    this.render();
  }

  /** Physique et collisions avec le véhicule (direction, vitesse monde). */
  update(dt: number, carDir: THREE.Vector3 | null, carVel: THREE.Vector3, R: number): void {
    if (!this.toys.length) return;
    const g = 9;
    for (const t of this.toys) {
      // Percussion : éjecté dans le sens du véhicule, vers le haut, avec un effet
      if (carDir && t.h < 0.3 && t.dir.angleTo(carDir) * R < 0.32 + t.size) {
        const away = t.dir.clone().sub(carDir).addScaledVector(t.dir, -t.dir.dot(t.dir.clone().sub(carDir)));
        const push = carVel.clone().addScaledVector(t.dir, -carVel.dot(t.dir)).multiplyScalar(1.35);
        if (away.lengthSq() > 1e-8) push.addScaledVector(away.normalize(), 1.5);
        if (push.lengthSq() > t.vel.lengthSq()) {
          t.vel.copy(push);
          t.vUp = 2.2 + Math.random() * 1.6;
          t.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
          this.onKick(Math.min(1, push.length() / 8));
        }
      }
      if (t.h > 0 || t.vUp > 0) {
        t.vUp -= g * dt;
        t.h += t.vUp * dt;
        if (t.h <= 0) {
          t.h = 0;
          t.vUp = Math.abs(t.vUp) > 1 ? -t.vUp * 0.45 : 0;
          t.spin.multiplyScalar(0.6);
        }
      }
      const grounded = t.h <= 0 && t.vUp === 0;
      t.vel.multiplyScalar(Math.exp(-dt * (grounded ? (t.kind === 'ball' ? 1.2 : 4.5) : 0.2)));
      const sp = t.vel.length();
      if (sp > 1e-4) {
        // Déplacement le long de la surface : rotation de la direction
        const axis = new THREE.Vector3().crossVectors(t.dir, t.vel).normalize();
        const ang = (sp * dt) / (R + t.h);
        t.dir.applyAxisAngle(axis, ang).normalize();
        t.vel.applyAxisAngle(axis, ang);
        t.vel.addScaledVector(t.dir, -t.vel.dot(t.dir));
        // Ballon qui roule
        if (t.kind === 'ball' && grounded) t.rot.premultiply(_q.setFromAxisAngle(axis, ang * (R / t.size)));
      }
      if (!grounded) t.rot.premultiply(_q.setFromEuler(new THREE.Euler(t.spin.x * dt, t.spin.y * dt, t.spin.z * dt)));
      else if (t.kind === 'block' && sp < 0.05) t.spin.set(0, 0, 0);
    }
    this.render();
  }

  private render(): void {
    const counts = [0, 0, 0];
    let nb = 0;
    for (const t of this.toys) {
      // Orientation : le « haut » du jouet suit la normale, plus sa rotation propre
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.dir).multiply(t.rot);
      _p.copy(t.dir).multiplyScalar((this.radius + t.size + t.h) / this.scale);
      _s.setScalar(1 / this.scale);
      _m.compose(_p, _q, _s);
      if (t.kind === 'ball') {
        for (const m of this.ball) m.setMatrixAt(nb, _m);
        nb++;
      } else this.blocks[t.variant].setMatrixAt(counts[t.variant]++, _m);
    }
    for (const m of this.ball) {
      m.count = nb;
      m.instanceMatrix.needsUpdate = true;
    }
    this.blocks.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}
