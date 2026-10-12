/**
 * Monde du jeu : reconstruit les scènes Unity « Menu » et « SampleScene »
 * dans une seule scène three (mêmes objets, aucune création en cours de partie)
 * et exécute les scripts portés dans l'ordre Update puis LateUpdate.
 */
import * as THREE from 'three';
import type { Assets } from '../unity/assets';
import { AudioManager, type AudioSourceLite } from '../unity/audio';
import { CameraShaker } from '../unity/cfxr';
import { unityColorToLinear } from '../unity/curves';
import { instantiate, type Instance } from '../unity/gameobject';
import { LightPool } from '../unity/lights';
import { Random } from '../unity/math';
import { ParticleManager, ParticleSystem } from '../unity/particles';
import { PostProcess } from '../unity/postprocess';
import { Time } from '../unity/time';
import { findNode, getComponent, scriptFields, type AudioSourceData, type CameraData, type LightData, type NodeData, type SceneData, type VolumeComponent } from '../unity/types';
import type { Settings } from '../settings/store';
import { CameraRig } from './CameraRig';
import { CollectibleSpawner, type CollectibleSpawnerFields } from './Collectibles';
import { makeOBB, obbFromBox, obbOverlap, type OBB } from './collision';
import { bool, num, type GameContext } from './context';
import { Craters } from './Craters';
import { Explosions } from './Explosions';
import { HealthManager, type HealthManagerFields } from './HealthManager';
import { MeteorSpawner, type MeteorSpawnerFields } from './Meteors';
import { RotatePlanet, ShrinkPlanet } from './RotatePlanet';
import { Stages } from './Stages';
import { VehicleController, type VehicleControllerFields } from './VehicleController';
import { VehicleDistanceTracker } from './VehicleDistanceTracker';

export type Mode = 'menu' | 'play' | 'dying' | 'over';

export interface WorldEvents {
  health(hp: number, max: number, delta: number): void;
  message(text: string, kind?: 'good' | 'bad' | 'info'): void;
  gameOver(stats: { distance: number; time: number; stage: number; clocks: number }): void;
  turbo(level: number, active: boolean): void;
}

const _v = new THREE.Vector3();

export class World implements GameContext {
  readonly scene = new THREE.Scene();
  readonly particles: ParticleManager;
  readonly lights: LightPool;
  readonly shaker = new CameraShaker();
  readonly audio: AudioManager;
  readonly renderer: THREE.WebGLRenderer;
  readonly post: PostProcess;
  readonly rig: CameraRig;
  planet!: THREE.Object3D;
  private planetCollider = 5;
  car!: THREE.Object3D;
  carInst!: Instance;
  vehicle!: VehicleController;
  health!: HealthManager;
  tracker!: VehicleDistanceTracker;
  meteors!: MeteorSpawner;
  clocks!: CollectibleSpawner;
  craters!: Craters;
  explosions!: Explosions;
  stages = new Stages();
  private rotatePlanet!: RotatePlanet;
  private shrink!: ShrinkPlanet;
  private readonly menuRoot = new THREE.Object3D();
  private sun!: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3();
  private sceneLights: { light: THREE.Light; menu: number; game: number }[] = [];
  private effects: Instance[] = [];
  private music: AudioSourceLite | null = null;
  private engine: AudioSourceLite | null = null;
  private skid: AudioSourceLite | null = null;
  private carBox: { size: number[]; center: number[] };
  readonly carOBB: OBB = makeOBB();
  mode: Mode = 'menu';
  /** Temps réel de la partie (chrono), hors pauses. */
  chrono = 0;
  clocksCollected = 0;
  turboLevel = 1;
  private turboActive = false;
  private dyingTime = 0;
  private gameData: SceneData;
  private menuData: SceneData;
  events: WorldEvents;
  /** Visée forcée des météores (tests). */
  aimOverride: number | null = null;
  private baseCarColor = new THREE.Color();

  constructor(readonly assets: Assets, public settings: Settings, canvas: HTMLCanvasElement, events: WorldEvents) {
    this.events = events;
    const quality = String(settings.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // URP sans tonemapping dans le profil
    this.renderer.shadowMap.enabled = bool(settings, 'shadows');
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.audio = new AudioManager();
    this.particles = new ParticleManager(assets.fxAtlas);
    this.scene.add(this.particles.points);
    this.lights = new LightPool(this.scene, Math.max(0, Math.round(num(settings, 'dynamicLights'))));
    const p = assets.project;
    this.gameData = p.scenes.SampleScene;
    this.menuData = p.scenes.Menu;
    // --- caméra (Main Camera de SampleScene, enfant de la voiture)
    const carNode = this.findRoot(this.gameData, 'Cartoon_SportCar_B01')!;
    const camNode = findNode(carNode, 'Main Camera')!;
    this.rig = new CameraRig(camNode, getComponent<CameraData>(camNode, 'Camera')!);
    this.scene.add(this.rig.pivot);
    // Plan « Halo » : enfant de la caméra
    const plane = findNode(camNode, 'Plane');
    if (plane) {
      const inst = instantiate(plane, this.buildCtx());
      inst.meshes.forEach((m) => {
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = -10;
      });
      this.rig.node.add(inst.root);
    }
    // --- post-process (Volume de la scène)
    const volNode = this.findRoot(this.gameData, 'Postprocess');
    const vol = volNode ? getComponent<{ type: string; id: number; profile: { components: Record<string, VolumeComponent> } }>(volNode, 'Volume') : undefined;
    this.post = new PostProcess(this.renderer, vol?.profile?.components, quality === 'high' || quality === 'auto' ? 4 : 0);
    this.post.enabled = bool(settings, 'postProcess');
    this.shaker.enabled = bool(settings, 'cameraShake');
    this.carBox = { size: [1, 1, 1], center: [0, 0, 0] };
    this.build(carNode);
  }

  private buildCtx() {
    return { assets: this.assets, particles: this.particles, lights: this.lights, castShadows: bool(this.settings, 'shadows') };
  }

  private findRoot(s: SceneData, name: string): NodeData | undefined {
    for (const r of s.roots) {
      const f = findNode(r, name);
      if (f) return f;
    }
    return undefined;
  }

  planetRadius(): number {
    return this.planetCollider * this.planet.scale.x;
  }

  private build(carNode: NodeData): void {
    const a = this.assets;
    const s = this.settings;
    // --- environnement : skybox (clear flags Skybox) et ambiance « Skybox »
    if (a.skybox) {
      this.scene.background = a.skybox;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromCubemap(a.skybox).texture;
      pm.dispose();
    }
    // --- planète
    const planetNode = this.findRoot(this.gameData, 'Planet')!;
    const pInst = instantiate(planetNode, this.buildCtx());
    this.planet = pInst.root;
    this.planet.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    this.planetCollider = getComponent<{ type: string; id: number; radius: number }>(planetNode, 'SphereCollider')?.radius ?? 5;
    this.scene.add(this.menuRoot);
    this.menuRoot.add(this.planet);
    const planetMat = a.material('Planete') as THREE.MeshStandardMaterial;
    if (a.planetOverride) {
      planetMat.map = a.planetOverride;
      planetMat.emissiveMap = null;
      planetMat.emissive.setRGB(0, 0, 0);
    }
    if (bool(s, 'planetDetail')) {
      const n = a.textures.get('planet_detail_n');
      if (n) {
        n.repeat.set(3, 3);
        planetMat.normalMap = n;
        planetMat.normalScale.set(0.5, 0.5);
      }
    }
    planetMat.needsUpdate = true;
    const rp = getComponent<{ type: string; id: number; fields: { rotationSpeed: number } }>(this.findRoot(this.menuData, 'Planet')!, 'RotatePlanet');
    this.rotatePlanet = new RotatePlanet(this.planet, rp?.fields.rotationSpeed ?? 10);
    this.shrink = new ShrinkPlanet(this.planet);
    // --- lumières de scène (créées une seule fois)
    this.setupSceneLights();
    // --- voiture
    const carInst = instantiate({ ...carNode, children: carNode.children.filter((c) => c.name !== 'Main Camera') }, this.buildCtx());
    this.carInst = carInst;
    this.car = carInst.root;
    this.scene.add(this.car);
    const body = a.material('body') as THREE.MeshStandardMaterial;
    this.baseCarColor.copy(body.color);
    // Couleur perso (hex sRGB → linéaire par la gestion des couleurs three)
    if (typeof s.carColor === 'string') body.color.set(s.carColor);
    this.car.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = bool(s, 'shadows');
    });
    const vf = scriptFields<VehicleControllerFields>(carNode, 'VehicleController');
    this.vehicle = new VehicleController(this.car, vf);
    const hf = scriptFields<HealthManagerFields>(carNode, 'HealthManager');
    this.health = new HealthManager(hf, num(s, 'maxHealth'));
    this.tracker = new VehicleDistanceTracker(this.car);
    const bc = getComponent<{ type: string; id: number; size: number[]; center: number[] }>(carNode, 'BoxCollider');
    if (bc) this.carBox = { size: bc.size, center: bc.center };
    const eng = getComponent<AudioSourceData>(carNode, 'AudioSource');
    if (eng?.clip) this.engine = this.audio.source(eng.clip, eng.volume, eng.pitch, eng.loop);
    this.skid = this.audio.source('Skid', 0, 1, true);
    // --- météores, cratères, explosions, horloges
    const msNode = this.findRoot(this.gameData, 'MeteorSpawner')!;
    const msf = scriptFields<MeteorSpawnerFields>(msNode, 'MeteorSpawner');
    this.meteors = new MeteorSpawner(this, msf);
    const meteorProto = a.project.prefabs[msf.meteorPrefabs[0].prefab];
    const mc = scriptFields<{ craterPrefab: { prefab: string }; explosionEffectPrefab: { prefab: string } }>(meteorProto, 'MeteorCollision');
    this.craters = new Craters(this, a.project.prefabs[mc.craterPrefab.prefab], String(s.craterStyle) === 'box' ? 'box' : 'decal');
    this.explosions = new Explosions(this, mc.explosionEffectPrefab.prefab, 5);
    const csNode = this.findRoot(this.gameData, 'CollectibleSpawner ') ?? this.findRoot(this.gameData, 'CollectibleSpawner')!;
    this.clocks = new CollectibleSpawner(this, scriptFields<CollectibleSpawnerFields>(csNode, 'CollectibleSpawner'));
    // --- effets d'ambiance de la scène (vent, esprits)
    const fxRoot = this.gameData.roots.find((r) => r.name.includes('Effects'));
    for (const fx of fxRoot?.children ?? []) {
      const inst = instantiate(fx, this.buildCtx());
      this.scene.add(inst.root);
      inst.root.updateMatrixWorld(true);
      for (const ps of inst.particles) if (ps.d.playOnAwake) ps.play();
      this.effects.push(inst);
    }
    // --- branchements des événements
    this.meteors.onImpact = (world, local, normal) => {
      // MeteorCollision.OnCollisionEnter : cratère + explosion
      this.craters.spawn(local, normal);
      this.explosions.spawn(world);
    };
    this.meteors.onHitCar = (name, at) => {
      this.explosions.spawn(at);
      this.damage(this.health.getDamagePoints(name), 'Météore !');
    };
    this.clocks.onCollect = (name) => {
      const heal = this.health.getHealPoints(name);
      const hs = num(this.settings, 'clockHeal');
      this.health.heal(Number.isFinite(hs) ? hs : heal);
      this.clocksCollected++;
      this.events.message(`+${Number.isFinite(hs) ? hs : heal} ❤`, 'good');
    };
    this.health.onChange = (hp, max, d) => this.events.health(hp, max, d);
    this.health.onDie = () => this.triggerGameOver();
    this.stages.onComplete = (n) => {
      this.events.message(`Étape ${n} réussie !`, 'good');
      this.health.heal(10);
    };
    this.applySettings(s);
  }

  private setupSceneLights(): void {
    // Les deux scènes ont les mêmes lumières (valeurs légèrement différentes)
    const collect = (sd: SceneData) => {
      const out: { node: NodeData; d: LightData }[] = [];
      const walk = (n: NodeData) => {
        const l = getComponent<LightData>(n, 'Light');
        if (l) out.push({ node: n, d: l });
        n.children.forEach(walk);
      };
      sd.roots.filter((r) => r.name.includes('Light')).forEach(walk);
      return out;
    };
    const game = collect(this.gameData);
    const menu = collect(this.menuData);
    for (const g of game) {
      const m = menu.find((x) => x.node.name === g.node.name);
      const [r, gg, b] = unityColorToLinear(g.d.color);
      if (g.d.lightType === 'directional') {
        const l = new THREE.DirectionalLight(new THREE.Color(r, gg, b), g.d.intensity * Math.PI);
        // Une lumière Unity éclaire selon son +Z local
        this.sunDir.set(0, 0, 1).applyQuaternion(new THREE.Quaternion(...g.node.rotation)).normalize();
        l.castShadow = bool(this.settings, 'shadows');
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.camera.near = 0.5;
        l.shadow.camera.far = 30;
        const sc = l.shadow.camera;
        sc.left = sc.bottom = -3;
        sc.right = sc.top = 3;
        l.shadow.bias = -0.0005;
        l.shadow.normalBias = 0.02;
        this.scene.add(l, l.target);
        this.sun = l;
        this.sceneLights.push({ light: l, game: g.d.intensity * Math.PI, menu: (m?.d.intensity ?? g.d.intensity) * Math.PI });
      } else if (g.d.lightType === 'point') {
        const l = new THREE.PointLight(new THREE.Color(r, gg, b), g.d.intensity * Math.PI, g.d.range, 2);
        l.position.set(...g.node.position);
        this.scene.add(l);
        this.sceneLights.push({ light: l, game: g.d.intensity * Math.PI, menu: (m?.d.intensity ?? g.d.intensity) * Math.PI });
      }
    }
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.vehicle.speed = num(s, 'carSpeed');
    this.vehicle.steerSpeed = num(s, 'steerSpeed');
    this.vehicle.fatigue = num(s, 'steerFatigue');
    this.health.maxHealth = num(s, 'maxHealth');
    this.health.invulnerabilityTime = num(s, 'invulnerability');
    this.clocks.spawnRate = num(s, 'clockInterval');
    this.clocks.maxSpawns = num(s, 'clockMax');
    this.clocks.lifetime = num(s, 'clockLifetime');
    this.rig.tilt = num(s, 'cameraTilt');
    this.post.enabled = bool(s, 'postProcess');
    this.shaker.enabled = bool(s, 'cameraShake');
    this.audio.setVolumes(num(s, 'musicVolume'), num(s, 'sfxVolume'));
    if (this.music) this.music.loop = bool(s, 'loopMusic');
  }

  // ------------------------------------------------------------------ modes
  /** Scène « Menu » : planète qui tourne, caméra fixe au-dessus. */
  enterMenu(): void {
    this.mode = 'menu';
    Time.timeScale = 1;
    this.car.visible = false;
    this.meteors.clear();
    this.clocks.start();
    this.craters.clear();
    this.explosions.clear();
    this.shaker.clear();
    this.planet.scale.setScalar(1);
    this.planet.quaternion.identity();
    this.rotatePlanet.start();
    this.engine?.stop();
    this.skid?.stop();
    for (const l of this.sceneLights) l.light.intensity = l.menu;
    const camNode = this.findRoot(this.menuData, 'Main Camera')!;
    this.rig.tilt = 0;
    // La caméra du menu est à la racine 3D : pivot identité, nœud = transform du menu
    this.rig.pivot.position.set(0, 0, 0);
    this.rig.pivot.quaternion.identity();
    this.rig.pivot.scale.set(1, 1, 1);
    this.rig.node.position.set(...camNode.position);
    this.rig.node.quaternion.set(...camNode.rotation);
    this.rig.node.scale.set(...camNode.scale);
    this.rig.pivot.updateMatrixWorld(true);
    this.playMusic(this.menuData);
  }

  /** Scène « SampleScene » : nouvelle partie (SceneManager.LoadScene). */
  startGame(): void {
    this.mode = 'play';
    Time.timeScale = 1;
    Time.time = 0;
    this.applySettings(this.settings);
    this.planet.quaternion.identity();
    this.planet.scale.setScalar(1);
    this.planet.updateMatrixWorld(true);
    for (const l of this.sceneLights) l.light.intensity = l.game;
    const carNode = this.findRoot(this.gameData, 'Cartoon_SportCar_B01')!;
    this.car.position.set(...carNode.position);
    this.car.quaternion.set(...carNode.rotation);
    this.car.visible = true;
    this.vehicle.reset();
    this.health.start();
    this.tracker.start();
    this.meteors.clear();
    this.craters.clear();
    this.explosions.clear();
    this.clocks.start();
    this.shaker.clear();
    this.chrono = 0;
    this.clocksCollected = 0;
    this.turboLevel = 1;
    this.dyingTime = 0;
    this.stages.start();
    this.updateDifficulty();
    this.meteors.start();
    this.shrink.start(0);
    const camNode = findNode(carNode, 'Main Camera')!;
    this.rig.node.position.set(...camNode.position);
    this.rig.node.quaternion.set(...camNode.rotation);
    this.rig.node.scale.set(...camNode.scale);
    this.rig.tilt = num(this.settings, 'cameraTilt');
    this.rig.follow(this.car, 0, true);
    this.engine?.play();
    if (bool(this.settings, 'extraSounds')) this.skid?.play();
    this.playMusic(this.gameData);
  }

  private playMusic(sd: SceneData): void {
    const cam = this.findRoot(sd, 'Main Camera');
    const src = cam ? getComponent<AudioSourceData>(cam, 'AudioSource') : undefined;
    if (!src?.clip) return;
    // Nouvelle scène = nouvelle AudioSource : la musique repart du début
    this.music?.stop();
    this.music = this.audio.source(src.clip, src.volume, src.pitch, bool(this.settings, 'loopMusic') || src.loop, 'music');
    if (src.playOnAwake) this.music.play();
  }

  /** GameOverManager.TriggerGameOver (garde-fou : une seule fois). */
  private triggerGameOver(): void {
    if (this.mode !== 'play') return;
    this.turboActive = false;
    this.engine?.stop();
    this.skid?.stop();
    if (bool(this.settings, 'deathAnimation')) {
      // Arcade : courte animation de fin (explosion, ralenti) avant le menu
      this.mode = 'dying';
      this.dyingTime = 0;
      this.explosions.spawn(this.car.getWorldPosition(new THREE.Vector3()));
      this.car.visible = false;
      Time.timeScale = 0.35;
    } else {
      this.finishGameOver();
    }
  }

  private finishGameOver(): void {
    this.mode = 'over';
    Time.timeScale = 0; // Time.timeScale = 0 : le jeu s'arrête
    this.music?.stop(); // mainCameraAudioSource.Stop()
    this.events.gameOver({ distance: this.tracker.totalDistance, time: this.chrono, stage: this.stages.stage, clocks: this.clocksCollected });
  }

  private damage(points: number, label: string): void {
    if (this.health.takeDamage(points)) {
      this.events.message(`${label} −${points}`, 'bad');
    }
  }

  private updateDifficulty(): void {
    const s = this.settings;
    let interval = num(s, 'meteorInterval');
    let aim = 0;
    if (bool(s, 'stages')) {
      interval *= this.stages.intervalFactor;
      aim = this.stages.aim;
    } else if (bool(s, 'meteorRamp')) {
      interval *= Math.max(0.35, 1 - this.chrono / 240);
      aim = 0.3;
    }
    this.meteors.interval = interval;
    this.meteors.aim = this.aimOverride ?? (bool(s, 'meteorRamp') || bool(s, 'stages') ? aim : 0);
  }

  // ------------------------------------------------------------------ boucle
  /**
   * Une frame de simulation. `realDt` : temps réel écoulé (s).
   * Les tests appellent step(1/60) en boucle sans rendu intermédiaire.
   */
  step(realDt: number, input: { horizontal: number; turbo: boolean }): void {
    Time.advance(realDt);
    const dt = Time.deltaTime;
    if (this.mode === 'menu') {
      this.rotatePlanet.update(dt);
      this.planet.updateMatrixWorld(true);
    } else if (this.mode === 'play' || this.mode === 'dying') {
      if (this.mode === 'play') this.chrono += realDt;
      this.gameplay(dt, input);
      if (this.mode === 'dying') {
        this.dyingTime += realDt;
        if (this.dyingTime > 1.6) this.finishGameOver();
      }
    }
    this.particles.update(dt);
    this.explosions.update(dt);
    this.shaker.update(dt);
    // LateUpdate : caméra
    if (this.mode === 'menu') this.rig.pivot.updateMatrixWorld(true);
    else this.rig.follow(this.car, realDt);
    this.updateSun();
  }

  private gameplay(dt: number, input: { horizontal: number; turbo: boolean }): void {
    const s = this.settings;
    const alive = this.mode === 'play';
    // Turbo (maintenu) : jauge qui se vide et se recharge
    const wantTurbo = alive && bool(s, 'turbo') && input.turbo && this.turboLevel > 0.02;
    if (wantTurbo) this.turboLevel = Math.max(0, this.turboLevel - dt / 2.5);
    else this.turboLevel = Math.min(1, this.turboLevel + dt / 6);
    if (wantTurbo !== this.turboActive) {
      this.turboActive = wantTurbo;
    }
    this.events.turbo(this.turboLevel, this.turboActive);
    this.vehicle.speedMultiplier = this.turboActive ? 1.7 : 1;
    if (bool(s, 'planetShrink')) this.shrink.update(Time.time);
    this.planet.updateMatrixWorld(true);
    // Update() de la voiture : rayon du collider (non mis à l'échelle dans l'original)
    const radius = bool(s, 'planetShrink') ? this.planetRadius() : this.planetCollider;
    if (alive) {
      this.vehicle.update(dt, input.horizontal, this.planet.position, radius);
      this.tracker.update();
    }
    this.car.updateMatrixWorld(true);
    obbFromBox(this.car, this.carBox.size, this.carBox.center, this.carOBB);
    this.health.update(dt);
    if (alive) {
      if (bool(s, 'stages')) this.stages.update(this.tracker.totalDistance, this.chrono, this.clocksCollected);
      this.updateDifficulty();
    }
    this.meteors.update(dt, alive ? { obb: this.carOBB, position: this.car.position } : null, alive);
    this.craters.update(dt, num(s, 'craterLifetime'), bool(s, 'planetShrink'));
    // OnTriggerEnter : cratères (couche DamageObject)
    if (alive) {
      for (const c of this.craters.list) {
        if (c.obb.center.distanceToSquared(this.carOBB.center) > 1) {
          c.inside = false;
          continue;
        }
        const inside = obbOverlap(this.carOBB, c.obb);
        // Dégâts : damageItems (« Crater » → 10) ou valeur du réglage
        if (inside && !c.inside && this.health.getDamagePoints(c.name) > 0) this.damage(num(s, 'craterDamage'), 'Cratère');
        c.inside = inside;
      }
    }
    this.clocks.update(dt, alive ? this.carOBB : null, alive);
    // Son moteur : hauteur selon le turbo ; dérapage selon le braquage
    if (this.engine) this.engine.setPitch(0.65 * (this.turboActive ? 1.35 : 1));
    if (this.skid && bool(s, 'extraSounds')) this.skid.setVolume(Math.max(0, Math.abs(this.vehicle.steer) - 0.55) * 0.5);
  }

  private updateSun(): void {
    if (!this.sun) return;
    // L'ombre portée suit la voiture : la caméra d'ombre est centrée sur elle
    const target = this.mode === 'menu' ? this.planet.position : this.car.position;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, -12);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ rendu
  private viewH = 720;
  resize(w: number, h: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
    this.rig.setAspect(w / h);
    this.viewH = h * pixelRatio;
  }

  render(): void {
    this.lights.update(this.rig.camera);
    this.particles.render(this.rig.camera, this.viewH);
    this.shaker.preRender(this.rig.node);
    this.post.render(this.scene, this.rig.camera);
    this.shaker.postRender(this.rig.node);
  }

  /**
   * Précompilation : tous les objets (même cachés) sont rendus visibles le
   * temps de compiler leurs shaders, pour éviter les gels en cours de partie.
   */
  async precompile(): Promise<void> {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    this.craters.mesh.count = 1;
    try {
      await this.renderer.compileAsync(this.scene, this.rig.camera);
    } catch {
      this.renderer.compile(this.scene, this.rig.camera);
    }
    this.post.render(this.scene, this.rig.camera);
    for (const o of hidden) o.visible = false;
    this.craters.mesh.count = 0;
  }

  setPaused(p: boolean): void {
    if (p) this.audio.suspend();
    else this.audio.resume();
  }

  /** Nombre de particules affichées (diagnostic). */
  get particleCount(): number {
    return this.particles.count;
  }

  /** Qualité adaptative : densité d'émission des particules. */
  setEffectsScale(k: number): void {
    ParticleSystem.emissionScale = k;
  }

  /** Graine aléatoire (tests déterministes). */
  seed(n: number): void {
    Random.seed(n);
  }

  carWorldPos(out = _v): THREE.Vector3 {
    return this.car.getWorldPosition(out);
  }
}
