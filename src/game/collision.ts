/**
 * Collisions simples remplaçant PhysX pour ce jeu :
 *  - boîte orientée (BoxCollider) contre boîte orientée, test des axes séparateurs ;
 *  - sphère contre boîte orientée (météore contre voiture).
 * Les déclencheurs (OnTriggerEnter) sont gérés par fronts montants dans les scripts.
 */
import * as THREE from 'three';

export interface OBB {
  center: THREE.Vector3;
  /** Axes unitaires (monde). */
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Demi-dimensions le long des axes. */
  half: THREE.Vector3;
}

export function makeOBB(): OBB {
  return { center: new THREE.Vector3(), axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)], half: new THREE.Vector3(0.5, 0.5, 0.5) };
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
/** BoxCollider (taille, centre locaux) d'un objet → OBB monde. */
export function obbFromBox(obj: THREE.Object3D, size: number[], center: number[], out: OBB): OBB {
  obj.updateWorldMatrix(true, false);
  obj.matrixWorld.decompose(_s, _q, _s);
  const sx = obj.matrixWorld.elements;
  const scale = new THREE.Vector3(
    Math.hypot(sx[0], sx[1], sx[2]),
    Math.hypot(sx[4], sx[5], sx[6]),
    Math.hypot(sx[8], sx[9], sx[10]),
  );
  out.center.set(center[0], center[1], center[2]).applyMatrix4(obj.matrixWorld);
  out.axes[0].set(1, 0, 0).applyQuaternion(_q);
  out.axes[1].set(0, 1, 0).applyQuaternion(_q);
  out.axes[2].set(0, 0, 1).applyQuaternion(_q);
  out.half.set(Math.abs(size[0] * scale.x) / 2, Math.abs(size[1] * scale.y) / 2, Math.abs(size[2] * scale.z) / 2);
  return out;
}

const _d = new THREE.Vector3();
const _ax = new THREE.Vector3();
function proj(o: OBB, ax: THREE.Vector3): number {
  return o.half.x * Math.abs(o.axes[0].dot(ax)) + o.half.y * Math.abs(o.axes[1].dot(ax)) + o.half.z * Math.abs(o.axes[2].dot(ax));
}

/** Intersection OBB / OBB (15 axes séparateurs). */
export function obbOverlap(a: OBB, b: OBB): boolean {
  _d.subVectors(b.center, a.center);
  const test = (ax: THREE.Vector3): boolean => {
    const l = ax.lengthSq();
    if (l < 1e-10) return true;
    return Math.abs(_d.dot(ax)) <= proj(a, ax) + proj(b, ax) + 1e-6 * l;
  };
  for (const ax of a.axes) if (!test(ax)) return false;
  for (const ax of b.axes) if (!test(ax)) return false;
  for (const x of a.axes) for (const y of b.axes) if (!test(_ax.crossVectors(x, y))) return false;
  return true;
}

/** Intersection sphère / OBB. */
export function sphereOBB(c: THREE.Vector3, r: number, o: OBB): boolean {
  _d.subVectors(c, o.center);
  let dist2 = 0;
  for (let i = 0; i < 3; i++) {
    const h = i === 0 ? o.half.x : i === 1 ? o.half.y : o.half.z;
    const p = _d.dot(o.axes[i]);
    if (p > h) dist2 += (p - h) ** 2;
    else if (p < -h) dist2 += (p + h) ** 2;
  }
  return dist2 <= r * r;
}
