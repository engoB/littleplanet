/**
 * Illustrations du tutoriel rendues par le moteur du jeu (Chromium headless),
 * pour qu'elles montrent exactement ce que l'on voit en jouant :
 *   npm run build && node tools/render_tuto.mjs && python3 tools/tuto_compose.py
 * Images brutes dans .cache/tuto/, composition finale dans public/tuto/.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../.cache/tuto/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try {
    const d = await readFile(join(DIST, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(d);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, ok));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Caméra libre : hors du suivi, regard sur un point, HUD masqué. */
const FREE_CAM = `(w, pos, target, up, fov) => {
  w.rig.follow = () => {};
  w.rig.chase = () => {};
  const cam = w.rig.camera;
  if (cam.parent !== w.scene) { cam.parent.remove(cam); w.scene.add(cam); }
  cam.clearViewOffset();
  cam.fov = fov;
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
  cam.position.copy(pos);
  cam.up.copy(up);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  for (const id of ['hud', 'touch-zones']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
}`;

/** Gros plan d'un objet (direction planète) vu de trois-quarts. */
const CLOSE_UP = `(sel, dist, h) => {
  const w = __mpp.world;
  const V = w.car.position.constructor;
  const k = w.kart;
  const list = sel === 'item' ? k.items.map((i) => i.dir) : sel === 'pad' ? k.pads.map((p) => p.dir) : sel === 'spring' ? k.springs.map((s) => s.dir) : w.clocks.positions().map((p) => p.clone().normalize());
  const d = list[0];
  if (!d) return 'none';
  const R = w.planetRadius();
  const up = d.clone().applyQuaternion(w.planet.quaternion).normalize();
  const p = w.planet.position.clone().addScaledVector(up, R);
  let t = new V(0, 1, 0).cross(up);
  if (t.lengthSq() < 1e-4) t = new V(1, 0, 0);
  t.normalize();
  (${FREE_CAM})(w, p.clone().addScaledVector(up, h).addScaledVector(t, dist), p.clone().addScaledVector(up, sel === 'box' || sel === 'item' ? 0.32 : 0.15), up, 42);
  w.meteors.clear();
  return 'ok';
}`;

async function shot(name, { query, w = 720, h = 360, hud = false, run, init }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  if (init) await page.addInitScript(init);
  page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await page.goto(`http://localhost:${server.address().port}/index.html?test=1&touch=1&seed=1&preset=arcade${init ? "" : "&unlockAll=1"}&${query}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__mppReady === true, null, { timeout: 120000 });
  await page.evaluate(() => __mpp.seed(12345));
  const r = await page.evaluate(run);
  if (r && r !== 'ok') console.log(name, r);
  await page.evaluate(() => __mpp.render());
  await (hud ? page : page.locator('canvas#game')).screenshot({ path: join(OUT, `${name}.png`) });
  await page.close();
}

// 1. L'histoire : la galaxie, l'étoile de lancement et la planète suivante dans le ciel
await shot('histoire', {
  query: 'planet=galaxie',
  run: `(() => { __mpp.play(); __mpp.step(560, 1 / 60, 0.2); __mpp.world.galaxy.goal = true; __mpp.world.galaxy.arrivalDist = -100; __mpp.step(30, 1 / 60, 0.2); for (let i = 0; i < 30; i++) { __mpp.step(6, 1 / 60, 'auto'); const g = __mpp.world.galaxy; if (g.star && g.star.angleTo(__mpp.world.carDir) * __mpp.world.planetRadius() < 3.2) break; } for (const id of ['hud', 'touch-zones']) document.getElementById(id).style.display = 'none'; return 'ok'; })()`,
});
// 2. Piloter : une vraie partie en portrait, HUD compris (anneau de turbo)
await shot('piloter', {
  query: 'planet=prairie&stages=0',
  w: 390,
  h: 700,
  hud: true,
  run: `(() => { __mpp.play(); __mpp.step(180, 1 / 60, 0.35); document.getElementById('hud-modes').hidden = true; return 'ok'; })()`,
});
// 3. Éviter : météore annoncé (cible rouge) et cratère près du véhicule
await shot('eviter', {
  query: 'planet=prairie&meteorInterval=0.5',
  run: `(() => {
    const w = __mpp.world;
    __mpp.play();
    w.aimOverride = 1;
    __mpp.step(90, 1 / 60, 0.1);
    for (let i = 0; i < 400; i++) { __mpp.step(1, 1 / 60, 0.1); if (w.meteors.targets().length && w.craters.list.length) break; }
    // Caméra entre le véhicule et la cible du prochain météore
    const V = w.car.position.constructor;
    // Cible la plus proche du véhicule ; point médian ramené à la surface
    const R = w.planetRadius();
    const tg = w.meteors.targets().map((t) => w.planet.localToWorld(t.clone())).sort((a, b) => a.distanceTo(w.car.position) - b.distanceTo(w.car.position));
    const tgt = tg[0];
    const up = tgt.clone().lerp(w.car.position, 0.5).sub(w.planet.position).normalize();
    const mid = w.planet.position.clone().addScaledVector(up, R);
    const span = Math.max(1.5, tgt.distanceTo(w.car.position));
    // Cible visée sur le véhicule : caméra de trois-quarts arrière
    const fwd = new V(0, 0, 1).applyQuaternion(w.car.quaternion);
    const left = new V(1, 0, 0).applyQuaternion(w.car.quaternion);
    (${FREE_CAM})(w, mid.clone().addScaledVector(up, 1.2 + span * 0.9).addScaledVector(fwd, -1.2 - span * 0.6).addScaledVector(left, 0.6), mid, up, 50);
    return 'ok';
  })()`,
});
// 4. Ramasser : gros plans des objets
for (const [sel, d, h] of [['box', 1.6, 0.75], ['item', 1.7, 0.8], ['pad', 1.1, 0.75], ['spring', 1.05, 0.55]]) {
  await shot(`obj_${sel}`, {
    query: 'planet=circuit&stages=0',
    w: 360,
    h: 240,
    run: `(() => { __mpp.play(); __mpp.step(${sel === 'box' ? 600 : 30}, 1 / 60, 0.2); return (${CLOSE_UP})('${sel}', ${d}, ${h}); })()`,
  });
}
// 5. Progresser : le carrousel des mondes (réussi, en cours, verrouillé)
await shot('progresser', {
  query: 'preset=arcade',
  init: `localStorage.setItem('mpp.progress.v2', JSON.stringify({ goals: { prairie: 3, meuh: 1 }, stats: {}, trophies: ['first', 'world'] }))`,
  run: `(() => { __mpp.showPlanets(); __mpp.world.select.select(1, true); __mpp.step(40, 1 / 60, 0); document.getElementById('menu-planets').style.display = 'none'; return 'ok'; })()`,
});
await browser.close();
server.close();
console.log('rendus :', OUT);
