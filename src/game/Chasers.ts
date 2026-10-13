/**
 * Poursuites (modes de jeu) :
 *  - Vif d'or : petite balle dorée ailée qui vole au ras de la planète, zigzague
 *    et fuit quand on approche ; l'attraper rapporte un point ;
 *  - Bullet Bill : obus noir aux yeux blancs qui pourchasse le véhicule
 *    (virage limité) puis s'éteint ; le toucher fait très mal.
 * Déplacements sur la sphère en espace planète.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

const toon = (color: number, opts: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });

/** Mobile sur la sphère : direction, cap tangent, vitesse (monde). */
class Mover {
  readonly dir = new THREE.Vector3(0, 1, 0);
  readonly heading = new THREE.Vector3(0, 0, 1);
  speed = 4;
  step(dt: number, R: number, h: number): void {
    const axis = new THREE.Vector3().crossVectors(this.dir, this.heading).normalize();
    const ang = (this.speed * dt) / (R + h);
    this.dir.applyAxisAngle(axis, ang).normalize();
    this.heading.applyAxisAngle(axis, ang);
    this.heading.addScaledVector(this.dir, -this.heading.dot(this.dir)).normalize();
  }
  /** Tourne le cap vers (ou à l'opposé de) une direction, au plus `rate` rad/s. */
  steer(target: THREE.Vector3, rate: number, dt: number, away = false): void {
    const want = target.clone().addScaledVector(this.dir, -target.dot(this.dir));
    if (want.lengthSq() < 1e-8) return;
    want.normalize();
    if (away) want.negate();
    const a = Math.atan2(new THREE.Vector3().crossVectors(this.heading, want).dot(this.dir), this.heading.dot(want));
    this.heading.applyAxisAngle(this.dir, Math.max(-rate * dt, Math.min(rate * dt, a)));
  }
  place(obj: THREE.Object3D, R: number, h: number, scale: number): void {
    obj.position.copy(this.dir).multiplyScalar((R + h) / scale);
    const x = new THREE.Vector3().crossVectors(this.dir, this.heading).normalize();
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, this.dir, this.heading));
    obj.scale.setScalar(1 / scale);
  }
}

export class Snitch {
  readonly obj = new THREE.Group();
  private readonly wings: THREE.Mesh[] = [];
  private readonly m = new Mover();
  private t = 0;
  active = false;
  caught = 0;
  onCatch: (at: THREE.Vector3) => void = () => undefined;

  constructor(parent: THREE.Object3D) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 12), toon(0xffc93a, { emissive: new THREE.Color(0x8a5a08) }));
    const wingGeo = new THREE.SphereGeometry(0.16, 12, 6).scale(1, 0.08, 0.45).translate(0.17, 0, -0.03);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, toon(0xf4f0e0, { side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      w.scale.x = sx;
      this.wings.push(w);
      this.obj.add(w);
    }
    this.obj.add(ball);
    this.obj.visible = false;
    parent.add(this.obj);
  }

  start(carDir: THREE.Vector3): void {
    this.active = true;
    this.caught = 0;
    this.respawn(carDir);
    this.obj.visible = true;
  }

  stop(): void {
    this.active = false;
    this.obj.visible = false;
  }

  private respawn(carDir: THREE.Vector3): void {
    // Loin du véhicule (de l'autre côté de la planète, ou presque)
    this.m.dir.copy(carDir).negate().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8)).normalize();
    const a = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    this.m.heading.copy(a.addScaledVector(this.m.dir, -a.dot(this.m.dir)).normalize());
  }

  update(dt: number, carDir: THREE.Vector3, carSpeed: number, R: number, scale: number): void {
    if (!this.active) return;
    this.t += dt;
    const dist = this.m.dir.angleTo(carDir) * R;
    // Zigzag permanent ; fuit si le véhicule approche (un peu moins vite que lui)
    this.m.heading.applyAxisAngle(this.m.dir, Math.sin(this.t * 1.7) * 1.6 * dt);
    if (dist < 3) this.m.steer(carDir, 2.2, dt, true);
    this.m.speed = dist < 3 ? carSpeed * 0.82 : carSpeed * 0.45;
    this.m.step(dt, R, 0.5);
    this.m.place(this.obj, R, 0.45 + 0.08 * Math.sin(this.t * 5), scale);
    const flap = Math.sin(this.t * 40) * 0.9;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
    if (dist < 0.5) {
      this.caught++;
      this.onCatch(this.obj.getWorldPosition(new THREE.Vector3()));
      this.respawn(carDir);
    }
  }

  get dir(): THREE.Vector3 | null {
    return this.active ? this.m.dir : null;
  }
}

interface Bill {
  m: Mover;
  obj: THREE.Group;
  life: number;
}

export class BulletBills {
  readonly group = new THREE.Group();
  private bills: Bill[] = [];
  private timer = 3;
  active = false;
  /** Prévient l'arrivée d'un obus (message, son). */
  onLaunch: () => void = () => undefined;
  onHit: (at: THREE.Vector3) => void = () => undefined;
  onFizzle: (at: THREE.Vector3) => void = () => undefined;
  dodged = 0;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  private make(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.22, 6, 16).rotateX(Math.PI / 2), toon(0x22222a));
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, -0.2), toon(0x111116));
    const eyes = [-1, 1].map((sx) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8).scale(1, 1.4, 0.5), toon(0xffffff));
      e.position.set(sx * 0.06, 0.06, 0.17);
      return e;
    });
    const arms = [-1, 1].map((sx) => {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).scale(1.5, 0.6, 0.8), toon(0xffffff));
      a.position.set(sx * 0.15, -0.02, 0);
      return a;
    });
    g.add(body, back, ...eyes, ...arms);
    g.castShadow = true;
    return g;
  }

  start(): void {
    this.active = true;
    this.timer = 4;
    this.dodged = 0;
  }

  stop(): void {
    this.active = false;
    for (const b of this.bills) this.group.remove(b.obj);
    this.bills = [];
  }

  update(dt: number, carDir: THREE.Vector3, carSpeed: number, R: number, scale: number): void {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer <= 0 && this.bills.length < 3) {
      this.timer = 9 + Math.random() * 4;
      // Arrive de derrière l'horizon, plutôt dans le dos du véhicule
      const m = new Mover();
      const away = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      m.dir.copy(carDir).addScaledVector(away, 1.6).normalize();
      m.heading.copy(carDir).addScaledVector(m.dir, -carDir.dot(m.dir)).normalize();
      const obj = this.make();
      this.group.add(obj);
      this.bills.push({ m, obj, life: 9 });
      this.onLaunch();
    }
    for (const b of [...this.bills]) {
      b.life -= dt;
      b.m.speed = carSpeed * 1.18;
      b.m.steer(carDir, 1.5, dt);
      b.m.step(dt, R, 0.35);
      b.m.place(b.obj, R, 0.35, scale);
      const at = () => b.obj.getWorldPosition(new THREE.Vector3());
      if (b.m.dir.angleTo(carDir) * R < 0.4) {
        this.onHit(at());
        this.group.remove(b.obj);
        this.bills.splice(this.bills.indexOf(b), 1);
      } else if (b.life <= 0) {
        this.dodged++;
        this.onFizzle(at());
        this.group.remove(b.obj);
        this.bills.splice(this.bills.indexOf(b), 1);
      }
    }
  }

  dirs(): THREE.Vector3[] {
    return this.bills.map((b) => b.m.dir);
  }
}
