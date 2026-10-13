/**
 * Choix de la planète façon « sélection de royaume » (Mario Odyssey) :
 * les planètes flottent en arc dans l'espace, celle du centre est grande,
 * entourée de son aura, et tourne lentement ; glisser ou les flèches font
 * défiler le carrousel avec un amorti doux.
 * Groupe 3D placé loin de la planète de jeu, avec sa propre caméra.
 */
import * as THREE from 'three';
import type { Assets } from '../unity/assets';
import type { PlanetDef } from './planets';
import { MagicSky } from './MagicSky';
import { atmosphere, planetToonMaterial, toonGradient } from './toon';

const ORIGIN = new THREE.Vector3(0, 400, 0);

interface Item {
  def: PlanetDef;
  mesh: THREE.Mesh;
  mat: THREE.Material;
  locked: boolean;
  /** Monuments posés sur la planète (créés à la première apparition). */
  decorated: boolean;
}

export class PlanetSelect {
  readonly group = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  private items: Item[] = [];
  private readonly aura: THREE.Mesh;
  /** Fond magique (nébuleuses, étoiles scintillantes). */
  private readonly sky = new MagicSky();
  /** Index affiché (flottant, amorti) et index visé. */
  private cur = 0;
  target = 0;
  active = false;
  private t = 0;
  private portrait = false;
  /** Pose les monuments d'une planète sur son maillage (fourni par le monde). */
  decorFor: ((def: PlanetDef, mesh: THREE.Mesh) => void) | null = null;
  /** Matériau de la planète classique (herbe et chemin). */
  classicMat: (() => THREE.Material) | null = null;

  constructor(scene: THREE.Scene, private readonly assets: Assets, private readonly origMat: THREE.Material, geo: THREE.BufferGeometry, geoScale: number) {
    this.group.position.copy(ORIGIN);
    this.group.visible = false;
    scene.add(this.group);
    this.group.add(this.sky.group);
    // Aura enfant de la planète sélectionnée (le shader lit l'échelle du parent)
    this.aura = atmosphere(geoScale);
    this.geo = geo;
    this.geoScale = geoScale;
  }
  private readonly geo: THREE.BufferGeometry;
  private readonly geoScale: number;
  private readonly lockedMat = new THREE.MeshToonMaterial({ color: 0x585d6c, gradientMap: toonGradient() });

  /** (Re)construit le carrousel avec la liste des planètes (verrouillées comprises). */
  setPlanets(defs: { def: PlanetDef; locked: boolean }[]): void {
    for (const it of this.items) {
      this.group.remove(it.mesh);
      it.mesh.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
    }
    this.items = defs.map(({ def, locked }) => {
      let mat: THREE.Material;
      const cubes = this.assets.planetCubes.get(def.id);
      if (def.style === 'toon' && cubes) {
        const m = planetToonMaterial();
        const u = m.userData.planetUniforms;
        u.planetCube.value = cubes.color;
        u.planetEmis.value = cubes.emis ?? cubes.color;
        u.emisColor.value.setScalar(def.emis ?? (cubes.emis ? 0.5 : 0));
        u.rimColor.value.set(def.atmosphere);
        if (def.glass && cubes.mask) {
          u.planetMask.value = cubes.mask;
          u.glass.value = 1;
          m.transparent = true;
          m.side = THREE.DoubleSide;
        }
        mat = m;
      } else mat = def.style === 'classic' && this.classicMat ? this.classicMat() : this.origMat;
      // Monde verrouillé : bille de pierre grise, sans couleurs ni décor
      if (locked) mat = this.lockedMat;
      const mesh = new THREE.Mesh(this.geo, mat);
      this.group.add(mesh);
      return { def, mesh, mat, locked, decorated: false };
    });
  }

  select(i: number, instant = false): void {
    this.target = Math.max(0, Math.min(this.items.length - 1, i));
    if (instant) this.cur = this.target;
  }

  get selected(): Item | undefined {
    return this.items[this.target];
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.portrait = aspect < 1;
    this.camera.fov = this.portrait ? 58 : 40;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, viewH = 720): void {
    if (!this.active) return;
    this.t += dt;
    this.sky.update(this.t, viewH);
    this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * 7));
    const spacing = this.portrait ? 2.2 : 2.9;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const o = i - this.cur;
      const a = Math.abs(o);
      it.mesh.visible = a < 4.5;
      if (!it.mesh.visible) continue;
      if (!it.decorated && !it.locked) {
        it.decorated = true;
        this.decorFor?.(it.def, it.mesh);
      }
      // Arc : la planète du centre avance et grossit, les autres reculent
      const s = ((this.portrait ? 1.28 : 1.45) - Math.min(1, a) * 0.7 - Math.max(0, a - 1) * 0.08) / this.geoScale;
      it.mesh.scale.setScalar(s);
      it.mesh.position.set(o * spacing - Math.sign(o) * Math.min(1, a) * 0.6, Math.sin(this.t * 0.8 + i) * 0.06 + (this.portrait ? 2.15 : 0.85), -Math.pow(a, 1.3) * 1.3);
      it.mesh.rotation.y = this.t * 0.25 + i;
      it.mesh.rotation.x = 0.35;
    }
    const sel = this.items[Math.round(this.cur)];
    if (sel) {
      if (this.aura.parent !== sel.mesh) sel.mesh.add(this.aura);
      const u = (this.aura.material as THREE.ShaderMaterial).uniforms;
      u.color.value.set(sel.def.atmosphere);
      if (sel.locked) u.color.value.set('#8a90a8');
      u.intensity.value = sel.locked ? 0.25 : 0.75;
    }
    this.camera.position.copy(ORIGIN).add(new THREE.Vector3(0, this.portrait ? 1.2 : 0.9, 7.2));
    this.camera.lookAt(ORIGIN.clone().add(new THREE.Vector3(0, this.portrait ? 0.3 : 0.2, 0)));
    this.camera.updateMatrixWorld();
  }

  show(v: boolean): void {
    this.active = v;
    this.group.visible = v;
  }
}
