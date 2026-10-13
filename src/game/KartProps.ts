/**
 * Objets de course éparpillés sur toute la planète (aucune piste à suivre) :
 *  - baskets du futur (montantes, semelle et lacets lumineux) : rechargent le turbo ;
 *  - accélérateurs : disques à flèches lumineuses qui pivotent vers le véhicule
 *    qui arrive (la flèche indique toujours le bon sens) : coup de vitesse ;
 *  - ressorts : plateau sur ressort qui se tasse puis propulse le véhicule en l'air ;
 *  - poteaux : simple poteau rayé ; le véhicule qui le heurte rebondit et fait
 *    un tour sur lui-même (côté selon le point d'impact), puis accélère.
 * Positions tirées au hasard (graine fixe par planète), en espace planète.
 * Les types d'objets peuvent être dévoilés progressivement (`reveal`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { URandom } from '../unity/math';
import { toonGradient } from './toon';

export interface KartDef {
  boosts: number;
  /** Baskets turbo. */
  items: number;
  /** Ressorts (anciens tremplins). */
  ramps: number;
  spinners?: number;
}

export type KartKind = 'boosts' | 'items' | 'ramps' | 'spinners';

/** Objets par défaut d'une planète Arcade (pour une planète de taille 1). */
export const DEFAULT_KART: KartDef = { boosts: 3, items: 2, ramps: 1, spinners: 1 };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Disque accélérateur : fond orange, trois chevrons vers le haut de l'image. */
const padTexture = () =>
  canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 62);
    grd.addColorStop(0, '#ffb21a');
    grd.addColorStop(1, '#ff5a00');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#fff3b0';
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 3; i++) {
      const y = 88 - i * 24;
      g.fillStyle = i === 2 ? '#ffffff' : i === 1 ? '#fff6c0' : '#ffe46a';
      g.beginPath();
      g.moveTo(30, y + 12);
      g.lineTo(64, y - 10);
      g.lineTo(98, y + 12);
      g.lineTo(98, y + 24);
      g.lineTo(64, y + 2);
      g.lineTo(30, y + 24);
      g.closePath();
      g.fill();
    }
  });

/** Plateau du ressort : étoile blanche sur fond transparent. */
const springTexture = () =>
  canvasTex(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 11 : 24;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });

/** Bandes horizontales rouge et blanc du poteau. */
const poleTexture = () =>
  canvasTex(16, 64, (g) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#e8333a';
      g.fillRect(0, i * 16, 16, 16);
    }
  });

const toon = (color: number, opts: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });

/** Contour de semelle vu de dessus (x, avant), talon arrondi, pointe large. */
function soleOutline(s = 1): THREE.Shape {
  const sh = new THREE.Shape();
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    pts.push([Math.cos(a) * 0.066 * s, (0.11 + Math.sin(a) * 0.06) * s]); // pointe
  }
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + (i / 18) * Math.PI;
    pts.push([Math.cos(a) * 0.052 * s, (-0.12 + Math.sin(a) * 0.045) * s]); // talon
  }
  // Repère de la forme : (x, −avant) ; extrusion vers le haut après rotation
  pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
  sh.closePath();
  return sh;
}

/**
 * Basket montante du futur (4 pièces) : semelle blanche épaisse, tige argentée
 * montante au profil arrondi, bride sombre sur le cou-de-pied, éclairages
 * (liseré de semelle, col, panneau du talon).
 */
function sneakerParts(): THREE.BufferGeometry[] {
  const flat = (g: THREE.BufferGeometry) => g.toNonIndexed();
  const sole = new THREE.ExtrudeGeometry(soleOutline(), { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 6 })
    .rotateX(-Math.PI / 2)
    .translate(0, 0.008, 0);
  // Profil latéral de la tige (avant, hauteur), extrudé sur la largeur
  const p = new THREE.Shape();
  p.moveTo(-0.15, 0.045);
  p.lineTo(-0.155, 0.2);
  p.quadraticCurveTo(-0.15, 0.255, -0.1, 0.258);
  p.lineTo(-0.03, 0.25);
  p.quadraticCurveTo(0.0, 0.2, 0.06, 0.13);
  p.quadraticCurveTo(0.13, 0.1, 0.165, 0.07);
  p.quadraticCurveTo(0.175, 0.045, 0.15, 0.045);
  p.closePath();
  const w = 0.1;
  const upper = new THREE.ExtrudeGeometry(p, { depth: w, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.014, bevelSegments: 3, curveSegments: 8 })
    .translate(0, 0, -w / 2)
    .rotateY(-Math.PI / 2);
  // Bride sur le cou-de-pied (suit la pente de la tige)
  const strap = new THREE.BoxGeometry(0.136, 0.026, 0.075).rotateX(0.75).translate(0, 0.19, 0.005);
  const glow = mergeGeometries([
    // Liseré lumineux autour de la semelle
    new THREE.ExtrudeGeometry(soleOutline(1.16), { depth: 0.012, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2).translate(0, 0.028, 0),
    // Col, panneau du talon et inscription lumineuse sur la bride
    new THREE.TorusGeometry(0.062, 0.011, 6, 20).scale(1, 1.25, 1).rotateX(Math.PI / 2 - 0.12).translate(0, 0.262, -0.1),
    new THREE.BoxGeometry(0.07, 0.11, 0.012).translate(0, 0.16, -0.172),
    new THREE.BoxGeometry(0.07, 0.008, 0.03).rotateX(0.75).translate(0, 0.19 + 0.016 * 0.73, 0.005 + 0.016 * 0.68),
  ].map(flat))!;
  return [sole, upper, strap, glow];
}

/** Hélice du ressort, de hauteur 1 (mise à l'échelle selon la compression). */
function coilGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const turns = 4;
  for (let i = 0; i <= turns * 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.17, i / (turns * 24), Math.sin(a) * 0.17));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, 0.022, 6, false);
}

const MAX_ITEM = 12;
const MAX_RAMP = 8;
const MAX_PAD = 12;
const MAX_SPIN = 8;
const SPRING_H = 0.16;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _a = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Pickup {
  dir: THREE.Vector3;
  respawn: number;
}

interface Pad {
  dir: THREE.Vector3;
  /** Avant de référence (espace planète, tangent). */
  fwd: THREE.Vector3;
  /** Cap courant des flèches (rad autour de la normale). */
  yaw: number;
}

interface Spring {
  dir: THREE.Vector3;
  fwd: THREE.Vector3;
  /** Temps depuis le déclenchement (−1 : au repos). */
  t: number;
}

interface Pole {
  dir: THREE.Vector3;
  /** Oscillation après un choc : axe (tangent) et temps. */
  axis: THREE.Vector3;
  t: number;
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
  private readonly padMesh: THREE.InstancedMesh[];
  private readonly padRingMat: THREE.MeshBasicMaterial;
  private readonly springMesh: THREE.InstancedMesh[];
  private readonly poleMesh: THREE.InstancedMesh[];
  private items: Pickup[] = [];
  /** Accélérateurs. */
  pads: Pad[] = [];
  /** Ressorts. */
  springs: Spring[] = [];
  /** Poteaux. */
  poles: Pole[] = [];
  /** Rayon de collision d'un poteau (monde). */
  readonly poleRadius = 0.1;
  private radius = 5;
  private scale = 1;
  private time = 0;
  /** Types visibles (dévoilement progressif). */
  private shown = new Set<KartKind>(['boosts', 'items', 'ramps', 'spinners']);

  constructor(parent: THREE.Object3D) {
    const [sole, upper, strap, glow] = sneakerParts();
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.8, 2.6) });
    this.sneaker = [
      inst(sole, toon(0xf6f6f2, { emissive: new THREE.Color(0x303030) }), MAX_ITEM),
      inst(upper, toon(0xc4c8d0, { emissive: new THREE.Color(0x1a1c22) }), MAX_ITEM),
      inst(strap, toon(0x3a3f4a), MAX_ITEM),
      inst(glow, this.glowMat, MAX_ITEM),
    ];
    // Accélérateur : disque à flèches + anneau lumineux
    this.padRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.4), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.padMesh = [
      inst(
        new THREE.CircleGeometry(0.36, 40).rotateX(-Math.PI / 2).rotateY(Math.PI),
        new THREE.MeshBasicMaterial({ map: padTexture(), color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
        MAX_PAD,
      ),
      inst(new THREE.RingGeometry(0.37, 0.42, 40).rotateX(-Math.PI / 2), this.padRingMat, MAX_PAD),
    ];
    for (const m of this.padMesh) {
      m.castShadow = false;
      m.renderOrder = 1;
    }
    // Ressort : socle, hélice, plateau rouge, étoile
    this.springMesh = [
      inst(new THREE.CylinderGeometry(0.27, 0.3, 0.05, 28).translate(0, 0.025, 0), toon(0x2a2a34), MAX_RAMP),
      inst(coilGeometry(), toon(0xd8dce4, { emissive: new THREE.Color(0x202228) }), MAX_RAMP),
      inst(new THREE.CylinderGeometry(0.25, 0.25, 0.045, 28).translate(0, 0.0225, 0), toon(0xff3b3b, { emissive: new THREE.Color(0x401010) }), MAX_RAMP),
      inst(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2).translate(0, 0.047, 0), new THREE.MeshBasicMaterial({ map: springTexture(), color: new THREE.Color(1.6, 1.5, 1.2), transparent: true, depthWrite: false }), MAX_RAMP),
    ];
    // Poteau rayé, socle sombre, boule lumineuse
    this.poleMesh = [
      inst(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 20).translate(0, 0.025, 0), toon(0x2a2a34), MAX_SPIN),
      inst(new THREE.CylinderGeometry(0.075, 0.085, 0.5, 20).translate(0, 0.3, 0), toon(0xffffff, { map: poleTexture() }), MAX_SPIN),
      inst(new THREE.SphereGeometry(0.075, 16, 10).translate(0, 0.58, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.6, 0.4) }), MAX_SPIN),
    ];
    this.group.add(...this.sneaker, ...this.padMesh, ...this.springMesh, ...this.poleMesh);
    parent.add(this.group);
  }

  /** Éparpille les objets sur la planète (rien si `kart` est absent). */
  build(kart: KartDef | undefined, radius: number, scale: number, seed: number): void {
    this.radius = radius;
    this.scale = scale;
    this.items = [];
    this.springs = [];
    this.pads = [];
    this.poles = [];
    if (!kart) {
      this.update(0);
      return;
    }
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
      if (s) this.springs.push({ ...s, t: -1 });
    }
    for (let i = 0; i < Math.min(kart.boosts, MAX_PAD); i++) {
      const s = spot();
      if (s) this.pads.push({ ...s, yaw: 0 });
    }
    for (let i = 0; i < Math.min(kart.spinners ?? 0, MAX_SPIN); i++) {
      const s = spot();
      if (s) this.poles.push({ dir: s.dir, axis: s.fwd, t: -1 });
    }
    this.update(0);
  }

  /** Types d'objets visibles et actifs (dévoilement progressif). */
  reveal(kinds: KartKind[]): void {
    this.shown = new Set(kinds);
  }

  /** Types présents sur la planète. */
  kinds(): KartKind[] {
    const out: KartKind[] = [];
    if (this.pads.length) out.push('boosts');
    if (this.items.length) out.push('items');
    if (this.springs.length) out.push('ramps');
    if (this.poles.length) out.push('spinners');
    return out;
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

  /**
   * Animation. `carDir`/`carFwd` (espace planète) : les flèches des
   * accélérateurs proches pivotent vers le cap du véhicule.
   */
  update(dt: number, carDir?: THREE.Vector3, carFwd?: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    // Baskets : rotation lente, flottement, éclairages qui pulsent
    let n = 0;
    if (this.shown.has('items')) {
      for (const it of this.items) {
        it.respawn = Math.max(0, it.respawn - dt);
        if (it.respawn > 0) continue;
        _a.set(0, 0, 1).addScaledVector(it.dir, -it.dir.z);
        if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
        const m = this.place(it.dir, _a.normalize(), 0.2 + 0.05 * Math.sin(t * 3 + n), 1.7);
        _q2.setFromAxisAngle(UP, t * 1.8 + n);
        m.multiply(_m2.makeRotationFromQuaternion(_q2));
        // Légèrement penchée, pointe vers le haut
        m.multiply(_m2.makeRotationX(-0.25));
        for (const s of this.sneaker) s.setMatrixAt(n, m);
        n++;
      }
    }
    for (const s of this.sneaker) {
      s.count = n;
      s.instanceMatrix.needsUpdate = true;
    }
    const k = 1 + 0.35 * Math.sin(t * 6);
    this.glowMat.color.setRGB(0.5 * k, 1.8 * k, 2.6 * k);
    // Accélérateurs : les flèches s'orientent vers le véhicule qui approche
    n = 0;
    if (this.shown.has('boosts')) {
      for (const p of this.pads) {
        if (carDir && carFwd && p.dir.angleTo(carDir) * this.radius < 3) {
          // Cap du véhicule dans le repère du disque
          _z.copy(p.fwd);
          _x.crossVectors(p.dir, _z);
          const want = Math.atan2(carFwd.dot(_x), carFwd.dot(_z));
          let d = want - p.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.yaw += d * (1 - Math.exp(-dt * 10));
        }
        _a.copy(p.fwd).applyAxisAngle(p.dir, p.yaw);
        const m = this.place(p.dir, _a, 0.012);
        this.padMesh[0].setMatrixAt(n, m);
        // Anneau qui pulse
        _s.setScalar((1 + 0.06 * Math.sin(t * 8 + n)) / this.scale);
        m.decompose(_p, _q, new THREE.Vector3());
        this.padMesh[1].setMatrixAt(n, _m2.compose(_p, _q, _s));
        n++;
      }
    }
    for (const m of this.padMesh) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    this.padRingMat.opacity = 0.65 + 0.3 * Math.sin(t * 8);
    // Ressorts : tassement puis détente amortie
    n = 0;
    if (this.shown.has('ramps')) {
      for (const s of this.springs) {
        let h = SPRING_H;
        if (s.t >= 0) {
          s.t += dt;
          if (s.t < 0.07) h = SPRING_H * (1 - 0.6 * (s.t / 0.07));
          else {
            const x = s.t - 0.07;
            h = SPRING_H * (1 - 0.6 * Math.exp(-5 * x) * Math.cos(14 * x));
            if (x > 1.2) s.t = -1;
          }
        }
        const base = this.place(s.dir, s.fwd, 0);
        this.springMesh[0].setMatrixAt(n, base);
        this.springMesh[1].setMatrixAt(n, _m2.copy(base).multiply(new THREE.Matrix4().makeTranslation(0, 0.045, 0).scale(new THREE.Vector3(1, h, 1))));
        const top = _m2.copy(base).multiply(new THREE.Matrix4().makeTranslation(0, 0.045 + h, 0));
        this.springMesh[2].setMatrixAt(n, top);
        this.springMesh[3].setMatrixAt(n, top);
        n++;
      }
    }
    for (const m of this.springMesh) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    // Poteaux : oscillation amortie après un choc
    n = 0;
    if (this.shown.has('spinners')) {
      for (const p of this.poles) {
        _a.set(0, 0, 1).addScaledVector(p.dir, -p.dir.z);
        if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
        const base = this.place(p.dir, _a.normalize(), 0);
        this.poleMesh[0].setMatrixAt(n, base);
        let tilt = 0;
        if (p.t >= 0) {
          p.t += dt;
          tilt = 0.45 * Math.exp(-4 * p.t) * Math.sin(16 * p.t);
          if (p.t > 2) p.t = -1;
        }
        // Axe d'oscillation exprimé dans le repère local du poteau
        const inv = _q2.copy(_q).invert();
        const ax = p.axis.clone().applyQuaternion(inv).normalize();
        const m = _m2.copy(base).multiply(new THREE.Matrix4().makeRotationAxis(ax, tilt)).multiply(new THREE.Matrix4().makeRotationY(t * 1.5));
        this.poleMesh[1].setMatrixAt(n, m);
        this.poleMesh[2].setMatrixAt(n, m);
        n++;
      }
    }
    for (const m of this.poleMesh) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Basket ramassée ? Renvoie sa direction (espace planète) pour les particules. */
  collect(carDir: THREE.Vector3, reach: number, R = this.radius): THREE.Vector3 | null {
    if (!this.shown.has('items')) return null;
    for (const it of this.items) {
      if (it.respawn > 0) continue;
      if (it.dir.angleTo(carDir) * R < reach) {
        it.respawn = 6;
        return it.dir;
      }
    }
    return null;
  }

  /** Ressort sous le véhicule : le déclenche et renvoie true. */
  springAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    if (!this.shown.has('ramps')) return false;
    for (const s of this.springs) {
      if (s.dir.angleTo(carDir) * R < reach) {
        if (s.t < 0 || s.t > 0.5) s.t = 0;
        return true;
      }
    }
    return false;
  }

  padAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    return this.shown.has('boosts') && this.pads.some((p) => p.dir.angleTo(carDir) * R < reach);
  }

  /** Poteaux actifs (collision), espace planète. */
  activePoles(): Pole[] {
    return this.shown.has('spinners') ? this.poles : [];
  }

  /** Choc sur un poteau : oscillation autour de l'axe perpendiculaire au choc. */
  hitPole(p: Pole, push: THREE.Vector3): void {
    p.axis.crossVectors(p.dir, push).normalize();
    p.t = 0;
  }
}
