/**
 * Stockage des réglages (localStorage) et des images perso (IndexedDB).
 * Les valeurs absentes prennent celles du préréglage choisi ; appliquer un
 * préréglage efface les valeurs enregistrées (sinon d'anciennes valeurs
 * masqueraient les nouveaux défauts).
 */
import { SCHEMA, type Preset } from './schema';

const KEY = 'mpp.settings.v1';
const PRESET_KEY = 'mpp.preset.v1';

export type Settings = Record<string, number | boolean | string | null>;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

export function currentPreset(): Preset {
  return safeGet(PRESET_KEY) === 'original' ? 'original' : 'arcade';
}

export function defaults(preset: Preset): Settings {
  const s: Settings = {};
  for (const d of SCHEMA) s[d.key] = d[preset];
  return s;
}

export function loadSettings(): Settings {
  const s = defaults(currentPreset());
  try {
    const saved = JSON.parse(safeGet(KEY) ?? '{}') as Settings;
    for (const d of SCHEMA) if (d.key in saved) s[d.key] = saved[d.key];
  } catch {
    /* valeurs corrompues : défauts */
  }
  return s;
}

export function saveSetting(key: string, value: Settings[string]): void {
  let saved: Settings = {};
  try {
    saved = JSON.parse(safeGet(KEY) ?? '{}') as Settings;
  } catch {
    saved = {};
  }
  saved[key] = value;
  safeSet(KEY, JSON.stringify(saved));
}

export function applyPreset(preset: Preset): void {
  safeSet(PRESET_KEY, preset);
  safeSet(KEY, null);
}

/** Paramètre d'URL ?preset=original|arcade (tests) : non persistant. */
export function settingsFromUrl(base: Settings): Settings {
  const q = new URLSearchParams(location.search);
  const p = q.get('preset');
  const s = p === 'original' || p === 'arcade' ? defaults(p) : base;
  for (const d of SCHEMA) {
    const v = q.get(d.key);
    if (v === null) continue;
    s[d.key] = d.type === 'bool' ? v === '1' || v === 'true' : d.type === 'number' ? Number(v) : v;
  }
  return s;
}

// --- Images perso (IndexedDB)
const DB = 'mpp-images';
function db(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export async function saveImage(key: string, blob: Blob | null): Promise<void> {
  const d = await db();
  await new Promise<void>((ok, ko) => {
    const tx = d.transaction('images', 'readwrite');
    if (blob) tx.objectStore('images').put(blob, key);
    else tx.objectStore('images').delete(key);
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error);
  });
}

export async function loadImage(key: string): Promise<Blob | null> {
  try {
    const d = await db();
    return await new Promise((ok, ko) => {
      const r = d.transaction('images').objectStore('images').get(key);
      r.onsuccess = () => ok((r.result as Blob | undefined) ?? null);
      r.onerror = () => ko(r.error);
    });
  } catch {
    return null;
  }
}

// --- Records (HighScoreManager : 3 meilleures distances)
const REC = 'mpp.records.v1';
export interface RecordEntry {
  distance: number;
  time: number;
  date: string;
  preset: Preset;
}

export function loadRecords(): RecordEntry[] {
  try {
    return (JSON.parse(safeGet(REC) ?? '[]') as RecordEntry[]).slice(0, 3);
  } catch {
    return [];
  }
}

/** CheckForHighScore : insère et décale (3 places). Renvoie le rang (1..3) ou 0. */
export function submitRecord(e: RecordEntry): number {
  const list = loadRecords();
  let rank = 0;
  for (let i = 0; i < 3; i++) {
    if (!list[i] || e.distance > list[i].distance) {
      list.splice(i, 0, e);
      rank = i + 1;
      break;
    }
  }
  safeSet(REC, JSON.stringify(list.slice(0, 3)));
  return rank;
}
