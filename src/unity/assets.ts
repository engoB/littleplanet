/**
 * Chargement des données exportées (scene.json, assets.json), des modèles GLB,
 * des textures et des sons, et conversion des matériaux URP en matériaux three.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unityColorToLinear } from './curves';
import type { AssetsManifest, MaterialData, UnityProject } from './types';

export const SURF = { GROUND: 0, WATER: 1, LAVA: 2, ICE: 3, PATH: 4, GRASS: 5 } as const;
/** Valeur du pixel = classe × SURF_SCALE (tools/procedural_planets.py). */
const SURF_SCALE = 30;

/** Carte de surface d'une planète, échantillonnée par direction (espace planète). */
export class Surface {
  constructor(readonly w: number, readonly h: number, readonly data: Uint8Array) {}
  /** Classe de sol sous la direction unitaire (x, y, z) (convention du générateur : lat = asin y, lon = atan2(z, x)). */
  at(x: number, y: number, z: number): number {
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(z, x);
    const u = Math.min(this.w - 1, Math.max(0, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * this.w)));
    const v = Math.min(this.h - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * this.h)));
    return Math.round(this.data[v * this.w + u] / SURF_SCALE);
  }
}

async function loadSurface(url: string): Promise<Surface | null> {
  try {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array(c.width * c.height);
    for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
    return new Surface(c.width, c.height, out);
  } catch {
    return null;
  }
}

export class Assets {
  project!: UnityProject;
  manifest!: AssetsManifest;
  readonly models = new Map<string, THREE.Group>();
  readonly textures = new Map<string, THREE.Texture>();
  readonly materials = new Map<string, THREE.Material>();
  skybox: THREE.CubeTexture | null = null;
  /** Ciel spatial procédural (préréglage Arcade). */
  space: THREE.CubeTexture | null = null;
  /** Cubemaps des planètes toon : couleur et émission. */
  readonly planetCubes = new Map<string, { color: THREE.CubeTexture; emis: THREE.CubeTexture | null; mask: THREE.CubeTexture | null }>();
  readonly planetPreviews = new Map<string, string>();
  /** Ciel doré « au-delà » (planète du Sage). */
  skyDb: THREE.CubeTexture | null = null;
  /** Ciel rouge de forteresse. */
  skyRed: THREE.CubeTexture | null = null;
  /** Autres ciels (nuages, Halloween, Noël…). */
  readonly skies = new Map<string, THREE.CubeTexture>();
  /** Cartes de surface (équirectangulaires, classe = valeur / 50) : eau, lave, glace… */
  readonly planetSurfaces = new Map<string, Surface>();
  fxAtlas!: THREE.Texture;
  private readonly texLoader = new THREE.TextureLoader();
  /** Texture remplaçant le sol de la planète (réglage d'image perso). */
  planetOverride: THREE.Texture | null = null;

  constructor(private readonly base: string) {}

  url(path: string): string {
    return this.base + path;
  }

  /** Données exportées (scene.json, assets.json). */
  async loadData(): Promise<void> {
    const [project, manifest] = await Promise.all([
      fetch(this.url('data/scene.json')).then((r) => r.json() as Promise<UnityProject>),
      fetch(this.url('data/assets.json')).then((r) => r.json() as Promise<AssetsManifest>),
    ]);
    this.project = project;
    this.manifest = manifest;
  }

  /** Modèles, textures, skybox et atlas FX. */
  async load(onProgress: (p: number) => void): Promise<void> {
    const project = this.project;
    const manifest = this.manifest;
    const jobs: Promise<unknown>[] = [];
    let done = 0;
    const track = <T>(p: Promise<T>): Promise<T> => {
      jobs.push(p);
      return p.then((v) => {
        done++;
        onProgress(done / jobs.length);
        return v;
      });
    };
    const gltf = new GLTFLoader();
    for (const [name, m] of Object.entries(project.models)) {
      void track(gltf.loadAsync(this.url(m.file)).then((g) => {
        this.models.set(name, g.scene);
      }));
    }
    for (const [name, file] of Object.entries(manifest.textures)) {
      if (typeof file !== 'string') continue;
      void track(this.loadTexture(name, file));
    }
    for (const extra of ['crater', 'crater_n', 'planet_detail_n']) {
      void track(this.loadTexture(extra, extra + '.png', extra.endsWith('_n')));
    }
    // Planète classique (écran titre) : herbe et terre du projet Unity d'origine
    for (const extra of ['classic_grass', 'classic_dirt']) void track(this.loadTexture(extra, extra + '.jpg'));
    void track(this.texLoader.loadAsync(this.url('textures/fx_atlas.png')).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      this.fxAtlas = t;
    }));
    const sky = manifest.textures.FS000_Day_04 as Record<string, string> | undefined;
    if (sky) {
      const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((k) => this.url('textures/' + sky[k]));
      void track(new THREE.CubeTextureLoader().loadAsync(order).then((c) => {
        c.colorSpace = THREE.SRGBColorSpace;
        this.skybox = c;
      }));
    }
    const cube = (files: Record<string, string>, prefix = '', srgb = true) =>
      new THREE.CubeTextureLoader().loadAsync(['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((k) => this.url('textures/' + files[prefix + k]))).then((c) => {
        c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return c;
      });
    if (manifest.space) void track(cube(manifest.space).then((c) => (this.space = c)));
    if (manifest.skyDb) void track(cube(manifest.skyDb).then((c) => (this.skyDb = c)));
    if (manifest.skyRed) void track(cube(manifest.skyRed).then((c) => (this.skyRed = c)));
    for (const [name, files] of Object.entries(manifest.skies ?? {})) void track(cube(files).then((c) => this.skies.set(name, c)));
    if (manifest.galaxyPreview) this.planetPreviews.set('galaxie', this.url('textures/' + manifest.galaxyPreview));
    for (const [id, files] of Object.entries(manifest.planets ?? {})) {
      this.planetPreviews.set(id, this.url('textures/' + files.preview));
      if (files.surface) void track(loadSurface(this.url('textures/' + files.surface)).then((sf) => sf && this.planetSurfaces.set(id, sf)));
      void track(
        Promise.all([cube(files), files.e_px ? cube(files, 'e_', false) : Promise.resolve(null), files.m_px ? cube(files, 'm_', false) : Promise.resolve(null)]).then(([color, emis, mask]) => {
          this.planetCubes.set(id, { color, emis, mask });
        }),
      );
    }
    await Promise.all(jobs);
  }

  private async loadTexture(name: string, file: string, linear = false): Promise<void> {
    let t: THREE.Texture;
    try {
      t = await this.texLoader.loadAsync(this.url('textures/' + file));
    } catch {
      console.warn('Texture absente', file);
      return;
    }
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    this.textures.set(name, t);
  }

  /** Données brutes d'un matériau Unity. */
  materialData(name: string): MaterialData | undefined {
    return this.project.materials[name];
  }

  /**
   * Matériau three équivalent d'un matériau URP Lit :
   * _BaseMap/_BaseColor → map/color, _Smoothness → 1 − roughness,
   * _Metallic, émission (_EmissionMap × _EmissionColor), surface
   * transparente (_Surface = 1).
   */
  material(name: string | null | undefined): THREE.Material {
    const key = name ?? 'missing';
    const cached = this.materials.get(key);
    if (cached) return cached;
    const d = name ? this.project.materials[name] : undefined;
    let mat: THREE.Material;
    if (!d) {
      // Matériau manquant dans le projet Unity (rose « magenta » chez Unity)
      mat = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.6, name: key });
    } else {
      const c = d.colors._BaseColor ?? d.colors._Color ?? [1, 1, 1, 1];
      const [r, g, b] = unityColorToLinear(c);
      const m = new THREE.MeshStandardMaterial({ name: key });
      m.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      m.roughness = 1 - (d.floats._Smoothness ?? d.floats._Glossiness ?? 0.5);
      m.metalness = d.floats._Metallic ?? 0;
      const tex = d.textures._BaseMap ?? d.textures._MainTex;
      if (tex && this.textures.has(tex.texture)) {
        const t = this.textures.get(tex.texture)!.clone();
        t.repeat.set(tex.scale[0], tex.scale[1]);
        t.offset.set(tex.offset[0], tex.offset[1]);
        m.map = t;
      }
      const em = d.textures._EmissionMap;
      const ec = d.colors._EmissionColor;
      // URP n'émet que si le mot-clé _EMISSION est actif (Planete.mat a une
      // carte d'émission mais pas le mot-clé : pas d'émission chez Unity)
      const urp = d.shader === 'URP/Lit';
      if (ec && (ec[0] > 0 || ec[1] > 0 || ec[2] > 0) && (urp ? d.keywords.includes('_EMISSION') : !!em)) {
        const [er, eg, eb] = unityColorToLinear(ec);
        m.emissive.setRGB(er, eg, eb, THREE.LinearSRGBColorSpace);
        if (em && this.textures.has(em.texture)) m.emissiveMap = this.textures.get(em.texture)!;
      }
      if (d.floats._Surface === 1) {
        m.transparent = true;
        m.opacity = c[3];
        m.depthWrite = false;
        if (d.floats._Blend === 1) m.blending = THREE.AdditiveBlending;
      }
      m.side = d.floats._Cull === 0 ? THREE.DoubleSide : THREE.FrontSide;
      mat = m;
    }
    this.materials.set(key, mat);
    return mat;
  }

  /** Premier maillage d'un modèle (MeshFilter Unity : maillage sans transform de nœud). */
  firstMesh(model: string): THREE.Mesh {
    let found: THREE.Mesh | null = null;
    this.models.get(model)?.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('Pas de maillage dans ' + model);
    return found;
  }

  /** Échelle d'import Unity (globalScale × facteur d'unité déjà appliqué par FBX2glTF). */
  importScale(model: string): number {
    return this.project.models[model]?.globalScale ?? 1;
  }
}
