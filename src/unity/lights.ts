/**
 * Lumières dynamiques sans recompilation de shaders.
 *
 * Ajouter ou retirer une lumière en cours de partie force three.js à
 * recompiler tous les shaders (gel de plusieurs centaines de ms sur mobile).
 * Toutes les lumières ponctuelles sont donc créées au démarrage ; les
 * composants Light des prefabs deviennent des « lumières virtuelles » et,
 * à chaque frame, les plus importantes reçoivent une lumière réelle du pool
 * (les autres ont une intensité nulle).
 */
import * as THREE from 'three';
import { unityColorToLinear } from './curves';
import type { LightData } from './types';

export class VirtualLight {
  intensity: number;
  readonly color: THREE.Color;
  enabled = true;
  constructor(readonly obj: THREE.Object3D, readonly data: LightData) {
    this.intensity = data.intensity;
    const [r, g, b] = unityColorToLinear(data.color);
    this.color = new THREE.Color(r, g, b);
  }
}

const _p = new THREE.Vector3();

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  readonly virtual: VirtualLight[] = [];
  constructor(scene: THREE.Scene, size: number) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  register(v: VirtualLight): VirtualLight {
    this.virtual.push(v);
    return v;
  }

  update(camera: THREE.Camera): void {
    const cam = camera.getWorldPosition(new THREE.Vector3());
    const cand: { v: VirtualLight; score: number }[] = [];
    for (const v of this.virtual) {
      if (!v.enabled || v.intensity <= 0 || !isVisible(v.obj)) continue;
      v.obj.getWorldPosition(_p);
      cand.push({ v, score: v.intensity / (1 + _p.distanceToSquared(cam) * 0.01) });
    }
    cand.sort((a, b) => b.score - a.score);
    this.lights.forEach((l, i) => {
      const c = cand[i];
      if (!c) {
        l.intensity = 0;
        return;
      }
      c.v.obj.getWorldPosition(l.position);
      l.color.copy(c.v.color);
      // URP → three (éclairage physique) : intensité × π
      l.intensity = c.v.intensity * Math.PI;
      l.distance = c.v.data.range;
    });
  }
}

export function isVisible(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}
