/**
 * Canon champignon du voyage galactique : la voiture plonge dans la bouche
 * du canon posé sur la planète d'arrivée ; le champignon l'avale, gonfle en se
 * dandinant, s'incline vers l'avant et la tire (bouffée de fumée), puis rentre
 * sous terre.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
const _y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const ease = (x: number) => x * x * (3 - 2 * x);

export class MushroomCannon {
  readonly group = new THREE.Group();
  private readonly cap = new THREE.Group();
  private readonly stem: THREE.Mesh;
  /** Hauteur de la bouche (unités locales, avant l'échelle). */
  static readonly MOUTH = 0.98;
  /** Charge (s) : la voiture est dedans, le champignon gonfle et se dandine. */
  static readonly CHARGE = 0.85;
  /** Visée (s) : il s'incline vers l'avant juste avant de tirer. */
  static readonly AIM = 0.25;
  /** Inclinaison du tir (rad). */
  static readonly TILT = 0.55;
  /** Temps de la phase en cours (s). */
  private t = 0;
  private state: 'idle' | 'gulp' | 'charge' | 'recoil' | 'hide' = 'idle';
  private size = 1;
  /** Orientation dressée (sans inclinaison) et axe d'inclinaison vers l'avant (local). */
  private readonly base = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(1, 0, 0);
  /** Le canon a disparu (rentré sous terre) : nuage de poussière. */
  onGone: (at: THREE.Vector3) => void = () => undefined;

  constructor(parent: THREE.Object3D) {
    // Pied crème, un peu évasé
    this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.5, 20).translate(0, 0.25, 0), toon(0xf5e8c8));
    // Chapeau rouge à pois blancs
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), toon(0xe63a2e));
    dome.scale.y = 0.75;
    const under = new THREE.Mesh(new THREE.CircleGeometry(0.47, 28).rotateX(Math.PI / 2), toon(0xf0dcb0));
    under.position.y = 0.06;
    this.cap.add(dome, under);
    const spot = toon(0xffffff);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const el = i % 2 ? 0.55 : 0.95;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6), spot);
      s.scale.y = 0.35;
      const p = new THREE.Vector3(Math.cos(a) * Math.sin(el), Math.cos(el) * 0.75, Math.sin(a) * Math.sin(el)).multiplyScalar(0.5);
      s.position.copy(p);
      s.quaternion.setFromUnitVectors(_y, p.clone().normalize());
      this.cap.add(s);
    }
    // Canon : fût sombre qui sort du chapeau, bouche noire et liseré doré
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 20, 1, true), toon(0x3a3550));
    barrel.position.y = 0.4;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.19, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050308 }));
    hole.position.y = 0.53;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.04, 8, 24).rotateX(Math.PI / 2), toon(0xffc531));
    rim.position.y = 0.56;
    this.cap.add(barrel, hole, rim);
    this.cap.position.y = 0.42;
    this.group.add(this.stem, this.cap);
    this.group.traverse((o) => (o.castShadow = true));
    this.group.visible = false;
    parent.add(this.group);
  }

  /** Pose le canon au point `at` (monde), dressé selon `up`, à l'échelle `s`. */
  place(at: THREE.Vector3, up: THREE.Vector3, s: number): void {
    this.group.position.copy(at);
    this.base.setFromUnitVectors(_y, up);
    this.group.quaternion.copy(this.base);
    this.group.scale.setScalar(s);
    this.size = s;
    this.group.visible = true;
    this.state = 'idle';
    this.t = 0;
    this.cap.scale.setScalar(1);
    this.stem.scale.setScalar(1);
  }

  /** Bouche du canon (monde). */
  mouth(out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(out.set(0, MushroomCannon.MOUTH, 0));
  }

  /** Axe du fût (monde), incliné ou non. */
  barrelDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(_y).applyQuaternion(this.group.quaternion).normalize();
  }

  /** La voiture plonge dedans : le chapeau s'ouvre un peu pour l'avaler. */
  gulp(): void {
    this.state = 'gulp';
    this.t = 0;
  }

  /** Voiture avalée : il gonfle et se dandine, puis s'incline vers `forward` (monde). */
  charge(forward: THREE.Vector3): void {
    this.state = 'charge';
    this.t = 0;
    // Axe d'inclinaison local : haut × avant (le fût bascule vers l'avant)
    const up = _a.copy(_y).applyQuaternion(this.base);
    const f = forward.clone().addScaledVector(up, -forward.dot(up)).normalize();
    this.axis.crossVectors(up, f).normalize().applyQuaternion(_q.copy(this.base).invert());
  }

  /** Tir : le chapeau s'écrase puis rebondit, il se redresse et rentre sous terre. */
  fire(): void {
    this.state = 'recoil';
    this.t = 0;
  }

  hide(): void {
    this.group.visible = false;
    this.state = 'idle';
  }

  private tilt(angle: number, wobbleX = 0, wobbleZ = 0): void {
    this.group.quaternion.copy(this.base).multiply(_q.setFromAxisAngle(this.axis, angle));
    if (wobbleX || wobbleZ) this.group.quaternion.multiply(_q.setFromEuler(new THREE.Euler(wobbleX, 0, wobbleZ)));
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;
    const C = MushroomCannon.CHARGE;
    if (this.state === 'gulp') {
      // Bouche qui s'ouvre (chapeau élargi), petit sursaut
      const k = Math.min(1, t / 0.4);
      const o = Math.sin(k * Math.PI);
      this.cap.scale.set(1 + 0.12 * o, 1 - 0.08 * o, 1 + 0.12 * o);
    } else if (this.state === 'charge') {
      if (t < C) {
        // Avale (bosse qui descend), gonfle et se dandine de plus en plus
        const k = t / C;
        const gulp = Math.max(0, 1 - t / 0.25);
        const w = Math.sin(t * 26) * (0.03 + 0.05 * k);
        this.cap.scale.set(1 + 0.22 * k + w + 0.1 * gulp, 1 + 0.1 * k - w, 1 + 0.22 * k + w + 0.1 * gulp);
        this.stem.scale.set(1 + 0.18 * k + 0.25 * gulp, 1 - 0.1 * k, 1 + 0.18 * k + 0.25 * gulp);
        this.tilt(0, Math.sin(t * 17) * 0.1 * k, Math.cos(t * 13) * 0.1 * k);
      } else {
        // Visée : bascule vers l'avant, le chapeau se ramasse
        const k = ease(Math.min(1, (t - C) / MushroomCannon.AIM));
        this.tilt(MushroomCannon.TILT * k);
        this.cap.scale.set(1.22 - 0.1 * k, 1.1 - 0.2 * k, 1.22 - 0.1 * k);
        this.stem.scale.set(1.18, 0.9, 1.18);
      }
    } else if (this.state === 'recoil') {
      // Recul : écrasement puis ressort amorti, il se redresse
      const e = Math.exp(-5 * t) * Math.cos(t * 22);
      this.cap.scale.set(1 - 0.25 * e, 1 + 0.45 * e, 1 - 0.25 * e);
      this.stem.scale.set(1, 1 + 0.25 * e, 1);
      this.tilt(MushroomCannon.TILT * (1 - ease(Math.min(1, t / 0.6))) - 0.12 * Math.exp(-6 * t) * Math.sin(t * 18));
      if (t > 0.9) {
        this.state = 'hide';
        this.t = 0;
      }
    } else if (this.state === 'hide') {
      // Usage unique : il se tasse et rentre sous terre, puis disparaît
      const k = Math.min(1, t / 0.45);
      const e = k * k;
      const w = this.size * (1 + 0.15 * Math.sin(k * Math.PI));
      this.group.scale.set(w, this.size * Math.max(0.01, 1 - e), w);
      if (k >= 1) {
        this.onGone(this.group.position.clone());
        this.hide();
      }
    }
  }
}
