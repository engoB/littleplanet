/** Contexte partagé par les scripts du jeu (évite les dépendances circulaires). */
import type * as THREE from 'three';
import type { Assets } from '../unity/assets';
import type { AudioManager } from '../unity/audio';
import type { CameraShaker } from '../unity/cfxr';
import type { LightPool } from '../unity/lights';
import type { ParticleManager } from '../unity/particles';
import type { Settings } from '../settings/store';

export interface GameContext {
  assets: Assets;
  settings: Settings;
  scene: THREE.Scene;
  particles: ParticleManager;
  lights: LightPool;
  shaker: CameraShaker;
  audio: AudioManager;
  /** Objet planète (les objets posés à sa surface en sont enfants). */
  planet: THREE.Object3D;
  /** Rayon du SphereCollider de la planète, à l'échelle courante. */
  planetRadius(): number;
}

export function num(s: Settings, k: string): number {
  return Number(s[k]);
}

export function bool(s: Settings, k: string): boolean {
  return s[k] === true;
}
