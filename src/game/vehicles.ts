/**
 * Véhicules du préréglage Arcade, construits procéduralement (unités locales
 * de la voiture Unity : ~3,35 de long, pivot au sol, échelle 0,2) :
 *  - « hover » : DeLorean volante (« Retour vers le futur 2 ») en inox,
 *    roues couchées lumineuses, persiennes, Mr. Fusion ;
 * La boîte de collision reste celle de la voiture d'origine.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

export type VehicleKind = 'original' | 'hover';

function toon(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

export interface VehicleRig {
  /** Néons années 80 (anneaux autour des patins + halo au sol) : mondes sombres. */
  neon?: THREE.Object3D;
  neonMats?: THREE.MeshBasicMaterial[];
  group: THREE.Group;
  /** Matériaux lumineux (réacteurs, phares) : intensité modulée (turbo). */
  glow: THREE.MeshBasicMaterial[];
  /** Sous-groupe animé (flottement, roulis). */
  body: THREE.Object3D;
  /** Points d'émission des particules (réacteurs ou sillage), espace véhicule. */
  emitters: THREE.Object3D[];
  kind: VehicleKind;
}

export function buildHover(): VehicleRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  // DeLorean volante (« Retour vers le futur 2 ») : inox brossé, vitres
  // teintées, persiennes noires, roues couchées à l'horizontale
  const steel = toon(0xd3d8e0, { emissive: new THREE.Color(0x2e323a) });
  const steelDark = toon(0x9aa1ad, { emissive: new THREE.Color(0x1a1d24) });
  const black = toon(0x1b1d22);
  const glassMat = toon(0x16202e, { emissive: new THREE.Color(0x0a1626), side: THREE.DoubleSide });
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.12) });
  const orange = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.15) });
  const white = toon(0xf4f4f0, { emissive: new THREE.Color(0x3a3a3a) });
  const glowA = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.4) });
  const glowB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6) });
  /** Profil latéral (z avant, y haut) extrudé sur la largeur. */
  const extrude = (pts: [number, number][], width: number, mat: THREE.Material, bevel = 0.05) => {
    const sh = new THREE.Shape();
    pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(width - 2 * bevel) / 2);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };
  // Caisse en coin : nez bas, capot plat, pare-brise très incliné, toit court, arrière tronqué
  const hull = extrude([[1.5, 0.36], [1.52, 0.52], [0.55, 0.7], [0.2, 0.74], [-1.38, 0.74], [-1.46, 0.66], [-1.46, 0.36]], 1.62, steel, 0.06);
  // Habitacle (plus étroit) : pare-brise, toit, lunette en persiennes
  const cabin = extrude([[0.22, 0.72], [-0.28, 1.1], [-0.72, 1.1], [-1.3, 0.78], [-1.3, 0.72]], 1.3, steel, 0.04);
  body.add(hull, cabin);
  // Vitres teintées : pare-brise et vitres latérales (portes papillon)
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.6), glassMat);
  ws.position.set(0, 0.945, -0.01);
  ws.rotation.x = -(Math.PI / 2 - Math.atan2(0.38, 0.5));
  body.add(ws);
  for (const sx of [-1, 1]) {
    const sw = new THREE.Shape();
    sw.moveTo(0.12, 0.8);
    sw.lineTo(-0.3, 1.06);
    sw.lineTo(-0.7, 1.06);
    sw.lineTo(-0.95, 0.85);
    sw.lineTo(-0.95, 0.8);
    const sg = new THREE.ShapeGeometry(sw).rotateY(-Math.PI / 2);
    const side = new THREE.Mesh(sg, glassMat);
    side.position.x = sx * 0.672;
    body.add(side);
    // Joint des portes papillon sur le toit
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.5), black);
    seam.position.set(sx * 0.32, 1.115, -0.5);
    body.add(seam);
  }
  // Persiennes noires sur la lunette arrière (signature vue de dessus)
  for (let i = 0; i < 6; i++) {
    const u = (i + 0.5) / 6;
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.025, 0.06), black);
    slat.position.set(0, 1.1 - 0.32 * u + 0.02, -0.72 - 0.58 * u);
    slat.rotation.x = Math.atan2(0.32, 0.58);
    body.add(slat);
  }
  // Bas de caisse noir, calandre et bandeau arrière
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 3.0), black);
  skirt.position.set(0, 0.36, 0.02);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.04), black);
  grille.position.set(0, 0.46, 1.535);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.04), black);
  rear.position.set(0, 0.5, -1.53);
  body.add(skirt, grille, rear);
  // Phares rectangulaires et feux arrière
  for (const sx of [-1, 1]) {
    for (const ox of [0.36, 0.56]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.02), glowB);
      l.position.set(sx * ox, 0.46, 1.56);
      body.add(l);
    }
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.02), red);
    tl.position.set(sx * 0.48, 0.52, -1.555);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.021), orange);
    bl.position.set(sx * 0.72, 0.52, -1.555);
    body.add(tl, bl);
  }
  // Mr. Fusion sur le capot arrière, et bobines sur les flancs
  const fusion = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 16), white);
  fusion.position.set(0, 0.84, -1.3);
  const fusionTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), steelDark);
  fusionTop.position.set(0, 0.94, -1.3);
  body.add(fusion, fusionTop);
  for (const sx of [-1, 1]) {
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), steelDark);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(sx * 0.84, 0.62, -0.75);
    body.add(coil);
  }
  // Roues couchées (mode vol) : pneu, jante inox et lueur bleue dessous
  for (const [x, z] of [[-0.82, 0.86], [0.82, 0.86], [-0.82, -0.86], [0.82, -0.86]]) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 22), black);
    tire.position.set(x, 0.36, z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.17, 18), steelDark);
    rim.position.set(x, 0.36, z);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), glowA);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, 0.275, z);
    body.add(tire, rim, glow);
  }
  // Deux tuyères arrière lumineuses (traînée des réacteurs)
  const emitters: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 14), steelDark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 0.42, 0.4, -1.58);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.08, 14), glowA);
    flame.rotation.y = Math.PI;
    flame.position.set(sx * 0.42, 0.4, -1.665);
    const em = new THREE.Object3D();
    em.position.set(sx * 0.42, 0.4, -1.72);
    emitters.push(em);
    body.add(pod, flame, em);
  }
  // Néons « années 80 » : fins anneaux sous les quatre patins et petite lueur au sol
  // juste sous chacun (rien sur la caisse)
  const neon = new THREE.Group();
  const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.4, 2.4) });
  const cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3.0) });
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const haloMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(1.3, 0.3, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  [[-0.82, 0.86], [0.82, 0.86], [-0.82, -0.86], [0.82, -0.86]].forEach(([x, z], i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.018, 6, 28), i < 2 ? pink : cyan);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.28, z);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.05, z);
    halo.renderOrder = 2;
    neon.add(ring, halo);
  });
  neon.visible = false;
  body.add(neon);
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, glow: [glowA, glowB], body, emitters, kind: 'hover', neon, neonMats: [pink, cyan, haloMat] };
}

/** Animation : flottement, roulis selon le braquage, éclat des réacteurs. */
export function animateVehicle(v: VehicleRig, t: number, steer: number, turbo: boolean): void {
  if (v.kind === 'hover') {
    v.body.position.y = 0.45 + 0.06 * Math.sin(t * 3.1);
    // Remis à zéro à chaque frame : les effets (toupie, saut) s'y ajoutent ensuite
    v.body.rotation.y = 0;
    v.body.rotation.z = -steer * 0.32;
    v.body.rotation.x = -0.04 + 0.03 * Math.sin(t * 2.3) - (turbo ? 0.08 : 0);
    const k = turbo ? 1.8 : 1 + 0.15 * Math.sin(t * 20);
    v.glow[0].color.setRGB(0.4 * k, 1.6 * k, 2.4 * k);
    if (v.neon?.visible && v.neonMats) {
      const p = 0.85 + 0.15 * Math.sin(t * 6);
      v.neonMats[0].color.setRGB(3.0 * p, 0.4 * p, 2.4 * p);
      v.neonMats[1].color.setRGB(0.4 * p, 2.4 * p, 3.0 * p);
    }
  }
}
