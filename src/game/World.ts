/**
 * Monde du jeu : reconstruit les scènes Unity « Menu » et « SampleScene »
 * dans une seule scène three (mêmes objets, aucune création en cours de partie)
 * et exécute les scripts portés dans l'ordre Update puis LateUpdate.
 */
import * as THREE from 'three';
import { SURF, type Assets } from '../unity/assets';
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
import { PLANETS, planetById, type PlanetDef } from './planets';
import { atmosphere, planetToonMaterial, toonGradient, toToon } from './toon';
import { Starfield } from './Starfield';
import { VehicleController, type VehicleControllerFields } from './VehicleController';
import { VehicleDistanceTracker } from './VehicleDistanceTracker';
import { animateVehicle, buildHover, type VehicleRig } from './vehicles';
import * as fxp from './fxParticles';
import { HealthRing } from './HealthRing';
import { DEFAULT_KART, KartProps } from './KartProps';
import { Toys } from './Toys';
import { BulletBills, Snitch } from './Chasers';
import { PlanetSelect } from './PlanetSelect';
import { classicPathPoint, classicPlanetMaterial, grassShells } from './classicPlanet';

export type Mode = 'menu' | 'play' | 'dying' | 'over';

export interface WorldEvents {
  health(hp: number, max: number, delta: number): void;
  message(text: string, kind?: 'good' | 'bad' | 'info'): void;
  gameOver(stats: { distance: number; time: number; stage: number; clocks: number; victory?: boolean; planets?: number }): void;
  turbo(level: number, active: boolean): void;
  /** Étape réussie : numéro de la nouvelle étape et son objectif. */
  stage?(next: number, label: string, title?: string): void;
  /** Compte à rebours de départ : 3, 2, 1 puis 0 (« Partez ! »). */
  countdown?(n: number): void;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _o1 = new THREE.Vector3();
const _o2 = new THREE.Vector3();
const _o3 = new THREE.Vector3();
const _o4 = new THREE.Vector3();
const _o5 = new THREE.Vector3();
const SPIN_TIME = 0.7;
const HOP_TIME = 1.0;
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

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
  private turboLocked = false;
  /** Contre-la-montre : temps restant (s). */
  timeLeft = 60;
  private dyingTime = 0;
  private gameData: SceneData;
  private menuData: SceneData;
  events: WorldEvents;
  /** Visée forcée des météores (tests). */
  aimOverride: number | null = null;
  private baseCarColor = new THREE.Color();
  // --- planètes (préréglage Arcade)
  /** Planète (ou monde) choisie dans le menu. */
  private selected: PlanetDef = planetById('origine');
  /** Planète physique courante (une étape du voyage galactique, sinon la planète choisie). */
  def: PlanetDef = this.selected;
  get planetDef(): PlanetDef {
    return this.selected;
  }
  set planetDef(d: PlanetDef) {
    this.selected = d;
    this.def = this.resolve(d, 0);
  }
  /** Voyage galactique : suite de planètes tirée au hasard (ids). */
  private route: string[] = [];
  /** Tire un nouvel itinéraire : toutes les planètes toon, mélangées (sans répétition consécutive). */
  private newRoute(): void {
    const pool = PLANETS.filter((p) => p.style === 'toon').map((p) => p.id);
    const out: string[] = [];
    while (out.length < 40) {
      const bag = [...pool];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (out.length && bag[0] === out[out.length - 1]) bag.push(bag.shift()!);
      out.push(...bag);
    }
    this.route = out;
  }
  /** Nombre de planètes du voyage (0 = sans fin) et temps par planète (0 = illimité). */
  get galaxyCount(): number {
    return Number(this.settings.galaxyCount ?? 5) || 0;
  }
  get galaxyTime(): number {
    return Number(this.settings.galaxyTime ?? 90) || 0;
  }
  /** Compte à rebours actif (contre-la-montre, ou temps limité par planète du voyage). */
  get countdown(): boolean {
    return bool(this.settings, 'modeTimeAttack') || (!!this.galaxy && this.galaxyTime > 0);
  }
  /** Voyage réussi (dernière planète atteinte et son objectif rempli). */
  private won = false;
  /** Compte à rebours avant le départ (s restantes). */
  startDelay = 0;
  /** Étape i d'un voyage galactique, ou la planète elle-même. */
  private resolve(d: PlanetDef, i: number): PlanetDef {
    if (d.style !== 'galaxy') return d;
    if (!this.route.length) this.newRoute();
    const sub = planetById(this.route[i % this.route.length]);
    return { ...sub, radius: Math.min(sub.radius, 1.05) };
  }
  private planetMesh!: THREE.Mesh;
  private planetStdMat!: THREE.Material;
  private readonly planetToonMat = planetToonMaterial();
  private classicMat: THREE.MeshStandardMaterial | null = null;
  private shells: THREE.Group | null = null;
  /** Écran titre : la voiture fait le tour de la planète classique sur son chemin. */
  title = false;
  private titlePhi = 0;
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
  /** Véhicules Arcade (voiture volante, bateau) et effets de surface. */
  private rigs!: { hover: VehicleRig };
  private rig3d: VehicleRig | null = null;
  private splash!: ParticleSystem;
  private wake!: ParticleSystem;
  private embers!: ParticleSystem;
  private thrusters: ParticleSystem[] = [];
  private surfaceFx: ParticleSystem[] = [];
  private surface = 0;
  private splashSoundCd = 0;
  private healthRing!: HealthRing;
  private leaves!: ParticleSystem;
  private fireTrails: ParticleSystem[] = [];
  // --- circuits
  private kart!: KartProps;
  private toys!: Toys;
  snitch!: Snitch;
  bills!: BulletBills;
  /** Toupie (pylône) : temps restant (s). */
  private spinT = 0;
  private spinSign = 1;
  private spinCd = 0;
  private readonly burstObj = new THREE.Object3D();
  private bursts: ParticleSystem[] = [];
  private smokes: ParticleSystem[] = [];
  private smokeIdx = 0;
  private burstIdx = 0;
  private boostTime = 0;
  private boostCd = 0;
  /** Saut (tremplin) : temps restant (s). */
  private hop = 0;
  readonly carDir = new THREE.Vector3(0, 1, 0);
  // --- voyage galactique
  galaxy: { index: number; arrivalDist: number; star: THREE.Vector3 | null; visited: number; goal: boolean } | null = null;
  /** Lancement : aspiration vers l'étoile, élan (toupie), vol, atterrissage. */
  launch: {
    phase: 'pull' | 'wind' | 'fly'; t: number; from: THREE.Vector3; at: THREE.Vector3; p: THREE.Vector3[]; up0: THREE.Vector3; up1: THREE.Vector3;
    /** Pose de départ, angle total de la toupie, cap de vol. */
    q0: THREE.Quaternion; spin: number; h0: THREE.Vector3;
    /** Orientations clés du vol et « haut » courant (sans le tonneau). */
    qs: THREE.Quaternion; qm: THREE.Quaternion; qe: THREE.Quaternion; upNow: THREE.Vector3;
    land: { at: THREE.Vector3; up: THREE.Vector3; f: THREE.Vector3; center: THREE.Vector3; radius: number } | null;
  } | null = null;
  /** Rebond d'atterrissage (s restantes). */
  private landT = 0;
  /** Rebonds après l'atterrissage (s restantes). */
  private landBounce = 0;
  private readonly launchProxy = new THREE.Object3D();
  private satellite!: THREE.Group;
  private satMat!: THREE.MeshToonMaterial;
  private satAtmo!: THREE.Mesh;
  private satDef: PlanetDef | null = null;
  launchStar!: THREE.Group;
  private sparkle!: ParticleSystem;
  /** Choix de la planète (carrousel 3D). */
  select!: PlanetSelect;

  constructor(readonly assets: Assets, public settings: Settings, canvas: HTMLCanvasElement, events: WorldEvents) {
    this.events = events;
    const quality = String(settings.quality);
    // Avec le post-process, l'anticrénelage se fait dans la cible intermédiaire :
    // inutile de payer un MSAA sur le framebuffer final (bande passante mobile)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low' && !bool(settings, 'postProcess'), powerPreference: 'high-performance', preserveDrawingBuffer: false });
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
    // MSAA : 4 sur ordinateur, 2 sur mobile (écrans denses), aucun en qualité basse
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.post = new PostProcess(this.renderer, vol?.profile?.components, quality === 'low' ? 0 : quality === 'medium' || coarse ? 2 : 4);
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
    this.decor.prepare(PLANETS);
    this.kart = new KartProps(this.planet);
    this.toys = new Toys(this.planet);
    this.toys.prepare(PLANETS.map((p) => p.toys));
    this.toys.onKick = (k) => {
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_crunch', 0.25 + 0.35 * k, 1.5 + Math.random() * 0.4);
    };
    this.toys.onBreak = () => {
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_crunch', 0.7, 0.9);
      this.shaker.start({ enabled: true, delay: 0, duration: 0.15, space: 0, strength: [0.05, 0.05, 0.1], curve: [[0, 1, 0, -1], [1, 0, -1, 0]], shakesDelay: 0 });
    };
    this.toys.onOrbit = () => {
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_whoosh', 0.6, 1.3);
      this.events.message('En orbite !', 'info');
    };
    this.snitch = new Snitch(this.planet);
    this.snitch.onCatch = (at) => {
      this.burstAt(at, [1, 0.85, 0.3, 1]);
      this.health.heal(10);
      this.events.message(`Vif d'or attrapé ! (${this.snitch.caught})`, 'good');
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_snitch', 0.8);
    };
    this.bills = new BulletBills(this.planet);
    this.bills.onLaunch = () => {
      this.events.message('Bullet Bill en approche !', 'bad');
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_warning', 0.6);
    };
    this.bills.onHit = (at) => {
      this.explosions.spawn(at);
      this.sfxAt('sfx_explosion', at, 1);
      this.damage(35, 'Bullet Bill !');
    };
    this.bills.onFizzle = (at) => {
      this.burstAt(at, [0.6, 0.6, 0.65, 1]);
      this.events.message('Esquivé !', 'good');
    };
    this.buildGalaxyObjects();
    const geo = this.planetMesh.geometry;
    geo.computeBoundingSphere();
    this.select = new PlanetSelect(this.scene, this.assets, this.planetStdMat, geo, geo.boundingSphere?.radius ?? 5);
    // Planètes du menu : leurs monuments et décorations flottantes à la surface
    this.select.classicMat = () => (this.classicMat ??= classicPlanetMaterial(this.assets.textures.get('classic_grass'), this.assets.textures.get('classic_dirt')));
    this.select.decorFor = (def, mesh) => {
      if (!bool(this.settings, 'premiumFx') || !Decor.hasMonuments(def)) return;
      const d = new Decor(mesh);
      // Monuments exagérés : la planète du menu est vue de loin
      d.build(def, this.planetCollider * def.radius, def.radius, this.surfaceAvoid(def), true, 1.8);
    };
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
    // Jauge de santé au sol autour du véhicule (unités locales de la voiture)
    this.healthRing = new HealthRing(this.car, 2.3);
    // Véhicules Arcade : construits une fois, affichés selon la planète
    this.rigs = { hover: buildHover() };
    const atlas = a.manifest.fxAtlas;
    for (const r of [this.rigs.hover]) {
      r.group.visible = false;
      this.car.add(r.group);
    }
    for (const em of this.rigs.hover.emitters) {
      em.rotation.y = Math.PI; // +Z de l'émetteur vers l'arrière
      this.thrusters.push(this.particles.add(fxp.thruster(em, atlas)));
    }
    const surfEm = new THREE.Object3D();
    surfEm.position.set(0, 0.15, -1.2);
    surfEm.rotation.x = -Math.PI / 2; // +Z vers le ciel
    this.car.add(surfEm);
    this.splash = this.particles.add(fxp.splash(surfEm, atlas));
    this.embers = this.particles.add(fxp.embers(surfEm, atlas));
    // Sillage d'écume quand le véhicule rase l'eau
    const wakeEm = new THREE.Object3D();
    wakeEm.position.set(0, 0.1, -1.5);
    wakeEm.rotation.x = -Math.PI / 2;
    this.car.add(wakeEm);
    this.wake = this.particles.add(fxp.wake(wakeEm, atlas));
    this.leaves = this.particles.add(fxp.splash(surfEm, atlas, [0.35, 0.85, 0.3, 1]));
    // Deux traînées de feu derrière les patins arrière (Hill Valley)
    for (const sx of [-1, 1]) {
      const fe = new THREE.Object3D();
      fe.position.set(sx * 0.82, 0.05, -0.9);
      fe.rotation.x = -Math.PI / 2;
      this.car.add(fe);
      this.fireTrails.push(this.particles.add(fxp.fireTrail(fe, atlas)));
    }
    this.sparkle = this.particles.add(fxp.sparkle(this.car, atlas));
    // Gerbes de ramassage (cases, baskets) : quelques systèmes réutilisés à tour de rôle
    this.scene.add(this.burstObj);
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Object3D();
      this.burstObj.add(o);
      const b = fxp.burst(o, atlas);
      b.d.playOnAwake = false;
      this.bursts.push(this.particles.add(b));
    }
    // Colonnes de fumée des impacts (quelques systèmes réutilisés à tour de rôle)
    for (let i = 0; i < 4; i++) {
      const o = new THREE.Object3D();
      this.burstObj.add(o);
      const sm = fxp.impactSmoke(o, atlas);
      sm.d.playOnAwake = false;
      this.smokes.push(this.particles.add(sm));
    }
    this.surfaceFx = [this.splash, this.embers, this.wake, this.leaves, ...this.fireTrails, this.sparkle];
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
      if (bool(this.settings, 'impactSmoke')) this.smokeAt(world);
      this.sfxAt('sfx_explosion', world, 0.9);
    };
    this.meteors.onHitCar = (name, at) => {
      this.explosions.spawn(at);
      this.sfxAt('sfx_explosion', at, 1);
      this.damage(this.health.getDamagePoints(name) * this.def.gameplay.craterDamage, 'Météore !');
    };
    this.meteors.onSpawn = (dir) => {
      // Sifflement si le météore vise les environs de la voiture
      if (this.mode !== 'play' || !bool(this.settings, 'extraSounds')) return;
      const up = this.car.position.clone().sub(this.planet.position).normalize();
      const ang = up.angleTo(dir);
      if (ang < 0.9) this.audio.playOneShot('sfx_whistle', 0.35 * (1 - ang / 0.9) + 0.08, 0.9 + Math.random() * 0.25);
    };
    this.clocks.onCollect = (name, at) => {
      this.burstAt(at, [1, 0.85, 0.4, 1]);
      const heal = this.health.getHealPoints(name);
      const hs = num(this.settings, 'clockHeal');
      this.health.heal(Number.isFinite(hs) ? hs : heal);
      this.clocksCollected++;
      if (bool(this.settings, 'modeTimeAttack')) {
        this.timeLeft += 5;
        this.events.message('+5 s', 'good');
      }
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_pickup', 0.7);
      this.events.message(`+${Number.isFinite(hs) ? hs : heal} ❤`, 'good');
    };
    this.health.onChange = (hp, max, d) => this.events.health(hp, max, d);
    this.health.onDie = () => this.triggerGameOver();
    this.stages.onComplete = (n) => {
      if (this.galaxy && !this.galaxy.goal && this.galaxyCount > 0 && this.galaxy.visited >= this.galaxyCount) {
        // Dernière planète du voyage : victoire
        this.galaxy.goal = true;
        this.events.stage?.(n + 1, `${this.galaxyCount} planètes traversées`, 'Voyage réussi !');
        if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_stage', 0.8);
        this.won = true;
        this.mode = 'dying';
        this.dyingTime = 0;
        Time.timeScale = 0.6;
        return;
      }
      if (this.galaxy && !this.galaxy.goal) {
        // Voyage galactique : l'objectif accompli débloque l'étoile de lancement
        this.galaxy.goal = true;
        this.events.stage?.(n + 1, 'L’étoile de lancement arrive…', 'Objectif réussi !');
        if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_stage', 0.7);
        this.health.heal(10);
        return;
      }
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_stage', 0.7);
      if (this.events.stage) this.events.stage(n + 1, `Objectif : ${this.stages.label}`);
      else this.events.message(`Étape ${n} réussie !`, 'good');
      this.health.heal(10);
      this.revealKart(n + 1, true);
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
    this.def = def;
    const premium = bool(this.settings, 'premiumFx');
    this.toon = premium && def.style === 'toon';
    this.planet.scale.setScalar(def.radius);
    this.planet.updateMatrixWorld(true);
    const cubes = this.assets.planetCubes.get(def.id);
    if (this.toon && cubes) {
      const u = this.planetToonMat.userData.planetUniforms;
      u.planetCube.value = cubes.color;
      u.planetEmis.value = cubes.emis ?? cubes.color;
      // Néon et lave : lueur modérée pour que voiture, cratères et réticules restent lisibles
      if (def.neon) u.emisColor.value.setRGB(0.8, 0.8, 0.8);
      else if (def.emis) u.emisColor.value.setRGB(def.emis, def.emis, def.emis);
      else u.emisColor.value.set(cubes.emis ? 0xff7a2a : 0x000000).multiplyScalar(cubes.emis ? 0.55 : 0);
      u.rimColor.value.set(def.atmosphere);
      // Planète de verre (Arc-en-ciel) : seule la route est opaque, on voit l'espace au travers
      const glass = !!def.glass && !!cubes.mask;
      u.planetMask.value = cubes.mask ?? cubes.color;
      u.glass.value = glass ? 1 : 0;
      if (this.planetToonMat.transparent !== glass) {
        this.planetToonMat.transparent = glass;
        this.planetToonMat.side = glass ? THREE.DoubleSide : THREE.FrontSide;
        this.planetToonMat.needsUpdate = true;
      }
      this.planetMesh.material = this.planetToonMat;
    } else if (def.style === 'classic') {
      // Planète classique : herbe réaliste et chemin de terre (textures du projet Unity)
      this.classicMat ??= classicPlanetMaterial(this.assets.textures.get('classic_grass'), this.assets.textures.get('classic_dirt'));
      this.planetMesh.material = this.classicMat;
    } else {
      this.planetMesh.material = this.planetStdMat;
    }
    // Herbe en relief (test, désactivée par défaut) : planète classique seulement
    const shells = def.style === 'classic' && bool(this.settings, 'realGrass');
    if (shells && !this.shells) {
      this.shells = grassShells(this.planetMesh.geometry, this.assets.textures.get('classic_grass'));
      this.planetMesh.add(this.shells);
    }
    if (this.shells) this.shells.visible = shells;
    this.atmo.visible = premium;
    (this.atmo.material as THREE.ShaderMaterial).uniforms.color.value.set(def.atmosphere);
    (this.atmo.material as THREE.ShaderMaterial).uniforms.intensity.value = def.neon || def.glass ? 0.3 : 0.6;
    if (this.haloRoot) this.haloRoot.visible = !premium;
    // Voyage galactique : ciel étoilé pour tout le voyage
    const sky = premium ? (this.selected.style === 'galaxy' ? 'space' : def.sky ?? 'space') : 'original';
    this.scene.background =
      sky === 'space' && this.assets.space ? this.assets.space
      : sky === 'db' && this.assets.skyDb ? this.assets.skyDb
      : sky === 'red' && this.assets.skyRed ? this.assets.skyRed
      : this.assets.skies.get(sky) ?? this.assets.skybox;
    this.scene.backgroundIntensity = sky === 'space' ? (def.neon ? 0.55 : 0.8) : sky === 'db' ? 0.62 : sky === 'original' ? 1 : 0.95;
    this.scene.environment = this.dayEnvironment;
    this.decor.build(def, this.planetRadius(), def.radius, this.surfaceAvoid(def));
    // Objets de course sur toutes les planètes Arcade (nombre selon la surface)
    const area = def.radius * def.radius;
    const kart = def.kart ?? {
      boosts: Math.round(DEFAULT_KART.boosts * area),
      items: Math.max(1, Math.round(DEFAULT_KART.items * area)),
      ramps: Math.round(DEFAULT_KART.ramps * area),
      spinners: Math.round((DEFAULT_KART.spinners ?? 0) * area),
    };
    this.kart.build(this.toon ? kart : undefined, this.planetRadius(), def.radius, [...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) >>> 0);
    this.revealKart(this.mode === 'menu' ? 99 : this.stages.stage);
    this.clocks.boxLook = this.toon;
    this.stages.item = this.toon ? ['caisse', 'caisses'] : ['horloge', 'horloges'];
    const seed = [...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 13) >>> 0;
    this.toys.build(this.toon ? def.toys : undefined, this.planetRadius(), def.radius, seed);
    // Lumières : en style toon, soleil + ambiance douce (sans la ponctuelle du dessus)
    // Éclairage lisible : ambiance forte, soleil modéré (ombres légères) ;
    // Néon : planète sombre, ce sont la voiture, la grille et les impacts qui brillent
    const neon = this.toon && !!def.neon;
    this.ambient.intensity = this.toon ? (neon ? 0.95 : 1.15) : 0;
    this.ambient.color.set(neon ? 0x8a6aff : 0xc4dcff);
    this.ambient.groundColor.set(neon ? 0x2a1040 : 0x6a5a6a);
    // En cel-shading, un flash ponctuel devient un aplat : il est atténué (sauf Néon)
    this.lights.scale = neon ? 0.9 : this.toon ? 0.22 : 1;
    for (const l of this.sceneLights) {
      const base = this.mode === 'menu' ? l.menu : l.game;
      l.light.intensity = this.toon && (l.light as THREE.PointLight).isPointLight ? 0 : base * (this.toon ? (neon ? 0.22 : 0.62) : 1);
    }
    if (this.sun) (this.sun.shadow as THREE.LightShadow & { intensity: number }).intensity = this.toon ? 0.3 : 1;
    for (const c of this.carMats) {
      for (const m of Array.isArray(c.toon) ? c.toon : [c.toon]) {
        const t = m as THREE.MeshToonMaterial;
        if (!t.isMeshToonMaterial) continue;
        const n = t.name;
        const glow = n.startsWith('body') ? new THREE.Color(0xff2050).multiplyScalar(0.3)
          : n.startsWith('light_AV') ? new THREE.Color(0xfff6c0).multiplyScalar(3)
          : n.startsWith('light_rear') ? new THREE.Color(0xff2030).multiplyScalar(3)
          : n.startsWith('light_blinker') ? new THREE.Color(0xffa020).multiplyScalar(2)
          : null;
        if (glow) t.emissive.copy(neon ? glow : new THREE.Color(0, 0, 0));
      }
    }
    this.craters.setGlow(neon ? new THREE.Color(0x22e8ff).multiplyScalar(2.5) : null);
    this.meteors.setReticleColor(def.reticle ?? 0xff2e0d);
    this.craters.setWater(premium && def.id === 'ocean');
    this.craters.heatGlow = bool(this.settings, 'impactSmoke') && def.id !== 'ocean';
    // Véhicule : voiture d'origine, voiture volante ou bateau (préréglage Arcade)
    const kind = premium ? def.vehicle ?? 'original' : 'original';
    this.rig3d = kind === 'hover' ? this.rigs.hover : null;
    this.rigs.hover.group.visible = this.rig3d === this.rigs.hover;
    // Mondes sombres (nuit, Halloween, lave, verre…) : néons années 80 sous la voiture
    if (this.rigs.hover.neon) this.rigs.hover.neon.visible = premium && !!def.dark && bool(this.settings, 'neonCar');
    for (const c of this.carMats) c.mesh.visible = !this.rig3d;
    for (const t of this.thrusters) t.stop(true);
    for (const f of this.surfaceFx) f.stop(true);
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
    const g = this.def.gameplay;
    this.vehicle.speed = num(s, 'carSpeed') * g.carSpeed;
    this.vehicle.grip = g.grip;
    this.meteors.speedMul = g.meteorSpeed * (bool(s, 'modeStorm') ? 1.3 : 1);
    this.vehicle.steerSpeed = num(s, 'steerSpeed');
    this.vehicle.fatigue = num(s, 'steerFatigue');
    this.vehicle.fatigueHold = Math.min(num(s, 'steerFatigueHold') || 0, Math.max(0, num(s, 'steerFatigue') - 0.2));
    this.health.maxHealth = num(s, 'maxHealth');
    this.health.invulnerabilityTime = num(s, 'invulnerability');
    this.clocks.spawnRate = num(s, 'clockInterval') * g.clockInterval * (bool(s, 'modeTimeAttack') ? 0.6 : 1);
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
  /** Écran titre : planète classique, la voiture volante boucle le long du chemin. */
  enterTitle(): void {
    this.planetDef = planetById('classique');
    this.enterMenu();
    this.title = true;
    this.titlePhi = 0;
    this.car.visible = true;
    this.updateTitle(0);
  }

  /** Sortie de l'écran titre (la voiture disparaît, retour au menu normal). */
  leaveTitle(): void {
    this.title = false;
    this.car.visible = false;
  }

  private updateTitle(dt: number): void {
    this.titlePhi += dt * 0.42;
    const R = this.planetRadius() + this.vehicle.f.desiredDistanceFromSurface;
    const d = classicPathPoint(this.titlePhi, _o1);
    const ahead = classicPathPoint(this.titlePhi + 0.01, _o2);
    const local = d.clone().multiplyScalar(R / this.planet.scale.x);
    this.car.position.copy(this.planet.localToWorld(local));
    const up = d.clone().applyQuaternion(this.planet.quaternion).normalize();
    const f = ahead.sub(d).applyQuaternion(this.planet.quaternion);
    f.addScaledVector(up, -f.dot(up)).normalize();
    const x = _o3.crossVectors(up, f).normalize();
    this.car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, f));
    this.car.updateMatrixWorld(true);
    // La voiture volante flotte et se balance comme en jeu
    if (this.rig3d) animateVehicle(this.rig3d, Time.time, 0, false);
    // Caméra du titre : de trois-quarts, en retrait derrière la voiture, la planète entière à l'image
    const D = this.planetRadius() * 2.9;
    this.healthRing.mesh.visible = false;
    const c = this.planet.position;
    const pos = _o4.copy(c).addScaledVector(up, D * 0.82).addScaledVector(f, -D * 0.62);
    const look = _o5.copy(c).addScaledVector(up, this.planetRadius() * 0.45);
    const n = this.rig.node;
    this.rig.pivot.position.set(0, 0, 0);
    this.rig.pivot.quaternion.identity();
    this.rig.pivot.scale.set(1, 1, 1);
    n.scale.set(1, 1, 1);
    const k = dt > 0 ? 1 - Math.exp(-dt * 3) : 1;
    n.position.lerp(pos, k);
    // Le nœud suit la convention Unity (+Z vers l'avant) : base (x, haut, avant)
    const fw = look.sub(n.position).normalize();
    const x2 = new THREE.Vector3().crossVectors(f, fw).normalize();
    const y2 = new THREE.Vector3().crossVectors(fw, x2);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y2, fw));
    if (dt > 0) n.quaternion.slerp(q, k);
    else n.quaternion.copy(q);
    this.rig.pivot.updateMatrixWorld(true);
  }

  enterMenu(): void {
    this.mode = 'menu';
    this.title = false;
    Time.timeScale = 1;
    this.car.visible = false;
    for (const f of [...this.surfaceFx, ...this.thrusters]) f.stop(true);
    this.meteors.clear();
    this.clocks.start();
    this.craters.clear();
    this.explosions.clear();
    this.shaker.clear();
    this.def = this.resolve(this.selected, 0);
    this.galaxy = null;
    this.launch = null;
    this.snitch?.stop();
    this.bills?.stop();
    this.planet.scale.setScalar(this.def.radius);
    this.planet.quaternion.identity();
    this.rotatePlanet.start();
    this.engine?.stop();
    this.skid?.stop();
    for (const l of this.sceneLights) l.light.intensity = l.menu;
    this.applyPlanet(this.def);
    this.placeSatellite(this.selected.style === 'galaxy' ? this.resolve(this.selected, 1) : null, new THREE.Vector3(0.75, 0.35, -0.55));
    this.launchStar.visible = false;
    const camNode = this.findRoot(this.menuData, 'Main Camera')!;
    this.rig.tilt = 0;
    this.rig.adaptive = false;
    this.shaker.strength = 1;
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
    if (this.selected.style === 'galaxy') this.newRoute();
    this.def = this.resolve(this.selected, 0);
    this.applyPlanet(this.def);
    this.craters.baseScale = this.def.radius;
    this.launch = null;
    this.launchStar.visible = false;
    this.hop = 0;
    this.spinT = 0;
    this.boostTime = 0;
    this.galaxy = this.selected.style === 'galaxy' ? { index: 0, arrivalDist: 0, star: null, visited: 1, goal: false } : null;
    this.landT = 0;
    this.landBounce = 0;
    this.carDir.set(0, 1, 0);
    if (bool(this.settings, 'modeSnitch') && bool(this.settings, 'premiumFx')) this.snitch.start(this.carDir);
    else this.snitch.stop();
    if (bool(this.settings, 'modeBullet') && bool(this.settings, 'premiumFx')) this.bills.start();
    else this.bills.stop();
    this.placeSatellite(this.galaxy ? this.resolve(this.selected, 1) : null, new THREE.Vector3(0.2, 0.5, 1));
    const carNode = this.findRoot(this.gameData, 'Cartoon_SportCar_B01')!;
    this.car.position.set(...carNode.position);
    // Hauteur de départ : rayon de la planète choisie (5,011 sur la planète d'origine)
    this.car.position.y = carNode.position[1] - this.planetCollider + this.planetRadius();
    this.car.quaternion.set(...carNode.rotation);
    this.car.visible = true;
    this.vehicle.reset();
    this.health.start();
    this.healthRing.reset();
    this.tracker.start();
    this.meteors.clear();
    this.craters.clear();
    this.explosions.clear();
    this.clocks.start();
    this.shaker.clear();
    this.chrono = 0;
    this.clocksCollected = 0;
    this.turboLevel = 1;
    this.turboLocked = false;
    this.timeLeft = this.galaxy && this.galaxyTime ? this.galaxyTime : 60;
    this.dyingTime = 0;
    this.won = false;
    this.startDelay = bool(this.settings, 'countdown') ? 3 : 0;
    if (this.startDelay > 0) this.events.countdown?.(3);
    this.stages.start();
    this.revealKart(1);
    this.updateDifficulty();
    this.meteors.start();
    this.shrink.start(0);
    this.shrinkStep = 0;
    this.rig.adaptive = bool(this.settings, 'cameraAdaptive');
    this.rig.closeHeight = num(this.settings, 'cameraHeight');
    this.rig.closeTilt = num(this.settings, 'cameraTilt');
    this.rig.center.copy(this.planet.position);
    this.rig.radius = this.planetRadius();
    this.shaker.strength = this.rig.adaptive ? 0.3 : 1;
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
    this.shaker.clear();
    Time.timeScale = 0; // Time.timeScale = 0 : le jeu s'arrête
    this.music?.stop(); // mainCameraAudioSource.Stop()
    this.events.gameOver({ distance: this.tracker.totalDistance, time: this.chrono, stage: this.stages.stage, clocks: this.clocksCollected, victory: this.won, planets: this.galaxy?.visited });
  }

  private damage(points: number, label: string): void {
    if (this.health.takeDamage(points)) {
      this.events.message(`${label} −${points}`, 'bad');
      if (bool(this.settings, 'extraSounds')) {
        this.audio.playOneShot('sfx_crunch', 0.8, 0.9 + Math.random() * 0.2);
        this.audio.playOneShot('sfx_hurt', 0.25);
      }
    }
  }

  private bumpCooldown = 0;
  private shrinkStep = 0;
  /** Décor : cercle (voiture) contre cercle (obstacle) sur la sphère, rebond. */
  /** Décor tenu à l'écart des routes, de la lave et de l'eau (carte de surface). */
  surfaceAvoid(def: PlanetDef): ((dir: THREE.Vector3, margin: number) => boolean) | undefined {
    const sf = this.assets.planetSurfaces.get(def.id);
    if (!sf) return undefined;
    const bad = (d: THREE.Vector3) => {
      const c = sf.at(d.x, d.y, d.z);
      return c === SURF.PATH || c === SURF.LAVA || c === SURF.WATER;
    };
    const t = new THREE.Vector3();
    const b = new THREE.Vector3();
    return (d, margin) => {
      if (bad(d)) return true;
      // Quatre points autour de l'objet, à `margin` (rad)
      t.set(0, 1, 0).cross(d);
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
      t.normalize();
      b.crossVectors(d, t);
      for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = d.clone().addScaledVector(t, x * margin).addScaledVector(b, y * margin).normalize();
        if (bad(p)) return true;
      }
      return false;
    };
  }

  /**
   * Dévoilement progressif des objets de course : un type de plus à chaque
   * étape (accélérateurs d'abord), pour ne pas tout montrer d'un coup.
   */
  private revealKart(stage: number, announce = false): void {
    const kinds = this.kart.kinds();
    const progressive = bool(this.settings, 'stages');
    const n = progressive ? Math.min(kinds.length, stage) : kinds.length;
    this.kart.reveal(kinds.slice(0, n));
    const added = kinds[n - 1];
    if (announce && added && n === stage) {
      const names: Record<string, string> = { boosts: 'accélérateurs', items: 'baskets turbo', ramps: 'ressorts', spinners: 'poteaux tournoyants' };
      this.events.message(`Nouveau : ${names[added]} !`, 'info');
    }
  }

  private obstacles(): void {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - Time.deltaTime);
    for (const o of this.decor.obstacles) if (this.pushOut(o.dir, o.radius)) this.bumpFx();
    // Poteaux : rebond, un tour de toupie du côté de l'impact, accélération
    for (const p of this.kart.activePoles()) {
      const away = this.pushOut(p.dir, this.kart.poleRadius, false);
      if (!away || this.spinCd > 0) continue;
      const left = _o5.set(1, 0, 0).applyQuaternion(this.car.quaternion);
      // Poteau à gauche (la voiture est repoussée vers la droite) : toupie vers la gauche
      this.spinSign = left.dot(away) < 0 ? 1 : -1;
      this.vehicle.bump(this.spinSign * 35);
      this.spinT = SPIN_TIME;
      this.spinCd = 1.2;
      this.boostTime = Math.max(this.boostTime, 1.2);
      this.kart.hitPole(p, away.clone().applyQuaternion(_q.copy(this.planet.quaternion).invert()));
      if (bool(this.settings, 'extraSounds')) {
        this.audio.playOneShot('sfx_spin', 0.6);
        this.audio.playOneShot('sfx_crunch', 0.35, 1.4);
      }
    }
  }

  /**
   * Cercle (voiture) contre cercle (obstacle de direction `dir`, espace planète)
   * sur la sphère : repousse la voiture et renvoie la direction d'éloignement
   * (monde), ou null sans contact. `deflect` : réflexion du cap.
   */
  private pushOut(dir: THREE.Vector3, radius: number, deflect = true): THREE.Vector3 | null {
    const R = this.planetRadius();
    const up = _o1.copy(this.car.position).sub(this.planet.position).normalize();
    const d = _o2.copy(dir).applyQuaternion(this.planet.quaternion);
    const min = radius + 0.16;
    // Rejet rapide (cosinus) avant le calcul d'angle
    if (up.dot(d) < Math.cos(Math.min(Math.PI, min / R))) return null;
    const dist = up.angleTo(d) * R;
    if (dist >= min) return null;
    // Repousse la voiture hors de l'obstacle, le long de la surface
    const away = _o3.copy(up).addScaledVector(d, -up.dot(d)).normalize();
    const push = (min - dist) / R;
    const axis = _o4.crossVectors(up, away).normalize();
    const q = _q.setFromAxisAngle(axis, push);
    this.car.position.sub(this.planet.position).applyQuaternion(q).add(this.planet.position);
    this.car.quaternion.premultiply(q);
    // Réflexion du cap si la voiture fonce dans l'obstacle
    const fwd = _o5.set(0, 0, 1).applyQuaternion(this.car.quaternion);
    if (deflect && fwd.dot(away) < 0) {
      const left = _o5.set(1, 0, 0).applyQuaternion(this.car.quaternion);
      this.vehicle.bump((left.dot(away) > 0 ? -1 : 1) * 70);
    }
    return away;
  }

  private bumpFx(): void {
    if (this.bumpCooldown <= 0) {
      this.bumpCooldown = 0.4;
      if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_crunch', 0.5, 0.7);
      this.shaker.start({ enabled: true, delay: 0, duration: 0.2, space: 0, strength: [0.1, 0.1, 0.2], curve: [[0, 1, 0, -1], [1, 0, -1, 0]], shakesDelay: 0 });
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
    if (bool(s, 'modeStorm')) interval *= 0.5;
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
    this.decor.update(dt, Time.time, this.mode === 'menu' ? undefined : this.carDir);
    this.planetToonMat.userData.planetUniforms.planetTime.value = Time.realtimeSinceStartup;
    if (this.mode === 'menu') {
      this.rotatePlanet.update(dt);
      this.planet.updateMatrixWorld(true);
      if (this.title) this.updateTitle(dt);
    } else if (this.mode === 'play' && this.startDelay > 0) {
      // Compte à rebours : tout est figé (ni météores ni chrono), la caméra suit
      const before = Math.ceil(this.startDelay);
      this.startDelay = Math.max(0, this.startDelay - realDt);
      const after = Math.ceil(this.startDelay);
      if (after !== before) {
        this.events.countdown?.(after);
        if (bool(this.settings, 'extraSounds')) this.audio.playOneShot(after > 0 ? 'ui_select' : 'sfx_boost', after > 0 ? 0.6 : 0.7, after > 0 ? 1 : 1.1);
      }
      if (this.rig3d) animateVehicle(this.rig3d, Time.time, 0, false);
    } else if (this.mode === 'play' || this.mode === 'dying') {
      if (this.mode === 'play') {
        this.chrono += realDt;
        if (this.countdown && !this.launch) {
          this.timeLeft -= realDt;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.events.message('Temps écoulé !', 'bad');
            this.triggerGameOver();
          }
        }
      }
      const h = bool(this.settings, 'modeMirror') ? -input.horizontal : input.horizontal;
      if (this.launch) this.updateLaunch(dt);
      else this.gameplay(dt, { horizontal: h, turbo: input.turbo });
      if (this.mode === 'dying') {
        this.dyingTime += realDt;
        if (this.dyingTime > 1.6) this.finishGameOver();
      }
    }
    this.select.update(realDt);
    this.particles.update(dt);
    this.explosions.update(dt);
    // Temps réel : une secousse en cours se termine même jeu figé (fin de partie)
    this.shaker.update(realDt);
    // LateUpdate : caméra
    if (this.mode === 'menu') this.rig.pivot.updateMatrixWorld(true);
    else {
      if (this.launch && this.launch.phase === 'fly') this.rig.chase(this.car, this.launchUp(), realDt, this.satellite.position, this.landingCamera());
      else if (this.launch) {
        // Aspiration / toupie : la caméra suit une pose sans la rotation de la toupie
        // (qui tourne doucement du cap d'arrivée vers le cap de vol)
        const L = this.launch;
        const u = L.phase === 'pull' ? (L.t * 0.55) / 0.9 : (0.55 + L.t * 0.35) / 0.9;
        this.launchProxy.position.copy(this.car.position);
        this.launchProxy.quaternion.slerpQuaternions(L.q0, L.qs, u * u * (3 - 2 * u));
        this.launchProxy.scale.copy(this.car.scale);
        this.rig.center.copy(this.planet.position);
        this.rig.radius = this.planetRadius();
        this.rig.follow(this.launchProxy, realDt);
      }
      else {
        this.rig.center.copy(this.planet.position);
        this.rig.radius = this.planetRadius();
        this.rig.follow(this.car, realDt);
      }
    }
    this.updateSun();
  }

  private gameplay(dt: number, input: { horizontal: number; turbo: boolean }): void {
    const s = this.settings;
    const alive = this.mode === 'play';
    // Turbo (maintenu) : jauge qui se vide et se recharge
    // Jauge vide : turbo verrouillé jusqu'au relâchement et 20 % de recharge
    // (sinon il se relance par à-coups tant qu'on garde le doigt dessus)
    if (this.turboLevel <= 0.001) this.turboLocked = true;
    if (this.turboLocked && !input.turbo && this.turboLevel >= 0.2) this.turboLocked = false;
    const wantTurbo = alive && bool(s, 'turbo') && input.turbo && !this.turboLocked;
    if (wantTurbo) this.turboLevel = Math.max(0, this.turboLevel - dt / 2.5);
    else if (!wantTurbo) this.turboLevel = Math.min(1, this.turboLevel + dt / 6);
    if (wantTurbo !== this.turboActive) {
      this.turboActive = wantTurbo;
      if (wantTurbo && bool(s, 'extraSounds')) this.audio.playOneShot('sfx_whoosh', 0.7);
      if (wantTurbo && this.def.fireTrail) this.events.message('88 mph !', 'info');
    }
    this.events.turbo(this.turboLevel, this.turboActive);
    // Accélérateurs et tremplins (planètes « kart »)
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.boostCd = Math.max(0, this.boostCd - dt);
    this.hop = Math.max(0, this.hop - dt);
    this.vehicle.speedMultiplier = (this.turboActive ? 1.7 : 1) * (this.boostTime > 0 ? 1.55 : 1);
    if (bool(s, 'planetShrink') && !this.galaxy) {
      const dur = num(s, 'shrinkDuration');
      const min = num(s, 'shrinkMin');
      if (dur > 0) {
        // Arcade : rétrécissement continu et progressif jusqu'à la taille minimale
        const x = Math.min(1, Time.time / dur);
        const k = 1 - (1 - min) * x * x * (3 - 2 * x);
        this.planet.scale.setScalar(this.def.radius * k);
        const step = Math.floor((1 - k) / ((1 - min) / 4));
        if (step > this.shrinkStep) {
          this.shrinkStep = step;
          if (alive) this.events.message('La planète rétrécit !', 'info');
        }
      } else {
        this.shrink.minScale = this.def.radius * min;
        this.shrink.update(Time.time);
      }
    }
    this.planet.updateMatrixWorld(true);
    // Update() de la voiture : rayon du collider (non mis à l'échelle dans l'original)
    const radius = bool(s, 'planetShrink') || this.def.id !== 'origine' ? this.planetRadius() : this.planetCollider;
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
        if (inside && !c.inside && this.hop <= 0 && this.health.getDamagePoints(c.name) > 0) {
          this.damage(Math.round(num(s, 'craterDamage') * this.def.gameplay.craterDamage), 'Cratère');
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
    if (alive) this.kartEvents(dt);
    if (alive) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
      const Rp = this.planetRadius();
      this.toys.update(dt, this.hop > 0 ? null : this.carDir, fwd.clone().multiplyScalar(this.vehicle.speed * this.vehicle.speedMultiplier), Rp, this.vehicle.speedMultiplier > 1.3);
      const sp = this.vehicle.speed;
      this.snitch.update(dt, this.carDir, sp, Rp, this.planet.scale.x);
      this.bills.update(dt, this.carDir, sp, Rp, this.planet.scale.x);
    }
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
    this.surfaceEffects(dt, alive);
    this.healthRing.mesh.visible = String(s.healthDisplay) === 'ring' && this.mode !== 'menu' && !this.launch;
    this.healthRing.set(this.health.currentHealth / Math.max(1, this.health.maxHealth));
    this.healthRing.update(dt, Time.time);
    // Son moteur : hauteur selon le turbo ; dérapage selon le braquage
    if (this.engine === this.engineOriginal) this.engine?.setPitch(0.65 * (this.turboActive ? 1.35 : 1));
    else this.engine?.setPitch((this.turboActive ? 1.35 : 1) * (1 + 0.12 * Math.abs(this.vehicle.steer)) * this.def.gameplay.carSpeed);
    if (this.skid && bool(s, 'extraSounds')) this.skid.setVolume(Math.max(0, Math.abs(this.vehicle.steer) - 0.55) * 0.5);
  }

  /** Animation du véhicule Arcade et effets selon le sol (eau, lave). */
  private surfaceEffects(dt: number, alive: boolean): void {
    const fx = bool(this.settings, 'premiumFx');
    const up = _v.copy(this.car.position).sub(this.planet.position).normalize();
    const down = up.clone().negate();
    for (const f of this.surfaceFx) f.gravityDir = down;
    // Sol sous la voiture : direction dans l'espace du maillage de la planète
    const sf = fx && !this.launch ? this.assets.planetSurfaces.get(this.def.id) : undefined;
    if (sf) {
      const local = this.planetMesh.worldToLocal(this.car.getWorldPosition(new THREE.Vector3())).normalize();
      this.carDir.copy(local);
      this.surface = sf.at(local.x, local.y, local.z);
    } else this.surface = SURF.GROUND;
    const r = this.rig3d;
    if (r) {
      animateVehicle(r, Time.time, this.vehicle.steer, this.turboActive || this.boostTime > 0);
      if (this.spinT > 0) {
        // Un tour complet, rapide puis amorti (sens selon le côté de l'impact)
        const k = 1 - this.spinT / SPIN_TIME;
        r.body.rotation.y += this.spinSign * Math.PI * 2 * (1 - Math.pow(1 - k, 3));
      }
      // Atterrissage : écrasement puis rebond élastique
      this.landT = Math.max(0, this.landT - dt);
      const lk = 1 - this.landT / 0.5;
      const sq = this.landT > 0 ? Math.sin(lk * Math.PI * 2) * (1 - lk) * 0.35 : 0;
      r.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      // Rebonds amortis à l'arrivée sur une nouvelle planète
      if (this.landBounce > 0) {
        this.landBounce = Math.max(0, this.landBounce - dt);
        const bt = 1.1 - this.landBounce;
        r.body.position.y += 1.8 * Math.exp(-4.2 * bt) * Math.abs(Math.sin(bt * 8.5));
      }
      if (this.hop > 0) {
        // Saut : parabole (unités locales de la voiture, échelle 0,2)
        const k = 1 - this.hop / HOP_TIME;
        r.body.position.y += 5.5 * 4 * k * (1 - k);
        r.body.rotation.x -= 0.35 * Math.sin(k * Math.PI * 2) * (1 - k);
      }
      for (const t of this.thrusters) {
        t.gravityDir = down;
        t.rateScale = r === this.rigs.hover && (alive || this.launch) ? (this.turboActive || this.boostTime > 0 || this.launch ? 2.2 : 1) : 0;
        if (t.rateScale > 0 && !t.playing) t.play();
      }
    }
    const set = (ps: ParticleSystem, k: number) => {
      ps.rateScale = alive ? k : 0;
      if (ps.rateScale > 0 && !ps.playing) ps.play();
    };
    const water = this.surface === SURF.WATER;
    // Voiture (ou voiture volante qui rase l'eau) : éclaboussures ; bateau : sillage d'écume
    set(this.splash, water ? (this.turboActive ? 1.6 : 1) : 0);
    set(this.wake, water ? (this.turboActive ? 1.4 : 0.8) : 0);
    set(this.embers, this.surface === SURF.LAVA ? 1 : 0);
    set(this.leaves, this.surface === SURF.GRASS ? 0.7 : 0);
    set(this.sparkle, this.launch ? 2 : 0);
    for (const f of this.fireTrails) set(f, this.def.fireTrail && this.turboActive && fx ? 1 : 0);
    this.splashSoundCd -= dt;
    if (water && alive && this.splashSoundCd <= 0 && bool(this.settings, 'extraSounds')) {
      this.splashSoundCd = 0.45;
      this.audio.playOneShot('sfx_whoosh', 0.12, 1.6 + Math.random() * 0.3);
    }
  }

  /** Colonne de fumée noire qui monte d'un impact (position monde). */
  private smokeAt(at: THREE.Vector3): void {
    const sm = this.smokes[this.smokeIdx++ % this.smokes.length];
    if (!sm) return;
    const up = at.clone().sub(this.planet.position).normalize();
    sm.obj.position.copy(at);
    sm.obj.quaternion.setFromUnitVectors(_zAxis, up);
    sm.obj.updateMatrixWorld(true);
    sm.gravityDir = up.clone().negate();
    sm.stop(true);
    sm.play();
  }

  /** Gerbe de particules à une position monde. */
  private burstAt(at: THREE.Vector3, c: [number, number, number, number]): void {
    if (!this.toon) return;
    const b = this.bursts[this.burstIdx++ % this.bursts.length];
    b.obj.position.copy(at);
    b.obj.updateMatrixWorld(true);
    const g = b.d.main.color;
    g.minColor = g.maxColor = c;
    b.play();
  }

  /** Cubes bonus, accélérateurs, tremplins, étoile de lancement. */
  private kartEvents(dt: number): void {
    const s = this.settings;
    const carFwd = _o5.set(0, 0, 1).applyQuaternion(this.car.quaternion).applyQuaternion(_q.copy(this.planet.quaternion).invert());
    this.kart.update(dt, this.carDir, carFwd);
    const R = this.planetRadius();
    this.spinT = Math.max(0, this.spinT - dt);
    this.spinCd = Math.max(0, this.spinCd - dt);
    if (this.toon) {
      if (this.kart.padAt(this.carDir, 0.42, R) && this.boostCd <= 0) {
        this.boostTime = 1.1;
        this.boostCd = 0.6;
        if (bool(s, 'extraSounds')) {
          this.audio.playOneShot('sfx_boost', 0.7);
          this.audio.playOneShot('sfx_whoosh', 0.5, 1.2);
        }
        this.shaker.start({ enabled: true, delay: 0, duration: 0.25, space: 0, strength: [0.05, 0.05, 0.12], curve: [[0, 1, 0, -1], [1, 0, -1, 0]], shakesDelay: 0 });
      }
      const got = this.kart.collect(this.carDir, 0.42, R);
      if (got) {
        this.burstAt(this.planet.localToWorld(got.clone().multiplyScalar(this.planetCollider + 0.1)), [0.5, 0.95, 1, 1]);
        this.turboLevel = 1;
        this.turboLocked = false;
        this.events.message('Turbo plein !', 'good');
        if (bool(s, 'extraSounds')) this.audio.playOneShot('sfx_turbo_pickup', 0.7);
      }
      // Route arc-en-ciel : accélère tant qu'on roule dessus
      if (this.def.roadBoost && this.surface === SURF.PATH && this.hop <= 0) {
        if (this.boostTime <= 0 && bool(s, 'extraSounds')) this.audio.playOneShot('sfx_boost', 0.4, 1.2);
        this.boostTime = Math.max(this.boostTime, 0.35);
      }
      if (this.hop <= 0 && this.kart.springAt(this.carDir, 0.3, R)) {
        // Ressort : léger tassement puis propulsion
        this.hop = HOP_TIME;
        if (bool(s, 'extraSounds')) this.audio.playOneShot('sfx_jump', 0.7);
      }
    }
    // Voyage galactique : l'étoile de lancement apparaît quand l'objectif de la
    // planète est réussi et qu'au moins 30 m ont été parcourus dessus
    const g = this.galaxy;
    if (!g) return;
    this.launchStar.rotation.y += dt * 2.5;
    if (!g.star && g.goal && this.tracker.totalDistance - g.arrivalDist > 30) {
      // Face à la planète suivante : le vol part vers l'extérieur
      g.star = this.satellite.position.clone().sub(this.planet.position).normalize();
      if (g.star.angleTo(this.carDir) < 0.6) g.star.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.9);
      const lift = 0.35;
      this.launchStar.position.copy(g.star).multiplyScalar((R + lift) / this.planet.scale.x);
      this.launchStar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), g.star);
      this.launchStar.scale.setScalar(1 / this.planet.scale.x);
      this.launchStar.visible = true;
      this.events.message('★ Étoile de lancement ! Fonce dessus', 'info');
      if (bool(s, 'extraSounds')) this.audio.playOneShot('sfx_star', 0.8);
    }
    if (!g.star) return;
    const dist = g.star.angleTo(this.carDir) * R;
    // L'étoile attire le véhicule quand il s'approche (sinon il tourne autour sans l'atteindre)
    if (dist < 2.6) {
      const to = this.planet.localToWorld(g.star.clone().multiplyScalar(this.planetCollider)).sub(this.car.position);
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.car.quaternion);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
      const a = Math.atan2(to.dot(left), to.dot(fwd));
      const rate = (2.2 + 2.5 * (1 - dist / 2.6)) * dt;
      this.car.rotateY(Math.max(-rate, Math.min(rate, a)));
    }
    if (dist < 0.75) this.startLaunch();
  }

  /** Objets du voyage galactique : planète suivante (visuelle) et étoile de lancement. */
  private buildGalaxyObjects(): void {
    this.satellite = new THREE.Group();
    this.satMat = planetToonMaterial();
    // Même maillage que la planète, même repère relatif à sa racine
    this.planet.updateMatrixWorld(true);
    const rel = new THREE.Matrix4().copy(this.planet.matrixWorld).invert().multiply(this.planetMesh.matrixWorld);
    const m = new THREE.Mesh(this.planetMesh.geometry, this.satMat);
    m.matrixAutoUpdate = false;
    m.matrix.copy(rel);
    this.satAtmo = atmosphere(this.planetCollider);
    this.satellite.add(m, this.satAtmo);
    this.satellite.visible = false;
    this.scene.add(this.satellite);
    // Étoile dorée à cinq branches, auréole lumineuse
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.17 : 0.4;
      if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }).translate(0, 0, -0.05);
    const star = new THREE.Mesh(starGeo, new THREE.MeshToonMaterial({ color: 0xffd23a, gradientMap: toonGradient(), emissive: new THREE.Color(0xb07a10) }));
    star.position.y = 0.45;
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 0.6), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.3;
    this.launchStar = new THREE.Group();
    this.launchStar.add(star, halo);
    this.launchStar.visible = false;
    this.planet.add(this.launchStar);
  }

  /** Planète suivante dans le ciel (ou rien), dans la direction `dir` depuis la planète courante. */
  private placeSatellite(def: PlanetDef | null, dir: THREE.Vector3): void {
    this.satDef = def;
    const cubes = def ? this.assets.planetCubes.get(def.id) : undefined;
    this.satellite.visible = !!(def && cubes && bool(this.settings, 'premiumFx'));
    if (!def || !cubes) return;
    const u = this.satMat.userData.planetUniforms;
    u.planetCube.value = cubes.color;
    u.planetEmis.value = cubes.emis ?? cubes.color;
    u.emisColor.value.setRGB(def.emis ?? 0, def.emis ?? 0, def.emis ?? 0);
    u.rimColor.value.set(def.atmosphere);
    (this.satAtmo.material as THREE.ShaderMaterial).uniforms.color.value.set(def.atmosphere);
    (this.satAtmo.material as THREE.ShaderMaterial).uniforms.intensity.value = 0.6;
    this.satellite.scale.setScalar(def.radius);
    const Rn = this.planetCollider * def.radius;
    this.satellite.position.copy(this.planet.position).addScaledVector(dir.clone().normalize(), this.planetRadius() + Rn + 10);
  }

  /** Contact avec l'étoile : aspiration, élan, puis vol (inspiration « Launch Star »). */
  startLaunch(): void {
    const g = this.galaxy;
    if (!g || !this.satDef || !g.star || this.launch) return;
    this.meteors.clear();
    const up0 = g.star.clone();
    const at = this.planet.localToWorld(g.star.clone().multiplyScalar(this.planetCollider)).addScaledVector(up0, 0.45);
    // Cap de départ (avant actuel) et cap de vol (vers la planète suivante), dans le plan tangent
    const f0 = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    f0.addScaledVector(up0, -f0.dot(up0));
    if (f0.lengthSq() < 1e-6) f0.set(1, 0, 0).addScaledVector(up0, -up0.x);
    f0.normalize();
    const h0 = this.satellite.position.clone().sub(at);
    h0.addScaledVector(up0, -h0.dot(up0));
    if (h0.lengthSq() < 1e-6) h0.copy(f0);
    h0.normalize();
    // Toupie : 3 tours + l'angle qui amène le nez face au cap de vol
    let d = Math.atan2(new THREE.Vector3().crossVectors(f0, h0).dot(up0), f0.dot(h0));
    if (d < 0) d += Math.PI * 2;
    const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up0, f0).normalize(), up0, f0));
    const qs = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up0, h0).normalize(), up0, h0));
    this.launch = {
      phase: 'pull', t: 0, from: this.car.position.clone(), at, p: [], up0, up1: up0.clone(),
      q0, spin: Math.PI * 6 + d, h0, qs, qm: new THREE.Quaternion(), qe: new THREE.Quaternion(), upNow: up0.clone(), land: null,
    };
    if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_chime', 0.6, 0.9);
  }

  /** Trajectoire du vol (Bézier cubique) et orientations clés (départ, mi-vol, arrivée). */
  private planFlight(): void {
    const L = this.launch!;
    const Rn = this.planetCollider * this.satDef!.radius + this.vehicle.f.desiredDistanceFromSurface;
    const p0 = L.at.clone();
    const up1 = this.planet.position.clone().sub(this.satellite.position).normalize().addScaledVector(L.up0, 0.6).normalize();
    const p3 = this.satellite.position.clone().addScaledVector(up1, Rn);
    // Cap d'arrivée : le cap de départ ramené dans le plan tangent d'arrivée
    const h1 = L.h0.clone().addScaledVector(up1, -L.h0.dot(up1));
    if (h1.lengthSq() < 1e-4) h1.set(1, 0, 0).addScaledVector(up1, -up1.x);
    h1.normalize();
    const span = p0.distanceTo(p3);
    L.p = [p0, p0.clone().addScaledVector(L.up0, span * 0.55).addScaledVector(L.h0, span * 0.25), p3.clone().addScaledVector(up1, span * 0.4).addScaledVector(h1, -span * 0.15), p3];
    L.up1 = up1;
    const basis = (up: THREE.Vector3, f: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, f).normalize(), up, f));
    // Mi-vol : nez dans le sens du vol (rotation minimale depuis la pose de départ)
    const [a, b, c, d] = L.p;
    const midTan = c.clone().add(d).sub(a).sub(b).normalize();
    L.qm = new THREE.Quaternion().setFromUnitVectors(L.h0, midTan).multiply(L.qs);
    L.qe = basis(up1, h1);
    if (L.qm.dot(L.qs) < 0) L.qm.set(-L.qm.x, -L.qm.y, -L.qm.z, -L.qm.w);
    if (L.qe.dot(L.qm) < 0) L.qe.set(-L.qe.x, -L.qe.y, -L.qe.z, -L.qe.w);
    // Pose de caméra d'après l'atterrissage (rejointe pendant la fin du vol)
    L.land = { at: p3, up: up1, f: h1, center: this.satellite.position.clone(), radius: this.planetCollider * this.satDef!.radius };
  }

  private launchUp(): THREE.Vector3 {
    return this.launch!.upNow.clone();
  }

  /** Aspiration → élan → vol ; puis bascule sur la planète suivante. Tout est calculé (pas de lissage cumulé) : aucun tremblement. */
  private updateLaunch(dt: number): void {
    const L = this.launch!;
    const star = this.launchStar.children[0];
    const spinAt = (u: number) => _q.setFromAxisAngle(_yAxis, L.spin * (u * u * (3 - 2 * u)));
    if (L.phase === 'pull') {
      // Aspiré vers le centre de l'étoile en tournoyant
      L.t = Math.min(1, L.t + dt / 0.55);
      const e = 1 - Math.pow(1 - L.t, 3);
      this.car.position.lerpVectors(L.from, L.at, e);
      this.car.quaternion.copy(L.q0).multiply(spinAt((L.t * 0.55) / 0.9));
      this.launchStar.rotation.y += dt * (4 + 20 * e);
      if (L.t >= 1) {
        L.phase = 'wind';
        L.t = 0;
      }
    } else if (L.phase === 'wind') {
      // Élan : l'étoile se tasse puis se détend, la toupie finit face au cap de vol
      L.t = Math.min(1, L.t + dt / 0.35);
      this.car.quaternion.copy(L.q0).multiply(spinAt((0.55 + L.t * 0.35) / 0.9));
      this.launchStar.rotation.y += dt * 28;
      star.scale.set(1 + 0.25 * L.t, 1 - 0.3 * L.t, 1 + 0.25 * L.t);
      this.car.position.copy(L.at).addScaledVector(L.up0, -0.12 * L.t);
      if (L.t >= 1) {
        star.scale.set(1, 1, 1);
        this.launchStar.visible = false;
        this.galaxy!.star = null;
        this.planFlight();
        L.phase = 'fly';
        L.t = 0;
        this.rig.blendFrom(this.rig.node.getWorldPosition(new THREE.Vector3()), this.rig.node.getWorldQuaternion(new THREE.Quaternion()), 0.7);
        this.events.message('Décollage !', 'good');
        if (bool(this.settings, 'extraSounds')) {
          this.audio.playOneShot('sfx_launch', 0.9);
          this.audio.playOneShot('sfx_whoosh', 0.9, 0.7);
        }
      }
    } else {
      L.t = Math.min(1, L.t + dt / 2.6);
      // Départ rapide, arrivée très ralentie (approche en douceur) mais sans arrêt brutal
      const x = L.t;
      const t = 0.9 * (1 - Math.pow(1 - x, 2.6)) + 0.1 * x;
      const [a, b, c, d] = L.p;
      const u = 1 - t;
      this.car.position.copy(a).multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
      // Orientation : Bézier de quaternions (départ → mi-vol → arrivée), continue et lisse
      const s1 = _q.slerpQuaternions(L.qs, L.qm, t);
      const s2 = _q2.slerpQuaternions(L.qm, L.qe, t);
      const base = _q3.slerpQuaternions(s1, s2, t * t * (3 - 2 * t));
      L.upNow.set(0, 1, 0).applyQuaternion(base);
      // Tonneau (2 tours) qui démarre vite et se termine à plat avant l'arrivée
      const r = Math.min(1, Math.max(0, (x - 0.08) / 0.62));
      const roll = Math.PI * 4 * (r * r * (3 - 2 * r));
      this.car.quaternion.copy(base).multiply(_q4.setFromAxisAngle(_zAxis, roll));
      // Champ de vision élargi pendant le vol
      this.rig.flightFov = 10 * Math.sin(Math.PI * x);
      (this.satAtmo.material as THREE.ShaderMaterial).uniforms.intensity.value = 0.6 * (1 - Math.min(1, Math.max(0, (x - 0.35) / 0.35)));
      (this.atmo.material as THREE.ShaderMaterial).uniforms.intensity.value = 0.6 * Math.max(0, 1 - x / 0.2);
    }
    this.car.updateMatrixWorld(true);
    this.sparkle.gravityDir = this.launchUp().negate();
    if (this.rig3d) animateVehicle(this.rig3d, Time.time, 0, true);
    this.surfaceEffects(dt, true);
    this.clocks.update(dt, null, false);
    this.craters.update(dt, num(this.settings, 'craterLifetime'), false);
    if (L.phase === 'fly' && L.t >= 1) this.land();
  }

  /** Pose de caméra cible de fin de vol (celle du suivi après l'atterrissage). */
  private landingCamera(): { pos: THREE.Vector3; tgt: THREE.Vector3; up: THREE.Vector3; k: number } | undefined {
    const L = this.launch;
    if (!L || !L.land || !this.rig.adaptive) return undefined;
    const { pos, tgt } = this.rig.adaptivePose(L.land.at, L.land.up, L.land.f, L.land.center, L.land.radius);
    const k = Math.min(1, Math.max(0, (L.t - 0.55) / 0.45));
    return { pos, tgt, up: L.land.f, k: k * k * (3 - 2 * k) };
  }

  private land(): void {
    const g = this.galaxy!;
    const next = this.satDef!;
    const rel = this.car.position.clone().sub(this.satellite.position);
    const camPos = this.rig.node.getWorldPosition(new THREE.Vector3());
    const camQ = this.rig.node.getWorldQuaternion(new THREE.Quaternion());
    // La planète suivante prend la place de la planète courante (à l'origine)
    g.index++;
    g.visited++;
    g.goal = false;
    this.launch = null;
    this.rig.flightFov = 0;
    this.applyPlanet(next);
    this.planet.quaternion.identity();
    this.planet.updateMatrixWorld(true);
    this.craters.baseScale = next.radius;
    this.craters.clear();
    this.meteors.clear();
    this.clocks.start();
    const upN = rel.clone().normalize();
    this.car.position.copy(this.planet.position).addScaledVector(upN, this.planetRadius() + this.vehicle.f.desiredDistanceFromSurface);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    f.addScaledVector(upN, -f.dot(upN));
    if (f.lengthSq() < 1e-4) f.set(1, 0, 0).addScaledVector(upN, -upN.x);
    f.normalize();
    const x = new THREE.Vector3().crossVectors(upN, f).normalize();
    this.car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, upN, f));
    this.car.updateMatrixWorld(true);
    this.carDir.copy(upN);
    this.tracker.resync();
    g.arrivalDist = this.tracker.totalDistance;
    this.health.heal(15);
    if (this.galaxyTime > 0) this.timeLeft = Math.max(this.timeLeft, this.galaxyTime);
    // Caméra : départ de la caméra de vol (recalée sur le nouveau repère), fondu vers le suivi
    const shift = this.satellite.position.clone().sub(this.planet.position);
    this.rig.endChase();
    this.rig.follow(this.car, 0, true);
    this.rig.blendFrom(camPos.sub(shift), camQ, 0.35);
    this.landT = 0.5;
    this.landBounce = 1.1;
    this.burstAt(this.car.position.clone(), [0.9, 0.85, 0.75, 1]);
    this.events.stage?.(g.visited, next.name, this.galaxyCount > 0 ? `Planète ${g.visited} / ${this.galaxyCount}` : `Planète ${g.visited}`);
    const ang = g.index * 2.4;
    this.placeSatellite(this.resolve(this.selected, g.index + 1), new THREE.Vector3(Math.cos(ang), 0.6, Math.sin(ang)));
    if (bool(this.settings, 'extraSounds')) this.audio.playOneShot('sfx_land', 0.8);
  }

  /** Pilote automatique (tests) : braquage vers l'étoile de lancement. */
  autoSteer(): number {
    const target = this.galaxy?.star?.clone();
    if (!target) return 0;
    const to = this.planet.localToWorld(target.multiplyScalar(this.planetCollider)).sub(this.car.position);
    // +X local de la voiture = sa gauche
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.car.quaternion);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    const a = Math.atan2(to.dot(left), to.dot(fwd));
    return Math.max(-1, Math.min(1, -a * 2.5));
  }

  /** Position de l'étoile de lancement (espace planète), pour la mini-carte. */
  get starDir(): THREE.Vector3 | null {
    return this.galaxy?.star ?? null;
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
    this.select?.setAspect(w / h);
    this.viewH = h * pixelRatio;
  }

  render(): void {
    const cam = this.select.active ? this.select.camera : this.rig.camera;
    this.lights.update(cam);
    this.stars.update(cam, this.viewH, Time.realtimeSinceStartup);
    this.particles.render(cam, this.viewH);
    this.shaker.preRender(this.rig.node);
    // Carrousel des planètes : toujours sur fond d'espace étoilé
    const bg = this.scene.background;
    const bgI = this.scene.backgroundIntensity;
    if (this.select.active && this.assets.space) {
      this.scene.background = this.assets.space;
      this.scene.backgroundIntensity = 0.85;
    }
    this.post.render(this.scene, cam);
    this.scene.background = bg;
    this.scene.backgroundIntensity = bgI;
    this.shaker.postRender(this.rig.node);
  }

  /**
   * Précompilation : tous les objets (même cachés) sont rendus visibles le
   * temps de compiler leurs shaders, pour éviter les gels en cours de partie.
   */
  async precompile(): Promise<void> {
    // Chaque style de planète (toon / original) est compilé une fois
    const keep = this.def;
    if (bool(this.settings, 'premiumFx')) {
      this.applyPlanet(planetById('prairie'));
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

  /** Qualité adaptative : MSAA du rendu intermédiaire. */
  setMsaa(n: number): void {
    this.post.setSamples(n);
  }

  /** Graine aléatoire (tests déterministes). */
  seed(n: number): void {
    Random.seed(n);
  }

  carWorldPos(out = _v): THREE.Vector3 {
    return this.car.getWorldPosition(out);
  }
}
