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
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uSaturation;
uniform float uContrastP;
uniform vec3 uTint;
uniform float uSoftClip;
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
  if (uBloom > 0.0) col += texture2D(tBloom, uv).rgb * uBloom;
  if (uGrade) {
    col = LMS_2_LIN * (uWhiteBalance * (LIN_2_LMS * col));
    col = logCToLin((linToLogC(col) - 0.4135884) * uContrast + 0.4135884);
  }
  // Étalonnage « premium » (préréglage Arcade) : saturation, contraste, teinte
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation) * uTint;
  col = (col - 0.18) * uContrastP + 0.18;
  col = max(col, 0.0);
  // Épaule douce : les hautes lumières du bloom ne saturent pas brutalement
  if (uSoftClip > 0.0) col = mix(col, min(col, 0.8 + 0.2 * (1.0 - exp(-(col - 0.8) / 0.2))), step(0.8, col) * uSoftClip);
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
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
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
        tBloom: { value: null },
        uBloom: { value: 0 },
        uSaturation: { value: 1 },
        uContrastP: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uSoftClip: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.roundedVignette = val(vg, 'rounded', false) as boolean;
    this.profileValues = { chroma: this.mat.uniforms.uChroma.value, vigIntensity: this.mat.uniforms.uVigIntensity.value, vigSmooth: this.mat.uniforms.uVigSmooth.value };
    this.profileVigColor = this.mat.uniforms.uVigColor.value.clone();
    const type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    for (let i = 0; i < 5; i++) this.mips.push(new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: false }));
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const common = { depthTest: false, depthWrite: false };
    this.bright = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.12 }, knee: { value: 0.2 } },
      vertexShader: vs,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold; uniform float knee; varying vec2 vUv;
        vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * texel).rgb; }
        void main(){
          vec3 c = (s(vec2(-1.0,-1.0)) + s(vec2(1.0,-1.0)) + s(vec2(-1.0,1.0)) + s(vec2(1.0,1.0))) * 0.25;
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee + 1e-4);
          float w = max(soft, br - threshold) / max(br, 1e-4);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
    });
    this.down = new THREE.ShaderMaterial({
      ...common,
      uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: vs,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
          c += texture2D(tSrc, vUv + vec2(-1.0,-1.0) * texel).rgb;
          c += texture2D(tSrc, vUv + vec2(1.0,-1.0) * texel).rgb;
          c += texture2D(tSrc, vUv + vec2(-1.0,1.0) * texel).rgb;
          c += texture2D(tSrc, vUv + vec2(1.0,1.0) * texel).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0);
        }`,
    });
    this.up = new THREE.ShaderMaterial({
      ...common,
      blending: THREE.AdditiveBlending,
      transparent: true,
      uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: vs,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
        void main(){
          vec2 h = texel * 0.5;
          vec3 c = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
          c += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
          c += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
          gl_FragColor = vec4(c / 12.0, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private roundedVignette: boolean;
  private readonly profileValues: Record<string, number>;

  // --- Bloom : seuil + chaîne de mips (filtre double de Kawase), mobile-friendly
  private readonly mips: THREE.WebGLRenderTarget[] = [];
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly bright: THREE.ShaderMaterial;
  bloomEnabled = false;

  /** Préréglage « premium » (Arcade) ou profil URP exact (Original). */
  setPremium(on: boolean, opts: { bloom: boolean; chroma?: number } = { bloom: true }): void {
    const u = this.mat.uniforms;
    if (on) {
      u.uChroma.value = (opts.chroma ?? 0.12) * 0.05;
      u.uVigIntensity.value = 0.3 * 3;
      u.uVigSmooth.value = 0.6 * 5;
      u.uVigColor.value.set(0.02, 0.02, 0.06);
      u.uSaturation.value = 1.1;
      u.uContrastP.value = 1.07;
      u.uTint.value.set(1.02, 1.0, 1.03);
      u.uSoftClip.value = 1;
      this.bloomEnabled = opts.bloom;
    } else {
      u.uChroma.value = this.profileValues.chroma;
      u.uVigIntensity.value = this.profileValues.vigIntensity;
      u.uVigSmooth.value = this.profileValues.vigSmooth;
      u.uVigColor.value.copy(this.profileVigColor);
      u.uSaturation.value = 1;
      u.uContrastP.value = 1;
      u.uTint.value.set(1, 1, 1);
      u.uSoftClip.value = 0;
      this.bloomEnabled = false;
    }
    u.uBloom.value = this.bloomEnabled ? 0.5 : 0;
  }
  private readonly profileVigColor: THREE.Vector3;

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
    this.mat.uniforms.uVigRound.value = this.roundedVignette ? w / h : 1;
    let mw = Math.max(1, Math.floor(w / 2));
    let mh = Math.max(1, Math.floor(h / 2));
    for (const m of this.mips) {
      m.setSize(mw, mh);
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
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
    if (this.bloomEnabled) {
      // Seuil + première réduction
      this.bright.uniforms.tSrc.value = this.rt.texture;
      this.bright.uniforms.texel.value.set(1 / this.rt.width, 1 / this.rt.height);
      this.pass(this.bright, this.mips[0]);
      for (let i = 1; i < this.mips.length; i++) {
        this.down.uniforms.tSrc.value = this.mips[i - 1].texture;
        this.down.uniforms.texel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.pass(this.down, this.mips[i]);
      }
      // Remontée additive
      const autoClear = r.autoClear;
      r.autoClear = false;
      for (let i = this.mips.length - 1; i > 0; i--) {
        this.up.uniforms.tSrc.value = this.mips[i].texture;
        this.up.uniforms.texel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this.pass(this.up, this.mips[i - 1]);
      }
      r.autoClear = autoClear;
      this.mat.uniforms.tBloom.value = this.mips[0].texture;
    }
    this.pass(this.mat, null);
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
