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
  private smoothQ = new THREE.Quaternion();
  private readonly localPos: THREE.Vector3;
  private readonly localRot: THREE.Quaternion;

  constructor(readonly data: NodeData, cam: CameraData) {
    this.camera = new THREE.PerspectiveCamera(cam.fov, 16 / 9, cam.near, cam.far);
    this.camera.rotation.y = Math.PI;
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
    this.pivot.position.copy(target.position);
    this.pivot.scale.copy(target.scale);
    if (this.tilt <= 0) {
      this.pivot.quaternion.copy(target.quaternion);
      this.node.position.copy(this.localPos);
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
      const h = this.localPos.length();
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

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
