/**
 * Mathématiques « Unity » en espace three.js.
 *
 * Conventions (voir tools/export_scene.py) : Unity est main gauche, three.js
 * main droite. On passe de l'un à l'autre en inversant l'axe X :
 *   position (x, y, z) → (−x, y, z) ; quaternion (x, y, z, w) → (x, −y, −z, w).
 * Une rotation Unity d'angle +a autour de Y devient −a autour de Y en three.
 */
import * as THREE from 'three';

export const Deg2Rad = Math.PI / 180;
export const Rad2Deg = 180 / Math.PI;

/** Position Unity → three. */
export function unityPos(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-x, y, z);
}

/** Quaternion Unity → three. */
export function unityQuat(x: number, y: number, z: number, w: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(x, -y, -z, w);
}

/**
 * Quaternion.Euler(x, y, z) de Unity (degrés, ordre d'application Z, X puis Y),
 * renvoyé en espace three.
 */
export function unityEuler(x: number, y: number, z: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x * Deg2Rad);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y * Deg2Rad);
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), z * Deg2Rad);
  // Espace Unity : q = qy * qx * qz, puis conversion de main.
  const q = qy.multiply(qx).multiply(qz);
  return out.set(q.x, -q.y, -q.z, q.w);
}

export const Mathf = {
  clamp(v: number, a: number, b: number): number {
    return v < a ? a : v > b ? b : v;
  },
  clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  },
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Mathf.clamp01(t);
  },
  moveTowards(cur: number, target: number, maxDelta: number): number {
    return Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta;
  },
  /**
   * Mathf.SmoothDamp de Unity (implémentation identique : ressort critique
   * approché, vitesse maximale infinie par défaut). Renvoie [valeur, vitesse].
   */
  smoothDamp(current: number, target: number, velocity: number, smoothTime: number, deltaTime: number, maxSpeed = Infinity): [number, number] {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const originalTo = target;
    const maxChange = maxSpeed * smoothTime;
    change = Mathf.clamp(change, -maxChange, maxChange);
    target = current - change;
    const temp = (velocity + omega * change) * deltaTime;
    velocity = (velocity - omega * temp) * exp;
    let output = target + (change + temp) * exp;
    if (originalTo - current > 0 === output > originalTo) {
      output = originalTo;
      velocity = (output - originalTo) / deltaTime;
    }
    return [output, velocity];
  },
};

/**
 * Générateur pseudo-aléatoire (mulberry32) remplaçant UnityEngine.Random.
 * Graine fixe possible pour les tests visuels déterministes.
 */
export class URandom {
  private s: number;
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.s = seed >>> 0;
  }
  seed(s: number): void {
    this.s = s >>> 0;
  }
  /** Random.value : [0, 1]. */
  get value(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Random.Range(min, max) flottant. */
  range(min: number, max: number): number {
    return min + (max - min) * this.value;
  }
  /** Random.Range(min, max) entier (max exclu). */
  rangeInt(min: number, max: number): number {
    return Math.min(max - 1, Math.floor(min + (max - min) * this.value));
  }
  /** Random.onUnitSphere. */
  onUnitSphere(out = new THREE.Vector3()): THREE.Vector3 {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), r * Math.sin(a), z);
  }
  /** Random.insideUnitSphere. */
  insideUnitSphere(out = new THREE.Vector3()): THREE.Vector3 {
    return this.onUnitSphere(out).multiplyScalar(Math.cbrt(this.value));
  }
}

export const Random = new URandom();

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
/**
 * Quaternion.LookRotation(forward, up) de Unity, directement en espace three
 * (l'axe +Z local pointe vers forward, +Y vers up).
 */
export function lookRotation(forward: THREE.Vector3, up = new THREE.Vector3(0, 1, 0), out = new THREE.Quaternion()): THREE.Quaternion {
  const f = _v.copy(forward).normalize();
  let u = up.clone();
  if (Math.abs(f.dot(u)) > 0.9999) u = Math.abs(f.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  // Base main droite de three : x = y × z
  const x = new THREE.Vector3().crossVectors(u, f).normalize();
  const y = new THREE.Vector3().crossVectors(f, x);
  _m.makeBasis(x, y, f);
  return out.setFromRotationMatrix(_m);
}
