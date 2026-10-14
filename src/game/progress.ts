/**
 * Progression classique (Arcade) : les mondes se débloquent l'un après
 * l'autre (3 objectifs réussis sur le précédent) ; débloquer le dernier
 * ouvre les défis (Chrono d'abord) et le voyage galactique ; les autres défis
 * s'ouvrent en décrochant des succès.
 */
import { PLANETS, type PlanetDef } from './planets';

/** Bilan d'une partie (fin de partie). */
export interface RunStats {
  distance: number;
  time: number;
  stage: number;
  clocks: number;
  victory?: boolean;
  planets?: number;
  decor?: number;
  orbit?: number;
}

interface Stats {
  distance: number;
  clocks: number;
  decor: number;
  orbit: number;
  bestTime: number;
  voyages: number;
}

interface Save {
  /** Objectifs réussis au mieux, par monde. */
  goals: Record<string, number>;
  stats: Stats;
  trophies: string[];
}

export interface Trophy {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** Défi débloqué par ce succès. */
  unlocks?: string;
  test: (p: Save) => boolean;
}

/** Objectifs à réussir sur un monde pour débloquer le suivant. */
export const GOALS = 3;

const KEY = 'mpp.progress.v2';
/** Version de la progression : une version plus récente repart de 0 %. */
const VERSION_KEY = 'mpp.progress.version';
const VERSION = '13';

/** Mondes de la progression, dans l'ordre du carrousel. */
export const WORLDS: PlanetDef[] = PLANETS.filter((p) => p.style !== 'galaxy' && !p.hidden);

export const TROPHIES: Trophy[] = [
  { id: 'first', name: 'Premiers tours', desc: 'Réussir un premier objectif', icon: '🏁', test: (p) => Object.values(p.goals).some((g) => g >= 1) },
  { id: 'world', name: 'Monde conquis', desc: `Réussir ${GOALS} objectifs sur un monde`, icon: '🌍', test: (p) => Object.values(p.goals).some((g) => g >= GOALS) },
  { id: 'last', name: 'Bout de la galaxie', desc: 'Débloquer le dernier monde', icon: '🌌', unlocks: 'modeTimeAttack', test: () => lastUnlocked() },
  { id: 'survivor', name: 'Survivant', desc: 'Tenir 2 minutes dans une partie', icon: '⏱️', unlocks: 'modeStorm', test: (p) => p.stats.bestTime >= 120 },
  { id: 'trotter', name: 'Globe-trotteur', desc: 'Parcourir 2 000 m au total', icon: '🛣️', unlocks: 'modeMirror', test: (p) => p.stats.distance >= 2000 },
  { id: 'collector', name: 'Collectionneur', desc: 'Ramasser 30 bonus de soin', icon: '🧰', unlocks: 'modeSnitch', test: (p) => p.stats.clocks >= 30 },
  { id: 'voyager', name: 'Grand voyageur', desc: 'Réussir un voyage galactique', icon: '🚀', unlocks: 'modeBullet', test: (p) => p.stats.voyages >= 1 },
  { id: 'wrecker', name: 'Démolisseur', desc: 'Détruire 10 éléments de décor', icon: '💥', test: (p) => p.stats.decor >= 10 },
  { id: 'orbit', name: 'Lanceur d’orbite', desc: 'Envoyer 10 objets en orbite', icon: '🛰️', test: (p) => p.stats.orbit >= 10 },
  { id: 'champion', name: 'Champion', desc: `Réussir ${GOALS} objectifs sur tous les mondes`, icon: '🏆', test: (p) => WORLDS.every((w) => (p.goals[w.id] ?? 0) >= GOALS) },
];

const empty = (): Save => ({ goals: {}, stats: { distance: 0, clocks: 0, decor: 0, orbit: 0, bestTime: 0, voyages: 0 }, trophies: [] });

let cache: Save | null = null;
function load(): Save {
  if (cache) return cache;
  const s = empty();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Save>;
    Object.assign(s.goals, raw.goals ?? {});
    Object.assign(s.stats, raw.stats ?? {});
    s.trophies = Array.isArray(raw.trophies) ? raw.trophies : [];
  } catch {
    /* données illisibles ou stockage indisponible : progression vierge */
  }
  cache = s;
  return s;
}
function save(s: Save): void {
  cache = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}

/** Tout débloquer (réglage « Toutes les planètes débloquées », tests). */
let all = false;
export function setUnlockAll(v: boolean): void {
  all = v;
}

export function goalsOf(id: string): number {
  return load().goals[id] ?? 0;
}

export function isUnlocked(p: PlanetDef): boolean {
  if (all) return true;
  const i = WORLDS.indexOf(p);
  if (i <= 0) return true;
  return goalsOf(WORLDS[i - 1].id) >= GOALS;
}

/** Monde précédent à réussir pour débloquer `p` (null s'il est ouvert). */
export function unlockHint(p: PlanetDef): string | null {
  if (isUnlocked(p)) return null;
  const prev = WORLDS[WORLDS.indexOf(p) - 1];
  return `🔒 Réussis ${GOALS} objectifs sur ${prev.name}`;
}

function lastUnlocked(): boolean {
  return isUnlocked(WORLDS[WORLDS.length - 1]);
}

/** Défis et voyage galactique : ouverts une fois le dernier monde débloqué. */
export function voyageUnlocked(): boolean {
  return all || lastUnlocked();
}

export function hasTrophy(id: string): boolean {
  return load().trophies.includes(id);
}

/** Un défi est-il ouvert ? Chrono avec le dernier monde, les autres avec leur succès. */
export function defiUnlocked(key: string): boolean {
  if (all) return true;
  if (!lastUnlocked()) return false;
  const t = TROPHIES.find((x) => x.unlocks === key);
  return !t || hasTrophy(t.id);
}

/** Comment débloquer un défi (texte d'aide). */
export function defiHint(key: string): string {
  if (!lastUnlocked()) return `Débloque le dernier monde (${WORLDS[WORLDS.length - 1].name}) pour ouvrir les défis`;
  const t = TROPHIES.find((x) => x.unlocks === key);
  return t ? `Succès « ${t.name} » : ${t.desc.toLowerCase()}` : '';
}

/** Succès décrochés (dans l'ordre de la liste). */
export function trophies(): { t: Trophy; got: boolean }[] {
  const got = load().trophies;
  return TROPHIES.map((t) => ({ t, got: got.includes(t.id) }));
}

/** Avancement global (0 → 1) : mondes réussis et succès. */
export function completion(): number {
  const p = load();
  const w = WORLDS.reduce((a, x) => a + Math.min(GOALS, p.goals[x.id] ?? 0), 0) / (WORLDS.length * GOALS);
  return (w * 2 + p.trophies.length / TROPHIES.length) / 3;
}

/**
 * Enregistre une partie : objectifs du monde, statistiques cumulées.
 * Renvoie les mondes, défis et succès nouvellement débloqués.
 */
export function recordRun(def: PlanetDef, r: RunStats): { worlds: PlanetDef[]; trophies: Trophy[]; voyage: boolean } {
  const p = load();
  const before = WORLDS.filter((w) => isUnlocked(w));
  const voyageBefore = voyageUnlocked();
  if (def.style !== 'galaxy') p.goals[def.id] = Math.max(p.goals[def.id] ?? 0, r.stage - 1);
  p.stats.distance += r.distance;
  p.stats.clocks += r.clocks;
  p.stats.decor += r.decor ?? 0;
  p.stats.orbit += r.orbit ?? 0;
  p.stats.bestTime = Math.max(p.stats.bestTime, r.time);
  if (r.victory) p.stats.voyages++;
  cache = p;
  const won: Trophy[] = [];
  for (const t of TROPHIES) {
    if (!p.trophies.includes(t.id) && t.test(p)) {
      p.trophies.push(t.id);
      won.push(t);
    }
  }
  save(p);
  return { worlds: WORLDS.filter((w) => isUnlocked(w) && !before.includes(w)), trophies: won, voyage: !voyageBefore && voyageUnlocked() };
}

/** Efface la progression (mondes, succès, statistiques). */
export function clearProgress(): void {
  cache = empty();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Nouvelle version de la progression : on repart de 0 % une seule fois.
 * Renvoie vrai si la progression a été remise à zéro.
 */
export function migrateProgress(reset: () => void): boolean {
  try {
    if (localStorage.getItem(VERSION_KEY) === VERSION) return false;
    reset();
    clearProgress();
    localStorage.setItem(VERSION_KEY, VERSION);
    return true;
  } catch {
    return false;
  }
}
