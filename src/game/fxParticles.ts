/**
 * Systèmes de particules du préréglage Arcade décrits en code (même moteur
 * que les particules Shuriken importées) : éclaboussures, sillage, jets des
 * réacteurs, braises de lave.
 */
import * as THREE from 'three';
import type { Key, MinMaxCurve, MinMaxGradient } from '../unity/curves';
import { ParticleSystem, type SpriteLook } from '../unity/particles';
import type { ParticleData, ParticleRendererData } from '../unity/types';

const k = (v: number): MinMaxCurve => ({ mode: 0, scalar: v, minScalar: v, max: [], min: [] });
const rnd = (a: number, b: number): MinMaxCurve => ({ mode: 3, scalar: b, minScalar: a, max: [], min: [] });
const curve = (keys: [number, number][]): MinMaxCurve => ({ mode: 1, scalar: 1, minScalar: 1, max: keys.map(([t, v]) => [t, v, 0, 0] as Key), min: [] });
const col = (c: [number, number, number, number]): MinMaxGradient => ({
  mode: 0, minColor: c, maxColor: c, max: { colors: [], alphas: [], fixed: false }, min: { colors: [], alphas: [], fixed: false },
});
const fade = (colors: [number, number, number, number][], alphas: [number, number][]): MinMaxGradient => ({
  mode: 1, minColor: [1, 1, 1, 1], maxColor: [1, 1, 1, 1], max: { colors, alphas, fixed: false }, min: { colors, alphas, fixed: false },
});

function base(over: Partial<Omit<ParticleData, 'main' | 'shape'>> & { main: Partial<ParticleData['main']>; shape?: Partial<ParticleData['shape']> }): ParticleData {
  const off = { enabled: false };
  return {
    duration: 1, looping: true, prewarm: false, playOnAwake: true, simulationSpeed: 1, startDelay: k(0), worldSpace: true, scalingMode: 1, stopAction: 0,
    main: { lifetime: k(0.6), speed: k(1), size: k(0.1), size3D: false, sizeY: k(1), rotation: k(0), color: col([1, 1, 1, 1]), gravity: k(0), maxParticles: 120, randomizeRotationDirection: 0, ...over.main },
    shape: { enabled: true, type: 4, radius: 0.1, radiusThickness: 1, angle: 25, length: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], boxThickness: [0, 0, 0], randomDirection: 0, sphericalDirection: 0, alignToDirection: false, ...over.shape },
    emission: over.emission ?? { enabled: true, rate: k(30), rateOverDistance: k(0), bursts: [] },
    colorOverLifetime: over.colorOverLifetime ?? { enabled: false, gradient: col([1, 1, 1, 1]) },
    sizeOverLifetime: over.sizeOverLifetime ?? { enabled: false, curve: k(1) },
    rotationOverLifetime: { enabled: false, curve: k(0) },
    textureSheet: { enabled: false, tilesX: 1, tilesY: 1, frameOverTime: k(0), startFrame: k(0), cycles: 1, animationType: 0 },
    velocityOverLifetime: { ...off, x: k(0), y: k(0), z: k(0), radial: k(0), speedModifier: k(1), worldSpace: false },
    limitVelocity: { ...off, limit: k(1), dampen: 0, drag: k(0) },
    force: { ...off, x: k(0), y: k(0), z: k(0), worldSpace: false },
    noise: { ...off, strength: k(0), frequency: 1, scrollSpeed: k(0) },
    ...(over.duration !== undefined ? { duration: over.duration } : {}),
    ...(over.looping !== undefined ? { looping: over.looping } : {}),
  } as ParticleData;
}

const renderer = (mode = 0, maxSize = 0.3): ParticleRendererData => ({ type: 'ParticleSystemRenderer', id: 0, materials: [], renderMode: mode, velocityScale: 0.06, lengthScale: 1.2, maxParticleSize: maxSize });

/** Éclaboussures d'eau (gouttes qui jaillissent et retombent) ; avec `c`, brins d'herbe. */
export function splash(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>, c: [number, number, number, number] = [0.85, 0.95, 1, 0.95]): ParticleSystem {
  const d = base({
    main: { lifetime: rnd(0.35, 0.7), speed: rnd(2.2, 3.6), size: rnd(0.05, 0.11), gravity: k(0.9), color: col(c) },
    shape: { type: 4, angle: 35, radius: 0.25 },
    emission: { enabled: true, rate: k(70), rateOverDistance: k(0), bursts: [] },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 1], [1, 0.8, 0.95, 1]], [[0, 1], [0.7, 0.9], [1, 0]]) },
  });
  const look: SpriteLook = { rect: atlas.fx_dot, additive: false, tint: [1, 1, 1], hidden: false };
  return new ParticleSystem(obj, d, renderer(1, 0.2), look);
}

/** Sillage d'écume du bateau (nuages blancs qui s'étalent). */
export function wake(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    main: { lifetime: rnd(0.8, 1.4), speed: rnd(0.3, 0.8), size: rnd(0.25, 0.45), gravity: k(0), color: col([1, 1, 1, 0.85]), rotation: rnd(0, 6.28) },
    shape: { type: 10, radius: 0.15, angle: 0 },
    emission: { enabled: true, rate: k(28), rateOverDistance: k(0), bursts: [] },
    sizeOverLifetime: { enabled: true, curve: curve([[0, 0.5], [1, 1.6]]) },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 1], [1, 0.85, 0.95, 1]], [[0, 0.9], [1, 0]]) },
  });
  const tex = atlas['cfxr smoke cloud x4'] ?? atlas.fx_dot;
  const look: SpriteLook = { rect: [tex[0], tex[1], tex[0] + (tex[2] - tex[0]) / 2, tex[1] + (tex[3] - tex[1]) / 2], additive: false, tint: [1.1, 1.1, 1.1], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 0.4), look);
}

/** Jets lumineux des réacteurs de la voiture volante (additifs, avec bloom). */
export function thruster(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    worldSpace: true,
    main: { lifetime: rnd(0.12, 0.25), speed: rnd(1.5, 2.5), size: rnd(0.06, 0.1), color: col([0.5, 0.95, 1, 1]) },
    shape: { type: 4, angle: 8, radius: 0.04 },
    emission: { enabled: true, rate: k(40), rateOverDistance: k(0), bursts: [] },
    sizeOverLifetime: { enabled: true, curve: curve([[0, 1], [1, 0.2]]) },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 1], [1, 0.4, 0.7, 1]], [[0, 1], [1, 0]]) },
  });
  const look: SpriteLook = { rect: atlas.fx_dot, additive: true, tint: [1.4, 1.6, 1.8], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 0.15), look);
}

/** Braises soulevées en roulant sur la lave. */
export function embers(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    main: { lifetime: rnd(0.4, 0.9), speed: rnd(1.2, 2.4), size: rnd(0.04, 0.08), gravity: k(-0.15), color: col([1, 0.65, 0.2, 1]) },
    shape: { type: 4, angle: 40, radius: 0.2 },
    emission: { enabled: true, rate: k(45), rateOverDistance: k(0), bursts: [] },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 0.9, 0.5], [1, 1, 0.3, 0.05]], [[0, 1], [1, 0]]) },
  });
  const look: SpriteLook = { rect: atlas.fx_dot, additive: true, tint: [2, 1.4, 0.8], hidden: false };
  return new ParticleSystem(obj, d, renderer(1, 0.15), look);
}

/** Traînées de feu au sol (Hill Valley, turbo) : flammes immobiles qui se consument. */
export function fireTrail(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    main: { lifetime: rnd(0.6, 0.9), speed: rnd(0.05, 0.2), size: rnd(0.28, 0.4), gravity: k(-0.08), color: col([1, 0.7, 0.25, 1]), maxParticles: 220, rotation: rnd(0, 6.28) },
    shape: { type: 4, angle: 10, radius: 0.02 },
    emission: { enabled: true, rate: k(150), rateOverDistance: k(0), bursts: [] },
    sizeOverLifetime: { enabled: true, curve: curve([[0, 0.6], [0.3, 1], [1, 0.3]]) },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 0.8], [0.5, 1, 0.5, 0.1], [1, 0.6, 0.15, 0.05]], [[0, 1], [0.7, 0.8], [1, 0]]) },
  });
  const tex = atlas.CFX2_T_Glow ?? atlas.fx_dot;
  const look: SpriteLook = { rect: tex, additive: true, tint: [2.4, 1.3, 0.5], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 0.5), look);
}

/** Étincelles dorées et blanches (hors-piste de la route arc-en-ciel, vol galactique). */
export function sparkle(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    main: { lifetime: rnd(0.4, 0.9), speed: rnd(0.6, 1.6), size: rnd(0.04, 0.09), gravity: k(0.15), color: col([1, 0.95, 0.7, 1]) },
    shape: { type: 0, radius: 0.15 },
    emission: { enabled: true, rate: k(50), rateOverDistance: k(0), bursts: [] },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 1], [0.5, 1, 0.85, 0.4], [1, 0.6, 0.8, 1]], [[0, 1], [1, 0]]) },
  });
  const look: SpriteLook = { rect: atlas.fx_dot, additive: true, tint: [2.2, 2.0, 1.6], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 0.15), look);
}

/** Gerbe de ramassage (non bouclée) : étoiles et confettis colorés. */
export function burst(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>, c: [number, number, number, number] = [1, 0.9, 0.5, 1]): ParticleSystem {
  const d = base({
    looping: false,
    duration: 0.6,
    main: { lifetime: rnd(0.45, 0.9), speed: rnd(1.6, 3.4), size: rnd(0.06, 0.13), gravity: k(0.35), color: col(c), maxParticles: 80, rotation: rnd(0, 6.28) },
    shape: { type: 0, radius: 0.08 },
    emission: { enabled: true, rate: k(0), rateOverDistance: k(0), bursts: [{ time: 0, count: k(36), cycles: 1, interval: 0.01, probability: 1 }] },
    sizeOverLifetime: { enabled: true, curve: curve([[0, 1], [1, 0.2]]) },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 1, 1, 1], [1, 1, 1, 1]], [[0, 1], [0.7, 0.8], [1, 0]]) },
  });
  const look: SpriteLook = { rect: atlas.fx_dot, additive: true, tint: [2, 2, 2], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 0.2), look);
}

/**
 * Colonne de fumée noire d'un impact de météore (non bouclée) : grosses
 * bouffées qui montent, grossissent et peuvent passer devant la caméra.
 */
export function impactSmoke(obj: THREE.Object3D, atlas: Record<string, [number, number, number, number]>): ParticleSystem {
  const d = base({
    looping: false,
    duration: 3.2,
    main: { lifetime: rnd(3.2, 5.2), speed: rnd(0.45, 1.0), size: rnd(0.55, 0.95), gravity: k(-0.07), color: col([0.13, 0.12, 0.12, 0.85]), maxParticles: 90, rotation: rnd(0, 6.28) },
    shape: { type: 4, angle: 16, radius: 0.18 },
    emission: { enabled: true, rate: curve([[0, 22], [0.4, 9], [1, 0]]), rateOverDistance: k(0), bursts: [{ time: 0, count: k(8), cycles: 1, interval: 0.01, probability: 1 }] },
    sizeOverLifetime: { enabled: true, curve: curve([[0, 0.5], [0.3, 1.5], [1, 3.4]]) },
    colorOverLifetime: { enabled: true, gradient: fade([[0, 0.35, 0.3, 0.28], [0.25, 1, 1, 1], [1, 1, 1, 1]], [[0, 0], [0.06, 0.9], [0.55, 0.6], [1, 0]]) },
  });
  const tex = atlas['cfxr smoke cloud x4'] ?? atlas.fx_dot;
  const look: SpriteLook = { rect: [tex[0], tex[1], tex[0] + (tex[2] - tex[0]) / 2, tex[1] + (tex[3] - tex[1]) / 2], additive: false, tint: [1, 1, 1], hidden: false };
  return new ParticleSystem(obj, d, renderer(0, 2.5), look);
}
