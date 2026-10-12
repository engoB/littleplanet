/**
 * Planètes jouables (src/game/planets.json), déblocage et records par planète.
 */
import data from './planets.json';
import type { TrackDef } from './track';

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
  sky?: 'space' | 'db' | 'day' | 'original' | 'red';
  /** Véhicule du préréglage Arcade. */
  vehicle?: 'original' | 'hover';
  /** Couleur des réticules de chute de météore (lisibilité selon le sol). */
  reticle?: string;
  /** Planète circuit : piste, hors-piste, accélérateurs, cubes bonus, tremplins. */
  track?: TrackDef;
  /** Intensité de la carte d'émission RVB (route arc-en-ciel, lave, lanternes). */
  emis?: number;
  /** Taille minimale propre à la planète quand elle rétrécit. */
  shrink?: number;
  /** Voyage galactique : planètes visitées l'une après l'autre. */
  galaxy?: string[];
  /** Hill Valley : traînées de feu au sol en turbo. */
  fireTrail?: boolean;
  /** Rendu en gros pixels (filtrage « nearest »). */
  pixel?: boolean;
}

export const PLANETS: PlanetDef[] = (data as { planets: PlanetDef[] }).planets;

export function planetById(id: string | null | undefined): PlanetDef {
  return PLANETS.find((p) => p.id === id) ?? PLANETS[0];
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
  return get(SEL) ?? 'prairie';
}

export function selectPlanet(id: string): void {
  set(SEL, id);
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
