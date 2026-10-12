/** Effets visuels du préréglage Arcade : réticule d'impact, halo des horloges. */
import * as THREE from 'three';

const RETICLE_FRAG = /* glsl */ `
uniform float progress;
uniform float time;
uniform vec3 color;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float aa = fwidth(r) * 1.5;
  // Anneau extérieur à 4 segments qui tourne
  float ring = smoothstep(0.80 + aa, 0.80, r) * smoothstep(0.66 - aa, 0.66, r);
  float seg = step(0.18, abs(fract((a + time * 1.8) / 1.5708) - 0.5) * 2.0);
  ring *= seg;
  float ringOut = smoothstep(0.88 + aa, 0.88, r) * smoothstep(0.58 - aa, 0.58, r) * seg;
  // Disque de remplissage : grandit jusqu'à l'impact
  float fillR = 0.62 * progress;
  float fill = smoothstep(fillR + aa, fillR, r) * 0.55;
  float edge = smoothstep(fillR + aa, fillR, r) * smoothstep(fillR - 0.07 - aa, fillR - 0.07, r);
  // Croix centrale
  float cross = (step(abs(p.x), 0.05) + step(abs(p.y), 0.05)) * step(r, 0.34) * step(0.14, r);
  float dot0 = smoothstep(0.09 + aa, 0.09, r);
  float lit = max(max(ring, edge), max(min(cross, 1.0), dot0));
  float alpha = max(max(ringOut, fill), lit);
  vec3 c = mix(vec3(0.05, 0.02, 0.02), color, step(0.01, max(lit, fill)));
  c = mix(c, vec3(1.0, 0.95, 0.8), edge * progress);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(c * (1.0 + 1.5 * lit * progress), alpha);
  #include <colorspace_fragment>
}`;

export function reticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { progress: { value: 0 }, time: { value: 0 }, color: { value: new THREE.Color(1, 0.18, 0.05) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: RETICLE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

const BEAM_FRAG = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float opacity;
varying vec2 vUv;
void main() {
  float a = (1.0 - vUv.y) * (0.55 + 0.45 * sin(vUv.y * 18.0 - time * 6.0));
  a *= smoothstep(0.0, 0.08, vUv.y);
  gl_FragColor = vec4(color * a * opacity * 1.6, 0.0);
  #include <colorspace_fragment>
}`;

/** Faisceau lumineux vertical + disque au sol pour repérer une horloge. */
export function clockBeacon(color = 0xffd34d): { group: THREE.Group; beam: THREE.ShaderMaterial; glow: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const beam = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, opacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.6, 16, 1, true).translate(0, 0.8, 0), beam);
  cyl.renderOrder = 3;
  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.3, 32).rotateX(-Math.PI / 2).translate(0, 0.01, 0), glowMat);
  g.add(cyl, disc);
  return { group: g, beam, glow: glowMat };
}
