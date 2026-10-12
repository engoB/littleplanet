/**
 * Reconstruction des GameObjects Unity (scène ou prefab) en Object3D three.
 * Chaque Object3D garde ses données Unity dans userData.unity.
 * Les composants gérés : MeshFilter/MeshRenderer (maillages intégrés Unity ou
 * GLB), modèle importé (instance de FBX/DAE), Light (lumières virtuelles du
 * pool), ParticleSystem (+ renderer), CFXR_Effect.
 */
import * as THREE from 'three';
import type { Assets } from './assets';
import { AnimatedLight } from './cfxr';
import { LightPool, VirtualLight } from './lights';
import { ParticleManager, ParticleSystem, spriteLook } from './particles';
import type { CfxrEffectData, LightData, NodeData, ParticleData, ParticleRendererData } from './types';

/** Résultat de l'instanciation : objets utiles indexés. */
export interface Instance {
  root: THREE.Object3D;
  particles: ParticleSystem[];
  lights: VirtualLight[];
  animatedLights: AnimatedLight[];
  effects: CfxrEffectData[];
  meshes: THREE.Mesh[];
  byName: Map<string, THREE.Object3D>;
}

export interface BuildContext {
  assets: Assets;
  particles: ParticleManager;
  lights: LightPool;
  /** Lumières « temps réel de la scène » (directionnelles, ponctuelles fixes). */
  sceneLights?: (obj: THREE.Object3D, d: LightData) => void;
  castShadows?: boolean;
}

function builtinGeometry(name: string): THREE.BufferGeometry {
  switch (name) {
    case 'Cube':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'Plane': {
      // Plan Unity : 10 × 10 dans XZ, normale +Y
      const g = new THREE.PlaneGeometry(10, 10, 1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'Quad':
      return new THREE.PlaneGeometry(1, 1);
    case 'Sphere':
      return new THREE.SphereGeometry(0.5, 24, 16);
    case 'Cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 2, 24);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function instantiate(node: NodeData, ctx: BuildContext): Instance {
  const inst: Instance = { root: new THREE.Object3D(), particles: [], lights: [], animatedLights: [], effects: [], meshes: [], byName: new Map() };
  const lightById = new Map<number, VirtualLight>();
  const pendingAnim: { d: CfxrEffectData['animatedLights'][number] }[] = [];
  inst.root = build(node, ctx, inst, lightById, pendingAnim);
  for (const p of pendingAnim) {
    const l = lightById.get(p.d.light);
    if (l) inst.animatedLights.push(new AnimatedLight(l, p.d));
  }
  return inst;
}

function build(node: NodeData, ctx: BuildContext, inst: Instance, lightById: Map<number, VirtualLight>, pendingAnim: { d: CfxrEffectData['animatedLights'][number] }[]): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = node.name;
  o.userData.unity = node;
  o.position.set(...node.position);
  o.quaternion.set(...node.rotation);
  o.scale.set(...node.scale);
  o.visible = node.active;
  inst.byName.set(node.name, o);
  const { assets } = ctx;

  if (node.model) {
    // Instance d'un modèle importé : copie de la hiérarchie GLB à l'échelle d'import
    const src = assets.models.get(node.model);
    if (src) {
      const g = src.clone(true);
      g.scale.setScalar(assets.importScale(node.model));
      g.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Matériaux : surcharge de l'instance, sinon recherche par nom de
        // l'importeur Unity (models[].materials), sinon matériau du modèle.
        const search = assets.project.models[node.model!]?.materials ?? {};
        const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const mats = src.map((m, i) => {
          const over = node.materialOverride?.[i] ?? node.materialOverride?.[0];
          if (over) return assets.material(over);
          const found = search[m.name];
          return found ? assets.material(found) : m;
        });
        mesh.material = mats.length === 1 ? mats[0] : mats;
        mesh.castShadow = (node.castShadows ?? true) && (ctx.castShadows ?? false);
        mesh.receiveShadow = true;
        inst.meshes.push(mesh);
      });
      o.add(g);
    }
  }

  const filter = node.components.find((c) => c.type === 'MeshFilter');
  const renderer = node.components.find((c) => c.type === 'MeshRenderer') as { materials?: (string | null)[]; castShadows?: boolean; enabled?: boolean } | undefined;
  if (filter && renderer) {
    const geo = filter.model ? assets.firstMesh(filter.model as string).geometry : builtinGeometry(filter.builtin as string);
    const mat = assets.material(renderer.materials?.[0] ?? null);
    const mesh = new THREE.Mesh(geo, mat);
    if (filter.model) mesh.scale.setScalar(assets.importScale(filter.model as string));
    mesh.castShadow = !!renderer.castShadows && (ctx.castShadows ?? false);
    mesh.receiveShadow = true;
    mesh.visible = renderer.enabled !== false;
    inst.meshes.push(mesh);
    o.add(mesh);
  }

  for (const c of node.components) {
    if (c.type === 'Light') {
      const ld = c as LightData;
      if (ctx.sceneLights) {
        ctx.sceneLights(o, ld);
      } else if (ld.lightType === 'point') {
        const v = ctx.lights.register(new VirtualLight(o, ld));
        lightById.set(c.id, v);
        inst.lights.push(v);
      }
    } else if (c.type === 'ParticleSystem') {
      const r = node.components.find((x) => x.type === 'ParticleSystemRenderer') as ParticleRendererData | undefined;
      if (r) {
        // Premier matériau visible (le second sert aux traînées, non portées)
        const mats = r.materials;
        const matName = mats.find((m) => m && m !== 'cfxr hidden') ?? mats[0];
        const look = spriteLook(matName, matName ? assets.materialData(matName) : undefined, assets.manifest.fxAtlas);
        const ps = new ParticleSystem(o, c.particle as ParticleData, r, look);
        ctx.particles.add(ps);
        inst.particles.push(ps);
      }
    } else if (c.type === 'CFXR_Effect') {
      const fx = c as CfxrEffectData;
      inst.effects.push(fx);
      for (const al of fx.animatedLights) pendingAnim.push({ d: al });
    }
  }

  for (const ch of node.children) o.add(build(ch, ctx, inst, lightById, pendingAnim));
  return o;
}
