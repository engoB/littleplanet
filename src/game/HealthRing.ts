/**
 * Jauge de santé au sol, autour du véhicule (préréglage Arcade) : petites
 * barres aux coins arrondis, dégradé du vert au rouge, qui s'éteignent par le
 * côté vert (il reste le rouge quand la santé est basse),
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
// 15 cases (une case = 10 de santé avec la santé maximale Arcade de 150)
const float N = 15.0;
const float RC = 0.9;
// Dégradé le long de la jauge : vert au début, jaune, rouge à la fin
vec3 barColor(float t) {
  vec3 green = vec3(0.25, 1.0, 0.4), yellow = vec3(1.0, 0.85, 0.15), red = vec3(1.0, 0.2, 0.14);
  return t < 0.5 ? mix(green, yellow, t * 2.0) : mix(yellow, red, (t - 0.5) * 2.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r < 0.75 || r > 1.0) discard;
  // Angle depuis l'avant (+y du plan), sens horaire, 0..1
  float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  // Petites barres aux coins arrondis (repère local : longueur d'arc × rayon)
  float i = floor(a * N);
  float t = (i + 0.5) / N;
  vec2 q = vec2((a * N - i - 0.5) * 6.2831853 * RC / N, r - RC);
  float d = sdRoundBox(q, vec2(0.5 * 6.2831853 * RC / N * 0.62, 0.06), 0.035);
  float aa = fwidth(d) * 1.2;
  float bar = 1.0 - smoothstep(-aa, aa, d);
  if (bar <= 0.0) discard;
  // La jauge se vide par le début (vert) : il reste le rouge quand la santé est basse
  float on = step(1.0 - hp, t);
  float lost = step(1.0 - shown, t) * (1.0 - on);
  vec3 c = barColor(t);
  float low = hp < 0.3 ? 0.55 + 0.45 * sin(time * 10.0) : 1.0;
  vec3 col = mix(vec3(0.06, 0.08, 0.14), c * low, on);
  col = mix(col, vec3(1.0, 0.95, 0.85), lost * 0.85);
  col = mix(col, vec3(1.4), flash);
  // Discret : plus marqué juste après un choc ou santé basse
  float k = max(attn, hp < 0.3 ? 0.6 : 0.0);
  float alpha = bar * mix(mix(0.12, 0.25, k), mix(0.45, 0.9, k), max(on, lost));
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
