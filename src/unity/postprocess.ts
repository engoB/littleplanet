/**
 * Post-process URP porté en GLSL (volume « Postprocess Profile » de la scène) :
 * aberration chromatique (chemin rapide de l'Uber shader URP), vignette,
 * balance des blancs (LMS) et contraste (LogC) si actifs dans le profil.
 * Le flou de mouvement, la profondeur de champ et le grain sont inactifs ou
 * non portés (voir README).
 */
import * as THREE from 'three';
import { srgbToLinear } from './curves';
import type { VolumeComponent } from './types';

function val<T>(c: VolumeComponent | undefined, k: string, def: T): T {
  const v = c?.[k];
  if (v && typeof v === 'object' && 'value' in v && v.override) return v.value as T;
  return def;
}

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uChroma;
uniform vec3 uVigColor;
uniform vec2 uVigCenter;
uniform float uVigIntensity;
uniform float uVigSmooth;
uniform float uVigRound;
uniform vec3 uWhiteBalance;
uniform float uContrast;
uniform bool uGrade;
varying vec2 vUv;

// Matrices LMS de URP (ColorUtils / Color.hlsl)
const mat3 LIN_2_LMS = mat3(3.90405e-1, 7.08416e-2, 2.31082e-2, 5.49941e-1, 9.63172e-1, 1.28021e-1, 8.92632e-3, 1.35775e-3, 9.36245e-1);
const mat3 LMS_2_LIN = mat3(2.85847e+0, -2.10182e-1, -4.18120e-2, -1.62879e+0, 1.15820e+0, -1.18169e-1, -2.48910e-2, 3.24281e-4, 1.08607e+0);

vec3 linToLogC(vec3 x) { return 0.244161 * log2(5.555556 * x + 0.047996) / 3.321928 + 0.386036; }
vec3 logCToLin(vec3 x) { return (pow(vec3(10.0), (x - 0.386036) / 0.244161) - 0.047996) / 5.555556; }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 uv = vUv;
  vec3 col;
  if (uChroma > 0.0) {
    vec2 coords = 2.0 * uv - 1.0;
    vec2 end = uv - coords * dot(coords, coords) * uChroma;
    vec2 delta = (end - uv) / 3.0;
    col.r = texture2D(tDiffuse, uv).r;
    col.g = texture2D(tDiffuse, delta + uv).g;
    col.b = texture2D(tDiffuse, delta * 2.0 + uv).b;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }
  if (uGrade) {
    col = LMS_2_LIN * (uWhiteBalance * (LIN_2_LMS * col));
    col = logCToLin((linToLogC(col) - 0.4135884) * uContrast + 0.4135884);
  }
  if (uVigIntensity > 0.0) {
    vec2 dist = abs(uv - uVigCenter) * uVigIntensity;
    dist.x *= uVigRound;
    float vf = pow(clamp(1.0 - dot(dist, dist), 0.0, 1.0), uVigSmooth);
    col *= mix(uVigColor, vec3(1.0), vf);
  }
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}`;

export class PostProcess {
  readonly rt: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mat: THREE.ShaderMaterial;
  enabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer, profile: Record<string, VolumeComponent> | undefined, msaa: number) {
    const halfFloat = renderer.capabilities.isWebGL2 !== false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: msaa,
      depthBuffer: true,
    });
    const ca = profile?.ChromaticAberration;
    const vg = profile?.Vignette;
    const wb = profile?.WhiteBalance;
    const ca2 = profile?.ColorAdjustments;
    const caOn = ca?.active ?? false;
    const vgOn = vg?.active ?? false;
    const vc = val<number[]>(vg, 'color', [0, 0, 0, 1]);
    const center = val<number[]>(vg, 'center', [0.5, 0.5]);
    const gradeOn = (wb?.active ?? false) || ((ca2?.active ?? false) && val(ca2, 'contrast', 0) !== 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        // URP : _Chroma_Params = intensité × 0.05
        uChroma: { value: caOn ? val(ca, 'intensity', 0) * 0.05 : 0 },
        uVigColor: { value: new THREE.Vector3(srgbToLinear(vc[0]), srgbToLinear(vc[1]), srgbToLinear(vc[2])) },
        uVigCenter: { value: new THREE.Vector2(center[0], center[1]) },
        // URP : intensité × 3, lissage × 5, arrondi = rapport d'aspect si « rounded »
        uVigIntensity: { value: vgOn ? val(vg, 'intensity', 0) * 3 : 0 },
        uVigSmooth: { value: val(vg, 'smoothness', 0.2) * 5 },
        uVigRound: { value: 1 },
        uWhiteBalance: { value: whiteBalance(val(wb, 'temperature', 0), val(wb, 'tint', 0)) },
        uContrast: { value: 1 + val(ca2, 'contrast', 0) / 100 },
        uGrade: { value: gradeOn },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.roundedVignette = val(vg, 'rounded', false) as boolean;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private roundedVignette: boolean;

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
    this.mat.uniforms.uVigRound.value = this.roundedVignette ? w / h : 1;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}

/** Coefficients de balance des blancs URP (ColorUtils.ColorBalanceToLMSCoeffs). */
export function whiteBalance(temperature: number, tint: number): THREE.Vector3 {
  const t1 = temperature / 65;
  const t2 = tint / 65;
  const x = 0.31271 - t1 * (t1 < 0 ? 0.1 : 0.05);
  const y = 2.87 * x - 3 * x * x - 0.27509507 + t2 * 0.05;
  const X = x / y;
  const Z = (1 - x - y) / y;
  const toLMS = (X1: number, Y1: number, Z1: number) => [0.7328 * X1 + 0.4296 * Y1 - 0.1624 * Z1, -0.7036 * X1 + 1.6975 * Y1 + 0.0061 * Z1, 0.003 * X1 + 0.0136 * Y1 + 0.9834 * Z1];
  const w1 = toLMS(0.949237, 1.03542, 1.08728);
  const w2 = toLMS(X, 1, Z);
  return new THREE.Vector3(w1[0] / w2[0], w1[1] / w2[1], w1[2] / w2[2]);
}
