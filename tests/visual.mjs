/**
 * Tests visuels déterministes (Chromium headless, rendu logiciel SwiftShader).
 * La boucle rAF est désactivée (?test=1) : on appelle la boucle du jeu à
 * 1/60 s sans rendu intermédiaire, puis on fait UNE capture par scénario.
 *   npm run build && npm run test:visual
 * Les captures sont écrites dans tests/out/ ; elles se comparent aux images
 * de référence de tests/reference/ (captures du jeu Unity / de l'APK).
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  try {
    const data = await readFile(join(DIST, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, ok));
const port = server.address().port;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const scenarios = [
  { name: 'menu', query: 'preset=arcade&planet=prairie', run: async () => {} },
  { name: 'planets', query: 'preset=arcade&unlockAll=1&planet=futur', run: async (page) => page.evaluate(() => __mpp.showPlanets()) },
  { name: 'prairie-8s', query: 'preset=arcade&planet=prairie', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.world.aimOverride = 0.8; __mpp.step(480, 1 / 60, 0.3); }) },
  { name: 'emeraude', query: 'preset=arcade&planet=emeraude&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, -0.2); }) },
  { name: 'sage', query: 'preset=arcade&planet=sage&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(240, 1 / 60, 0.3); }) },
  { name: 'champi', query: 'preset=arcade&planet=champi&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, -0.3); }) },
  { name: 'ocean', query: 'preset=arcade&planet=ocean&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(260, 1 / 60, 0.25); }) },
  { name: 'comte', query: 'preset=arcade&planet=comte', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, 0.2); }) },
  { name: 'herbes', query: 'preset=arcade&planet=herbes', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, -0.25); }) },
  { name: 'candy', query: 'preset=arcade&planet=candy', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.world.health.currentHealth = 30; __mpp.step(300, 1 / 60, 0.3); }) },
  { name: 'pixar', query: 'preset=arcade&planet=pixar', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, 0.35); }) },
  { name: 'disney', query: 'preset=arcade&planet=disney', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, -0.3); }) },
  { name: 'futur-turbo', query: 'preset=arcade&planet=futur', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(240, 1 / 60, 0.2); __mpp.step(50, 1 / 60, 0.2, true); }) },
  { name: 'petitprince', query: 'preset=arcade&planet=petitprince', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(240, 1 / 60, 0.3); }) },
  { name: 'time-attack', query: 'preset=arcade&planet=prairie&modeTimeAttack=1&modeStorm=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(3200, 1 / 60, 0.3); }) },
  { name: 'cubes', query: 'preset=arcade&planet=cubes&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, 0.4); }) },
  { name: 'banquise', query: 'preset=arcade&planet=banquise&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, 0.6); }) },
  { name: 'naine', query: 'preset=arcade&planet=naine&unlockAll=1', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(300, 1 / 60, 0.1); }) },
  { name: 'shrink-late', query: 'preset=arcade&planet=prairie&maxHealth=4000&meteorInterval=3', run: async (page) => page.evaluate(() => { __mpp.play(); for (let i = 0; i < 40; i++) __mpp.step(240, 1 / 60, Math.sin(i) * 0.5); }) },
  { name: 'menu-portrait', viewport: { width: 400, height: 860 }, query: 'preset=arcade&planet=disney', run: async () => {} },
  { name: 'portrait', viewport: { width: 420, height: 860 }, query: 'preset=arcade&planet=prairie&orientation=auto', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(240, 1 / 60, 0.2); }) },
  { name: 'arcade-impact', query: 'preset=arcade&planet=prairie&meteorInterval=0.4', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.world.aimOverride = 1; __mpp.step(200, 1 / 60, 0); }) },
  { name: 'original-6s', query: 'preset=original', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(360, 1 / 60, 0.35); }) },
  { name: 'pause', query: 'preset=arcade', run: async (page) => page.evaluate(() => { __mpp.play(); __mpp.step(60); document.getElementById('btn-pause').click(); }) },
  { name: 'settings', page: 'settings.html', run: async () => {} },
  { name: 'gameover', query: 'preset=original&maxHealth=20', run: async (page) => page.evaluate(() => { __mpp.play(); for (let i = 0; i < 60 && __mpp.world.mode === 'play'; i++) __mpp.step(60, 1 / 60, Math.sin(i) * 0.8); }) },
];
const only = process.argv[2];
const results = [];
for (const sc of scenarios) {
  if (only && !sc.name.includes(only)) continue;
  const page = await browser.newPage({ viewport: sc.viewport ?? { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  if (sc.page) {
    await page.goto(`http://localhost:${port}/${sc.page}`);
    await page.waitForSelector('fieldset');
    await page.screenshot({ path: join(OUT, `${sc.name}.png`), fullPage: false });
    results.push({ name: sc.name, errors: logs.filter((l) => l.includes('error')) });
    await page.close();
    continue;
  }
  await page.goto(`http://localhost:${port}/index.html?test=1&touch=1&seed=1&${sc.query}`);
  await page.waitForFunction(() => window.__mppReady === true, null, { timeout: 120000 });
  await page.evaluate(() => __mpp.seed(12345));
  const t0 = Date.now();
  await sc.run(page);
  const metrics = await page.evaluate(() => {
    __mpp.render();
    const w = __mpp.world;
    return { mode: w.mode, distance: w.tracker.totalDistance, hp: w.health.currentHealth, craters: w.craters.list.length, meteors: w.meteors.active.length, particles: w.particleCount, chrono: w.chrono, calls: w.renderer.info.render.calls, tris: w.renderer.info.render.triangles };
  });
  await page.screenshot({ path: join(OUT, `${sc.name}.png`) });
  results.push({ name: sc.name, ms: Date.now() - t0, ...metrics, errors: logs.filter((l) => l.includes('error')) });
  await page.close();
}
await writeFile(join(OUT, 'metrics.json'), JSON.stringify(results, null, 1));
console.table(results.map(({ errors, ...r }) => ({ ...r, errors: errors.length })));
for (const r of results) for (const e of r.errors) console.log(r.name, e);
await browser.close();
server.close();

// --- Test fonctionnel des deux zones tactiles (pointer events) + bouton turbo
{
  const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const srv = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
    try { const d = await readFile(join(DIST, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => srv.listen(0, ok));
  const page = await b2.newPage({ viewport: { width: 900, height: 420 } });
  await page.goto(`http://localhost:${srv.address().port}/index.html?test=1&touch=1&preset=arcade`);
  await page.waitForFunction(() => window.__mppReady === true, null, { timeout: 120000 });
  await page.evaluate(() => __mpp.play());
  const read = () => page.evaluate(() => { __mpp.input.update(0.5); return [+__mpp.input.horizontal.toFixed(3), __mpp.input.turbo]; });
  const press = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); const v = await read(); await page.mouse.up(); await read(); return v; };
  const left = await press(150, 220);
  const right = await press(750, 160);
  const after = await read();
  // Bouton turbo (moitié droite) : turbo sans virage
  const t = await page.evaluate(() => { const b = document.getElementById('btn-turbo').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const turbo = await press(t.x, t.y);
  // HUD : la barre de vie ne chevauche jamais le chrono (paysage et portrait)
  const overlap = async () => page.evaluate(() => {
    const a = document.querySelector('.hud-left').getBoundingClientRect();
    const c = document.querySelector('.hud-center').getBoundingClientRect();
    return a.right > c.left + 1 && a.bottom > c.top;
  });
  const o1 = await overlap();
  // Bouton pause : vrai clic au doigt (il doit passer au-dessus des zones tactiles)
  const pb = await page.evaluate(() => { const b = document.getElementById('btn-pause').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(pb.x, pb.y);
  const paused = await page.evaluate(() => !document.getElementById('menu-pause').hidden);
  await page.evaluate(() => document.getElementById('btn-resume').click());
  await page.setViewportSize({ width: 360, height: 760 });
  await page.waitForTimeout(200);
  const o2 = await overlap();
  const ok = left[0] === -1 && right[0] === 1 && after[0] === 0 && turbo[0] === 0 && turbo[1] === true && !o1 && !o2 && paused;
  console.log('Zones : gauche', left, 'droite', right, 'relâché', after, 'turbo', turbo, 'chevauchement HUD', o1, o2, 'pause au doigt', paused, ok ? 'OK' : 'ÉCHEC');
  await b2.close();
  srv.close();
  if (!ok) process.exitCode = 1;
}
