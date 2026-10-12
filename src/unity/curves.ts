/**
 * Courbes et dégradés Unity exportés par tools/export_scene.py :
 *  - AnimationCurve : clés [temps, valeur, pente entrée, pente sortie], Hermite ;
 *  - MinMaxCurve : mode 0 constante, 1 courbe, 2 deux courbes, 3 deux constantes ;
 *  - MinMaxGradient : mode 0 couleur, 1 dégradé, 2 deux couleurs, 3 deux dégradés.
 */
export type Key = [number, number, number, number];

export interface MinMaxCurve {
  mode: number;
  scalar: number;
  minScalar: number;
  max: Key[];
  min: Key[];
}

export interface Gradient {
  colors: [number, number, number, number][];
  alphas: [number, number][];
  fixed: boolean;
}

export interface MinMaxGradient {
  mode: number;
  minColor: number[];
  maxColor: number[];
  max: Gradient;
  min: Gradient;
}

const BIG = 1e29; // les pentes infinies sont exportées en ±1e30 (marches)

/** AnimationCurve.Evaluate (interpolation d'Hermite, bornes « clamp »). */
export function evalCurve(keys: Key[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1 || t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0, , o0] = keys[i];
  const [t1, v1, i1] = keys[i + 1];
  const dt = t1 - t0;
  if (dt <= 0) return v1;
  if (Math.abs(o0) > BIG || Math.abs(i1) > BIG) return v0; // marche constante
  const s = (t - t0) / dt;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * v0 + h10 * dt * o0 + h01 * v1 + h11 * dt * i1;
}

/** MinMaxCurve.Evaluate(t, lerp) : lerp ∈ [0,1] est l'aléa de la particule. */
export function evalMinMax(c: MinMaxCurve | undefined, t: number, lerp: number): number {
  if (!c) return 0;
  switch (c.mode) {
    case 0:
      return c.scalar;
    case 1:
      return c.scalar * evalCurve(c.max, t);
    case 2:
      return c.scalar * (evalCurve(c.min, t) + (evalCurve(c.max, t) - evalCurve(c.min, t)) * lerp);
    case 3:
      return c.minScalar + (c.scalar - c.minScalar) * lerp;
    default:
      return c.scalar;
  }
}

/** Gradient.Evaluate → [r, g, b, a] (espace de stockage, sRGB). */
export function evalGradient(g: Gradient, t: number, out: number[] = [0, 0, 0, 0]): number[] {
  const cs = g.colors;
  const as = g.alphas;
  if (cs.length) {
    if (t <= cs[0][0]) {
      out[0] = cs[0][1]; out[1] = cs[0][2]; out[2] = cs[0][3];
    } else if (t >= cs[cs.length - 1][0]) {
      const k = cs[cs.length - 1];
      out[0] = k[1]; out[1] = k[2]; out[2] = k[3];
    } else {
      let i = 0;
      while (i < cs.length - 2 && t > cs[i + 1][0]) i++;
      const a = cs[i];
      const b = cs[i + 1];
      const s = g.fixed ? 1 : (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * s;
      out[1] = a[2] + (b[2] - a[2]) * s;
      out[2] = a[3] + (b[3] - a[3]) * s;
    }
  } else {
    out[0] = out[1] = out[2] = 1;
  }
  if (as.length) {
    if (t <= as[0][0]) out[3] = as[0][1];
    else if (t >= as[as.length - 1][0]) out[3] = as[as.length - 1][1];
    else {
      let i = 0;
      while (i < as.length - 2 && t > as[i + 1][0]) i++;
      const a = as[i];
      const b = as[i + 1];
      const s = g.fixed ? 1 : (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      out[3] = a[1] + (b[1] - a[1]) * s;
    }
  } else out[3] = 1;
  return out;
}

const _a = [0, 0, 0, 0];
const _b = [0, 0, 0, 0];
/** MinMaxGradient.Evaluate(t, lerp). */
export function evalMinMaxGradient(g: MinMaxGradient | undefined, t: number, lerp: number, out: number[] = [0, 0, 0, 0]): number[] {
  if (!g) {
    out[0] = out[1] = out[2] = out[3] = 1;
    return out;
  }
  switch (g.mode) {
    case 0:
      for (let i = 0; i < 4; i++) out[i] = g.maxColor[i];
      return out;
    case 1:
      return evalGradient(g.max, t, out);
    case 2:
      for (let i = 0; i < 4; i++) out[i] = g.minColor[i] + (g.maxColor[i] - g.minColor[i]) * lerp;
      return out;
    case 3:
      evalGradient(g.min, t, _a);
      evalGradient(g.max, t, _b);
      for (let i = 0; i < 4; i++) out[i] = _a[i] + (_b[i] - _a[i]) * lerp;
      return out;
    default:
      return evalGradient(g.max, t, out);
  }
}

/** sRGB → linéaire pour une composante. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Couleur Unity sérialisée → linéaire : les couleurs HDR (une composante > 1)
 * sont déjà linéaires ; les couleurs LDR sont stockées en sRGB.
 */
export function unityColorToLinear(c: number[]): [number, number, number] {
  if (c[0] > 1 || c[1] > 1 || c[2] > 1) return [c[0], c[1], c[2]];
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}
