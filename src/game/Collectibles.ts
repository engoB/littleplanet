/**
 * Port de CollectibleSpawner.cs, CollectibleRotation.cs et
 * DestructionCollectible.cs (horloges « MoreTime » qui rendent de la santé).
 */
import * as THREE from 'three';
import { instantiate, type Instance } from '../unity/gameobject';
import { Random } from '../unity/math';
import { getComponent, scriptFields, type NodeData } from '../unity/types';
import { makeOBB, obbFromBox, obbOverlap, type OBB } from './collision';
import type { GameContext } from './context';

export interface CollectibleSpawnerFields {
  repairCollectiblePrefab: { prefab: string };
  spawnRate: number;
  spawnDistance: number;
  collectibleLifetime: number;
  maxSpawnsPerGame: number;
  blinkStart: number;
  blinkRate: number;
}

interface Clock {
  inst: Instance;
  active: boolean;
  age: number;
  inside: boolean;
  obb: OBB;
}

export class CollectibleSpawner {
  private readonly pool: Clock[] = [];
  private timer = 0;
  spawnCount = 0;
  maxSpawns: number;
  spawnRate: number;
  lifetime: number;
  readonly name: string;
  private readonly axis: THREE.Vector3;
  private readonly rotSpeed: number;
  private readonly box: { size: number[]; center: number[] };
  private readonly collectSound: string | null;
  onCollect: (name: string, at: THREE.Vector3) => void = () => undefined;

  constructor(private readonly ctx: GameContext, readonly f: CollectibleSpawnerFields, poolSize = 5) {
    const node: NodeData = ctx.assets.project.prefabs[f.repairCollectiblePrefab.prefab];
    this.name = node.name + '(Clone)';
    const rot = scriptFields<{ rotationAxis: { x: number; y: number; z: number }; rotationSpeed: number }>(node, 'CollectibleRotation');
    // Axe Unity → three : rotation (axe, a) ≡ (axe miroir en X, −a)
    this.axis = new THREE.Vector3(-rot.rotationAxis.x, rot.rotationAxis.y, rot.rotationAxis.z).normalize();
    this.rotSpeed = rot.rotationSpeed;
    const bc = getComponent<{ type: string; id: number; size: number[]; center: number[] }>(node, 'BoxCollider');
    this.box = { size: bc?.size ?? [1, 1, 1], center: bc?.center ?? [0, 0, 0] };
    const snd = scriptFields<{ collectSound: { audio: string } | null }>(node, 'DestructionCollectible');
    this.collectSound = snd.collectSound?.audio ?? null;
    this.maxSpawns = f.maxSpawnsPerGame;
    this.spawnRate = f.spawnRate;
    this.lifetime = f.collectibleLifetime;
    for (let i = 0; i < poolSize; i++) {
      const inst = instantiate(node, { assets: ctx.assets, particles: ctx.particles, lights: ctx.lights, castShadows: true });
      inst.root.visible = false;
      ctx.planet.add(inst.root);
      this.pool.push({ inst, active: false, age: 0, inside: false, obb: makeOBB() });
    }
  }

  get instances(): THREE.Object3D[] {
    return this.pool.map((c) => c.inst.root);
  }

  start(): void {
    this.timer = 0;
    this.spawnCount = 0;
    for (const c of this.pool) this.release(c);
  }

  update(dt: number, carOBB: OBB | null, alive: boolean): void {
    if (this.maxSpawns <= 0 || this.spawnCount < this.maxSpawns) {
      this.timer += dt;
      if (this.timer >= this.spawnRate) {
        this.spawn();
        this.timer = 0;
      }
    }
    const blinkFrom = this.lifetime - this.f.blinkStart;
    for (const c of this.pool) {
      if (!c.active) continue;
      c.age += dt;
      const r = c.inst.root;
      // CollectibleRotation : transform.Rotate(axe, vitesse × dt) en espace local
      r.rotateOnAxis(this.axis, -this.rotSpeed * dt * (Math.PI / 180));
      // HandleDestruction : clignotement (Renderer.enabled basculé tous les blinkRate)
      if (c.age >= this.lifetime) {
        this.release(c);
        continue;
      }
      const meshVisible = c.age < blinkFrom || Math.floor((c.age - blinkFrom) / this.f.blinkRate) % 2 === 1;
      for (const m of c.inst.meshes) m.visible = meshVisible;
      // OnTriggerEnter (joueur) : son + destruction ; HealthManager soigne
      if (alive && carOBB) {
        const inside = obbOverlap(carOBB, obbFromBox(r, this.box.size, this.box.center, c.obb));
        if (inside && !c.inside) {
          const at = r.getWorldPosition(new THREE.Vector3());
          if (this.collectSound) this.ctx.audio.playOneShot(this.collectSound, 1);
          this.onCollect(this.name, at);
          this.release(c);
          continue;
        }
        c.inside = inside;
      }
    }
  }

  private spawn(): void {
    const c = this.pool.find((x) => !x.active) ?? this.pool.reduce((a, b) => (a.age > b.age ? a : b));
    // localSpawnPoint = onUnitSphere × (planet.localScale.x × 0.5 + spawnDistance), puis TransformPoint
    // (les horloges sont enfants de la planète : la position locale suffit)
    const local = Random.onUnitSphere(new THREE.Vector3()).multiplyScalar(this.ctx.planet.scale.x * 0.5 + this.f.spawnDistance);
    const r = c.inst.root;
    r.position.copy(local);
    // transform.up = direction radiale
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local.clone().normalize());
    r.visible = true;
    for (const m of c.inst.meshes) m.visible = true;
    c.active = true;
    c.age = 0;
    c.inside = false;
    this.spawnCount++;
  }

  private release(c: Clock): void {
    c.active = false;
    c.inst.root.visible = false;
  }

  /** Positions (espace planète) des horloges actives, pour la mini-carte. */
  positions(): THREE.Vector3[] {
    return this.pool.filter((c) => c.active).map((c) => c.inst.root.position);
  }
}
