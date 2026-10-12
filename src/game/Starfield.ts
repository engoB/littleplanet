/**
 * Champ d'étoiles en points 3D (nets à toute résolution, contrairement à une
 * skybox basse définition), centré sur la caméra, scintillement léger.
 */
import * as THREE from 'three';
import { URandom } from '../unity/math';

const VERT = /* glsl */ `
attribute float size;
attribute float phase;
uniform float uTime;
uniform float uScale;
varying float vA;
varying vec3 vC;
attribute vec3 tint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999; // toujours au fond
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + phase) + phase * 10.0);
  gl_PointSize = size * uScale;
  vA = tw;
  vC = tint;
}`;
const FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  float a = core * core * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * a, 0.0);
  #include <colorspace_fragment>
}`;

export class Starfield {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count = 1800) {
    const rng = new URandom(7);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const d = rng.onUnitSphere().multiplyScalar(20);
      pos.set([d.x, d.y, d.z], i * 3);
      const m = Math.pow(rng.value, 5);
      size[i] = 1.4 + 4.5 * m;
      phase[i] = rng.value * 6.28;
      const warm = rng.value;
      tint.set([0.8 + 0.2 * warm, 0.85 + 0.1 * rng.value, 1.0 - 0.15 * warm].map((c) => c * (0.55 + 0.6 * m)), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -20;
    this.points.visible = false;
  }

  update(camera: THREE.Camera, viewH: number, time: number): void {
    camera.getWorldPosition(this.points.position);
    this.points.updateMatrixWorld();
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = Math.max(0.75, viewH / 720);
  }
}
