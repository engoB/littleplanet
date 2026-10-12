/**
 * Chargement des données exportées (scene.json, assets.json), des modèles GLB,
 * des textures et des sons, et conversion des matériaux URP en matériaux three.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unityColorToLinear } from './curves';
import type { AssetsManifest, MaterialData, UnityProject } from './types';

export class Assets {
  project!: UnityProject;
  manifest!: AssetsManifest;
  readonly models = new Map<string, THREE.Group>();
  readonly textures = new Map<string, THREE.Texture>();
  readonly materials = new Map<string, THREE.Material>();
  skybox: THREE.CubeTexture | null = null;
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
