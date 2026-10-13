/**
 * Canon champignon du voyage galactique : la voiture plonge dans la bouche
 * du canon posé sur la planète d'arrivée, le champignon gonfle… puis BOUM,
 * il la recrache en l'air.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
const _y = new THREE.Vector3(0, 1, 0);

export class MushroomCannon {
  readonly group = new THREE.Group();
  private readonly cap = new THREE.Group();
  private readonly stem: THREE.Mesh;
  /** Hauteur de la bouche (unités locales, avant l'échelle). */
  static readonly MOUTH = 0.98;
  /** Temps de la phase en cours (s). */
  private t = 0;
  private state: 'idle' | 'charge' | 'recoil' | 'linger' | 'hide' = 'idle';
  private size = 1;
  /** Le canon a disparu (rentré sous terre) : nuage de poussière. */
  onGone: (at: THREE.Vector3) => void = () => undefined;
  /** Charge (s) : durée entre l'entrée de la voiture et le BOUM. */
  static readonly CHARGE = 0.6;

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
    this.group.quaternion.setFromUnitVectors(_y, up);
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

  /** La voiture est dedans : le champignon gonfle. */
  charge(): void {
    this.state = 'charge';
    this.t = 0;
  }

  /** BOUM : le chapeau s'écrase puis rebondit. */
  fire(): void {
    this.state = 'recoil';
    this.t = 0;
  }

  hide(): void {
    this.group.visible = false;
    this.state = 'idle';
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const t = this.t;
    if (this.state === 'charge') {
      // Gonfle en tremblotant
      const k = Math.min(1, t / MushroomCannon.CHARGE);
      const w = Math.sin(t * 40) * 0.04 * k;
      this.cap.scale.set(1 + 0.28 * k + w, 1 - 0.12 * k - w, 1 + 0.28 * k + w);
      this.stem.scale.set(1 + 0.1 * k, 1 - 0.15 * k, 1 + 0.1 * k);
    } else if (this.state === 'recoil') {
      // Écrasement puis ressort amorti
      const e = Math.exp(-5 * t) * Math.cos(t * 22);
      this.cap.scale.set(1 - 0.25 * e, 1 + 0.45 * e, 1 - 0.25 * e);
      this.stem.scale.set(1, 1 + 0.25 * e, 1);
      if (t > 0.7) {
        this.state = 'linger';
        this.t = 0;
      }
    } else if (this.state === 'linger') {
      if (t > 0.3) {
        this.state = 'hide';
        this.t = 0;
      }
    } else if (this.state === 'hide') {
      // Usage unique : il se tasse et rentre sous terre, puis disparaît
      const k = Math.min(1, t / 0.45);
      const e = k * k;
      this.group.scale.set(this.size * (1 + 0.15 * Math.sin(k * Math.PI)), this.size * Math.max(0.01, 1 - e), this.size * (1 + 0.15 * Math.sin(k * Math.PI)));
      if (k >= 1) {
        this.onGone(this.group.position.clone());
        this.hide();
      }
    }
  }
}
