/**
 * Port de MeteorSpawner.cs et MeteorCollision.cs.
 * Toutes les `interval` secondes (WaitForSeconds(1) dans l'original), un
 * météore aléatoire apparaît à spawnDistance du centre (Random.onUnitSphere),
 * regarde la planète et fonce vers son centre à meteorSpeed. Au contact du
 * SphereCollider (tag « Planet ») : cratère + explosion, puis destruction.
 * Préréglage Arcade : roche visible, annonce du point d'impact, visée
 * partielle vers la voiture, dégâts directs.
 */
import * as THREE from 'three';
import { instantiate, type Instance } from '../unity/gameobject';
import { lookRotation, Random } from '../unity/math';
import { getComponent, type NodeData } from '../unity/types';
import { sphereOBB, type OBB } from './collision';
import { bool, num, type GameContext } from './context';
import { reticleMaterial } from './fx';

export interface MeteorSpawnerFields {
  meteorPrefabs: { prefab: string }[];
  spawnDistance: number;
  meteorSpeed: number;
}

interface Meteor {
  inst: Instance;
  prefab: string;
  active: boolean;
  dir: THREE.Vector3; // direction de déplacement (monde)
  target: THREE.Vector3; // point d'impact prévu (espace planète)
  marker: THREE.Mesh | null;
  reticle: boolean;
  colliderRadius: number;
  age: number;
}

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

export class MeteorSpawner {
  private readonly pools = new Map<string, Meteor[]>();
  private timer = 0;
  interval = 1;
  /** Fraction des météores visés vers la voiture (Arcade). */
  aim = 0;
  readonly active: Meteor[] = [];
  private readonly markers: THREE.Mesh[] = [];
  private readonly reticles: THREE.Mesh[] = [];
  /** Multiplicateur de vitesse (planète). */
  speedMul = 1;
  private readonly markerMat: THREE.MeshBasicMaterial;
  onSpawn: (dirLocal: THREE.Vector3) => void = () => undefined;
  onImpact: (worldPoint: THREE.Vector3, localPoint: THREE.Vector3, localNormal: THREE.Vector3) => void = () => undefined;
  onHitCar: (name: string, at: THREE.Vector3) => void = () => undefined;

  constructor(private readonly ctx: GameContext, readonly f: MeteorSpawnerFields, poolSize = 7) {
    const visible = bool(ctx.settings, 'meteorVisible');
    const rock = new THREE.MeshStandardMaterial({ color: 0x4a3b33, roughness: 0.9, emissive: new THREE.Color(0.9, 0.28, 0.05), emissiveIntensity: 0.55 });
    for (const ref of f.meteorPrefabs) {
      const node: NodeData = ctx.assets.project.prefabs[ref.prefab];
      const list: Meteor[] = [];
      const col = getComponent<{ type: string; id: number; radius: number }>(node, 'SphereCollider');
      for (let i = 0; i < poolSize; i++) {
        const inst = instantiate(node, { assets: ctx.assets, particles: ctx.particles, lights: ctx.lights });
        inst.root.visible = false;
        let radius = (col?.radius ?? 0.01) * node.scale[0];
        if (visible) {
          // Arcade : la roche (2 cm à l'origine) devient visible
          for (const m of inst.meshes) {
            m.scale.multiplyScalar(18);
            m.material = rock;
          }
          radius = 0.2;
        }
        ctx.scene.add(inst.root);
        list.push({ inst, prefab: ref.prefab, active: false, dir: new THREE.Vector3(), target: new THREE.Vector3(), marker: null, reticle: false, colliderRadius: radius, age: 0 });
      }
      this.pools.set(ref.prefab, list);
    }
    // Annonce d'impact : anneaux pré-alloués
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xff1a00, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.RingGeometry(0.15, 0.23, 32);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ring, this.markerMat.clone());
      m.visible = false;
      m.renderOrder = 2;
      ctx.planet.add(m);
      this.markers.push(m);
    }
    // Réticules (style Arcade) : quad + shader, un matériau par instance (même programme)
    const quad = new THREE.PlaneGeometry(0.66, 0.66);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(quad, reticleMaterial());
      m.visible = false;
      m.renderOrder = 2;
      ctx.planet.add(m);
      this.reticles.push(m);
    }
  }

  /** Couleur des réticules (selon la planète, pour rester lisibles sur le sol). */
  setReticleColor(c: THREE.ColorRepresentation): void {
    for (const m of this.reticles) (m.material as THREE.ShaderMaterial).uniforms.color.value.set(c);
  }

  get instances(): THREE.Object3D[] {
    return [...this.pools.values()].flat().map((m) => m.inst.root);
  }

  start(): void {
    // La coroutine de l'original fait apparaître un météore immédiatement au Start
    this.timer = this.interval;
  }

  update(dt: number, car: { obb: OBB; position: THREE.Vector3 } | null, alive: boolean): void {
    this.timer += dt;
    while (this.timer >= this.interval) {
      this.timer -= this.interval;
      this.spawn(car?.position ?? null);
    }
    const planet = this.ctx.planet;
    const R = this.ctx.planetRadius();
    const speed = num(this.ctx.settings, 'meteorSpeed') * this.speedMul;
    planet.getWorldPosition(_c);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const r = m.inst.root;
      m.age += dt;
      r.position.addScaledVector(m.dir, speed * dt);
      for (const l of m.inst.animatedLights) l.update(dt);
      // Marqueur : pulse et rétrécit à l'approche
      if (m.marker) {
        const dist = r.position.distanceTo(_c) - R;
        const k = Math.max(0, Math.min(1, dist / (this.f.spawnDistance - R)));
        if (m.reticle) {
          const u = (m.marker.material as THREE.ShaderMaterial).uniforms;
          u.progress.value = 1 - k;
          u.time.value = m.age;
          m.marker.scale.setScalar((1.15 - 0.35 * (1 - k)) / this.ctx.planet.scale.x);
        } else {
          const s = 0.6 + 1.6 * k;
          m.marker.scale.setScalar(s);
          (m.marker.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * (1 - k) * Math.sin(m.age * 18);
        }
      }
      // Arcade : collision directe avec la voiture
      if (alive && car && bool(this.ctx.settings, 'meteorHitsCar') && sphereOBB(r.position, m.colliderRadius, car.obb)) {
        this.onHitCar(m.prefab + '(Clone)', r.position.clone());
        this.release(m, i);
        continue;
      }
      // OnCollisionEnter avec la planète (tag « Planet ») : SphereCollider
      if (r.position.distanceTo(_c) <= R + m.colliderRadius) {
        const normal = _v.copy(r.position).sub(_c).normalize();
        const world = _c.clone().addScaledVector(normal, R);
        const local = planet.worldToLocal(world.clone());
        const localNormal = local.clone().normalize();
        this.onImpact(world, local, localNormal);
        this.release(m, i);
      }
    }
  }

  private spawn(carPos: THREE.Vector3 | null): void {
    const keys = [...this.pools.keys()];
    const key = keys[Random.rangeInt(0, keys.length)];
    const pool = this.pools.get(key)!;
    let m = pool.find((x) => !x.active);
    if (!m) {
      // Pool plein : le plus ancien est recyclé
      m = pool.reduce((a, b) => (a.age > b.age ? a : b));
      this.release(m, this.active.indexOf(m));
    }
    const planet = this.ctx.planet;
    planet.getWorldPosition(_c);
    const dir = Random.onUnitSphere(new THREE.Vector3());
    if (carPos && this.aim > 0 && Random.value < this.aim) {
      // Visée : direction proche de la voiture (cône de ~35°)
      const up = carPos.clone().sub(_c).normalize();
      dir.multiplyScalar(0.6).add(up).normalize();
    }
    const spawnPos = dir.clone().multiplyScalar(this.f.spawnDistance).add(_c);
    const r = m.inst.root;
    r.position.copy(spawnPos);
    // meteor.transform.LookAt(planet.position) : +Z vers le centre
    r.quaternion.copy(lookRotation(_c.clone().sub(spawnPos)));
    r.visible = true;
    r.updateMatrixWorld(true);
    m.dir.copy(_c).sub(spawnPos).normalize();
    m.active = true;
    m.age = 0;
    m.target.copy(dir).multiplyScalar(this.ctx.planetRadius() / planet.scale.x);
    for (const p of m.inst.particles) p.play();
    for (const l of m.inst.animatedLights) l.reset();
    for (const l of m.inst.lights) l.enabled = true;
    if (bool(this.ctx.settings, 'meteorWarning')) {
      const premium = bool(this.ctx.settings, 'premiumFx');
      const mk = (premium ? this.reticles : this.markers).find((x) => !x.visible);
      if (mk) {
        mk.position.copy(m.target).addScaledVector(dir, 0.012);
        mk.quaternion.copy(lookRotation(dir));
        mk.visible = true;
        m.marker = mk;
        m.reticle = premium;
      }
    }
    this.onSpawn(dir);
    this.active.push(m);
  }

  private release(m: Meteor, index: number): void {
    m.active = false;
    m.inst.root.visible = false;
    for (const p of m.inst.particles) p.stop(true);
    for (const l of m.inst.lights) l.enabled = false;
    if (m.marker) {
      m.marker.visible = false;
      m.marker = null;
    }
    if (index >= 0) this.active.splice(index, 1);
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i], i);
    this.timer = 0;
  }

  /** Racines de tous les météores (actifs ou non), avec leur état. */
  forEachMeteor(fn: (root: THREE.Object3D, active: boolean) => void): void {
    for (const pool of this.pools.values()) for (const m of pool) fn(m.inst.root, m.active);
  }

  /** Points d'impact prévus (espace planète), pour la mini-carte. */
  targets(): THREE.Vector3[] {
    return this.active.map((m) => m.target);
  }

  /** Rend tout visible (précompilation des shaders). */
  forEachRoot(fn: (o: THREE.Object3D) => void): void {
    for (const pool of this.pools.values()) for (const m of pool) fn(m.inst.root);
    for (const mk of this.markers) fn(mk);
    for (const mk of this.reticles) fn(mk);
  }
}
