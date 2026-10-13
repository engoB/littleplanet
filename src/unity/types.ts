/** Types du fichier public/data/scene.json (voir tools/export_scene.py). */
import type { MinMaxCurve, MinMaxGradient, Key } from './curves';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Color = [number, number, number, number];

export interface ComponentData {
  type: string;
  id: number;
  enabled?: boolean;
  [k: string]: unknown;
}

export interface LightData extends ComponentData {
  lightType: 'spot' | 'directional' | 'point' | 'area';
  color: Color;
  intensity: number;
  range: number;
  shadows: number;
}

export interface CameraData extends ComponentData {
  fov: number;
  near: number;
  far: number;
  clearFlags: number;
  background: Color;
}

export interface AudioSourceData extends ComponentData {
  clip: string | null;
  volume: number;
  pitch: number;
  loop: boolean;
  playOnAwake: boolean;
}

export interface ParticleData {
  duration: number;
  looping: boolean;
  prewarm: boolean;
  playOnAwake: boolean;
  simulationSpeed: number;
  startDelay: MinMaxCurve;
  worldSpace: boolean;
  scalingMode: number;
  stopAction: number;
  main: {
    lifetime: MinMaxCurve; speed: MinMaxCurve; size: MinMaxCurve; size3D: boolean; sizeY: MinMaxCurve;
    rotation: MinMaxCurve; color: MinMaxGradient; gravity: MinMaxCurve; maxParticles: number;
    randomizeRotationDirection: number;
  };
  shape: {
    enabled: boolean; type: number; radius: number; radiusThickness: number; angle: number; length: number; arc: number;
    position: Vec3; rotation: Vec3; scale: Vec3; boxThickness: Vec3; randomDirection: number; sphericalDirection: number;
    alignToDirection: boolean;
  };
  emission: {
    enabled: boolean; rate: MinMaxCurve; rateOverDistance: MinMaxCurve;
    bursts: { time: number; count: MinMaxCurve; cycles: number; interval: number; probability: number }[];
  };
  colorOverLifetime: { enabled: boolean; gradient: MinMaxGradient };
  sizeOverLifetime: { enabled: boolean; curve: MinMaxCurve };
  rotationOverLifetime: { enabled: boolean; curve: MinMaxCurve };
  textureSheet: { enabled: boolean; tilesX: number; tilesY: number; frameOverTime: MinMaxCurve; startFrame: MinMaxCurve; cycles: number; animationType: number };
  velocityOverLifetime: { enabled: boolean; x: MinMaxCurve; y: MinMaxCurve; z: MinMaxCurve; radial: MinMaxCurve; speedModifier: MinMaxCurve; worldSpace: boolean };
  limitVelocity: { enabled: boolean; limit: MinMaxCurve; dampen: number; drag: MinMaxCurve };
  force: { enabled: boolean; x: MinMaxCurve; y: MinMaxCurve; z: MinMaxCurve; worldSpace: boolean };
  noise: { enabled: boolean; strength: MinMaxCurve; frequency: number; scrollSpeed: MinMaxCurve };
}

export interface ParticleRendererData extends ComponentData {
  materials: (string | null)[];
  renderMode: number;
  velocityScale: number;
  lengthScale: number;
  maxParticleSize: number;
}

export interface CfxrEffectData extends ComponentData {
  cameraShake: { enabled: boolean; delay: number; duration: number; space: number; strength: Vec3; curve: Key[]; shakesDelay: number };
  animatedLights: {
    light: number; loop: boolean; animateIntensity: boolean; intensityStart: number; intensityEnd: number; intensityDuration: number;
    intensityCurve: Key[]; perlinIntensity: boolean; fadeIn: boolean; fadeInDuration: number; fadeOut: boolean; fadeOutDuration: number;
  }[];
}

export interface NodeData {
  name: string;
  id: number;
  tag: string;
  layer: number;
  active: boolean;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  components: ComponentData[];
  children: NodeData[];
  model?: string;
  prefab?: string;
  materialOverride?: string[];
  castShadows?: boolean;
  rect?: { anchorMin: number[]; anchorMax: number[]; anchoredPosition: number[]; sizeDelta: number[]; pivot: number[] };
}

export interface MaterialData {
  shader: string;
  keywords: string[];
  renderQueue: number;
  textures: Record<string, { texture: string; scale: number[]; offset: number[] }>;
  floats: Record<string, number>;
  colors: Record<string, Color>;
}

export interface VolumeComponent {
  active: boolean;
  [k: string]: { override: boolean; value: unknown } | boolean;
}

export interface SceneData {
  renderSettings: {
    ambientMode: number; ambientSky: Color; ambientEquator: Color; ambientGround: Color; ambientIntensity: number;
    fog: boolean; skybox: string | null; sun: number;
  };
  roots: NodeData[];
}

export interface UnityProject {
  meta: { unityVersion: string; sourceCommit: string | null; colorSpace: string; defaultOrientation: number; productName: string };
  tags: string[];
  layers: string[];
  scenes: Record<string, SceneData>;
  prefabs: Record<string, NodeData>;
  materials: Record<string, MaterialData>;
  models: Record<string, { source: string; file: string; globalScale: number; materials?: Record<string, string | null> }>;
  audio: Record<string, { source: string; file: string }>;
}

export interface AssetsManifest {
  textures: Record<string, string | Record<string, unknown>>;
  fxAtlas: Record<string, [number, number, number, number]>;
  audio: Record<string, string>;
  fonts: Record<string, { file: string; weight?: number }>;
  planets?: Record<string, Record<string, string>>;
  space?: Record<string, string>;
  skyDb?: Record<string, string>;
  skyRed?: Record<string, string>;
  skies?: Record<string, Record<string, string>>;
  galaxyPreview?: string;
}

/** Recherche récursive d'un nœud par nom. */
export function findNode(root: NodeData, name: string): NodeData | undefined {
  if (root.name === name) return root;
  for (const c of root.children) {
    const f = findNode(c, name);
    if (f) return f;
  }
  return undefined;
}

/** Premier composant d'un type donné. */
export function getComponent<T extends ComponentData>(node: NodeData, type: string): T | undefined {
  return node.components.find((c) => c.type === type) as T | undefined;
}

/** Champs sérialisés d'un MonoBehaviour (valeurs de l'inspecteur Unity). */
export function scriptFields<T = Record<string, unknown>>(node: NodeData, script: string): T {
  const c = getComponent(node, script);
  if (!c) throw new Error(`Script ${script} absent de ${node.name}`);
  return (c.fields ?? {}) as T;
}
