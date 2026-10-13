/**
 * Objets bousculables posés sur la planète (jouets, citrouilles, cadeaux,
 * bottes de foin, cônes, clôtures…). Le véhicule les percute : ils sont
 * éjectés, rebondissent (gravité vers le centre), roulent puis s'arrêtent.
 * Percutés à pleine vitesse (turbo, accélérateur), certains partent en orbite
 * et disparaissent dans l'espace avant de réapparaître à leur place ; les
 * clôtures se brisent en planches.
 * Rendu en InstancedMesh (une table de types) ; physique simple sur la sphère.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { URandom } from '../unity/math';
import { toonGradient } from './toon';

interface Toy {
  kind: string;
  /** Position de départ (réapparition). */
  home: THREE.Vector3;
  dir: THREE.Vector3;
  /** Hauteur au-dessus du sol (monde). */
  h: number;
  vUp: number;
  /** Vitesse tangentielle (monde, espace planète). */
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  spin: THREE.Vector3;
  size: number;
  color: THREE.Color;
  /** Parti en orbite (plus de gravité). */
  escape: boolean;
  /** Caché (orbite, brisé) : temps avant réapparition ; débris : durée de vie. */
  hidden: number;
  life: number;
  /** Apparition en grossissant (0 → 1). */
  pop: number;
}

function canvasTex(draw: (g: CanvasRenderingContext2D) => void, size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
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

/** Visage de citrouille lumineux (fond transparent). */
const pumpkinFace = () =>
  canvasTex((g) => {
    g.fillStyle = '#ffe28a';
    g.beginPath(); g.moveTo(14, 26); g.lineTo(24, 14); g.lineTo(28, 28); g.fill();
    g.beginPath(); g.moveTo(50, 26); g.lineTo(40, 14); g.lineTo(36, 28); g.fill();
    g.beginPath();
    g.moveTo(12, 38); g.lineTo(20, 46); g.lineTo(26, 40); g.lineTo(32, 48); g.lineTo(38, 40); g.lineTo(44, 46); g.lineTo(52, 38); g.lineTo(46, 54); g.lineTo(18, 54);
    g.fill();
  });

/** Ballon de plage : quartiers colorés. */
const beachTexture = () =>
  canvasTex((g) => {
    const cols = ['#ff3b3b', '#ffffff', '#ffd23a', '#ffffff', '#2f7dff', '#ffffff'];
    cols.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect((i * 64) / cols.length, 0, 64 / cols.length + 1, 64);
    });
  });

const hayTexture = () =>
  canvasTex((g) => {
    g.fillStyle = '#f0c85a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(160, 110, 30, 0.6)';
    g.lineWidth = 2;
    for (let i = 0; i < 64; i += 6) {
      g.beginPath(); g.moveTo(0, i + (i % 12)); g.lineTo(64, i + 3); g.stroke();
    }
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

const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)))!;
const toon = (opts: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });

interface ToyKind {
  /** Pièces (géométrie centrée sur le centre de l'objet, matériau). */
  parts: () => { geo: THREE.BufferGeometry; mat: THREE.Material; tinted?: boolean }[];
  /** Rayon (monde) : contact et hauteur du centre. */
  size: number;
  /** Roule au sol (ballons, citrouilles). */
  rolls?: boolean;
  /** Couleurs par instance (pièces `tinted`). */
  colors?: string[];
  /** Se brise en débris (`debris` × 3) au lieu d'être éjecté. */
  breaks?: string;
  /** Débris : disparaît après sa durée de vie. */
  debris?: boolean;
  /** Probabilité de partir en orbite à pleine vitesse. */
  orbit?: number;
}

const KINDS: Record<string, ToyKind> = {
  ball: { size: 0.16, rolls: true, orbit: 0.5, parts: () => [
    { geo: new THREE.SphereGeometry(0.16, 24, 16), mat: toon({ color: 0xffd23a }) },
    { geo: new THREE.TorusGeometry(0.16, 0.035, 8, 32), mat: toon({ color: 0x2f6bff }) },
    { geo: merge([star(0.07).translate(0, 0, 0.162), star(0.07).rotateY(Math.PI).translate(0, 0, -0.162)]), mat: toon({ color: 0xff3a3a, side: THREE.DoubleSide }) },
  ] },
  blockA: { size: 0.11, orbit: 0.3, parts: () => [{ geo: new THREE.BoxGeometry(0.22, 0.22, 0.22), mat: toon({ color: 0xffffff, map: letter('A', '#e8433a') }) }] },
  blockB: { size: 0.11, orbit: 0.3, parts: () => [{ geo: new THREE.BoxGeometry(0.22, 0.22, 0.22), mat: toon({ color: 0xffffff, map: letter('B', '#3a7bff') }) }] },
  blockC: { size: 0.11, orbit: 0.3, parts: () => [{ geo: new THREE.BoxGeometry(0.22, 0.22, 0.22), mat: toon({ color: 0xffffff, map: letter('C', '#3fbf5a') }) }] },
  pumpkin: { size: 0.12, rolls: true, orbit: 0.35, parts: () => [
    { geo: merge([0, 1, 2, 3, 4, 5].map((i) => new THREE.SphereGeometry(0.075, 12, 10).scale(0.8, 1, 1.25).translate(0, 0, 0.045).rotateY((i / 6) * Math.PI * 2))).scale(1.25, 0.95, 1.25), mat: toon({ color: 0xff8a1a, emissive: new THREE.Color(0x301000) }) },
    { geo: new THREE.CylinderGeometry(0.012, 0.02, 0.07, 6).translate(0, 0.1, 0), mat: toon({ color: 0x3a5a2a }) },
    { geo: new THREE.PlaneGeometry(0.15, 0.15).translate(0, 0, 0.15), mat: new THREE.MeshBasicMaterial({ map: pumpkinFace(), color: new THREE.Color(2.2, 1.6, 0.6), transparent: true, depthWrite: false }) },
  ] },
  gift: { size: 0.1, orbit: 0.4, colors: ['#e8333a', '#2f7dff', '#3fbf5a', '#b04ae8', '#ffd23a'], parts: () => [
    { geo: new THREE.BoxGeometry(0.19, 0.16, 0.19), mat: toon({ color: 0xffffff }), tinted: true },
    { geo: merge([new THREE.BoxGeometry(0.2, 0.165, 0.04), new THREE.BoxGeometry(0.04, 0.165, 0.2), new THREE.TorusGeometry(0.04, 0.013, 6, 12).translate(-0.035, 0.1, 0), new THREE.TorusGeometry(0.04, 0.013, 6, 12).translate(0.035, 0.1, 0)]), mat: toon({ color: 0xffe28a, emissive: new THREE.Color(0x302008) }) },
  ] },
  hay: { size: 0.12, rolls: true, orbit: 0.25, parts: () => [
    { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.22, 16).rotateZ(Math.PI / 2), mat: toon({ color: 0xffffff, map: hayTexture() }) },
  ] },
  beachball: { size: 0.15, rolls: true, orbit: 0.6, parts: () => [
    { geo: new THREE.SphereGeometry(0.15, 24, 16), mat: toon({ color: 0xffffff, map: beachTexture() }) },
  ] },
  cone: { size: 0.08, orbit: 0.4, parts: () => [
    { geo: new THREE.ConeGeometry(0.07, 0.2, 14).translate(0, 0.02, 0), mat: toon({ color: 0xff6a1a, emissive: new THREE.Color(0x301000) }) },
    { geo: merge([new THREE.CylinderGeometry(0.041, 0.051, 0.035, 14).translate(0, 0.03, 0), new THREE.BoxGeometry(0.17, 0.02, 0.17).translate(0, -0.08, 0)]), mat: toon({ color: 0xffffff }) },
  ] },
  fence: { size: 0.14, breaks: 'plank', parts: () => [
    { geo: merge([-0.36, 0, 0.36].map((x) => new THREE.BoxGeometry(0.04, 0.22, 0.04).translate(x, -0.03, 0)).concat([new THREE.BoxGeometry(0.8, 0.035, 0.025).translate(0, 0.02, 0), new THREE.BoxGeometry(0.8, 0.035, 0.025).translate(0, -0.06, 0)])), mat: toon({ color: 0xffffff }), tinted: true },
  ], colors: ['#a8784a'] },
  plank: { size: 0.04, debris: true, parts: () => [
    { geo: new THREE.BoxGeometry(0.34, 0.035, 0.03), mat: toon({ color: 0xa8784a }) },
  ] },
};

const MAX = 18;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Toys {
  readonly group = new THREE.Group();
  private toys: Toy[] = [];
  private readonly meshes = new Map<string, THREE.InstancedMesh[]>();
  private radius = 5;
  private scale = 1;
  /** Appelé quand un objet est percuté (son). */
  onKick: (strength: number) => void = () => undefined;
  /** Objet brisé (clôture). */
  onBreak: () => void = () => undefined;
  /** Objet parti en orbite. */
  onOrbit: () => void = () => undefined;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  private meshesOf(kind: string): THREE.InstancedMesh[] {
    let ms = this.meshes.get(kind);
    if (!ms) {
      ms = KINDS[kind].parts().map(({ geo, mat, tinted }) => {
        const x = new THREE.InstancedMesh(geo, mat, MAX);
        x.count = 0;
        x.frustumCulled = false;
        x.castShadow = true;
        if (tinted) x.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
        this.group.add(x);
        return x;
      });
      this.meshes.set(kind, ms);
    }
    return ms;
  }

  /** Crée d'avance les maillages (précompilation des shaders). */
  prepare(defs: (Record<string, number> | undefined)[]): void {
    for (const d of defs) for (const k of Object.keys(d ?? {})) if (KINDS[k]) this.meshesOf(k);
    if (defs.some((d) => d?.fence)) this.meshesOf('plank');
  }

  /** Place les objets d'une planète : { type: nombre }. */
  build(def: Record<string, number> | undefined, radius: number, scale: number, seed: number): void {
    this.radius = radius;
    this.scale = scale;
    this.toys = [];
    if (def) {
      const rng = new URandom(seed);
      const start = new THREE.Vector3(0, 1, 0);
      for (const [kind, n] of Object.entries(def)) {
        const spec = KINDS[kind];
        if (!spec) continue;
        this.meshesOf(kind);
        if (spec.breaks) this.meshesOf(spec.breaks);
        for (let i = 0; i < Math.min(n, MAX); i++) {
          for (let t = 0; t < 30; t++) {
            const d = rng.onUnitSphere();
            if (d.angleTo(start) < 0.3 || this.toys.some((o) => o.dir.angleTo(d) * radius < 0.5)) continue;
            const col = spec.colors ? spec.colors[rng.rangeInt(0, spec.colors.length)] : '#ffffff';
            this.toys.push(this.make(kind, d, rng.range(0, 6.28), new THREE.Color(col)));
            break;
          }
        }
      }
    }
    this.render();
  }

  private make(kind: string, d: THREE.Vector3, yaw: number, color: THREE.Color): Toy {
    const rot = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    return { kind, home: d.clone(), dir: d.clone(), h: 0, vUp: 0, vel: new THREE.Vector3(), rot, spin: new THREE.Vector3(), size: KINDS[kind].size, color, escape: false, hidden: 0, life: 0, pop: 1 };
  }

  /**
   * Physique et collisions avec le véhicule (direction, vitesse monde).
   * `fast` : véhicule lancé (turbo, accélérateur) — les objets peuvent partir en orbite.
   */
  update(dt: number, carDir: THREE.Vector3 | null, carVel: THREE.Vector3, R: number, fast = false): void {
    if (!this.toys.length) return;
    const g = 9;
    const spawned: Toy[] = [];
    for (const t of this.toys) {
      const spec = KINDS[t.kind];
      if (t.hidden > 0) {
        t.hidden -= dt;
        if (t.hidden <= 0) {
          // Réapparition à sa place, en grossissant
          t.dir.copy(t.home);
          t.h = 0;
          t.vUp = 0;
          t.vel.set(0, 0, 0);
          t.spin.set(0, 0, 0);
          t.escape = false;
          t.pop = 0;
        }
        continue;
      }
      t.pop = Math.min(1, t.pop + dt * 3);
      if (spec.debris) {
        t.life -= dt;
        if (t.life <= 0) {
          t.hidden = Infinity;
          continue;
        }
      }
      // Percussion : éjecté dans le sens du véhicule, vers le haut, avec un effet
      if (carDir && !t.escape && t.h < 0.3 && t.pop > 0.8 && !spec.debris && t.dir.angleTo(carDir) * R < 0.3 + t.size) {
        const rel = _a.copy(t.dir).sub(carDir);
        const away = rel.addScaledVector(t.dir, -t.dir.dot(rel));
        const push = _b.copy(carVel).addScaledVector(t.dir, -carVel.dot(t.dir)).multiplyScalar(1.35);
        if (away.lengthSq() > 1e-8) push.addScaledVector(away.normalize(), 1.5);
        if (push.lengthSq() > t.vel.lengthSq()) {
          if (spec.breaks) {
            // Clôture : vole en éclats (planches), revient plus tard
            t.hidden = 14;
            for (let k = 0; k < 3; k++) {
              const p = this.make(spec.breaks, t.dir, Math.random() * 6.28, t.color);
              p.vel.copy(push).multiplyScalar(0.6 + Math.random() * 0.5).addScaledVector(away, (k - 1) * 0.8);
              p.vUp = 2 + Math.random() * 2;
              p.h = 0.05;
              p.spin.set(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
              p.life = 4 + Math.random();
              spawned.push(p);
            }
            this.onBreak();
            continue;
          }
          t.vel.copy(push);
          t.vUp = 2.2 + Math.random() * 1.6;
          t.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
          if (fast && Math.random() < (spec.orbit ?? 0)) {
            // À pleine vitesse : part en orbite
            t.escape = true;
            t.vUp = 5;
            t.spin.multiplyScalar(1.6);
            this.onOrbit();
          }
          this.onKick(Math.min(1, push.length() / 8));
        }
      }
      if (t.escape) {
        // Accélère vers l'espace, puis disparaît
        t.vUp += 6 * dt;
        t.h += t.vUp * dt;
        if (t.h > 9) t.hidden = 10;
      } else if (t.h > 0 || t.vUp > 0) {
        t.vUp -= g * dt;
        t.h += t.vUp * dt;
        if (t.h <= 0) {
          t.h = 0;
          t.vUp = Math.abs(t.vUp) > 1 ? -t.vUp * 0.45 : 0;
          t.spin.multiplyScalar(0.6);
        }
      }
      const grounded = t.h <= 0 && t.vUp === 0;
      t.vel.multiplyScalar(Math.exp(-dt * (grounded ? (spec.rolls ? 1.2 : 4.5) : 0.2)));
      const sp = t.vel.length();
      if (sp > 1e-4) {
        // Déplacement le long de la surface : rotation de la direction
        const axis = _a.crossVectors(t.dir, t.vel).normalize();
        const ang = (sp * dt) / (R + t.h);
        t.dir.applyAxisAngle(axis, ang).normalize();
        t.vel.applyAxisAngle(axis, ang);
        t.vel.addScaledVector(t.dir, -t.vel.dot(t.dir));
        // Objet rond qui roule
        if (spec.rolls && grounded) t.rot.premultiply(_q.setFromAxisAngle(axis, ang * (R / t.size)));
      }
      if (!grounded) t.rot.premultiply(_q.setFromEuler(_e.set(t.spin.x * dt, t.spin.y * dt, t.spin.z * dt)));
      else if (!spec.rolls && sp < 0.05) t.spin.set(0, 0, 0);
    }
    if (spawned.length) this.toys.push(...spawned);
    // Débris disparus : retirés
    if (this.toys.some((t) => t.hidden === Infinity)) this.toys = this.toys.filter((t) => t.hidden !== Infinity);
    this.render();
  }

  private render(): void {
    const counts = new Map<string, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    for (const t of this.toys) {
      if (t.hidden > 0) continue;
      const ms = this.meshes.get(t.kind);
      if (!ms) continue;
      const n = counts.get(t.kind) ?? 0;
      if (n >= MAX) continue;
      counts.set(t.kind, n + 1);
      // Orientation : le « haut » de l'objet suit la normale, plus sa rotation propre
      _q.setFromUnitVectors(UP, t.dir).multiply(t.rot);
      _p.copy(t.dir).multiplyScalar((this.radius + t.size + t.h) / this.scale);
      const pop = t.pop < 1 ? 1 - Math.pow(1 - t.pop, 3) * 1 + Math.sin(t.pop * Math.PI) * 0.15 : 1;
      _s.setScalar(pop / this.scale);
      _m.compose(_p, _q, _s);
      for (const m of ms) {
        m.setMatrixAt(n, _m);
        if (m.instanceColor) m.setColorAt(n, _c.copy(t.color));
      }
    }
    for (const [k, ms] of this.meshes) {
      for (const m of ms) {
        m.count = counts.get(k) ?? 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
}
