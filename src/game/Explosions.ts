/**
 * Effets d'explosion (prefab « CFXR Explosion 1 ») pré-instanciés.
 * Instantiate(explosionEffectPrefab, point, Quaternion.identity) → on
 * réutilise une instance du pool (aucune création d'objet en jeu).
 */
import * as THREE from 'three';
import { instantiate, type Instance } from '../unity/gameobject';
import type { GameContext } from './context';

interface Fx {
  inst: Instance;
  t: number;
  busy: boolean;
}

export class Explosions {
  private readonly pool: Fx[] = [];
  constructor(private readonly ctx: GameContext, prefab: string, size: number) {
    const node = ctx.assets.project.prefabs[prefab];
    for (let i = 0; i < size; i++) {
      const inst = instantiate(node, { assets: ctx.assets, particles: ctx.particles, lights: ctx.lights });
      inst.root.visible = false;
      ctx.scene.add(inst.root);
      this.pool.push({ inst, t: 0, busy: false });
    }
  }

  get instances(): THREE.Object3D[] {
    return this.pool.map((f) => f.inst.root);
  }

  spawn(at: THREE.Vector3): void {
    // Le plus ancien est recyclé si toutes les instances sont occupées
    let fx = this.pool.find((f) => !f.busy);
    if (!fx) fx = this.pool.reduce((a, b) => (a.t > b.t ? a : b));
    const r = fx.inst.root;
    r.position.copy(at);
    r.quaternion.identity();
    r.visible = true;
    r.updateMatrixWorld(true);
    fx.t = 0;
    fx.busy = true;
    for (const p of fx.inst.particles) p.play();
    for (const l of fx.inst.animatedLights) l.reset();
    for (const e of fx.inst.effects) this.ctx.shaker.start(e.cameraShake);
  }

  update(dt: number): void {
    for (const fx of this.pool) {
      if (!fx.busy) continue;
      fx.t += dt;
      for (const l of fx.inst.animatedLights) l.update(dt);
      if (fx.t > 0.3 && !fx.inst.particles.some((p) => p.alive)) {
        fx.busy = false;
        fx.inst.root.visible = false;
        for (const l of fx.inst.lights) l.intensity = 0;
      }
    }
  }

  clear(): void {
    for (const fx of this.pool) {
      fx.busy = false;
      fx.inst.root.visible = false;
      for (const p of fx.inst.particles) p.stop(true);
    }
  }
}
