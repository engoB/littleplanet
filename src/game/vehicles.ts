/**
 * Véhicules du préréglage Arcade, construits procéduralement (unités locales
 * de la voiture Unity : ~3,35 de long, pivot au sol, échelle 0,2) :
 *  - « hover » : voiture volante ronde et blanche, cockpit-bulle, réacteurs
 *    lumineux (inspiration aéro-voitures des dessins animés japonais) ;
 *  - « boat » : petit bateau pirate (coque en bois, mât, voile, figure de proue)
 *    pour la planète-océan.
 * La boîte de collision reste celle de la voiture d'origine.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

export type VehicleKind = 'original' | 'hover' | 'boat';

function toon(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

export interface VehicleRig {
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
  // Blanc légèrement émissif : reste blanc éclatant même côté ombre
  const white = toon(0xffffff, { emissive: new THREE.Color(0x3a3a44) });
  const red = toon(0xff3b3b, { emissive: new THREE.Color(0x401010) });
  const blue = toon(0x2f7dff);
  const yellow = toon(0xffc93a, { emissive: new THREE.Color(0x302008) });
  const dark = toon(0x253047);
  // Coque en goutte : avant arrondi, arrière plus large (sphère déformée)
  const hg = new THREE.SphereGeometry(1, 32, 18);
  const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const y = hp.getY(i);
    const z = hp.getZ(i);
    const t = (z + 1) / 2; // 0 arrière → 1 avant
    const w = 0.78 - 0.16 * t;
    hp.setXYZ(i, x * w, y * (y > 0 ? 0.42 : 0.3) * (1 - 0.15 * t), z * 1.6);
  }
  hg.computeVertexNormals();
  const hull = new THREE.Mesh(hg, white);
  hull.position.y = 0.55;
  // Bande rouge sur le flanc (tore aplati qui épouse la coque)
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 6, 48), red);
  stripe.rotation.x = Math.PI / 2;
  stripe.scale.set(0.73, 1.62, 1);
  stripe.position.y = 0.55;
  // Bulle de cockpit, grande et brillante
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fe0ff, emissive: new THREE.Color(0x0a3550), transparent: true, opacity: 0.7, roughness: 0.05, metalness: 0, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.scale.set(0.95, 0.9, 1.35);
  dome.position.set(0, 0.9, 0.25);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), toon(0xffd9b0));
  head.position.set(0, 1.0, 0.1);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x3a5fd9));
  hair.position.set(0, 1.03, 0.08);
  // Petites ailes et dérive
  const wingGeo = new THREE.BoxGeometry(0.55, 0.05, 0.45);
  const wings = [-1, 1].map((sx) => {
    const w = new THREE.Mesh(wingGeo, blue);
    w.position.set(sx * 0.82, 0.5, -0.65);
    w.rotation.z = sx * -0.18;
    w.rotation.y = sx * 0.35;
    return w;
  });
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.45), blue);
  fin.position.set(0, 0.92, -1.25);
  fin.rotation.x = -0.45;
  // Nacelles de réacteurs arrière (jaunes) avec tuyère lumineuse
  const glowA = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.4) });
  const glowB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6) });
  const emitters: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 6, 14), yellow);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 0.55, 0.42, -0.95);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.12, 16), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx * 0.55, 0.42, -1.48);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), glowA);
    flame.rotation.y = Math.PI;
    flame.position.set(sx * 0.55, 0.42, -1.545);
    const em = new THREE.Object3D();
    em.position.set(sx * 0.55, 0.42, -1.6);
    emitters.push(em);
    body.add(pod, nozzle, flame, em);
  }
  // Coussin anti-gravité sous la coque
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), glowA);
  pad.rotation.x = Math.PI / 2;
  pad.scale.set(1, 1.8, 1);
  pad.position.y = 0.39;
  // Emblème rond à l'arrière et phares
  const emb = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), blue);
  emb.position.set(0, 0.62, -1.27);
  emb.rotation.y = Math.PI;
  emb.rotation.x = 0.35;
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glowB);
    l.position.set(sx * 0.32, 0.55, 1.5);
    body.add(l);
  }
  body.add(hull, stripe, dome, head, hair, ...wings, fin, pad, emb);
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, glow: [glowA, glowB], body, emitters, kind: 'hover' };
}

export function buildBoat(): VehicleRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wood = toon(0xa8693a);
  const woodDark = toon(0x7a4a26);
  const deck = toon(0xd9a46a);
  const sailMat = toon(0xfff8ea, { side: THREE.DoubleSide });
  // Coque : boîte déformée (fond en V, proue pointue, poupe relevée)
  const g = new THREE.BoxGeometry(1.15, 0.7, 3.2, 6, 4, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (z + 1.6) / 3.2; // 0 poupe → 1 proue
    const narrow = 1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 1.6) * 0.95;
    const vee = y < 0 ? 1 - (-y / 0.35) * 0.55 : 1;
    x *= narrow * vee;
    y += t > 0.8 ? (t - 0.8) * 0.9 : t < 0.12 ? (0.12 - t) * 1.6 : 0;
    pos.setXY(i, x, y);
  }
  g.computeVertexNormals();
  const hull = new THREE.Mesh(g, wood);
  hull.position.y = 0.35;
  const deckM = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 2.3), deck);
  deckM.position.set(0, 0.72, -0.2);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 2.4), woodDark);
  rail.position.set(0, 0.7, -0.2);
  rail.scale.set(1, 1, 1);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.6), toon(0xe0c08a));
  cabin.position.set(0, 0.98, -1.0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.7), toon(0xd94a3a));
  roof.position.set(0, 1.24, -1.0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.3, 8), woodDark);
  mast.position.set(0, 1.85, 0.25);
  // Voile gonflée (plan courbé)
  const sg = new THREE.PlaneGeometry(1.3, 1.25, 8, 6);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    sp.setZ(i, 0.28 * (1 - (x / 0.65) ** 2));
  }
  sg.computeVertexNormals();
  const sail = new THREE.Mesh(sg, sailMat);
  sail.position.set(0, 1.95, 0.32);
  // Emblème sur la voile : disque noir + crâne stylisé (deux ronds blancs)
  const emb = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), toon(0x222222, { side: THREE.DoubleSide }));
  emb.position.set(0, 1.98, 0.61);
  const skull = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), toon(0xffffff, { side: THREE.DoubleSide }));
  skull.position.set(0, 2.0, 0.62);
  const hat = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 20, 1, 0, Math.PI), toon(0xffd23a, { side: THREE.DoubleSide }));
  hat.position.set(0, 2.06, 0.625);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.24), toon(0x222222, { side: THREE.DoubleSide }));
  flag.position.set(0, 3.05, 0.05);
  // Figure de proue ronde
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), toon(0xfff4dc));
  head.position.set(0, 0.95, 1.62);
  const glowB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.9) });
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowB);
  lantern.position.set(0, 1.35, -1.25);
  body.add(hull, rail, deckM, cabin, roof, mast, sail, emb, skull, hat, flag, head, lantern);
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const wake = new THREE.Object3D();
  wake.position.set(0, 0.1, -1.6);
  body.add(wake);
  return { group, glow: [glowB], body, emitters: [wake], kind: 'boat' };
}

/** Animation : flottement, roulis selon le braquage, éclat des réacteurs. */
export function animateVehicle(v: VehicleRig, t: number, steer: number, turbo: boolean): void {
  if (v.kind === 'hover') {
    v.body.position.y = 0.45 + 0.06 * Math.sin(t * 3.1);
    v.body.rotation.z = -steer * 0.32;
    v.body.rotation.x = -0.04 + 0.03 * Math.sin(t * 2.3) - (turbo ? 0.08 : 0);
    const k = turbo ? 1.8 : 1 + 0.15 * Math.sin(t * 20);
    v.glow[0].color.setRGB(0.4 * k, 1.6 * k, 2.4 * k);
  } else if (v.kind === 'boat') {
    v.body.position.y = -0.05 + 0.05 * Math.sin(t * 2.2);
    v.body.rotation.z = -steer * 0.22 + 0.06 * Math.sin(t * 1.7);
    v.body.rotation.x = 0.05 * Math.sin(t * 2.6);
  }
}
