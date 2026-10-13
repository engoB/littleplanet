/**
 * Cel-shading doux « film d'animation » (préréglage Arcade, inspiré des jeux
 * Zelda récents) : deux aplats séparés par un terminateur adouci, ombres
 * teintées par la lumière d'ambiance, liseré lumineux sur les bords.
 * Pas de contours noirs (la coque inversée reste disponible mais inutilisée).
 */
import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** Rampe d'éclairage : ombre / lumière avec un terminateur adouci. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const t = Math.min(1, Math.max(0, (x - 0.47) / 0.07));
    const v = 0.68 + 0.32 * t * t * (3 - 2 * t); // ombres légères : tout reste lisible
    data.fill(Math.round(v * 255), i * 4, i * 4 + 3);
    data[i * 4 + 3] = 255;
  }
  gradient = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.LinearFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

/** Copie toon d'un matériau standard (couleur, carte, transparence conservées). */
export function toToon(m: THREE.Material): THREE.Material {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return m;
  const t = new THREE.MeshToonMaterial({
    name: s.name + ' (toon)',
    color: s.color.clone(),
    map: s.map,
    emissive: s.emissive.clone(),
    emissiveMap: s.emissiveMap,
    transparent: s.transparent,
    opacity: s.opacity,
    depthWrite: s.depthWrite,
    side: s.side,
    gradientMap: toonGradient(),
  });
  return t;
}

const OUTLINE_VERT = /* glsl */ `
uniform float thickness;
#include <common>
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 mv = viewMatrix * m * vec4(position, 1.0);
  vec3 n = normalize(mat3(viewMatrix) * mat3(m) * normal);
  // Épaisseur constante à l'écran (proportionnelle à la profondeur)
  mv.xyz += n * thickness * max(0.5, -mv.z) * 0.01;
  gl_Position = projectionMatrix * mv;
}`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 color;
void main() {
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

export function outlineMaterial(thickness = 0.35, color = 0x101018): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
}

/** Ajoute un contour à chaque maillage opaque d'un objet (enfants « outline »). */
export function addOutlines(root: THREE.Object3D, mat: THREE.ShaderMaterial): THREE.Mesh[] {
  const added: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.isOutline) meshes.push(m);
  });
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.every((x) => x.transparent)) continue;
    const o = new THREE.Mesh(m.geometry, mat);
    o.userData.isOutline = true;
    o.castShadow = false;
    o.receiveShadow = false;
    o.visible = false;
    m.add(o);
    added.push(o);
  }
  return added;
}

/**
 * Matériau de planète toon : la couleur vient d'une cubemap échantillonnée
 * avec la direction locale (aucune couture, aucun pincement aux pôles),
 * plus une cubemap d'émission (lave) optionnelle.
 */
export function planetToonMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
  const uniforms = {
    planetCube: { value: null as THREE.CubeTexture | null },
    planetEmis: { value: null as THREE.CubeTexture | null },
    emisColor: { value: new THREE.Color(0, 0, 0) },
    rimColor: { value: new THREE.Color(1, 1, 1) },
    rimStrength: { value: 0.14 },
    /** Planète de verre : masque d'opacité (route opaque) et activation. */
    planetMask: { value: null as THREE.CubeTexture | null },
    glass: { value: 0 },
    planetTime: { value: 0 },
    /** Océan : houle animée, crêtes d'écume et reflets. */
    ocean: { value: 0 },
  };
  m.userData.planetUniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjDir;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjDir = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vObjDir;\nuniform samplerCube planetCube;\nuniform samplerCube planetEmis;\nuniform samplerCube planetMask;\nuniform float glass;\nuniform float ocean;\nuniform float planetTime;\nfloat wHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\nfloat wNoise(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }\nuniform vec3 emisColor;\nuniform vec3 rimColor;\nuniform float rimStrength;',
      )
      .replace(
        '#include <map_fragment>',
        // Les cubemaps WebGL sont « main gauche » : X inversé pour retrouver l'espace
        // du générateur (pistes, cartes de surface)
        `vec3 planetDir = normalize(vObjDir);
        diffuseColor.rgb *= textureCube(planetCube, planetDir).rgb;
        float oceanGlint = 0.0;
        float oceanFoam = 0.0;
        if (ocean > 0.5) {
          // Houle : trains de vagues croisés qui avancent, crêtes d'écume et dentelle
          float t = planetTime;
          vec3 q = planetDir;
          float ch = wNoise(q * 18.0 + vec3(0.0, t * 0.35, t * 0.2));
          // Le sens de la houle tourne lentement (rotation douce des vecteurs d'onde)
          float ang = 0.9 * sin(t * 0.045) + 0.45 * sin(t * 0.11 + 1.3);
          vec3 ax = normalize(vec3(0.25, 1.0, 0.35));
          vec3 k1 = vec3(46.0, 12.0, 18.0);
          k1 = k1 * cos(ang) + cross(ax, k1) * sin(ang) + ax * dot(ax, k1) * (1.0 - cos(ang));
          vec3 k2 = vec3(-10.0, 34.0, 15.0);
          k2 = k2 * cos(-ang * 0.7) + cross(ax, k2) * sin(-ang * 0.7) + ax * dot(ax, k2) * (1.0 - cos(-ang * 0.7));
          float w1 = sin(dot(q, k1) + t * 1.8 + ch * 3.0);
          float w2 = sin(dot(q, k2) - t * 2.1 + ch * 1.4);
          float w = 0.78 * w1 + 0.22 * w2;
          // Creux sombres, dos des vagues clairs
          diffuseColor.rgb *= 0.66 + 0.44 * smoothstep(-0.9, 0.9, w);
          // Écume discrète : fin liseré déchiré sur les crêtes seulement
          float brk = smoothstep(0.45, 0.75, wNoise(q * 40.0 + vec3(t * 0.5, 0.0, -t * 0.3)));
          float crest = smoothstep(0.8, 0.88, w1) * (1.0 - smoothstep(0.93, 0.99, w1)) * brk;
          float lace = smoothstep(0.66, 0.72, wNoise(q * 120.0 + vec3(t * 0.3, -t * 0.2, t * 0.25))) * smoothstep(0.7, 0.98, w1) * 0.15;
          oceanFoam = clamp(crest * 0.75 + lace, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.97, 1.0), oceanFoam * 0.85);
          float sp = wNoise(q * 170.0 + vec3(t * 1.2));
          oceanGlint = smoothstep(0.9, 0.98, sp) * smoothstep(0.2, 0.8, w);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `totalEmissiveRadiance += emisColor * textureCube(planetEmis, planetDir).rgb;
        float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += rimColor * rim * rimStrength;
        totalEmissiveRadiance += vec3(0.8, 0.9, 1.0) * oceanGlint * 0.7 + vec3(0.55, 0.62, 0.7) * oceanFoam;
        if (glass > 0.5) {
          // Verre : transparent au centre, reflet bleuté sur les bords (Fresnel) ; route opaque
          float road = textureCube(planetMask, planetDir).r;
          float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.0);
          diffuseColor.a = mix(0.16 + 0.55 * fres, 1.0, road);
          totalEmissiveRadiance += (1.0 - road) * (vec3(0.45, 0.55, 1.0) * fres * 0.7 + vec3(0.02, 0.03, 0.08));
          // Scintillements d'étoiles et petites galaxies spirales dans le verre
          vec3 sg = planetDir * 64.0;
          vec3 sc = floor(sg);
          float sh = fract(sin(dot(sc, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float sd = length(fract(sg) - 0.5);
          float tw = 0.5 + 0.5 * sin(planetTime * (1.5 + sh * 4.0) + sh * 40.0);
          float star = step(0.94, sh) * smoothstep(0.2, 0.0, sd) * tw * tw;
          vec3 gg = planetDir * 7.0;
          vec3 gc = floor(gg);
          float gh = fract(sin(dot(gc, vec3(39.346, 11.135, 83.155))) * 24634.6345);
          vec3 gf = fract(gg) - 0.5;
          vec2 gp = gf.xy + gf.z * vec2(0.35, -0.5);
          float gr = length(gp);
          float ga = atan(gp.y, gp.x);
          float arms = 0.5 + 0.5 * sin(ga * 2.0 - gr * 34.0 + planetTime * 0.4 + gh * 6.28);
          float galaxy = step(0.88, gh) * exp(-gr * gr * 55.0) * (0.35 + 0.65 * arms) * (1.0 - smoothstep(0.2, 0.35, gr));
          vec3 gcol = mix(vec3(0.7, 0.45, 1.0), vec3(0.45, 0.8, 1.0), gh);
          totalEmissiveRadiance += (1.0 - road) * (star * vec3(1.6, 1.5, 1.8) + galaxy * gcol * 0.9);
          diffuseColor.a = max(diffuseColor.a, (1.0 - road) * clamp(star + galaxy * 0.6, 0.0, 1.0));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'planet-toon';
  return m;
}

const ATMO_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// Lueur diffuse : distance du rayon de vue au centre de la planète,
// décroissance exponentielle douce depuis la surface (pas d'anneau net).
const ATMO_FRAG = /* glsl */ `
uniform vec3 color;
uniform float intensity;
uniform vec3 center;
uniform float radius;
uniform float falloff;
varying vec3 vPos;
void main() {
  vec3 dir = normalize(vPos);
  float t = dot(center, dir);
  float dist = length(center - dir * t);
  float h = max(dist - radius, 0.0) / falloff;
  float g = exp(-h * h * 0.9 - h * 0.6);
  float a = g * intensity;
  gl_FragColor = vec4(color * a, 0.0);
  #include <colorspace_fragment>
}`;

/** Halo d'atmosphère diffus (sphère englobante, calcul par rayon de vue). */
export function atmosphere(radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0x9be7ff) },
      intensity: { value: 0.6 },
      center: { value: new THREE.Vector3() },
      radius: { value: radius },
      falloff: { value: radius * 0.22 },
    },
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  // Sphère englobante (1,7 × le rayon) ; le calcul se fait par pixel
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.7, 48, 24), mat);
  m.renderOrder = -5;
  m.frustumCulled = false;
  // Centre et rayon en espace caméra, mis à jour juste avant le rendu
  const c = new THREE.Vector3();
  const sc = new THREE.Vector3();
  m.onBeforeRender = (_r, _s, cam) => {
    m.getWorldPosition(c).applyMatrix4(cam.matrixWorldInverse);
    mat.uniforms.center.value.copy(c);
    m.parent?.getWorldScale(sc);
    const k = sc.x || 1;
    mat.uniforms.radius.value = radius * k;
    mat.uniforms.falloff.value = radius * k * 0.22;
  };
  return m;
}
