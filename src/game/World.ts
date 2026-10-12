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
import { Decor } from './Decor';
import { planetById, type PlanetDef } from './planets';
import { atmosphere, planetToonMaterial, toToon } from './toon';
import { Starfield } from './Starfield';
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
  // --- planètes (préréglage Arcade)
  planetDef: PlanetDef = planetById('origine');
  private planetMesh!: THREE.Mesh;
  private planetStdMat!: THREE.Material;
  private readonly planetToonMat = planetToonMaterial();
  private atmo!: THREE.Mesh;
  decor!: Decor;
  private haloRoot: THREE.Object3D | null = null;
  private readonly ambient = new THREE.HemisphereLight(0xc4dcff, 0x6a5a6a, 0);
  private carMats: { mesh: THREE.Mesh; std: THREE.Material | THREE.Material[]; toon: THREE.Material | THREE.Material[] }[] = [];
  readonly stars = new Starfield();
  private smoke: ParticleSystem | null = null;
  private fire: ParticleSystem | null = null;
  private dayEnvironment: THREE.Texture | null = null;
  private engineArcade: AudioSourceLite | null = null;
  private engineOriginal: AudioSourceLite | null = null;
  /** Style courant : dessin animé (planètes Arcade) ou original. */
  private toon = false;

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
      this.haloRoot = inst.root;
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
      this.dayEnvironment = this.scene.environment;
      pm.dispose();
    }
    this.scene.add(this.ambient);
    this.scene.add(this.stars.points);
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
    this.planet.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !this.planetMesh) this.planetMesh = o as THREE.Mesh;
    });
    this.planetStdMat = this.planetMesh.material as THREE.Material;
    this.atmo = atmosphere(this.planetCollider);
    this.atmo.visible = false;
    this.planet.add(this.atmo);
    this.decor = new Decor(this.planet);
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
    // Variantes dessin animé (toon + contours), créées une fois pour toutes
    const toonCache = new Map<THREE.Material, THREE.Material>();
    const toonOf = (m: THREE.Material) => {
      if (!toonCache.has(m)) toonCache.set(m, toToon(m));
      return toonCache.get(m)!;
    };
    this.car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const std = m.material;
      const toon = Array.isArray(std) ? std.map(toonOf) : toonOf(std);
      this.carMats.push({ mesh: m, std, toon });
    });
    // Fumée et feu selon les dégâts (systèmes des prefabs météores réutilisés)
    const smokeNode = findNode(a.project.prefabs['meteor 2 '] ?? a.project.prefabs['meteor3'], 'Smoke');
    const fireNode = findNode(a.project.prefabs['meteor 1'], 'CFXR Fire');
    const emitter = new THREE.Object3D();
    emitter.position.set(0, 0.7, -1.7); // arrière de la voiture (unités locales, échelle 0.2)
    this.car.add(emitter);
    if (smokeNode) {
      const n = structuredClone(smokeNode);
      n.position = [0, 0, 0];
      n.rotation = [0, 0, 0, 1];
      n.scale = [1, 1, 1];
      n.children = [];
      const ps = n.components.find((c) => c.type === 'ParticleSystem') as unknown as { particle: { worldSpace: boolean; main: { gravity: { scalar: number } } } };
      ps.particle.worldSpace = true;
      ps.particle.main.gravity.scalar = -0.05;
      const inst = instantiate(n, this.buildCtx());
      emitter.add(inst.root);
      this.smoke = inst.particles[0] ?? null;
    }
    if (fireNode) {
      const n = structuredClone(fireNode);
      n.position = [0, 0.2, 0];
      n.rotation = [-0.7071, 0, 0, 0.7071];
      n.scale = [0.6, 0.6, 0.6];
      n.children = [];
      n.components = n.components.filter((c) => c.type !== 'CFXR_Effect');
      const inst = instantiate(n, this.buildCtx());
      emitter.add(inst.root);
      this.fire = inst.particles[0] ?? null;
    }
    const vf = scriptFields<VehicleControllerFields>(carNode, 'VehicleController');
    this.vehicle = new VehicleController(this.car, vf);
    const hf = scriptFields<HealthManagerFields>(carNode, 'HealthManager');
    this.health = new HealthManager(hf, num(s, 'maxHealth'));
    this.tracker = new VehicleDistanceTracker(this.car);
    const bc = getComponent<{ type: string; id: number; size: number[]; center: number[] }>(carNode, 'BoxCollider');
    if (bc) this.carBox = { size: bc.size, center: bc.center };
    const eng = getComponent<AudioSourceData>(carNode, 'AudioSource');
    if (eng?.clip) this.engineOriginal = this.audio.source(eng.clip, eng.volume, eng.pitch, eng.loop);
    this.engineArcade = this.audio.source('sfx_engine', 0.45, 1, true);
    this.engine = this.engineOriginal;
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
      this.craters.spawn(local, normal, !bool(this.settings, 'extraSounds'));
      this.explosions.spawn(world);
      this.sfxAt('sfx_explosion', world, 0.9);
    };
    this.meteors.onHitCar = (name, at) => {
      this.explosions.spawn(at);
      this.sfxAt('sfx_explosion', at, 1);
      this.damage(this.health.getDamagePoints(name) * this.planetDef.gameplay.craterDamage, 'Météore !');
    };
    this.meteors.onSpawn = (dir) => {
      // Sifflement si le météore vise les environs de la voiture
      if (this.mode !== 'play' || !bool(this.settings, 'extraSounds')) return;
      const up = this.car.position.clone().sub(this.planet.position).normalize();
      const ang = up.angleTo(dir);
      if (ang < 0.9) this.audio.playOneShot('sfx_whistle', 0.35 * (1 - ang / 0.9) + 0.08, 0.9 + Math.random() * 0.25);
    };
    this.clocks.onCollect = (name) => {
      const heal = this.health.getHealPoints(name);
      const hs = num(this.settings, 'clockHeal');
      this.health.heal(Number.isFinite(hs) ? hs : heal);
      this.clocksCollected++;
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_chime', 0.6);
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

  /** Son ponctuel atténué selon la distance à la voiture, panoramique selon l'écran. */
  private sfxAt(clip: string, at: THREE.Vector3, volume: number): void {
    if (!bool(this.settings, 'extraSounds')) return;
    const d = at.distanceTo(this.mode === 'menu' ? this.planet.position : this.car.position);
    const v = volume * Math.max(0.12, Math.min(1, 1.15 - d / 11));
    const p = at.clone().project(this.rig.camera);
    this.audio.playOneShot(clip, v, 0.85 + Math.random() * 0.3, Math.max(-0.8, Math.min(0.8, p.x * 0.8)));
  }

  /**
   * Applique une planète : apparence (planète d'origine ou toon), taille,
   * décor, ciel, lumières et matériaux de la voiture. Aucun objet n'est créé
   * ni détruit (pas de recompilation : seuls les uniformes et la visibilité changent).
   */
  applyPlanet(def: PlanetDef): void {
    this.planetDef = def;
    const premium = bool(this.settings, 'premiumFx');
    this.toon = premium && def.style === 'toon';
    this.planet.scale.setScalar(def.radius);
    this.planet.updateMatrixWorld(true);
    const cubes = this.assets.planetCubes.get(def.id);
    if (this.toon && cubes) {
      const u = this.planetToonMat.userData.planetUniforms;
      u.planetCube.value = cubes.color;
      u.planetEmis.value = cubes.emis ?? cubes.color;
      u.emisColor.value.set(cubes.emis ? 0xff7a2a : 0x000000).multiplyScalar(cubes.emis ? 0.85 : 0);
      u.rimColor.value.set(def.atmosphere);
      this.planetMesh.material = this.planetToonMat;
    } else {
      this.planetMesh.material = this.planetStdMat;
    }
    this.atmo.visible = premium;
    (this.atmo.material as THREE.ShaderMaterial).uniforms.color.value.set(def.atmosphere);
    if (this.haloRoot) this.haloRoot.visible = !premium;
    this.scene.background = premium && this.assets.space ? this.assets.space : this.assets.skybox;
    this.scene.backgroundIntensity = premium ? 0.8 : 1;
    this.scene.environment = this.dayEnvironment;
    this.decor.build(def, this.planetRadius(), def.radius);
    // Lumières : en style toon, soleil + ambiance douce (sans la ponctuelle du dessus)
    this.ambient.intensity = this.toon ? 0.95 : 0;
    // En cel-shading, un flash ponctuel devient un aplat : il est fortement atténué
    this.lights.scale = this.toon ? 0.22 : 1;
    for (const l of this.sceneLights) {
      const base = this.mode === 'menu' ? l.menu : l.game;
      l.light.intensity = this.toon && (l.light as THREE.PointLight).isPointLight ? 0 : base * (this.toon ? 0.72 : 1);
    }
    for (const c of this.carMats) c.mesh.material = this.toon ? c.toon : c.std;
    this.stars.points.visible = premium;
    this.rig.heightScale = premium ? Math.max(0.75, def.radius) : 1;
    this.post.setPremium(bool(this.settings, 'bloom'), { bloom: bool(this.settings, 'bloom') });
    // Avec le bloom, les particules HDR (×2 des shaders CFXR) sont tempérées
    this.particles.intensity = bool(this.settings, 'bloom') ? 0.62 : 1;
    this.clocks.spawnRadius = def.id === 'origine' ? null : () => this.planetCollider + 0.2 / this.planet.scale.x;
    this.applySettings(this.settings);
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
    const g = this.planetDef.gameplay;
    this.vehicle.speed = num(s, 'carSpeed') * g.carSpeed;
    this.vehicle.grip = g.grip;
    this.meteors.speedMul = g.meteorSpeed;
    this.vehicle.steerSpeed = num(s, 'steerSpeed');
    this.vehicle.fatigue = num(s, 'steerFatigue');
    this.health.maxHealth = num(s, 'maxHealth');
    this.health.invulnerabilityTime = num(s, 'invulnerability');
    this.clocks.spawnRate = num(s, 'clockInterval') * g.clockInterval;
    this.clocks.maxSpawns = num(s, 'clockMax');
    this.clocks.lifetime = num(s, 'clockLifetime');
    this.rig.tilt = num(s, 'cameraTilt');
    this.post.enabled = bool(s, 'postProcess');
    this.shaker.enabled = bool(s, 'cameraShake');
    this.audio.setVolumes(num(s, 'musicVolume'), num(s, 'sfxVolume'));
    if (this.music) this.music.loop = bool(s, 'loopMusic');
    // Moteur : boucle d'origine (AccelerationLow, 0,052) ou boucle Arcade plus présente
    const wanted = bool(s, 'extraSounds') ? this.engineArcade : this.engineOriginal;
    if (wanted !== this.engine) {
      const playing = this.engine?.isPlaying ?? false;
      this.engine?.stop();
      this.engine = wanted;
      if (playing) this.engine?.play();
    }
    this.engine?.setVolume(num(s, 'engineVolume'));
    this.rig.portraitFit = bool(s, 'premiumFx') || String(s.orientation) !== 'landscape';
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
    this.planet.scale.setScalar(this.planetDef.radius);
    this.planet.quaternion.identity();
    this.rotatePlanet.start();
    this.engine?.stop();
    this.skid?.stop();
    for (const l of this.sceneLights) l.light.intensity = l.menu;
    this.applyPlanet(this.planetDef);
    const camNode = this.findRoot(this.menuData, 'Main Camera')!;
    this.rig.tilt = 0;
    // La caméra du menu est à la racine 3D : pivot identité, nœud = transform du menu
    this.rig.pivot.position.set(0, 0, 0);
    this.rig.pivot.quaternion.identity();
    this.rig.pivot.scale.set(1, 1, 1);
    this.rig.node.position.set(...camNode.position).multiplyScalar(this.rig.heightScale);
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
    for (const l of this.sceneLights) l.light.intensity = l.game;
    this.applyPlanet(this.planetDef);
    this.craters.baseScale = this.planetDef.radius;
    const carNode = this.findRoot(this.gameData, 'Cartoon_SportCar_B01')!;
    this.car.position.set(...carNode.position);
    // Hauteur de départ : rayon de la planète choisie (5,011 sur la planète d'origine)
    this.car.position.y = carNode.position[1] - this.planetCollider + this.planetRadius();
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
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_crunch', 0.8, 0.9 + Math.random() * 0.2);
    }
  }

  private bumpCooldown = 0;
  /** Décor : cercle (voiture) contre cercle (obstacle) sur la sphère, rebond. */
  private obstacles(): void {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - Time.deltaTime);
    const R = this.planetRadius();
    const up = this.car.position.clone().sub(this.planet.position).normalize();
    for (const o of this.decor.obstacles) {
      const d = o.dir.clone().applyQuaternion(this.planet.quaternion);
      const dist = up.angleTo(d) * R;
      const min = o.radius + 0.16;
      if (dist >= min) continue;
      // Repousse la voiture hors de l'obstacle, le long de la surface
      const away = up.clone().sub(d.clone().multiplyScalar(up.dot(d))).normalize();
      const push = (min - dist) / R;
      const axis = new THREE.Vector3().crossVectors(up, away).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, push);
      this.car.position.sub(this.planet.position).applyQuaternion(q).add(this.planet.position);
      this.car.quaternion.premultiply(q);
      // Réflexion du cap si la voiture fonce dans l'obstacle
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
      if (fwd.dot(away) < 0) {
        const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.car.quaternion);
        this.vehicle.bump((left.dot(away) > 0 ? -1 : 1) * 70);
      }
      if (this.bumpCooldown <= 0) {
        this.bumpCooldown = 0.4;
        if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_crunch', 0.5, 0.7);
        this.shaker.start({ enabled: true, delay: 0, duration: 0.2, space: 0, strength: [0.1, 0.1, 0.2], curve: [[0, 1, 0, -1], [1, 0, -1, 0]], shakesDelay: 0 });
      }
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
      if (wantTurbo && bool(s, 'extraSounds')) this.audio.playOneShot('sfx_whoosh', 0.7);
    }
    this.events.turbo(this.turboLevel, this.turboActive);
    this.vehicle.speedMultiplier = this.turboActive ? 1.7 : 1;
    if (bool(s, 'planetShrink')) this.shrink.update(Time.time);
    this.planet.updateMatrixWorld(true);
    // Update() de la voiture : rayon du collider (non mis à l'échelle dans l'original)
    const radius = bool(s, 'planetShrink') || this.planetDef.id !== 'origine' ? this.planetRadius() : this.planetCollider;
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
        if (inside && !c.inside && this.health.getDamagePoints(c.name) > 0) {
          this.damage(Math.round(num(s, 'craterDamage') * this.planetDef.gameplay.craterDamage), 'Cratère');
          if (bool(s, 'craterBump')) {
            // Arcade : déviation aléatoire de 25 à 60° d'un côté ou de l'autre
            this.vehicle.bump((Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 35));
            this.shaker.start({ enabled: true, delay: 0, duration: 0.3, space: 0, strength: [0.15, 0.15, 0.3], curve: [[0, 1, 0, -1], [1, 0, -1, 0]], shakesDelay: 0 });
          }
        }
        c.inside = inside;
      }
    }
    this.clocks.update(dt, alive ? this.carOBB : null, alive);
    if (alive) this.obstacles();
    // Fumée (puis feu) selon les dégâts
    const hurt = 1 - this.health.currentHealth / Math.max(1, this.health.maxHealth);
    const smokeOn = bool(s, 'damageSmoke') && this.mode !== 'menu';
    if (this.smoke) {
      this.smoke.rateScale = smokeOn ? Math.max(0, (hurt - 0.2) / 0.8) * 1.6 : 0;
      if (this.smoke.rateScale > 0 && !this.smoke.playing) this.smoke.play();
    }
    if (this.fire) {
      this.fire.rateScale = smokeOn && hurt > 0.65 ? 1 : 0;
      if (this.fire.rateScale > 0 && !this.fire.playing) this.fire.play();
    }
    // Son moteur : hauteur selon le turbo ; dérapage selon le braquage
    if (this.engine === this.engineOriginal) this.engine?.setPitch(0.65 * (this.turboActive ? 1.35 : 1));
    else this.engine?.setPitch((this.turboActive ? 1.35 : 1) * (1 + 0.12 * Math.abs(this.vehicle.steer)) * this.planetDef.gameplay.carSpeed);
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
    this.stars.update(this.rig.camera, this.viewH, Time.realtimeSinceStartup);
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
    // Chaque style de planète (toon / original) est compilé une fois
    const keep = this.planetDef;
    if (bool(this.settings, 'premiumFx')) {
      this.applyPlanet(planetById('volcan'));
      await this.compileAll();
    }
    this.applyPlanet(planetById('origine'));
    await this.compileAll();
    this.applyPlanet(keep);
  }

  private async compileAll(): Promise<void> {
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
