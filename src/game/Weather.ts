/**
 * Climat autour du véhicule : pluie, neige, feuilles qui volent, vent, orage
 * (pluie battante, rafales et éclairs) ou rien. Les particules vivent dans un
 * volume qui suit la voiture (repère « haut = normale de la planète ») ; le
 * déplacement de la voiture est compensé pour qu'elles restent fixes dans le
 * monde (la pluie défile quand on roule).
 */
import * as THREE from 'three';

export type WeatherKind = 'none' | 'rain' | 'snow' | 'leaves' | 'wind' | 'storm';
export const WEATHERS: WeatherKind[] = ['none', 'rain', 'snow', 'leaves', 'wind', 'storm'];

/** Demi-largeur et hauteur du volume (unités monde). */
const W = 7;
const H = 8;
const _y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 1, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const wrap = (v: number, lo: number, hi: number) => {
  const r = hi - lo;
  return v < lo ? v + r * Math.ceil((lo - v) / r) : v > hi ? v - r * Math.ceil((v - hi) / r) : v;
};

export class Weather {
  readonly group = new THREE.Group();
  kind: WeatherKind = 'none';
  /** Éclair en cours (0 → 1) : la scène s'illumine. */
  flash = 0;
  /** Assombrissement du ciel (1 : rien). */
  dim = 1;
  /** Coup de foudre au sol (position monde). */
  onStrike: (at: THREE.Vector3) => void = () => undefined;
  // Pluie / vent : segments
  private readonly rainPos: Float32Array;
  private readonly rainVel: Float32Array;
  private readonly rain: THREE.LineSegments;
  private readonly rainMat: THREE.LineBasicMaterial;
  private rainN = 0;
  // Neige : points
  private readonly snowPos: Float32Array;
  private readonly snowPh: Float32Array;
  private readonly snow: THREE.Points;
  // Feuilles : instances
  private readonly leafPos: Float32Array;
  private readonly leafRot: Float32Array;
  private readonly leaves: THREE.InstancedMesh;
  private leafN = 0;
  // Éclair
  private readonly bolt: THREE.Mesh;
  private boltT = 0;
  private strikeIn = 5;
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private windA = Math.random() * 6.28;
  private t = 0;

  constructor(parent: THREE.Object3D) {
    const MAX_RAIN = 1100;
    this.rainPos = new Float32Array(MAX_RAIN * 3);
    this.rainVel = new Float32Array(MAX_RAIN * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_RAIN * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 4;
    const MAX_SNOW = 600;
    this.snowPos = new Float32Array(MAX_SNOW * 3);
    this.snowPh = new Float32Array(MAX_SNOW);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SNOW * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.11, map: softDot(), transparent: true, depthWrite: false, color: 0xffffff }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 4;
    const MAX_LEAVES = 80;
    this.leafPos = new Float32Array(MAX_LEAVES * 3);
    this.leafRot = new Float32Array(MAX_LEAVES * 4);
    const leaf = new THREE.Shape();
    leaf.moveTo(0, -0.5);
    leaf.quadraticCurveTo(0.42, -0.1, 0, 0.5);
    leaf.quadraticCurveTo(-0.42, -0.1, 0, -0.5);
    this.leaves = new THREE.InstancedMesh(new THREE.ShapeGeometry(leaf), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), MAX_LEAVES);
    this.leaves.frustumCulled = false;
    const cols = [0xe8732a, 0xd6402a, 0xf2b631, 0x9cc243, 0xb5562a];
    for (let i = 0; i < MAX_LEAVES; i++) this.leaves.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.7, 3.4), transparent: true, depthWrite: false }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.group.add(this.rain, this.snow, this.leaves);
    this.group.visible = false;
    parent.add(this.group, this.bolt);
  }

  set(kind: WeatherKind): void {
    this.kind = kind;
    this.group.visible = kind !== 'none';
    this.hasLast = false;
    this.flash = 0;
    this.bolt.visible = false;
    this.strikeIn = 3 + Math.random() * 4;
    this.rainN = kind === 'rain' ? 650 : kind === 'storm' ? 1100 : kind === 'wind' ? 70 : 0;
    this.leafN = kind === 'leaves' ? 70 : kind === 'wind' ? 24 : kind === 'storm' ? 10 : 0;
    this.dim = kind === 'storm' ? 0.55 : kind === 'rain' ? 0.78 : kind === 'snow' ? 0.92 : 1;
    this.rain.visible = this.rainN > 0;
    this.snow.visible = kind === 'snow';
    this.leaves.visible = this.leafN > 0;
    this.leaves.count = this.leafN;
    this.rainMat.opacity = kind === 'wind' ? 0.3 : kind === 'storm' ? 0.55 : 0.45;
    this.rainMat.color.set(kind === 'wind' ? 0xffffff : 0xbfd8ff);
    const r = () => Math.random();
    for (let i = 0; i < this.rainN; i++) {
      this.rainPos.set([(r() * 2 - 1) * W, r() * H, (r() * 2 - 1) * W], i * 3);
      this.rainVel[i * 3 + 1] = kind === 'wind' ? (r() - 0.5) * 0.4 : -(kind === 'storm' ? 13 : 10) - r() * 3;
    }
    (this.rain.geometry as THREE.BufferGeometry).setDrawRange(0, this.rainN * 2);
    for (let i = 0; i < 600; i++) {
      this.snowPos.set([(r() * 2 - 1) * W, r() * H, (r() * 2 - 1) * W], i * 3);
      this.snowPh[i] = r() * 6.28;
    }
    for (let i = 0; i < 80; i++) {
      this.leafPos.set([(r() * 2 - 1) * W, 0.1 + r() * 3, (r() * 2 - 1) * W], i * 3);
      this.leafRot.set([r() * 6.28, r() * 6.28, r() * 6.28, 0.5 + r()], i * 4);
    }
  }

  /** Vent dans le repère local (direction horizontale × force). */
  private wind(): [number, number, number] {
    const k = this.kind;
    const base = k === 'wind' ? 6 : k === 'storm' ? 4.5 : k === 'leaves' ? 1.8 : k === 'rain' ? 1.2 : k === 'snow' ? 0.7 : 0;
    const gust = 1 + 0.45 * Math.sin(this.t * 0.9) + 0.25 * Math.sin(this.t * 2.3 + 1);
    const a = this.windA + 0.6 * Math.sin(this.t * 0.07);
    return [Math.cos(a) * base * gust, Math.sin(a) * base * gust, base * gust];
  }

  /** Poussée latérale du vent sur le véhicule (à ajouter au braquage), -1..1. */
  steerBias(carLeft: THREE.Vector3): number {
    if (this.kind !== 'wind' && this.kind !== 'storm') return 0;
    const [wx, wz, s] = this.wind();
    if (s <= 0) return 0;
    _d.set(wx, 0, wz).applyQuaternion(this.group.quaternion);
    return -_d.dot(carLeft) * 0.035;
  }

  update(dt: number, carPos: THREE.Vector3, up: THREE.Vector3, camera: THREE.Camera): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.boltT > 0) {
      this.boltT -= dt;
      (this.bolt.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.boltT / 0.3) * (0.6 + 0.4 * Math.sin(this.boltT * 90));
      if (this.boltT <= 0) this.bolt.visible = false;
    }
    if (this.kind === 'none') return;
    // Repère qui suit la voiture ; la voiture se déplace : les particules restent dans le monde
    this.group.position.copy(carPos);
    this.group.quaternion.setFromUnitVectors(_y, up);
    this.group.updateMatrixWorld(true);
    _d.set(0, 0, 0);
    if (this.hasLast) _d.copy(carPos).sub(this.last).applyQuaternion(_q.copy(this.group.quaternion).invert());
    if (_d.lengthSq() > 4) _d.set(0, 0, 0); // téléportation (changement de planète)
    this.last.copy(carPos);
    this.hasLast = true;
    const [wx, wz] = this.wind();
    // Pluie (traits) / vent (filets d'air horizontaux)
    if (this.rainN) {
      const pos = (this.rain.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      const isWind = this.kind === 'wind';
      for (let i = 0; i < this.rainN; i++) {
        const j = i * 3;
        const vy = this.rainVel[j + 1];
        const vx = isWind ? wx * 2.2 : wx;
        const vz = isWind ? wz * 2.2 : wz;
        let x = this.rainPos[j] + vx * dt - _d.x;
        let y = this.rainPos[j + 1] + vy * dt - _d.y;
        let z = this.rainPos[j + 2] + vz * dt - _d.z;
        if (y < 0) {
          y += H;
          x = (Math.random() * 2 - 1) * W;
          z = (Math.random() * 2 - 1) * W;
        }
        x = wrap(x, -W, W);
        z = wrap(z, -W, W);
        y = wrap(y, 0, H);
        this.rainPos[j] = x;
        this.rainPos[j + 1] = y;
        this.rainPos[j + 2] = z;
        const l = isWind ? 0.09 : 0.045;
        a[i * 6] = x;
        a[i * 6 + 1] = y;
        a[i * 6 + 2] = z;
        a[i * 6 + 3] = x - vx * l;
        a[i * 6 + 4] = y - vy * l;
        a[i * 6 + 5] = z - vz * l;
      }
      pos.needsUpdate = true;
    }
    // Neige : flocons qui tombent doucement en se balançant
    if (this.kind === 'snow') {
      const pos = (this.snow.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < 600; i++) {
        const j = i * 3;
        const ph = this.snowPh[i];
        let x = this.snowPos[j] + (wx * 0.4 + Math.sin(this.t * 1.3 + ph) * 0.35) * dt - _d.x;
        let y = this.snowPos[j + 1] - (0.7 + 0.3 * Math.sin(ph * 3)) * dt - _d.y;
        let z = this.snowPos[j + 2] + (wz * 0.4 + Math.cos(this.t * 1.1 + ph) * 0.35) * dt - _d.z;
        x = wrap(x, -W, W);
        z = wrap(z, -W, W);
        y = wrap(y, 0, H);
        this.snowPos[j] = a[j] = x;
        this.snowPos[j + 1] = a[j + 1] = y;
        this.snowPos[j + 2] = a[j + 2] = z;
      }
      pos.needsUpdate = true;
    }
    // Feuilles : emportées par le vent, elles virevoltent près du sol
    if (this.leafN) {
      for (let i = 0; i < this.leafN; i++) {
        const j = i * 3;
        const r = this.leafRot;
        const k = i * 4;
        const sp = r[k + 3];
        let x = this.leafPos[j] + wx * 1.4 * sp * dt - _d.x;
        let y = this.leafPos[j + 1] + (Math.sin(this.t * 2.2 + r[k]) * 0.5 - 0.15) * dt - _d.y;
        let z = this.leafPos[j + 2] + wz * 1.4 * sp * dt - _d.z;
        x = wrap(x, -W, W);
        z = wrap(z, -W, W);
        y = wrap(y, 0.05, 3.2);
        this.leafPos[j] = x;
        this.leafPos[j + 1] = y;
        this.leafPos[j + 2] = z;
        r[k] += dt * 3 * sp;
        r[k + 1] += dt * 4.3 * sp;
        r[k + 2] += dt * 2.1 * sp;
        _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(r[k], r[k + 1], r[k + 2])), _s.setScalar(0.2));
        this.leaves.setMatrixAt(i, _m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    // Orage : éclairs et coups de foudre au sol, à distance du véhicule
    if (this.kind === 'storm') {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = 4 + Math.random() * 5;
        this.flash = 1;
        const a = Math.random() * 6.28;
        const d = 2.5 + Math.random() * 2.5;
        const at = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
        this.group.localToWorld(at);
        this.strike(at, up, camera);
      }
    }
  }

  private strike(at: THREE.Vector3, up: THREE.Vector3, camera: THREE.Camera): void {
    // Éclair en zigzag du ciel jusqu'au point d'impact (ruban tourné vers la caméra)
    const pts: THREE.Vector3[] = [];
    const side = new THREE.Vector3().crossVectors(up, camera.getWorldDirection(new THREE.Vector3())).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const j = i === 0 || i === 10 ? 0 : 1;
      pts.push(at.clone().addScaledVector(up, (1 - k) * 9).addScaledVector(side, (Math.random() - 0.5) * 0.9 * j).addScaledVector(fwd, (Math.random() - 0.5) * 0.5 * j));
    }
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const w = 0.07 * (1 - (i / 10) * 0.5);
      pos.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      if (i < 10) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.bolt.geometry.dispose();
    this.bolt.geometry = g;
    (this.bolt.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.bolt.visible = true;
    this.boltT = 0.3;
    this.onStrike(at);
  }
}
