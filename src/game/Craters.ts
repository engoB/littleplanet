/**
 * Cratères (prefab « Crater ») : cube mis à l'échelle, orienté selon la
 * normale d'impact (Quaternion.LookRotation(normal)), trigger de dégâts.
 * Rendu par InstancedMesh (un seul appel de dessin pour tous les cratères).
 * Style « box » : le cube de l'original ; style « decal » : brûlure au sol.
 */
import * as THREE from 'three';
import { getComponent, type NodeData } from '../unity/types';
import { lookRotation } from '../unity/math';
import { makeOBB, type OBB } from './collision';
import type { GameContext } from './context';

export interface Crater {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  quat: THREE.Quaternion;
  age: number;
  obb: OBB;
  /** Le joueur est-il dans le trigger (front montant OnTriggerEnter) ? */
  inside: boolean;
  name: string;
}

const MAX = 400;
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Craters {
  readonly list: Crater[] = [];
  readonly mesh: THREE.InstancedMesh;
  readonly size: THREE.Vector3;
  readonly boxSize: number[];
  readonly name: string;
  private readonly style: 'box' | 'decal';
  /** Échelle de base de la planète (taille de la planète choisie). */
  baseScale = 1;
  /** Incandescence de l'impact : lueur orange qui s'éteint en ~1,6 s (préréglage Arcade). */
  heatGlow = false;
  private readonly heat: THREE.InstancedMesh | null = null;

  constructor(private readonly ctx: GameContext, prefab: NodeData, style: 'box' | 'decal') {
    this.name = prefab.name + '(Clone)';
    this.size = new THREE.Vector3(...prefab.scale);
    const box = getComponent<{ type: string; id: number; size: number[] }>(prefab, 'BoxCollider');
    this.boxSize = box?.size ?? [1, 1, 1];
    this.style = style;
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    if (style === 'box') {
      geo = new THREE.BoxGeometry(1, 1, 1);
      const r = getComponent<{ type: string; id: number; materials: (string | null)[] }>(prefab, 'MeshRenderer');
      const name = r?.materials[0];
      // Matériau absent du dépôt Unity : remplacé par un brun sombre (voir README)
      mat = name && !name.startsWith('missing') ? ctx.assets.material(name) : new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.95 });
    } else {
      geo = new THREE.CircleGeometry(0.5, 20);
      const m = new THREE.MeshStandardMaterial({
        map: ctx.assets.textures.get('crater') ?? null,
        normalMap: ctx.assets.textures.get('crater_n') ?? null,
        transparent: true,
        depthWrite: false,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      // Carte d'émission posée dès la création (émission noire par défaut) :
      // l'activer plus tard forcerait une recompilation du shader
      m.emissiveMap = m.map;
      mat = m;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    ctx.planet.add(this.mesh);
    if (style === 'decal') {
      const hm = new THREE.MeshBasicMaterial({ map: heatTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      this.heat = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 24), hm, MAX);
      this.heat.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      this.heat.count = 0;
      this.heat.frustumCulled = false;
      this.heat.renderOrder = 2;
      ctx.planet.add(this.heat);
    }
  }

  /** Lueur des cratères (planète Néon) ; null = aucune. */
  setGlow(c: THREE.Color | null): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial) return;
    m.emissive.copy(c ?? new THREE.Color(0, 0, 0));
  }

  private craterMaps: { map: THREE.Texture | null; normal: THREE.Texture | null } | null = null;
  private whirl: THREE.Texture | null = null;
  /** Planète-océan : les impacts deviennent des tourbillons (style « decal » seulement). */
  setWater(water: boolean): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    if (this.style !== 'decal' || !m.isMeshStandardMaterial || !m.map) return;
    this.craterMaps ??= { map: m.map, normal: m.normalMap };
    this.whirl ??= whirlpoolTexture();
    const map = water ? this.whirl : this.craterMaps.map;
    if (m.map !== map) {
      m.map = map;
      m.emissiveMap = map;
    }
    m.normalScale.setScalar(water ? 0 : 1);
  }

  /** Instantiate(craterPrefab, point, LookRotation(normal)) — point/normale en espace planète. */
  spawn(localPos: THREE.Vector3, localNormal: THREE.Vector3, playSound = true): Crater {
    if (this.list.length >= MAX) this.list.shift();
    const c: Crater = {
      pos: localPos.clone(),
      normal: localNormal.clone().normalize(),
      quat: lookRotation(localNormal, new THREE.Vector3(0, 1, 0)),
      age: 0,
      obb: makeOBB(),
      inside: false,
      name: this.name,
    };
    this.updateOBB(c);
    this.list.push(c);
    // AudioSource du prefab : PlayerDeath.wav en lecture automatique
    const audio = getComponent<{ type: string; id: number; clip: string; volume: number; playOnAwake: boolean }>(this.ctx.assets.project.prefabs.Crater, 'AudioSource');
    if (playSound && audio?.playOnAwake && audio.clip) this.ctx.audio.playOneShot(audio.clip, audio.volume);
    return c;
  }

  private updateOBB(c: Crater): void {
    const p = this.ctx.planet;
    p.updateWorldMatrix(true, false);
    const ps = p.scale.x;
    c.obb.center.copy(c.pos).applyMatrix4(p.matrixWorld);
    const wq = p.getWorldQuaternion(new THREE.Quaternion()).multiply(c.quat);
    c.obb.axes[0].set(1, 0, 0).applyQuaternion(wq);
    c.obb.axes[1].set(0, 1, 0).applyQuaternion(wq);
    c.obb.axes[2].set(0, 0, 1).applyQuaternion(wq);
    const k = ps / Math.max(0.01, this.baseScale);
    c.obb.half.set(this.size.x * this.boxSize[0] * k / 2, this.size.y * this.boxSize[1] * k / 2, this.size.z * this.boxSize[2] * k / 2);
  }

  update(dt: number, lifetime: number, shrinking: boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.age += dt;
      if (lifetime > 0 && c.age >= lifetime) this.list.splice(i, 1);
      else if (shrinking) this.updateOBB(c);
    }
    const n = this.list.length;
    // Taille constante en unités monde, même sur une petite planète
    const inv = 1 / Math.max(0.01, this.baseScale);
    for (let i = 0; i < n; i++) {
      const c = this.list[i];
      let k = 1;
      if (lifetime > 0) k = Math.min(1, (lifetime - c.age) / 1.5);
      if (this.style === 'box') {
        _s.copy(this.size).multiplyScalar(k * inv);
        _m.compose(c.pos, c.quat, _s);
      } else {
        // Brûlure posée sur le sol, à peine plus grande que le trigger
        const d = Math.max(this.size.x, this.size.y) * 1.45 * Math.min(1, c.age * 8 + 0.3) * k * inv;
        _s.set(d, d, d);
        _p.copy(c.pos).addScaledVector(c.normal, 0.004);
        _m.compose(_p, c.quat, _s);
      }
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Incandescence : seulement les impacts récents
    const h = this.heat;
    if (h) {
      let m = 0;
      if (this.heatGlow) {
        for (const c of this.list) {
          if (c.age > HEAT_TIME) continue;
          const x = 1 - c.age / HEAT_TIME;
          const k = x * x;
          const d = Math.max(this.size.x, this.size.y) * (1.6 + 0.4 * (1 - x)) * inv;
          _s.set(d, d, d);
          _p.copy(c.pos).addScaledVector(c.normal, 0.006);
          _m.compose(_p, c.quat, _s);
          h.setMatrixAt(m, _m);
          h.setColorAt(m, _c.setRGB(2.6 * k, (0.9 + 0.5 * k) * k, 0.25 * k * k));
          m++;
        }
      }
      h.count = m;
      h.instanceMatrix.needsUpdate = true;
      if (h.instanceColor) h.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.list.length = 0;
    this.mesh.count = 0;
    if (this.heat) this.heat.count = 0;
  }
}

const HEAT_TIME = 1.6;
const _c = new THREE.Color();

/** Lueur d'impact : cœur blanc-jaune, halo orange, fissures rayonnantes. */
function heatTexture(): THREE.Texture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,200,120,0.9)');
  grd.addColorStop(0.6, 'rgba(255,110,40,0.35)');
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(255,220,150,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.sin(i * 7) * 0.3;
    g.beginPath();
    g.moveTo(N / 2, N / 2);
    const r = N * (0.3 + 0.15 * Math.abs(Math.sin(i * 3.1)));
    g.lineTo(N / 2 + Math.cos(a + 0.2) * r * 0.5, N / 2 + Math.sin(a + 0.2) * r * 0.5);
    g.lineTo(N / 2 + Math.cos(a) * r, N / 2 + Math.sin(a) * r);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/** Tourbillon d'eau dessiné (spirale bleu foncé → écume blanche, bords transparents). */
function whirlpoolTexture(): THREE.Texture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1;
      const dy = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const arm = 0.5 + 0.5 * Math.sin(a * 3 + r * 14);
      const foam = arm > 0.72 ? 1 : 0;
      const depth = 1 - Math.min(1, r);
      const i = (y * N + x) * 4;
      const base = [20 + 60 * (1 - depth), 70 + 90 * (1 - depth), 150 + 70 * (1 - depth)];
      const w = foam * (0.35 + 0.65 * Math.min(1, r * 1.6));
      img.data[i] = base[0] + (255 - base[0]) * w;
      img.data[i + 1] = base[1] + (255 - base[1]) * w;
      img.data[i + 2] = base[2] + (255 - base[2]) * w;
      img.data[i + 3] = 255 * Math.max(0, Math.min(1, (1 - r) * 5));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
