/**
 * Cratères (prefab « Crater ») : cube mis à l'échelle, orienté selon la
 * normale d'impact (Quaternion.LookRotation(normal)), trigger de dégâts.
 * Rendu par InstancedMesh (un seul appel de dessin pour tous les cratères).
 * Style « box » : le cube de l'original ; style « decal » : brûlure au sol.
 */
import * as THREE from 'three';
import { getComponent, type NodeData } from '../unity/types';
import { lookRotation } from '../unity/math';
import { makeOBB, type OBB } from './collision';
import type { GameContext } from './context';

export interface Crater {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  quat: THREE.Quaternion;
  age: number;
  obb: OBB;
  /** Le joueur est-il dans le trigger (front montant OnTriggerEnter) ? */
  inside: boolean;
  name: string;
}

const MAX = 400;
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Craters {
  readonly list: Crater[] = [];
  readonly mesh: THREE.InstancedMesh;
  readonly size: THREE.Vector3;
  readonly boxSize: number[];
  readonly name: string;
  private readonly style: 'box' | 'decal';
  /** Échelle de base de la planète (taille de la planète choisie). */
  baseScale = 1;

  constructor(private readonly ctx: GameContext, prefab: NodeData, style: 'box' | 'decal') {
    this.name = prefab.name + '(Clone)';
    this.size = new THREE.Vector3(...prefab.scale);
    const box = getComponent<{ type: string; id: number; size: number[] }>(prefab, 'BoxCollider');
    this.boxSize = box?.size ?? [1, 1, 1];
    this.style = style;
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    if (style === 'box') {
      geo = new THREE.BoxGeometry(1, 1, 1);
      const r = getComponent<{ type: string; id: number; materials: (string | null)[] }>(prefab, 'MeshRenderer');
      const name = r?.materials[0];
      // Matériau absent du dépôt Unity : remplacé par un brun sombre (voir README)
      mat = name && !name.startsWith('missing') ? ctx.assets.material(name) : new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.95 });
    } else {
      geo = new THREE.CircleGeometry(0.5, 20);
      const m = new THREE.MeshStandardMaterial({
        map: ctx.assets.textures.get('crater') ?? null,
        normalMap: ctx.assets.textures.get('crater_n') ?? null,
        transparent: true,
        depthWrite: false,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      // Carte d'émission posée dès la création (émission noire par défaut) :
      // l'activer plus tard forcerait une recompilation du shader
      m.emissiveMap = m.map;
      mat = m;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    ctx.planet.add(this.mesh);
  }

  /** Lueur des cratères (planète Néon) ; null = aucune. */
  setGlow(c: THREE.Color | null): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial) return;
    m.emissive.copy(c ?? new THREE.Color(0, 0, 0));
  }

  /** Instantiate(craterPrefab, point, LookRotation(normal)) — point/normale en espace planète. */
  spawn(localPos: THREE.Vector3, localNormal: THREE.Vector3, playSound = true): Crater {
    if (this.list.length >= MAX) this.list.shift();
    const c: Crater = {
      pos: localPos.clone(),
      normal: localNormal.clone().normalize(),
      quat: lookRotation(localNormal, new THREE.Vector3(0, 1, 0)),
      age: 0,
      obb: makeOBB(),
      inside: false,
      name: this.name,
    };
    this.updateOBB(c);
    this.list.push(c);
    // AudioSource du prefab : PlayerDeath.wav en lecture automatique
    const audio = getComponent<{ type: string; id: number; clip: string; volume: number; playOnAwake: boolean }>(this.ctx.assets.project.prefabs.Crater, 'AudioSource');
    if (playSound && audio?.playOnAwake && audio.clip) this.ctx.audio.playOneShot(audio.clip, audio.volume);
    return c;
  }

  private updateOBB(c: Crater): void {
    const p = this.ctx.planet;
    p.updateWorldMatrix(true, false);
    const ps = p.scale.x;
    c.obb.center.copy(c.pos).applyMatrix4(p.matrixWorld);
    const wq = p.getWorldQuaternion(new THREE.Quaternion()).multiply(c.quat);
    c.obb.axes[0].set(1, 0, 0).applyQuaternion(wq);
    c.obb.axes[1].set(0, 1, 0).applyQuaternion(wq);
    c.obb.axes[2].set(0, 0, 1).applyQuaternion(wq);
    const k = ps / Math.max(0.01, this.baseScale);
    c.obb.half.set(this.size.x * this.boxSize[0] * k / 2, this.size.y * this.boxSize[1] * k / 2, this.size.z * this.boxSize[2] * k / 2);
  }

  update(dt: number, lifetime: number, shrinking: boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.age += dt;
      if (lifetime > 0 && c.age >= lifetime) this.list.splice(i, 1);
      else if (shrinking) this.updateOBB(c);
    }
    const n = this.list.length;
    // Taille constante en unités monde, même sur une petite planète
    const inv = 1 / Math.max(0.01, this.baseScale);
    for (let i = 0; i < n; i++) {
      const c = this.list[i];
      let k = 1;
      if (lifetime > 0) k = Math.min(1, (lifetime - c.age) / 1.5);
      if (this.style === 'box') {
        _s.copy(this.size).multiplyScalar(k * inv);
        _m.compose(c.pos, c.quat, _s);
      } else {
        // Brûlure posée sur le sol, à peine plus grande que le trigger
        const d = Math.max(this.size.x, this.size.y) * 1.45 * Math.min(1, c.age * 8 + 0.3) * k * inv;
        _s.set(d, d, d);
        _p.copy(c.pos).addScaledVector(c.normal, 0.004);
        _m.compose(_p, c.quat, _s);
      }
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.list.length = 0;
    this.mesh.count = 0;
  }
}
