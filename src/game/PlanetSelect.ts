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
import { atmosphere, planetToonMaterial } from './toon';

const ORIGIN = new THREE.Vector3(0, 400, 0);

interface Item {
  def: PlanetDef;
  mesh: THREE.Mesh;
  mat: THREE.Material;
  locked: boolean;
}

export class PlanetSelect {
  readonly group = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  private items: Item[] = [];
  private readonly aura: THREE.Mesh;
  /** Index affiché (flottant, amorti) et index visé. */
  private cur = 0;
  target = 0;
  active = false;
  private t = 0;
  private portrait = false;

  constructor(scene: THREE.Scene, private readonly assets: Assets, private readonly origMat: THREE.Material, geo: THREE.BufferGeometry, geoScale: number) {
    this.group.position.copy(ORIGIN);
    this.group.visible = false;
    scene.add(this.group);
    // Aura enfant de la planète sélectionnée (le shader lit l'échelle du parent)
    this.aura = atmosphere(geoScale);
    this.geo = geo;
    this.geoScale = geoScale;
  }
  private readonly geo: THREE.BufferGeometry;
  private readonly geoScale: number;

  /** (Re)construit le carrousel avec la liste des planètes (verrouillées comprises). */
  setPlanets(defs: { def: PlanetDef; locked: boolean }[]): void {
    for (const it of this.items) this.group.remove(it.mesh);
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
        mat = m;
      } else mat = this.origMat;
      if (locked && (mat as THREE.MeshToonMaterial).color) {
        mat = mat === this.origMat ? mat.clone() : mat;
        (mat as THREE.MeshToonMaterial).color.setScalar(0.18);
      }
      const mesh = new THREE.Mesh(this.geo, mat);
      this.group.add(mesh);
      return { def, mesh, mat, locked };
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

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    this.cur += (this.target - this.cur) * (1 - Math.exp(-dt * 7));
    const spacing = this.portrait ? 2.2 : 2.9;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const o = i - this.cur;
      const a = Math.abs(o);
      it.mesh.visible = a < 4.5;
      if (!it.mesh.visible) continue;
      // Arc : la planète du centre avance et grossit, les autres reculent
      const s = (1.45 - Math.min(1, a) * 0.7 - Math.max(0, a - 1) * 0.08) / this.geoScale;
      it.mesh.scale.setScalar(s);
      it.mesh.position.set(o * spacing - Math.sign(o) * Math.min(1, a) * 0.6, Math.sin(this.t * 0.8 + i) * 0.06 + (this.portrait ? 0.6 : 0.85), -Math.pow(a, 1.3) * 1.3);
      it.mesh.rotation.y = this.t * 0.25 + i;
      it.mesh.rotation.x = 0.35;
    }
    const sel = this.items[Math.round(this.cur)];
    if (sel) {
      if (this.aura.parent !== sel.mesh) sel.mesh.add(this.aura);
      const u = (this.aura.material as THREE.ShaderMaterial).uniforms;
      u.color.value.set(sel.def.atmosphere);
      u.intensity.value = sel.locked ? 0.15 : 0.75;
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
