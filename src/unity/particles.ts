/**
 * Particules « Shuriken » simplifiées.
 *
 * Chaque ParticleSystem Unity exporté (modules main, shape, emission,
 * color/size/rotation over lifetime, texture sheet, velocity, limit velocity,
 * force, noise) est simulé sur CPU ; toutes les particules de tous les
 * systèmes sont dessinées par UN SEUL THREE.Points pré-alloué, avec un atlas
 * de textures et un mélange prémultiplié qui gère à la fois l'alpha blending
 * et l'additif dans le même appel de dessin.
 * Écarts : pas de traînées (Trail module), pas de collisions, bruit approché.
 */
import * as THREE from 'three';
import { evalMinMax, evalMinMaxGradient, unityColorToLinear, srgbToLinear, type MinMaxCurve } from './curves';
import { Random, unityEuler } from './math';
import type { MaterialData, ParticleData, ParticleRendererData } from './types';

const GRAVITY = 9.81;

/** Apparence d'un matériau de particules dans l'atlas. */
export interface SpriteLook {
  rect: [number, number, number, number];
  additive: boolean;
  tint: [number, number, number];
  hidden: boolean;
}

export function spriteLook(matName: string | null, mat: MaterialData | undefined, atlas: Record<string, [number, number, number, number]>): SpriteLook {
  const hidden = !mat || matName === 'cfxr hidden';
  const tex = mat?.textures._MainTex?.texture ?? mat?.textures._BaseMap?.texture;
  let rect = (tex && atlas[tex]) || atlas.fx_dot;
  if (matName?.includes('proc ring')) rect = atlas.fx_ring;
  const kw = mat?.keywords ?? [];
  const legacy = !mat?.shader || mat.shader.startsWith('builtin');
  const additive = kw.includes('_CFXR_ADDITIVE') || mat?.floats._DstBlend === 1 || (legacy && !kw.includes('_ALPHABLEND_ON'));
  const c = mat?.colors._Color ?? mat?.colors._TintColor ?? [1, 1, 1, 1];
  let tint = unityColorToLinear(c);
  if (mat?.colors._TintColor) tint = tint.map((x) => x * 2) as [number, number, number]; // shaders legacy : × 2
  return { rect, additive, tint, hidden };
}

class Particles {
  n = 0;
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly age: Float32Array; readonly life: Float32Array; readonly size: Float32Array;
  readonly rot: Float32Array; readonly rnd: Float32Array; readonly frame: Float32Array;
  readonly col: Float32Array;
  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size = f(); this.rot = f(); this.rnd = f(); this.frame = f();
    this.col = new Float32Array(cap * 4);
  }
  kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j];
    this.rot[i] = this.rot[j]; this.rnd[i] = this.rnd[j]; this.frame[i] = this.frame[j];
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
  }
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _c = [0, 0, 0, 0];
const _c2 = [0, 0, 0, 0];

function noise3(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  // Champ lisse pseudo-aléatoire (somme de sinus), dans [-1, 1]
  return out.set(
    Math.sin(x * 1.7 + Math.sin(y * 2.3 + 1.1) + z * 0.9),
    Math.sin(y * 1.9 + Math.sin(z * 1.3 + 2.7) + x * 0.7),
    Math.sin(z * 1.5 + Math.sin(x * 2.1 + 0.3) + y * 1.1),
  );
}

export class ParticleSystem {
  readonly p: Particles;
  readonly look: SpriteLook;
  readonly stretched: boolean;
  readonly lengthScale: number;
  readonly velocityScale: number;
  readonly maxScreen: number;
  time = 0;
  playing = false;
  private emitAcc = 0;
  private burstDone: number[];
  private delay = 0;
  private shapeQ: THREE.Quaternion;
  /** Multiplicateur global d'émission (réglage de qualité). */
  static emissionScale = 1;

  constructor(readonly obj: THREE.Object3D, readonly d: ParticleData, r: ParticleRendererData, look: SpriteLook) {
    this.p = new Particles(Math.max(1, Math.min(d.main.maxParticles, 256)));
    this.look = look;
    this.stretched = r.renderMode === 1;
    this.lengthScale = r.lengthScale;
    this.velocityScale = r.velocityScale;
    this.maxScreen = r.maxParticleSize || 0.5;
    this.burstDone = d.emission.bursts.map(() => 0);
    const sr = d.shape.rotation;
    this.shapeQ = unityEuler(sr[0], sr[1], sr[2]);
  }

  get alive(): boolean {
    return this.playing || this.p.n > 0;
  }

  /** ParticleSystem.Play() : redémarre le système (avec préchauffage éventuel). */
  play(): void {
    this.time = 0;
    this.emitAcc = 0;
    this.burstDone.fill(0);
    this.delay = evalMinMax(this.d.startDelay, 0, Random.value);
    this.playing = true;
    if (this.d.prewarm && this.d.looping) {
      this.delay = 0;
      const steps = 20;
      for (let i = 0; i < steps; i++) this.update(this.d.duration / steps);
    }
  }

  stop(clear = false): void {
    this.playing = false;
    if (clear) this.p.n = 0;
  }

  private worldScale(): number {
    const e = this.obj.matrixWorld.elements;
    return Math.cbrt(Math.abs(new THREE.Matrix4().fromArray(e).determinant())) || 1;
  }

  private emit(count: number): void {
    const d = this.d;
    const p = this.p;
    const tn = d.duration > 0 ? (this.time % d.duration) / d.duration : 0;
    const world = d.worldSpace;
    const ws = d.scalingMode === 1 ? 1 : this.worldScale();
    // Les systèmes locaux sont mis à l'échelle au rendu (matrice monde)
    const sizeScale = world && d.scalingMode === 0 ? ws : 1;
    for (let c = 0; c < count && p.n < p.cap; c++) {
      const i = p.n++;
      const rnd = Random.value;
      p.rnd[i] = rnd;
      p.age[i] = 0;
      p.life[i] = Math.max(0.01, evalMinMax(d.main.lifetime, tn, Random.value));
      p.size[i] = evalMinMax(d.main.size, tn, Random.value) * sizeScale;
      p.rot[i] = evalMinMax(d.main.rotation, tn, Random.value) * (Random.value < d.main.randomizeRotationDirection ? -1 : 1);
      evalMinMaxGradient(d.main.color, tn, Random.value, _c);
      p.col.set(_c, i * 4);
      p.frame[i] = d.textureSheet.enabled ? evalMinMax(d.textureSheet.frameOverTime, 0, Random.value) : 0;
      this.shapePoint(_v, _d);
      const speed = evalMinMax(d.main.speed, tn, Random.value);
      _d.multiplyScalar(speed);
      if (world) {
        // Système en espace monde : on transforme position et vitesse initiales
        _v.applyMatrix4(this.obj.matrixWorld);
        _m3.setFromMatrix4(this.obj.matrixWorld);
        _d.applyMatrix3(_m3);
        if (d.scalingMode !== 0) _d.multiplyScalar(1 / ws);
      }
      p.px[i] = _v.x; p.py[i] = _v.y; p.pz[i] = _v.z;
      p.vx[i] = _d.x; p.vy[i] = _d.y; p.vz[i] = _d.z;
    }
  }

  /** Point et direction d'émission selon le module Shape (espace local). */
  private shapePoint(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const s = this.d.shape;
    if (!s.enabled) {
      pos.set(0, 0, 0);
      Random.onUnitSphere(dir);
      return;
    }
    const r = s.radius;
    const thick = s.radiusThickness;
    switch (s.type) {
      case 0: case 1: { // sphère
        Random.onUnitSphere(dir);
        const rr = r * (1 - thick + thick * Math.cbrt(Random.value));
        pos.copy(dir).multiplyScalar(rr);
        break;
      }
      case 2: case 3: { // hémisphère (+Z)
        Random.onUnitSphere(dir);
        dir.z = Math.abs(dir.z);
        pos.copy(dir).multiplyScalar(r * (1 - thick + thick * Math.cbrt(Random.value)));
        break;
      }
      case 4: case 7: case 8: case 9: { // cône (axe +Z)
        const phi = Random.range(0, (s.arc || 360) * Math.PI / 180);
        const rho = 1 - thick + thick * Math.sqrt(Random.value);
        pos.set(Math.cos(phi) * rho * r, Math.sin(phi) * rho * r, 0);
        const a = s.angle * Math.PI / 180 * rho;
        dir.set(Math.cos(phi) * Math.sin(a), Math.sin(phi) * Math.sin(a), Math.cos(a));
        break;
      }
      case 5: case 15: case 16: { // boîte
        pos.set(Random.range(-0.5, 0.5) * s.scale[0], Random.range(-0.5, 0.5) * s.scale[1], Random.range(-0.5, 0.5) * s.scale[2]);
        dir.set(0, 0, 1);
        break;
      }
      case 10: case 11: { // cercle (plan XY)
        const phi = Random.range(0, (s.arc || 360) * Math.PI / 180);
        const rho = s.type === 11 ? 1 : 1 - thick + thick * Math.sqrt(Random.value);
        pos.set(Math.cos(phi) * rho * r, Math.sin(phi) * rho * r, 0);
        dir.copy(pos).normalize();
        break;
      }
      case 12: { // arête
        pos.set(Random.range(-r, r), 0, 0);
        dir.set(0, 1, 0);
        break;
      }
      default:
        pos.set(0, 0, 0);
        Random.onUnitSphere(dir);
    }
    if (s.type !== 5 && s.type !== 15 && s.type !== 16) {
      pos.x *= s.scale[0]; pos.y *= s.scale[1]; pos.z *= s.scale[2];
    }
    if (s.randomDirection > 0) {
      const rd = Random.onUnitSphere(new THREE.Vector3());
      dir.lerp(rd, s.randomDirection).normalize();
    }
    if (s.sphericalDirection > 0 && pos.lengthSq() > 1e-12) dir.lerp(_d.copy(pos).normalize(), s.sphericalDirection).normalize();
    pos.applyQuaternion(this.shapeQ).add(new THREE.Vector3(...s.position));
    dir.applyQuaternion(this.shapeQ);
  }

  update(dt: number): void {
    const d = this.d;
    dt *= d.simulationSpeed;
    if (dt <= 0) return;
    // --- émission
    if (this.playing) {
      if (this.delay > 0) {
        this.delay -= dt;
      } else {
        const prev = this.time;
        this.time += dt;
        if (!d.looping && this.time >= d.duration) {
          this.time = d.duration;
          this.playing = false;
        }
        if (d.emission.enabled) {
          const tn = d.duration > 0 ? (this.time % d.duration) / d.duration : 0;
          this.emitAcc += evalMinMax(d.emission.rate, tn, Random.value) * (this.time - prev) * ParticleSystem.emissionScale;
          const n = Math.floor(this.emitAcc);
          if (n > 0) {
            this.emitAcc -= n;
            this.emit(n);
          }
          const loopT = d.looping && d.duration > 0 ? this.time % d.duration : this.time;
          const prevLoopT = d.looping && d.duration > 0 ? prev % d.duration : prev;
          if (d.looping && loopT < prevLoopT) this.burstDone.fill(0);
          d.emission.bursts.forEach((b, k) => {
            const cycles = b.cycles <= 0 ? 1e9 : b.cycles;
            while (this.burstDone[k] < cycles && loopT >= b.time + this.burstDone[k] * b.interval) {
              this.burstDone[k]++;
              if (Random.value <= b.probability) this.emit(Math.round(evalMinMax(b.count, 0, Random.value)));
            }
          });
        }
      }
    }
    // --- simulation
    const p = this.p;
    if (p.n === 0) return;
    const grav = evalMinMax(d.main.gravity, 0, 0.5) * GRAVITY;
    // Gravité : axe −Y monde, ramené dans l'espace local si besoin
    _v.set(0, -grav, 0);
    if (!d.worldSpace && grav !== 0) {
      this.obj.getWorldQuaternion(_q).invert();
      _v.applyQuaternion(_q).multiplyScalar(1 / this.worldScale());
    }
    const gx = _v.x, gy = _v.y, gz = _v.z;
    const lim = d.limitVelocity.enabled ? d.limitVelocity : null;
    const frc = d.force.enabled ? d.force : null;
    const vel = d.velocityOverLifetime.enabled ? d.velocityOverLifetime : null;
    const noise = d.noise.enabled ? d.noise : null;
    for (let i = p.n - 1; i >= 0; i--) {
      p.age[i] += dt;
      if (p.age[i] >= p.life[i]) {
        p.kill(i);
        continue;
      }
      const t = p.age[i] / p.life[i];
      p.vx[i] += gx * dt; p.vy[i] += gy * dt; p.vz[i] += gz * dt;
      if (frc) {
        p.vx[i] -= evalMinMax(frc.x, t, p.rnd[i]) * dt; // X inversé (main droite)
        p.vy[i] += evalMinMax(frc.y, t, p.rnd[i]) * dt;
        p.vz[i] += evalMinMax(frc.z, t, p.rnd[i]) * dt;
      }
      if (lim) {
        const l = evalMinMax(lim.limit, t, p.rnd[i]);
        const sp = Math.hypot(p.vx[i], p.vy[i], p.vz[i]);
        if (sp > l && sp > 0) {
          const k = (l + (sp - l) * Math.pow(1 - lim.dampen, dt * 60)) / sp;
          p.vx[i] *= k; p.vy[i] *= k; p.vz[i] *= k;
        }
      }
      let ex = 0, ey = 0, ez = 0;
      if (vel) {
        ex = -evalMinMax(vel.x, t, p.rnd[i]);
        ey = evalMinMax(vel.y, t, p.rnd[i]);
        ez = evalMinMax(vel.z, t, p.rnd[i]);
      }
      if (noise) {
        const st = evalMinMax(noise.strength, t, p.rnd[i]);
        const f = noise.frequency;
        noise3(p.px[i] * f + p.rnd[i] * 13, p.py[i] * f + this.time * 0.5, p.pz[i] * f, _d);
        ex += _d.x * st; ey += _d.y * st; ez += _d.z * st;
      }
      p.px[i] += (p.vx[i] + ex) * dt;
      p.py[i] += (p.vy[i] + ey) * dt;
      p.pz[i] += (p.vz[i] + ez) * dt;
      if (d.rotationOverLifetime.enabled) p.rot[i] += evalMinMax(d.rotationOverLifetime.curve, t, p.rnd[i]) * dt;
    }
  }

  /** Écrit les particules vivantes dans les tampons partagés. Renvoie le nouvel index. */
  write(buf: ParticleBuffers, start: number): number {
    const p = this.p;
    const d = this.d;
    if (this.look.hidden || p.n === 0) return start;
    let k = start;
    const world = d.worldSpace;
    const m = this.obj.matrixWorld;
    _m3.setFromMatrix4(m);
    const ws = world || d.scalingMode !== 0 ? 1 : this.worldScale();
    const ts = d.textureSheet;
    const [u0, v0, u1, v1] = this.look.rect;
    const tint = this.look.tint;
    for (let i = 0; i < p.n && k < buf.cap; i++, k++) {
      const t = p.age[i] / p.life[i];
      _v.set(p.px[i], p.py[i], p.pz[i]);
      _d.set(p.vx[i], p.vy[i], p.vz[i]);
      if (!world) {
        _v.applyMatrix4(m);
        _d.applyMatrix3(_m3);
      }
      buf.pos[k * 3] = _v.x; buf.pos[k * 3 + 1] = _v.y; buf.pos[k * 3 + 2] = _v.z;
      buf.vel[k * 3] = _d.x; buf.vel[k * 3 + 1] = _d.y; buf.vel[k * 3 + 2] = _d.z;
      let size = p.size[i] * ws;
      if (d.sizeOverLifetime.enabled) size *= evalMinMax(d.sizeOverLifetime.curve, t, p.rnd[i]);
      _c[0] = p.col[i * 4]; _c[1] = p.col[i * 4 + 1]; _c[2] = p.col[i * 4 + 2]; _c[3] = p.col[i * 4 + 3];
      if (d.colorOverLifetime.enabled) {
        evalMinMaxGradient(d.colorOverLifetime.gradient, t, p.rnd[i], _c2);
        for (let j = 0; j < 4; j++) _c[j] *= _c2[j];
      }
      buf.col[k * 4] = srgbToLinear(Math.min(1, _c[0])) * tint[0];
      buf.col[k * 4 + 1] = srgbToLinear(Math.min(1, _c[1])) * tint[1];
      buf.col[k * 4 + 2] = srgbToLinear(Math.min(1, _c[2])) * tint[2];
      buf.col[k * 4 + 3] = _c[3];
      // Planche de textures (frame figée par particule ou animée)
      let ru0 = u0, rv0 = v0, ru1 = u1, rv1 = v1;
      if (ts.enabled && (ts.tilesX > 1 || ts.tilesY > 1)) {
        const nFrames = ts.tilesX * ts.tilesY;
        const f = ts.frameOverTime.mode === 3 ? p.frame[i] : evalMinMax(ts.frameOverTime, (t * ts.cycles) % 1, p.rnd[i]);
        const fi = Math.min(nFrames - 1, Math.floor(f * nFrames));
        const cx = fi % ts.tilesX;
        const cy = Math.floor(fi / ts.tilesX);
        const w = (u1 - u0) / ts.tilesX;
        const h = (v1 - v0) / ts.tilesY;
        ru0 = u0 + cx * w; ru1 = ru0 + w;
        rv1 = v1 - cy * h; rv0 = rv1 - h;
      }
      buf.rect[k * 4] = ru0; buf.rect[k * 4 + 1] = rv0; buf.rect[k * 4 + 2] = ru1; buf.rect[k * 4 + 3] = rv1;
      const speed = _d.length();
      buf.misc[k * 4] = size;
      buf.misc[k * 4 + 1] = this.stretched ? -1 : p.rot[i]; // −1 : orienté selon la vitesse
      buf.misc[k * 4 + 2] = this.stretched ? Math.max(1, (size * this.lengthScale + speed * this.velocityScale) / Math.max(1e-4, size)) : 1;
      buf.misc[k * 4 + 3] = (this.look.additive ? 1 : 0) + Math.min(0.99, this.maxScreen) * 0.5;
    }
    return k;
  }
}

export interface ParticleBuffers {
  cap: number;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  rect: Float32Array;
  misc: Float32Array;
}

const VERT = /* glsl */ `
attribute vec3 vel;
attribute vec4 pcol;
attribute vec4 rect;
attribute vec4 misc;
uniform float uViewportH;
varying vec4 vCol;
varying vec4 vRect;
varying float vRot;
varying float vAspect;
varying float vAdd;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = misc.x;
  float stretch = misc.z;
  float px = size * projectionMatrix[1][1] * 0.5 * uViewportH / max(0.001, -mv.z);
  float rot = misc.y;
  if (rot == -1.0) {
    // Billboard étiré : orientation selon la vitesse projetée à l'écran
    vec4 p2 = projectionMatrix * (modelViewMatrix * vec4(position + vel * 0.02, 1.0));
    vec2 a = gl_Position.xy / gl_Position.w;
    vec2 b = p2.xy / p2.w;
    vec2 dir = b - a;
    rot = length(dir) > 1e-6 ? atan(dir.y, dir.x) : 0.0;
  }
  vRot = rot;
  float maxPx = fract(misc.w) * 2.0 * uViewportH;
  gl_PointSize = min(px * stretch, maxPx);
  vAspect = stretch;
  vAdd = floor(misc.w);
  vCol = pcol;
  vRect = rect;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vCol;
varying vec4 vRect;
varying float vRot;
varying float vAspect;
varying float vAdd;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  q.y *= vAspect;
  if (abs(q.x) > 0.5 || abs(q.y) > 0.5) discard;
  vec2 uv = mix(vRect.xy, vRect.zw, q + 0.5);
  vec4 tex = texture2D(map, uv);
  vec4 col = vCol * tex;
  if (col.a < 0.004) discard;
  // Prémultiplié : additif → alpha nul, alpha blending → alpha normal
  gl_FragColor = vec4(col.rgb * col.a, col.a * (1.0 - vAdd));
  #include <colorspace_fragment>
}`;

/** Gestionnaire global : un seul Points pour toutes les particules. */
export class ParticleManager {
  readonly systems: ParticleSystem[] = [];
  readonly points: THREE.Points;
  private readonly buf: ParticleBuffers;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private order: Uint32Array;
  private depth: Float32Array;
  private tmp: ParticleBuffers;

  constructor(atlas: THREE.Texture, cap = 3000) {
    const mk = (n: number) => new Float32Array(cap * n);
    this.buf = { cap, pos: mk(3), vel: mk(3), col: mk(4), rect: mk(4), misc: mk(4) };
    this.tmp = { cap, pos: mk(3), vel: mk(3), col: mk(4), rect: mk(4), misc: mk(4) };
    this.order = new Uint32Array(cap);
    this.depth = new Float32Array(cap);
    this.geo = new THREE.BufferGeometry();
    const attr = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.buf.pos, 3));
    this.geo.setAttribute('vel', attr(this.buf.vel, 3));
    this.geo.setAttribute('pcol', attr(this.buf.col, 4));
    this.geo.setAttribute('rect', attr(this.buf.rect, 4));
    this.geo.setAttribute('misc', attr(this.buf.misc, 4));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, uViewportH: { value: 720 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  add(sys: ParticleSystem): ParticleSystem {
    this.systems.push(sys);
    return sys;
  }

  update(dt: number): void {
    for (const s of this.systems) if (s.alive && s.obj.visible) s.update(dt);
  }

  /** Remplit la géométrie, triée de l'arrière vers l'avant. */
  render(camera: THREE.Camera, viewportH: number): void {
    this.mat.uniforms.uViewportH.value = viewportH;
    const t = this.tmp;
    let n = 0;
    for (const s of this.systems) {
      if (!s.obj.visible || s.p.n === 0) continue;
      n = s.write(t, n);
    }
    const cx = camera.matrixWorld.elements[12], cy = camera.matrixWorld.elements[13], cz = camera.matrixWorld.elements[14];
    for (let i = 0; i < n; i++) {
      this.order[i] = i;
      const dx = t.pos[i * 3] - cx, dy = t.pos[i * 3 + 1] - cy, dz = t.pos[i * 3 + 2] - cz;
      this.depth[i] = dx * dx + dy * dy + dz * dz;
    }
    const ord = this.order.subarray(0, n);
    ord.sort((a, b) => this.depth[b] - this.depth[a]);
    const b = this.buf;
    for (let j = 0; j < n; j++) {
      const i = ord[j];
      b.pos.set(t.pos.subarray(i * 3, i * 3 + 3), j * 3);
      b.vel.set(t.vel.subarray(i * 3, i * 3 + 3), j * 3);
      b.col.set(t.col.subarray(i * 4, i * 4 + 4), j * 4);
      b.rect.set(t.rect.subarray(i * 4, i * 4 + 4), j * 4);
      b.misc.set(t.misc.subarray(i * 4, i * 4 + 4), j * 4);
    }
    for (const name of ['position', 'vel', 'pcol', 'rect', 'misc']) {
      const a = this.geo.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.geo.setDrawRange(0, n);
  }

  get count(): number {
    return this.geo.drawRange.count;
  }
}

export type { MinMaxCurve };
