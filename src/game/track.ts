/**
 * Pistes des planètes « circuit » : une boucle sinueuse autour de la planète,
 * décrite dans le repère de départ (la voiture part de (0, 1, 0) vers +Z).
 * Latitude de l'axe de la piste : f(φ) = a·sin 2φ + b·sin 3φ + c·sin 5φ.
 * Même formule que tools/procedural_planets.py (track_fields).
 */
import * as THREE from 'three';

export interface TrackDef {
  wave: number[];
  /** Demi-largeur (radians). */
  width: number;
  /** Abscisses φ des accélérateurs, des cubes bonus et des tremplins. */
  boosts: number[];
  items: number[];
  ramps: number[];
  /** Vitesse hors piste (× vitesse). */
  offroad: number;
  offroadFx: 'grass' | 'mud' | 'water' | 'dust' | 'stars';
  /** Arche de départ. */
  arch?: boolean;
}

const E1 = new THREE.Vector3(0, 1, 0);
const E2 = new THREE.Vector3(0, 0, 1);
const N = new THREE.Vector3(1, 0, 0);

function wave(t: TrackDef, phi: number): [number, number] {
  const [a = 0, b = 0, c = 0] = t.wave;
  return [
    a * Math.sin(2 * phi) + b * Math.sin(3 * phi) + c * Math.sin(5 * phi),
    2 * a * Math.cos(2 * phi) + 3 * b * Math.cos(3 * phi) + 5 * c * Math.cos(5 * phi),
  ];
}

/** Distance signée à l'axe (radians) et abscisse φ d'une direction unitaire (espace planète). */
export function trackFields(t: TrackDef, d: THREE.Vector3): { dist: number; phi: number } {
  const phi = Math.atan2(d.dot(E2), d.dot(E1));
  const lat = Math.asin(Math.max(-1, Math.min(1, d.dot(N))));
  const [f, fp] = wave(t, phi);
  const cl = Math.cos(lat);
  return { dist: ((lat - f) * cl) / Math.sqrt(fp * fp + cl * cl), phi };
}

/** Direction (espace planète) d'un point de la piste ; `lateral` : décalage (radians) vers ±N. */
export function trackPoint(t: TrackDef, phi: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const lat = wave(t, phi)[0] + lateral;
  out.copy(E1).multiplyScalar(Math.cos(phi)).addScaledVector(E2, Math.sin(phi));
  return out.multiplyScalar(Math.cos(lat)).addScaledVector(N, Math.sin(lat)).normalize();
}

/** Direction de la piste (tangente unitaire, sens de la course) en un point. */
export function trackTangent(t: TrackDef, phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = trackPoint(t, phi - 0.002, 0, new THREE.Vector3());
  const b = trackPoint(t, phi + 0.002, 0, out);
  return b.sub(a).normalize();
}
