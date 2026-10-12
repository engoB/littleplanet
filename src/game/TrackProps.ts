/**
 * Objets posés sur la piste des planètes circuit :
 *  - cubes bonus arc-en-ciel (rangées de trois) : turbo plein, réapparaissent ;
 *  - tremplins : le véhicule s'envole (saut) ;
 *  - arche de départ en damier.
 * Positions calculées depuis la piste (track.ts), en espace planète.
 */
import * as THREE from 'three';
import { toonGradient } from './toon';
import { trackPoint, trackTangent, type TrackDef } from './track';

const BOX_FRAG = /* glsl */ `
uniform float time;
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vN;
varying float vSeed;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  float m = texture2D(map, vUv).a;
  vec3 c = mix(vec3(1.0), hue(fract(time * 0.25 + vSeed + vUv.x * 0.3 + vUv.y * 0.2)), 0.65);
  c = mix(c, vec3(1.0), m);
  float rim = pow(1.0 - abs(vN.z), 2.0);
  gl_FragColor = vec4(c * (1.05 + rim * 0.6), 0.62 + 0.38 * m);
  #include <colorspace_fragment>
}`;
const BOX_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = fract(instanceMatrix[3].x * 3.7 + instanceMatrix[3].z * 1.3);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

function questionAlpha(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.font = 'bold 46px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText('?', 32, 35);
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 56, 56);
  return new THREE.CanvasTexture(c);
}

function checkerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd23a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#222';
  for (let i = -64; i < 128; i += 22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 11, 0);
    g.lineTo(i + 11 - 64, 64);
    g.lineTo(i - 64, 64);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_BOX = 24;
const MAX_RAMP = 6;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

interface Box {
  dir: THREE.Vector3;
  respawn: number;
}

export class TrackProps {
  readonly group = new THREE.Group();
  private readonly boxMesh: THREE.InstancedMesh;
  private readonly boxMat: THREE.ShaderMaterial;
  private readonly rampMesh: THREE.InstancedMesh;
  private readonly arch: THREE.Group;
  private boxes: Box[] = [];
  /** Tremplins : direction et axe avant (espace planète). */
  ramps: { dir: THREE.Vector3; fwd: THREE.Vector3 }[] = [];
  private radius = 5;
  private scale = 1;
  private spin = 0;

  constructor(parent: THREE.Object3D) {
    this.boxMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, map: { value: questionAlpha() } }, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG, transparent: true });
    this.boxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), this.boxMat, MAX_BOX);
    this.boxMesh.count = 0;
    this.boxMesh.frustumCulled = false;
    this.boxMesh.renderOrder = 2;
    // Tremplin : coin incliné à bandes jaunes et noires
    const rg = new THREE.BoxGeometry(0.62, 0.16, 0.5);
    const pos = rg.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getZ(i) > 0 ? 0.16 : -0.08);
    rg.translate(0, 0.08, 0);
    rg.computeVertexNormals();
    this.rampMesh = new THREE.InstancedMesh(rg, new THREE.MeshToonMaterial({ color: 0xffffff, map: stripeTexture(), gradientMap: toonGradient() }), MAX_RAMP);
    this.rampMesh.count = 0;
    this.rampMesh.frustumCulled = false;
    this.rampMesh.castShadow = true;
    // Arche de départ : deux poteaux et une banderole en damier
    this.arch = new THREE.Group();
    const poleMat = new THREE.MeshToonMaterial({ color: 0xe8333a, gradientMap: toonGradient() });
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 10), poleMat);
      pole.position.set(sx * 0.5, 0.45, 0);
      pole.name = 'pole';
      this.arch.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.04), new THREE.MeshToonMaterial({ color: 0xffffff, map: checkerTexture(), gradientMap: toonGradient() }));
    banner.position.y = 0.88;
    this.arch.add(banner);
    this.arch.visible = false;
    this.group.add(this.boxMesh, this.rampMesh, this.arch);
    parent.add(this.group);
  }

  /** Place les objets de la piste (ou rien si la planète n'a pas de piste). */
  build(track: TrackDef | undefined, radius: number, scale: number): void {
    this.radius = radius;
    this.scale = scale;
    this.boxes = [];
    this.ramps = [];
    this.arch.visible = false;
    this.boxMesh.count = 0;
    this.rampMesh.count = 0;
    if (!track) return;
    for (const phi of track.items) {
      for (const k of [-0.55, 0, 0.55]) this.boxes.push({ dir: trackPoint(track, phi, k * track.width), respawn: 0 });
    }
    for (const phi of track.ramps) {
      const dir = trackPoint(track, phi);
      this.ramps.push({ dir, fwd: trackTangent(track, phi) });
    }
    this.rampMesh.count = this.ramps.length;
    this.ramps.forEach((r, i) => {
      this.orient(r.dir, r.fwd, 0);
      _s.setScalar(1 / scale);
      _m.compose(_p, _q, _s);
      this.rampMesh.setMatrixAt(i, _m);
    });
    this.rampMesh.instanceMatrix.needsUpdate = true;
    if (track.arch) {
      const d = trackPoint(track, 0.035);
      this.orient(d, trackTangent(track, 0.035), 0);
      this.arch.position.copy(_p);
      this.arch.quaternion.copy(_q);
      // Largeur de la piste en unités monde → écartement des poteaux
      const w = track.width * radius;
      this.arch.scale.setScalar(1 / scale);
      this.arch.children.forEach((c) => {
        if (c.name === 'pole') c.position.x = Math.sign(c.position.x) * (w + 0.08);
        else c.scale.x = (w * 2 + 0.2) / 1.1;
      });
      this.arch.visible = true;
    }
    this.update(0);
  }

  /** Repère local : +Y = normale, +Z = avant ; position à la surface (+ lift monde). */
  private orient(dir: THREE.Vector3, fwd: THREE.Vector3, lift: number): void {
    _z.copy(fwd).addScaledVector(dir, -fwd.dot(dir)).normalize();
    _x.crossVectors(dir, _z).normalize();
    _m.makeBasis(_x, dir, _z);
    _q.setFromRotationMatrix(_m);
    _p.copy(dir).multiplyScalar((this.radius + lift) / this.scale);
  }

  update(dt: number): void {
    this.spin += dt;
    this.boxMat.uniforms.time.value = this.spin;
    let n = 0;
    for (const b of this.boxes) {
      b.respawn = Math.max(0, b.respawn - dt);
      if (b.respawn > 0) continue;
      const up = b.dir;
      _z.set(0, 0, 1).addScaledVector(up, -up.z);
      if (_z.lengthSq() < 1e-4) _z.set(1, 0, 0);
      this.orient(up, _z.normalize(), 0.32 + 0.05 * Math.sin(this.spin * 3 + n));
      _q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, this.spin * 2 + n, 0.3)));
      _s.setScalar(1 / this.scale);
      _m.compose(_p, _q, _s);
      this.boxMesh.setMatrixAt(n++, _m);
    }
    this.boxMesh.count = n;
    this.boxMesh.instanceMatrix.needsUpdate = true;
  }

  /** Cube bonus touché par le véhicule (direction espace planète) ? */
  collect(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    for (const b of this.boxes) {
      if (b.respawn > 0) continue;
      if (b.dir.angleTo(carDir) * R < reach) {
        b.respawn = 4;
        return true;
      }
    }
    return false;
  }

  /** Tremplin sous le véhicule ? */
  rampAt(carDir: THREE.Vector3, reach: number, R = this.radius): boolean {
    return this.ramps.some((r) => r.dir.angleTo(carDir) * R < reach);
  }

  /** Positions des cubes visibles (mini-carte), espace planète. */
  boxDirs(): THREE.Vector3[] {
    return this.boxes.filter((b) => b.respawn <= 0).map((b) => b.dir);
  }
}
