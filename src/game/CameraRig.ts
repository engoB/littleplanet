/**
 * Caméra principale.
 * Original : la Main Camera est enfant de la voiture (position locale
 * (0, 59.9, 0.36), rotation X 90°) — vue de dessus qui tourne avec elle.
 * Arcade : même rig, incliné de `tilt` degrés vers l'arrière, avec un
 * léger amortissement de l'orientation.
 * Le plan « Halo » (fond dégradé) reste enfant de la caméra comme dans Unity.
 * Une caméra three regarde vers −Z alors qu'une caméra Unity regarde vers +Z :
 * la PerspectiveCamera est donc enfant du nœud Unity, tournée de 180° en Y.
 */
import * as THREE from 'three';
import { Deg2Rad } from '../unity/math';
import type { CameraData, NodeData } from '../unity/types';

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();

export class CameraRig {
  /** Nœud « Main Camera » (convention Unity : +Z vers l'avant). */
  readonly node = new THREE.Object3D();
  /** Pivot qui suit la voiture (transform du parent Unity). */
  readonly pivot = new THREE.Object3D();
  readonly camera: THREE.PerspectiveCamera;
  tilt = 0;
  /** Facteur de hauteur (petites planètes, préréglage Arcade). */
  heightScale = 1;
  /** Élargit le champ en portrait (garde l'angle horizontal). */
  portraitFit = false;
  private baseFov: number;
  /**
   * Caméra adaptative (Arcade) : proche de la voiture quand la planète est
   * grosse, recule pour montrer la planète entière quand elle devient petite.
   */
  adaptive = false;
  readonly center = new THREE.Vector3();
  radius = 5;
  closeHeight = 6.2;
  closeTilt = 30;
  private smoothQ = new THREE.Quaternion();
  private readonly localPos: THREE.Vector3;
  private readonly localRot: THREE.Quaternion;

  constructor(readonly data: NodeData, cam: CameraData) {
    // Plan lointain allongé : planète de verre (on voit la face opposée) et vols entre planètes
    this.camera = new THREE.PerspectiveCamera(cam.fov, 16 / 9, cam.near, Math.max(cam.far, 300));
    this.camera.rotation.y = Math.PI;
    this.baseFov = cam.fov;
    this.node.add(this.camera);
    this.node.name = data.name;
    this.localPos = new THREE.Vector3(...data.position);
    this.localRot = new THREE.Quaternion(...data.rotation);
    this.node.position.copy(this.localPos);
    this.node.quaternion.copy(this.localRot);
    this.node.scale.set(...data.scale);
    this.pivot.add(this.node);
  }

  /** Suit un transform (voiture ou racine 3D du menu). LateUpdate. */
  follow(target: THREE.Object3D, dt: number, snap = false): void {
    if (this.adaptive) {
      this.followAdaptive(target, dt, snap);
      return;
    }
    this.pivot.position.copy(target.position);
    this.pivot.scale.copy(target.scale);
    if (this.tilt <= 0) {
      this.pivot.quaternion.copy(target.quaternion);
      this.node.position.copy(this.localPos).multiplyScalar(this.heightScale);
      this.node.quaternion.copy(this.localRot);
    } else {
      // Arcade : orientation amortie, caméra reculée et inclinée
      if (snap) this.smoothQ.copy(target.quaternion);
      else this.smoothQ.slerp(target.quaternion, 1 - Math.exp(-dt * 6));
      // Recalage : le « haut » du pivot reste la normale de la planète
      _up.set(0, 1, 0).applyQuaternion(target.quaternion);
      const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.smoothQ);
      _q.setFromUnitVectors(curUp, _up);
      this.smoothQ.premultiply(_q);
      this.pivot.quaternion.copy(this.smoothQ);
      const h = this.localPos.length() * this.heightScale;
      const a = this.tilt * Deg2Rad;
      this.node.position.set(0, Math.cos(a) * h, -Math.sin(a) * h);
      // Regarde un point un peu devant la voiture (en unités locales du pivot)
      const look = new THREE.Vector3(0, 0, (0.8 / Math.max(1e-3, target.scale.z)) * Math.sin(a));
      _fwd.copy(look).sub(this.node.position).normalize();
      _up.set(0, 0, 1);
      _x.crossVectors(_up, _fwd).normalize();
      const y = new THREE.Vector3().crossVectors(_fwd, _x);
      _m.makeBasis(_x, y, _fwd);
      this.node.quaternion.setFromRotationMatrix(_m);
    }
    this.pivot.updateMatrixWorld(true);
  }

  private followAdaptive(target: THREE.Object3D, dt: number, snap: boolean): void {
    if (snap) this.smoothQ.copy(target.quaternion);
    else this.smoothQ.slerp(target.quaternion, 1 - Math.exp(-dt * 5));
    const up = new THREE.Vector3().subVectors(target.position, this.center).normalize();
    const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.smoothQ);
    this.smoothQ.premultiply(new THREE.Quaternion().setFromUnitVectors(curUp, up));
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.smoothQ);
    const { pos, tgt } = this.adaptivePose(target.position, up, f, this.center, this.radius);
    this.pivot.position.set(0, 0, 0);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.node.scale.set(1, 1, 1);
    this.node.position.copy(pos);
    _fwd.subVectors(tgt, pos).normalize();
    // Le « haut » de l'écran suit la direction de la voiture
    _up.copy(f).addScaledVector(_fwd, -f.dot(_fwd)).normalize();
    _x.crossVectors(_up, _fwd).normalize();
    const y = new THREE.Vector3().crossVectors(_fwd, _x);
    _m.makeBasis(_x, y, _fwd);
    this.node.quaternion.setFromRotationMatrix(_m);
    this.pivot.updateMatrixWorld(true);
    this.applyBlend(dt);
    this.updateFov();
  }

  /** Pose de la caméra adaptative pour un véhicule (position, haut, avant) sur une planète. */
  adaptivePose(at: THREE.Vector3, up: THREE.Vector3, f: THREE.Vector3, center: THREE.Vector3, radius: number): { pos: THREE.Vector3; tgt: THREE.Vector3 } {
    // 0 : planète grosse (caméra proche) → 1 : planète petite (planète entière)
    const x = Math.min(1, Math.max(0, (4.2 - radius) / 2.2));
    const k = x * x * (3 - 2 * x);
    const a = this.closeTilt * Deg2Rad;
    const h = this.closeHeight;
    const pos0 = at.clone().addScaledVector(up, h * Math.cos(a)).addScaledVector(f, -h * Math.sin(a));
    const tgt0 = at.clone().addScaledVector(f, 1.1);
    const half = Math.min(this.camera.fov, (Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect) * 360) / Math.PI) * 0.5;
    const D = (radius * 1.3) / Math.tan(half * Deg2Rad);
    const b = 14 * Deg2Rad;
    const pos1 = center.clone().addScaledVector(up, Math.cos(b) * D).addScaledVector(f, -Math.sin(b) * D);
    return { pos: pos0.lerp(pos1, k), tgt: tgt0.lerp(center, k) };
  }

  /** Élargissement du champ (degrés) pendant un vol. */
  flightFov = 0;
  private blend: { pos: THREE.Vector3; q: THREE.Quaternion; t: number; dur: number } | null = null;
  /** Transition douce depuis une pose de caméra (monde) vers le suivi normal. */
  blendFrom(pos: THREE.Vector3, q: THREE.Quaternion, dur: number): void {
    this.blend = { pos: pos.clone(), q: q.clone(), t: 0, dur };
  }
  private applyBlend(dt: number): void {
    const b = this.blend;
    if (!b) return;
    b.t += dt;
    const k = Math.min(1, b.t / b.dur);
    const e = k * k * (3 - 2 * k);
    // Le nœud est à la racine (pivot identité) en mode adaptatif / poursuite
    this.node.position.lerpVectors(b.pos, this.node.position.clone(), e);
    this.node.quaternion.slerpQuaternions(b.q, this.node.quaternion.clone(), e);
    if (k >= 1) this.blend = null;
    this.pivot.updateMatrixWorld(true);
  }
  private lastFlightFov = 0;
  private updateFov(): void {
    if (this.flightFov === this.lastFlightFov) return;
    this.lastFlightFov = this.flightFov;
    this.setAspect(this.lastAspect);
  }
  private chasePos = new THREE.Vector3();
  private chaseTime = 0;
  private chaseInit = false;
  /** Caméra de poursuite (vol entre deux planètes) : derrière et au-dessus du véhicule. */
  chase(target: THREE.Object3D, up: THREE.Vector3, dt: number, focus?: THREE.Vector3, land?: { pos: THREE.Vector3; tgt: THREE.Vector3; up: THREE.Vector3; k: number }): void {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(target.quaternion);
    // Derrière le véhicule, côté opposé à la destination : la planète visée reste à l'image
    const away = focus ? target.position.clone().sub(focus).normalize() : f.clone().negate();
    const want = target.position.clone().addScaledVector(away, 4.2).addScaledVector(up, 2.4);
    if (!this.chaseInit) {
      this.chasePos.copy(this.node.getWorldPosition(new THREE.Vector3()));
      this.chaseInit = true;
      this.chaseTime = 0;
    }
    this.chaseTime += dt;
    this.chasePos.lerp(want, 1 - Math.exp(-dt * 4));
    this.pivot.position.set(0, 0, 0);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.node.scale.set(1, 1, 1);
    this.node.position.copy(this.chasePos);
    // Au départ on regarde le véhicule, puis le regard glisse vers la destination
    const k = Math.min(1, this.chaseTime / 0.8);
    const look = focus ? target.position.clone().lerp(focus, 0.3 * k * k * (3 - 2 * k)) : target.position.clone().addScaledVector(f, 2);
    const camUp = up.clone();
    // Fin du vol : la caméra rejoint la pose de suivi d'après l'atterrissage
    if (land && land.k > 0) {
      this.node.position.lerp(land.pos, land.k);
      look.lerp(land.tgt, land.k);
      camUp.lerp(land.up, land.k).normalize();
    }
    _fwd.copy(look).sub(this.node.position).normalize();
    _x.crossVectors(camUp, _fwd).normalize();
    const y = new THREE.Vector3().crossVectors(_fwd, _x);
    _m.makeBasis(_x, y, _fwd);
    this.node.quaternion.setFromRotationMatrix(_m);
    this.pivot.updateMatrixWorld(true);
    this.applyBlend(dt);
    this.updateFov();
  }

  /** Fin de poursuite : la prochaine poursuite repart de la caméra courante. */
  endChase(): void {
    this.chaseInit = false;
  }

  /** Décalage de cadrage (fractions de l'écran) pour la composition des menus. */
  readonly composition = new THREE.Vector2();
  private lastAspect = 16 / 9;

  setComposition(x: number, y: number): void {
    this.composition.set(x, y);
    this.setAspect(this.lastAspect);
  }

  setAspect(aspect: number): void {
    this.lastAspect = aspect;
    this.camera.aspect = aspect;
    const { x, y } = this.composition;
    if (x || y) {
      const w = 1000;
      const h = 1000 / aspect;
      this.camera.setViewOffset(w, h, -x * w, y * h, w, h);
    } else this.camera.clearViewOffset();
    // Portrait : FOV vertical élargi pour conserver ~le cadrage horizontal du paysage
    if (this.portraitFit && aspect < 1) {
      const t = Math.tan((this.baseFov * Math.PI) / 360) * 1.25;
      this.camera.fov = Math.min(80, (Math.atan(t / aspect) * 360) / Math.PI);
    } else this.camera.fov = this.baseFov;
    this.camera.fov += this.flightFov;
    this.camera.updateProjectionMatrix();
  }
}
