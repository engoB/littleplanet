/**
 * Fond « magique » du choix des mondes, façon Mario Galaxy : voûte de
 * nébuleuses colorées, étoiles scintillantes en croix et fragments d'étoile
 * qui dérivent doucement devant les planètes.
 */
import * as THREE from 'three';
import { URandom } from '../unity/math';

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOME_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float t = uTime * 0.015;
  // Fond : indigo profond, plus clair vers le bas (halo galactique)
  vec3 col = mix(vec3(0.07, 0.03, 0.2), vec3(0.01, 0.01, 0.06), smoothstep(-0.4, 0.8, d.y));
  // Nébuleuses : trois nappes de couleur
  float n1 = fbm(d * 2.2 + vec3(t, 0.0, -t));
  float n2 = fbm(d * 3.1 + vec3(5.2, -t, 1.3));
  float n3 = fbm(d * 1.6 + vec3(-2.0, 3.0, t));
  col += vec3(0.55, 0.12, 0.6) * pow(smoothstep(0.45, 0.85, n1), 1.6) * 0.9;
  col += vec3(0.08, 0.35, 0.75) * pow(smoothstep(0.5, 0.9, n2), 1.5) * 0.85;
  col += vec3(0.85, 0.35, 0.25) * pow(smoothstep(0.55, 0.95, n3), 2.0) * 0.6;
  // Bande galactique lumineuse en travers
  float band = exp(-pow((d.y - 0.35 * d.x) * 3.2, 2.0));
  col += vec3(0.35, 0.25, 0.6) * band * (0.35 + 0.65 * fbm(d * 6.0 + t));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */ `
attribute float size;
attribute float phase;
attribute vec3 tint;
uniform float uTime;
uniform float uScale;
uniform float uDrift;
varying float vA;
varying vec3 vC;
varying float vSpin;
void main() {
  vec3 p = position;
  // Fragments d'étoile : lente dérive verticale en boucle
  p.y = mod(p.y + uTime * uDrift * (0.3 + 0.2 * fract(phase)), 12.0) - 6.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * (1.2 + fract(phase * 3.7) * 2.5) + phase * 6.28);
  vA = 0.25 + 0.75 * tw * tw;
  gl_PointSize = size * uScale * (0.75 + 0.45 * tw) * (uDrift > 0.0 ? 10.0 / max(1.0, -mv.z) : 1.0);
  vC = tint;
  vSpin = uTime * 0.6 + phase;
}`;
const STAR_FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
varying float vSpin;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vSpin * 0.2), s = sin(vSpin * 0.2);
  p = mat2(c, -s, s, c) * p;
  float r = length(p) * 2.0;
  // Cœur doux + rayons en croix (étincelle)
  float core = exp(-r * r * 9.0);
  float rays = exp(-abs(p.x) * 38.0) * exp(-abs(p.y) * 3.5) + exp(-abs(p.y) * 38.0) * exp(-abs(p.x) * 3.5);
  float a = (core + rays * 0.8) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * a, 0.0);
  #include <colorspace_fragment>
}`;

const PALETTE = [
  [1, 0.95, 0.75],
  [1, 0.85, 0.35],
  [0.55, 0.9, 1],
  [1, 0.55, 0.85],
  [0.75, 0.65, 1],
  [1, 1, 1],
];

function stars(n: number, seed: number, place: (rng: URandom) => THREE.Vector3, sizeMin: number, sizeMax: number, drift: number): { pts: THREE.Points; mat: THREE.ShaderMaterial } {
  const rng = new URandom(seed);
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const tint = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = place(rng);
    pos.set([v.x, v.y, v.z], i * 3);
    const m = Math.pow(rng.value, 3);
    size[i] = sizeMin + (sizeMax - sizeMin) * m;
    phase[i] = rng.value * 10;
    const c = PALETTE[Math.floor(rng.value * PALETTE.length)];
    const k = 0.8 + 0.7 * m;
    tint.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uDrift: { value: drift } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

export class MagicSky {
  readonly group = new THREE.Group();
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), this.domeMat);
    dome.renderOrder = -40;
    dome.frustumCulled = false;
    this.group.add(dome);
    // Étoiles lointaines sur la voûte
    const far = stars(900, 11, (r) => r.onUnitSphere().multiplyScalar(80), 4, 26, 0);
    far.pts.renderOrder = -35;
    far.mat.depthTest = false;
    // Fragments d'étoile qui dérivent entre la caméra et les planètes
    const near = stars(90, 23, (r) => new THREE.Vector3(r.range(-7, 7), r.range(-6, 6), r.range(-6, 4)), 7, 18, 0.35);
    this.mats.push(far.mat, near.mat);
    this.group.add(far.pts, near.pts);
  }

  update(time: number, viewH: number): void {
    this.domeMat.uniforms.uTime.value = time;
    for (const m of this.mats) {
      m.uniforms.uTime.value = time;
      m.uniforms.uScale.value = Math.max(0.75, viewH / 720);
    }
  }
}
