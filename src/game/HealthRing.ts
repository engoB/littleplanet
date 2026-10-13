/**
 * Jauge de santé au sol, autour du véhicule (préréglage Arcade) : anneau
 * segmenté qui se vide dans le sens horaire depuis l'avant, du vert au rouge,
 * clignote quand la santé est basse et flashe blanc à chaque choc.
 * Remplace la barre de santé du HUD, illisible en pleine partie.
 */
import * as THREE from 'three';

const FRAG = /* glsl */ `
uniform float hp;
uniform float shown;
uniform float flash;
uniform float time;
uniform float attn;
varying vec2 vUv;
vec3 hpColor(float k) {
  vec3 red = vec3(1.0, 0.18, 0.12), yellow = vec3(1.0, 0.82, 0.15), green = vec3(0.25, 1.0, 0.35);
  return k < 0.5 ? mix(red, yellow, k * 2.0) : mix(yellow, green, (k - 0.5) * 2.0);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // Anneau fin entre 0,86 et 0,96 du rayon (bords adoucis)
  float ring = smoothstep(0.85, 0.88, r) * (1.0 - smoothstep(0.94, 0.97, r));
  if (ring <= 0.0) discard;
  // Angle depuis l'avant (+y du plan), sens horaire, 0..1
  float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  // 12 segments séparés par de fins espaces
  float seg = fract(a * 12.0);
  float gap = smoothstep(0.0, 0.05, seg) * (1.0 - smoothstep(0.95, 1.0, seg));
  float on = step(a, hp);
  float lost = step(a, shown) * (1.0 - on); // portion perdue récemment (traînée)
  vec3 c = hpColor(hp);
  float low = hp < 0.3 ? 0.55 + 0.45 * sin(time * 10.0) : 1.0;
  vec3 col = mix(vec3(0.05, 0.07, 0.12), c * low, on);
  col = mix(col, vec3(1.0, 0.95, 0.85), lost * 0.85);
  col = mix(col, vec3(1.4), flash);
  // Discret : presque transparent, plus marqué juste après un choc ou santé basse
  float k = max(attn, hp < 0.3 ? 0.6 : 0.0);
  float alpha = ring * gap * mix(mix(0.08, 0.2, k), mix(0.32, 0.85, k), max(on, lost));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export class HealthRing {
  readonly mesh: THREE.Mesh;
  private readonly u: { hp: { value: number }; shown: { value: number }; flash: { value: number }; time: { value: number }; attn: { value: number } };

  constructor(parent: THREE.Object3D, radius: number) {
    this.u = { hp: { value: 1 }, shown: { value: 1 }, flash: { value: 0 }, time: { value: 0 }, attn: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    // Plan couché sur le sol, +y du plan vers l'avant du véhicule (+Z local)
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.rotation.z = Math.PI;
    this.mesh.position.y = 0.08;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  set(hp01: number): void {
    if (hp01 < this.u.hp.value - 0.001) this.u.flash.value = this.u.attn.value = 1;
    this.u.hp.value = Math.max(0, Math.min(1, hp01));
    if (this.u.hp.value > this.u.shown.value) this.u.shown.value = this.u.hp.value;
  }

  update(dt: number, time: number): void {
    this.u.time.value = time;
    this.u.flash.value = Math.max(0, this.u.flash.value - dt * 5);
    this.u.attn.value = Math.max(0, this.u.attn.value - dt / 2.5);
    // La part perdue se résorbe après un court délai visuel
    this.u.shown.value += (this.u.hp.value - this.u.shown.value) * Math.min(1, dt * 2.5);
  }

  reset(): void {
    this.u.hp.value = this.u.shown.value = 1;
    this.u.flash.value = this.u.attn.value = 0;
  }
}
