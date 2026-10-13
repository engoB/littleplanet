/**
 * Véhicules du préréglage Arcade, construits procéduralement (unités locales
 * de la voiture Unity : ~3,35 de long, pivot au sol, échelle 0,2) :
 *  - « hover » : voiture volante ronde et blanche, cockpit-bulle, réacteurs
 *    lumineux (inspiration aéro-voitures des dessins animés japonais) ;
 * La boîte de collision reste celle de la voiture d'origine.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';

export type VehicleKind = 'original' | 'hover';

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
  const blue = toon(0x2f7dff, { emissive: new THREE.Color(0x081a40) });
  const yellow = toon(0xffc93a, { emissive: new THREE.Color(0x302008) });
  const dark = toon(0x253047);
  // Coque compacte et large (silhouette de voiture vue de dessus : avant
  // arrondi, flancs droits, arrière large), profil bombé
  const hg = new THREE.SphereGeometry(1, 40, 20);
  const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const y = hp.getY(i);
    const z = hp.getZ(i);
    // Super-ellipse dans le plan XZ : coins arrondis mais flancs presque droits
    const r = Math.hypot(x, z);
    const k = r < 1e-6 ? 1 : Math.pow(Math.pow(Math.abs(x / r), 4) + Math.pow(Math.abs(z / r), 4), -0.25);
    const t = (z + 1) / 2; // 0 arrière → 1 avant
    const w = 0.9 - 0.12 * t * t;
    hp.setXYZ(i, x * k * w * 0.92, y * (y > 0 ? 0.46 : 0.3) * (1 - 0.18 * t), z * k * 1.28);
  }
  hg.computeVertexNormals();
  const hull = new THREE.Mesh(hg, white);
  hull.position.y = 0.55;
  // Bandes de course rouges sur le dessus (visibles depuis la caméra)
  for (const sx of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 2.0), red);
    st.position.set(sx * 0.2, 0.98, -0.1);
    body.add(st);
  }
  // Jupe colorée autour de la coque
  const skirt = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 48), blue);
  skirt.rotation.x = Math.PI / 2;
  skirt.scale.set(0.82, 1.18, 1);
  skirt.position.y = 0.5;
  // Bulle de cockpit, grande et brillante, pilote visible
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fe0ff, emissive: new THREE.Color(0x0a3550), transparent: true, opacity: 0.62, roughness: 0.05, metalness: 0, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.scale.set(1.05, 0.95, 1.15);
  dome.position.set(0, 0.95, 0.2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), toon(0xffd9b0));
  head.position.set(0, 1.08, 0.12);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x3a5fd9));
  hair.position.set(0, 1.11, 0.1);
  // Emblème rond sur le capot
  const emb = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), blue);
  emb.rotation.x = -Math.PI / 2 + 0.35;
  emb.position.set(0, 0.86, 0.95);
  const embRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 24), white);
  embRing.rotation.copy(emb.rotation);
  embRing.position.copy(emb.position);
  // Quatre patins anti-gravité aux coins (remplacent les roues, lisibles de dessus)
  const glowA = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.4) });
  const glowB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.6) });
  for (const [x, z] of [[-0.82, 0.78], [0.82, 0.78], [-0.82, -0.82], [0.82, -0.82]]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.2, 20), yellow);
    pod.position.set(x, 0.42, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20), dark);
    cap.position.set(x, 0.535, z);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), glowA);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, 0.315, z);
    body.add(pod, cap, glow);
  }
  // Aileron arrière en arceau
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.3), red);
  spoiler.position.set(0, 1.08, -1.12);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.14), dark);
    leg.position.set(sx * 0.6, 0.94, -1.1);
    body.add(leg);
  }
  // Deux réacteurs arrière avec tuyère lumineuse
  const emitters: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.5, 16), white);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 0.42, 0.62, -1.18);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), glowA);
    flame.rotation.y = Math.PI;
    flame.position.set(sx * 0.42, 0.62, -1.435);
    const em = new THREE.Object3D();
    em.position.set(sx * 0.42, 0.62, -1.5);
    emitters.push(em);
    body.add(pod, flame, em);
  }
  // Phares
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glowB);
    l.position.set(sx * 0.45, 0.62, 1.22);
    body.add(l);
  }
  body.add(hull, skirt, dome, head, hair, emb, embRing, spoiler);
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, glow: [glowA, glowB], body, emitters, kind: 'hover' };
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
  }
}
