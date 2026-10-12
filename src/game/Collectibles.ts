/**
 * Port de CollectibleSpawner.cs, CollectibleRotation.cs et
 * DestructionCollectible.cs (horloges « MoreTime » qui rendent de la santé).
 */
import * as THREE from 'three';
import { instantiate, type Instance } from '../unity/gameobject';
import { Random } from '../unity/math';
import { getComponent, scriptFields, type NodeData } from '../unity/types';
import { makeOBB, obbFromBox, obbOverlap, type OBB } from './collision';
import { bool, type GameContext } from './context';
import { clockBeacon } from './fx';

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
  beacon: ReturnType<typeof clockBeacon>;
  base: THREE.Vector3;
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
  /** Rayon local d'apparition ; null = formule de l'original. */
  spawnRadius: (() => number) | null = null;

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
      const beacon = clockBeacon();
      beacon.group.visible = false;
      ctx.planet.add(beacon.group);
      this.pool.push({ inst, beacon, base: new THREE.Vector3(), active: false, age: 0, inside: false, obb: makeOBB() });
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
      if (c.beacon.group.visible) {
        // Arcade : l'horloge flotte doucement et un faisceau la signale
        const up = c.base.clone().normalize();
        r.position.copy(c.base).addScaledVector(up, (0.05 + 0.04 * Math.sin(c.age * 3)) / this.ctx.planet.scale.x);
        c.beacon.beam.uniforms.time.value = c.age;
        const fade = c.age < blinkFrom ? 1 : meshVisible ? 0.6 : 0.2;
        c.beacon.beam.uniforms.opacity.value = Math.min(1, c.age * 2) * fade;
        c.beacon.glow.opacity = 0.55 * fade;
      }
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
    const dir = Random.onUnitSphere(new THREE.Vector3());
    const local = dir.clone().multiplyScalar(this.spawnRadius ? this.spawnRadius() : this.ctx.planet.scale.x * 0.5 + this.f.spawnDistance);
    const r = c.inst.root;
    r.position.copy(local);
    c.base.copy(local);
    const premium = bool(this.ctx.settings, 'premiumFx');
    c.beacon.group.visible = premium;
    if (premium) {
      c.beacon.group.position.copy(dir).multiplyScalar(local.length() - 0.2 / this.ctx.planet.scale.x);
      c.beacon.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      c.beacon.group.scale.setScalar(1 / this.ctx.planet.scale.x);
      r.scale.setScalar(0.5 / this.ctx.planet.scale.x);
    }
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
    c.beacon.group.visible = false;
  }

  /** Racines des balises (précompilation). */
  get beacons(): THREE.Object3D[] {
    return this.pool.map((c) => c.beacon.group);
  }

  /** Positions (espace planète) des horloges actives, pour la mini-carte. */
  positions(): THREE.Vector3[] {
    return this.pool.filter((c) => c.active).map((c) => c.inst.root.position);
  }
}
