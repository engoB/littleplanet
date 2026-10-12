/**
 * Port du script CFXR_Effect (Cartoon FX Remaster) : secousse de caméra et
 * lumières animées, valeurs lues dans le prefab.
 */
import * as THREE from 'three';
import { evalCurve } from './curves';
import { Random } from './math';
import type { CfxrEffectData } from './types';
import type { VirtualLight } from './lights';

/** Secousses actives (appliquées à la caméra avant le rendu puis retirées). */
export class CameraShaker {
  private readonly active: { fx: CfxrEffectData['cameraShake']; t: number; vec: THREE.Vector3 }[] = [];
  enabled = true;
  /** Multiplicateur global (GLOBAL_CAMERA_SHAKE_MULTIPLIER = 1 dans CFXR). */
  strength = 1;
  private saved = new THREE.Vector3();
  private applied = false;

  start(fx: CfxrEffectData['cameraShake']): void {
    if (!fx.enabled || !this.enabled) return;
    this.active.push({ fx, t: 0, vec: new THREE.Vector3() });
  }

  /** animate(time) de CFXR : vecteur aléatoire × force × courbe(t / durée totale). */
  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.t += dt;
      const total = s.fx.duration + s.fx.delay;
      if (s.t >= total) {
        this.active.splice(i, 1);
        continue;
      }
      if (s.t < s.fx.delay) {
        s.vec.set(0, 0, 0);
        continue;
      }
      const delta = Math.min(1, s.t / total);
      const sign = Random.value > 0.5 ? -1 : 1;
      const k = evalCurve(s.fx.curve, delta) * this.strength * sign;
      // X inversé : conversion main gauche → main droite
      s.vec.set(-Random.value * s.fx.strength[0] * k, Random.value * s.fx.strength[1] * k, Random.value * s.fx.strength[2] * k);
    }
  }

  /** onPreRenderCamera : localPosition += rotation de la caméra × vecteur. */
  preRender(cam: THREE.Object3D): void {
    this.applied = false;
    if (!this.active.length) return;
    this.saved.copy(cam.position);
    const q = cam.getWorldQuaternion(new THREE.Quaternion());
    for (const s of this.active) {
      const off = s.vec.clone().applyQuaternion(q);
      cam.position.add(off);
    }
    cam.updateMatrixWorld(true);
    this.applied = true;
  }

  /** onPostRenderCamera : restaure la position. */
  postRender(cam: THREE.Object3D): void {
    if (!this.applied) return;
    cam.position.copy(this.saved);
    cam.updateMatrixWorld(true);
    this.applied = false;
  }

  clear(): void {
    this.active.length = 0;
  }
}

/** AnimatedLight de CFXR : intensité début → fin selon la courbe. */
export class AnimatedLight {
  t = 0;
  private seed = Random.value * 100;
  constructor(readonly light: VirtualLight, readonly d: CfxrEffectData['animatedLights'][number]) {}

  reset(): void {
    this.t = 0;
    this.light.intensity = this.d.animateIntensity ? this.d.intensityStart : this.light.data.intensity;
  }

  update(dt: number): void {
    const d = this.d;
    this.t += dt;
    if (!d.animateIntensity) return;
    let delta = this.t / Math.max(1e-4, d.intensityDuration);
    if (d.loop) delta %= 1;
    else delta = Math.min(1, delta);
    let k: number;
    if (d.perlinIntensity) {
      // Bruit de Perlin remplacé par une somme de sinus lisse
      const x = this.t * 2 + this.seed;
      k = 0.5 + 0.25 * Math.sin(x * 1.3) + 0.25 * Math.sin(x * 2.9 + 1.7);
    } else {
      k = d.intensityCurve.length ? evalCurve(d.intensityCurve, delta) : delta;
    }
    this.light.intensity = d.intensityStart + (d.intensityEnd - d.intensityStart) * k;
  }
}
