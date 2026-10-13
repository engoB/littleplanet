/**
 * Planètes jouables (src/game/planets.json), déblocage et records par planète.
 */
import data from './planets.json';
import type { KartDef } from './KartProps';

export interface PlanetDef {
  id: string;
  name: string;
  tagline: string;
  difficulty: number;
  style: 'original' | 'toon' | 'galaxy';
  /** Planète nocturne : sol sombre, voiture et impacts lumineux. */
  neon?: boolean;
  radius: number;
  unlock: { planet: string; distance: number } | null;
  atmosphere: string;
  palette?: Record<string, string>;
  pattern?: string;
  decorColors?: { trunk: string; canopy: string[]; rock: string; house: string; roof: string; [extra: string]: string | string[] | undefined };
  gameplay: { meteorInterval: number; meteorSpeed: number; clockInterval: number; carSpeed: number; grip: number; craterDamage: number };
  decor: { trees: number; rocks: number; houses: number; [kind: string]: number | undefined };
  /** Ciel : espace, ciel doré façon « au-delà », ciel de jour ou celui d'origine. */
  sky?: string;
  /** Véhicule du préréglage Arcade. */
  vehicle?: 'original' | 'hover';
  /** Couleur des réticules de chute de météore (lisibilité selon le sol). */
  reticle?: string;
  /** Planète « kart » : accélérateurs, cubes bonus et tremplins éparpillés (aucune piste). */
  kart?: KartDef;
  /** Intensité de la carte d'émission RVB (route arc-en-ciel, lave, lanternes). */
  emis?: number;
  /** Voyage galactique : planètes visitées l'une après l'autre. */
  galaxy?: string[];
  /** Objets bousculables : { type: nombre } (ball, blockA/B/C, pumpkin, gift, hay, beachball, cone, fence). */
  toys?: Record<string, number>;
  /** Planète de verre : seule la route est opaque (masque d'opacité). */
  glass?: boolean;
  /** Rouler sur la route (surface « chemin ») donne un coup d'accélérateur. */
  roadBoost?: boolean;
  /** Hill Valley : traînées de feu au sol en turbo. */
  fireTrail?: boolean;
  /** Rendu en gros pixels (filtrage « nearest »). */
  pixel?: boolean;
}

export const PLANETS: PlanetDef[] = (data as { planets: PlanetDef[] }).planets;

/** Monde 1 : premier monde du carrousel (sélection par défaut). */
export const FIRST: PlanetDef = PLANETS.find((p) => p.style !== 'galaxy') ?? PLANETS[0];

export function planetById(id: string | null | undefined): PlanetDef {
  return PLANETS.find((p) => p.id === id) ?? FIRST;
}

const SEL = 'mpp.planet.v1';
const BEST = 'mpp.best.v1';

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible */
  }
}

export function selectedPlanet(): string {
  return get(SEL) ?? FIRST.id;
}

export function selectPlanet(id: string): void {
  set(SEL, id);
}

const DEFIS = 'mpp.defis.v1';

/** Défis choisis pour un monde (null : jamais réglé). */
export function worldChallenges(id: string): string[] | null {
  try {
    const all = JSON.parse(get(DEFIS) ?? '{}') as Record<string, string[]>;
    return Array.isArray(all[id]) ? all[id] : null;
  } catch {
    return null;
  }
}

export function setWorldChallenges(id: string, keys: string[]): void {
  let all: Record<string, string[]> = {};
  try {
    all = JSON.parse(get(DEFIS) ?? '{}');
  } catch {
    /* données illisibles : on repart de zéro */
  }
  all[id] = keys;
  set(DEFIS, JSON.stringify(all));
}

export function bestDistances(): Record<string, number> {
  try {
    return JSON.parse(get(BEST) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Enregistre la distance ; renvoie les planètes nouvellement débloquées. */
export function recordDistance(planet: string, distance: number): PlanetDef[] {
  const before = PLANETS.filter((p) => isUnlocked(p, false));
  const b = bestDistances();
  if (distance > (b[planet] ?? 0)) {
    b[planet] = distance;
    set(BEST, JSON.stringify(b));
  }
  return PLANETS.filter((p) => isUnlocked(p, false) && !before.includes(p));
}

export function isUnlocked(p: PlanetDef, all: boolean): boolean {
  if (all || !p.unlock) return true;
  return (bestDistances()[p.unlock.planet] ?? 0) >= p.unlock.distance;
}
