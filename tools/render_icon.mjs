/**
 * Rendu de l'icône par le moteur du jeu (Chromium headless) puis composition :
 *   npm run build && node tools/render_icon.mjs && python3 tools/icon_compose.py .cache/icon_render.png public/icons
 * Voiture volante agrandie au-dessus de la Prairie, caméra trois-quarts arrière.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../.cache/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
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
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${server.address().port}/index.html?test=1&seed=1&preset=arcade&unlockAll=1&planet=prairie`);
await page.waitForFunction(() => window.__mppReady === true, null, { timeout: 120000 });
await page.evaluate(() => {
  __mpp.seed(12345);
  __mpp.play();
  __mpp.step(100, 1 / 60, 0.15);
  // [hauteur, avant, côté, visée] en rayons de planète ; fov ; échelle voiture
  const [hu, fw, sd, look, fov, scale] = [0.75, -3.0, -1.2, 0.85, 40, 8.5];
  const w = __mpp.world;
  const car = w.car;
  const V = car.position.constructor;
  const O = w.planet.position.clone();
  const R = w.planetRadius();
  const up = car.position.clone().sub(O).normalize();
  const fwd = new V(0, 0, 1).applyQuaternion(car.quaternion);
  const left = new V(1, 0, 0).applyQuaternion(car.quaternion);
  car.scale.multiplyScalar(scale);
  car.position.copy(O).addScaledVector(up, R);
  car.updateMatrixWorld(true);
  w.rig.follow = () => {};
  const cam = w.rig.camera;
  cam.parent.remove(cam);
  w.scene.add(cam);
  cam.clearViewOffset();
  cam.fov = fov;
  cam.aspect = 1;
  cam.updateProjectionMatrix();
  cam.position.copy(O).addScaledVector(up, R * hu).addScaledVector(fwd, R * fw).addScaledVector(left, R * sd);
  cam.up.copy(up);
  cam.lookAt(O.clone().addScaledVector(up, R * look));
  cam.updateMatrixWorld();
  w.meteors.clear();
  w.decor.group.visible = false;
  for (const c of w.clocks.instances) c.visible = false;
  for (const id of ['hud', 'touch-zones']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  __mpp.render();
});
await page.locator('canvas#game').screenshot({ path: join(OUT, 'icon_render.png') });
await browser.close();
server.close();
console.log('rendu :', join(OUT, 'icon_render.png'));
