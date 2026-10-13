/**
 * Case bonus arc-en-ciel « ? » (matériau partagé, rendu en InstancedMesh) :
 * teinte qui tourne avec le temps, point d'interrogation et liseré blancs.
 */
import * as THREE from 'three';

const FRAG = /* glsl */ `
uniform float time;
uniform float opacity;
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
  gl_FragColor = vec4(c * (1.05 + rim * 0.6), (0.62 + 0.38 * m) * opacity);
  #include <colorspace_fragment>
}`;
const VERT = /* glsl */ `
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

let tex: THREE.Texture | null = null;

export function itemBoxMaterial(): THREE.ShaderMaterial {
  tex ??= questionAlpha();
  return new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, opacity: { value: 1 }, map: { value: tex } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true });
}

export function itemBoxMesh(max: number, size = 0.26): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), itemBoxMaterial(), max);
  m.count = 0;
  m.frustumCulled = false;
  m.renderOrder = 2;
  return m;
}
