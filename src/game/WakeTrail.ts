/**
 * Sillage sur l'eau : ruban d'écume posé sur la surface derrière le véhicule,
 * qui s'élargit et s'efface (bords écumeux en V, centre bouillonnant).
 */
import * as THREE from 'three';

const N = 56;
/** Durée de vie d'un point du sillage (s) et intervalle d'échantillonnage. */
const LIFE = 2.2;
const STEP = 0.04;

const VERT = /* glsl */ `
attribute float alpha;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying float vA;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float x = abs(vUv.x * 2.0 - 1.0);
  // Bords écumeux (le V du sillage) et centre bouillonnant, déchirés par le bruit
  float edge = smoothstep(0.5, 0.85, x) * (1.0 - smoothstep(0.92, 1.0, x));
  float churn = n2(vec2(vUv.x * 9.0, vUv.y * 3.0 - time * 1.5));
  float centre = (1.0 - smoothstep(0.0, 0.45, x)) * smoothstep(0.35, 0.75, churn) * 0.6;
  float tear = smoothstep(0.25, 0.6, n2(vec2(vUv.x * 14.0 + 3.0, vUv.y * 5.0)));
  float a = (edge * tear + centre) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), a);
  #include <colorspace_fragment>
}`;

interface P {
  pos: THREE.Vector3;
  side: THREE.Vector3;
  age: number;
}

export class WakeTrail {
  readonly mesh: THREE.Mesh;
  private readonly pts: P[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos = new Float32Array(N * 2 * 3);
  private readonly uv = new Float32Array(N * 2 * 2);
  private readonly al = new Float32Array(N * 2);
  private acc = 0;
  private readonly mat: THREE.ShaderMaterial;

  constructor(parent: THREE.Object3D) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
  }

  clear(): void {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** `at` : point de la surface sous le véhicule ; `side` : sa droite ; `active` : sur l'eau. */
  update(dt: number, time: number, at: THREE.Vector3, side: THREE.Vector3, active: boolean, speed = 1): void {
    this.mat.uniforms.time.value = time;
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[0].age > LIFE) this.pts.shift();
    this.acc += dt;
    if (active && this.acc >= STEP) {
      this.acc = 0;
      this.pts.push({ pos: at.clone(), side: side.clone().normalize(), age: 0 });
      if (this.pts.length > N) this.pts.shift();
    }
    if (!active) this.acc = STEP;
    const n = this.pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    let v = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      if (i > 0) v += p.pos.distanceTo(this.pts[i - 1].pos);
      // Plus large en vieillissant (le V s'ouvre), plus large en turbo
      const w = (0.16 + p.age * 0.45) * (0.8 + 0.25 * speed);
      const k = Math.max(0, 1 - p.age / LIFE);
      const j = i * 2;
      this.pos[j * 3] = p.pos.x - p.side.x * w;
      this.pos[j * 3 + 1] = p.pos.y - p.side.y * w;
      this.pos[j * 3 + 2] = p.pos.z - p.side.z * w;
      this.pos[j * 3 + 3] = p.pos.x + p.side.x * w;
      this.pos[j * 3 + 4] = p.pos.y + p.side.y * w;
      this.pos[j * 3 + 5] = p.pos.z + p.side.z * w;
      this.uv[j * 2] = 0;
      this.uv[j * 2 + 1] = v;
      this.uv[j * 2 + 2] = 1;
      this.uv[j * 2 + 3] = v;
      // Fondu à la naissance (sous la voiture) et en fin de vie
      const a = Math.min(1, p.age / 0.12) * k * k;
      this.al[j] = this.al[j + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
}
