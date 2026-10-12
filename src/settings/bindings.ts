/**
 * Valeurs « original » lues dans public/data/scene.json (valeurs de
 * l'inspecteur Unity) : rien n'est retapé à la main. Les valeurs littérales
 * du schéma ne servent que de repli si les données ne sont pas chargées.
 * `same: true` : la valeur Arcade est identique à l'original.
 */
import type { UnityProject, NodeData } from '../unity/types';
import { findNode, getComponent } from '../unity/types';
import { SCHEMA } from './schema';

type Fields = Record<string, unknown>;

function script(p: UnityProject, scene: string, go: string, cls: string): Fields | undefined {
  for (const r of p.scenes[scene]?.roots ?? []) {
    const n = findNode(r, go);
    const c = n && getComponent(n, cls);
    if (c) return (c.fields ?? {}) as Fields;
  }
  return undefined;
}

function prefab(p: UnityProject, name: string): NodeData | undefined {
  return p.prefabs[name];
}

const BINDINGS: Record<string, { get: (p: UnityProject) => unknown; same: boolean }> = {
  carSpeed: { get: (p) => script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'VehicleController')?.speed, same: true },
  steerSpeed: {
    get: (p) => {
      const f = script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'VehicleController');
      return f ? Number(f.rotationSpeed) * Number(f.rotationMultiplier) : undefined;
    },
    same: true,
  },
  steerFatigue: { get: (p) => script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'VehicleController')?.maxDirectionDuration, same: false },
  maxHealth: { get: (p) => script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'HealthManager')?.maxHealth, same: true },
  craterDamage: {
    get: (p) => (script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'HealthManager')?.damageItems as { itemName: string; damagePoints: number }[] | undefined)?.find((d) => d.itemName === 'Crater')?.damagePoints,
    same: true,
  },
  meteorDamage: {
    get: (p) => (script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'HealthManager')?.damageItems as { itemName: string; damagePoints: number }[] | undefined)?.find((d) => d.itemName.startsWith('meteor'))?.damagePoints,
    same: true,
  },
  meteorSpeed: { get: (p) => script(p, 'SampleScene', 'MeteorSpawner', 'MeteorSpawner')?.meteorSpeed, same: true },
  clockInterval: { get: (p) => script(p, 'SampleScene', 'CollectibleSpawner ', 'CollectibleSpawner')?.spawnRate, same: true },
  clockMax: { get: (p) => script(p, 'SampleScene', 'CollectibleSpawner ', 'CollectibleSpawner')?.maxSpawnsPerGame, same: false },
  clockLifetime: { get: (p) => script(p, 'SampleScene', 'CollectibleSpawner ', 'CollectibleSpawner')?.collectibleLifetime, same: true },
  clockHeal: {
    get: (p) => (script(p, 'SampleScene', 'Cartoon_SportCar_B01', 'HealthManager')?.healItems as { healPoints: number }[] | undefined)?.[0]?.healPoints,
    same: true,
  },
  musicVolume: {
    get: (p) => {
      const cam = p.scenes.SampleScene.roots.map((r) => findNode(r, 'Main Camera')).find(Boolean);
      return cam ? (getComponent(cam, 'AudioSource') as { volume?: number } | undefined)?.volume : undefined;
    },
    same: false,
  },
  loopMusic: {
    get: (p) => {
      const cam = p.scenes.SampleScene.roots.map((r) => findNode(r, 'Main Camera')).find(Boolean);
      return cam ? (getComponent(cam, 'AudioSource') as { loop?: boolean } | undefined)?.loop : undefined;
    },
    same: false,
  },
  craterStyle: { get: (p) => (prefab(p, 'Crater') ? 'box' : undefined), same: false },
};

/** Remplace les valeurs « original » (et « arcade » identiques) par celles du projet Unity. */
export function bindSchemaToProject(p: UnityProject): void {
  for (const def of SCHEMA) {
    const b = BINDINGS[def.key];
    if (!b) continue;
    const v = b.get(p);
    if (v === undefined || v === null) continue;
    def.original = v as typeof def.original;
    if (b.same) def.arcade = v as typeof def.arcade;
  }
}

export const BOUND_KEYS = Object.keys(BINDINGS);
