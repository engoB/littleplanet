/**
 * Planète « classique » (écran titre) : l'herbe réaliste et la terre du
 * projet Unity d'origine, en projection triplanaire (aucune couture), et un
 * chemin de terre qui fait le tour de la planète (grand cercle du départ,
 * légèrement sinueux) que la voiture suit en boucle sur l'écran titre.
 * `grassShells` (herbe en relief, shell texturing) : essai mis de côté,
 * trop lourd pour les téléphones ; non branché pour le moment.
 */
import * as THREE from 'three';

/** Chemin : normale du grand cercle (le plan x = 0 passe par le départ (0, 1, 0) vers +Z). */
export const CLASSIC_PATH_NORMAL = new THREE.Vector3(1, 0, 0);
/** Demi-largeur angulaire du chemin et amplitude de ses courbes. */
const PATH_W = 0.085;
const PATH_WOBBLE = 0.05;

/** Décalage du chemin selon l'angle φ le long du grand cercle (même formule que le shader). */
export function classicPathOffset(phi: number): number {
  return PATH_WOBBLE * Math.sin(3 * phi) + PATH_WOBBLE * 0.5 * Math.sin(5 * phi + 1.3);
}

/** Point du chemin (espace planète, direction unitaire) à l'angle φ. */
export function classicPathPoint(phi: number, out = new THREE.Vector3()): THREE.Vector3 {
  // Base : e1 = (0, 1, 0) (départ), e2 = (0, 0, 1) (avant), n = (1, 0, 0)
  const o = classicPathOffset(phi);
  return out.set(Math.sin(o), Math.cos(phi) * Math.cos(o), Math.sin(phi) * Math.cos(o)).normalize();
}

const COMMON = /* glsl */ `
uniform sampler2D grassMap;
uniform sampler2D dirtMap;
uniform float tiling;
vec3 triplanar(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(t, p.yz * tiling).rgb * w.x + texture2D(t, p.xz * tiling).rgb * w.y + texture2D(t, p.xy * tiling).rgb * w.z;
}
float pathMask(vec3 d) {
  float phi = atan(d.z, d.y);
  float off = ${PATH_WOBBLE.toFixed(4)} * sin(3.0 * phi) + ${(PATH_WOBBLE * 0.5).toFixed(4)} * sin(5.0 * phi + 1.3);
  float dist = abs(asin(clamp(d.x, -1.0, 1.0)) - off);
  return 1.0 - smoothstep(${(PATH_W * 0.75).toFixed(4)}, ${PATH_W.toFixed(4)}, dist);
}
`;

/** Matériau du sol : herbe et terre (triplanaires), lumière standard. */
export function classicPlanetMaterial(grass: THREE.Texture | undefined, dirt: THREE.Texture | undefined): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const u = { grassMap: { value: grass ?? null }, dirtMap: { value: dirt ?? null }, tiling: { value: 0.55 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\n' + COMMON)
      .replace(
        '#include <map_fragment>',
        `vec3 cd = normalize(vObjPos);
        vec3 gcol = triplanar(grassMap, vObjPos, cd);
        vec3 dcol = triplanar(dirtMap, vObjPos * 1.6, cd) * vec3(0.95, 0.85, 0.72);
        float pm = pathMask(cd);
        diffuseColor.rgb *= mix(gcol, dcol, pm);`,
      );
  };
  m.customProgramCacheKey = () => 'classic-planet';
  return m;
}

const SHELL_VERT = /* glsl */ `
uniform float shell;
uniform float height;
varying vec3 vObjPos;
varying vec3 vNormalW;
void main() {
  vec3 p = position * (1.0 + shell * height);
  vObjPos = p;
  vNormalW = normalize(mat3(modelMatrix) * normalize(position));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const SHELL_FRAG = /* glsl */ `
uniform float shell;
uniform vec3 sunDir;
uniform float density;
varying vec3 vObjPos;
varying vec3 vNormalW;
${COMMON}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vObjPos);
  if (pathMask(d) > 0.2) discard;
  // Brins : une cellule = un brin, plus ou moins haut, qui s'affine en montant
  vec3 g = d * density;
  vec3 c = floor(g);
  float h = hash(c);
  vec3 f = fract(g) - 0.5;
  float r = length(f - dot(f, d) * d);
  if (h < shell || r > 0.48 * (1.0 - shell / max(h, 0.001))) discard;
  vec3 col = triplanar(grassMap, vObjPos, d);
  float ao = 0.45 + 0.55 * shell;
  float lit = 0.55 + 0.6 * max(dot(vNormalW, normalize(sunDir)), 0.0);
  gl_FragColor = vec4(col * ao * lit * vec3(0.95, 1.05, 0.9), 1.0);
  #include <colorspace_fragment>
}`;

/** Coques d'herbe (shell texturing) autour du maillage de la planète. */
export function grassShells(geo: THREE.BufferGeometry, grass: THREE.Texture | undefined, count = 12): THREE.Group {
  const g = new THREE.Group();
  for (let i = 1; i <= count; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        shell: { value: i / count },
        height: { value: 0.022 },
        density: { value: 260 },
        tiling: { value: 0.55 },
        grassMap: { value: grass ?? null },
        dirtMap: { value: null },
        sunDir: { value: new THREE.Vector3(0.4, 1, 0.3) },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 0;
    g.add(m);
  }
  g.name = 'grassShells';
  return g;
}
