/**
 * Point d'entrée : chargement, menus, boucle de jeu, PWA.
 */
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { Input, vibrate } from './input/input';
import { TouchButton, VirtualStick } from './input/stick';
import { bindSchemaToProject } from './settings/bindings';
import { currentPreset, loadImage, loadRecords, loadSettings, settingsFromUrl, submitRecord, type Settings } from './settings/store';
import { Hud } from './ui/hud';
import { Minimap, type MapItem } from './ui/minimap';
import { setupOrientation } from './ui/orientation';
import { Screens } from './ui/screens';
import { Assets } from './unity/assets';
import { World } from './game/World';
import * as THREE from 'three';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

async function loadFont(): Promise<void> {
  try {
    const f = new FontFace('Liberation', 'url(./fonts/LiberationSans.ttf)');
    document.fonts.add(await f.load());
  } catch {
    /* police système de repli */
  }
}

async function main(): Promise<void> {
  if (!TEST && 'serviceWorker' in navigator) registerSW({ immediate: true });
  const fontP = loadFont();
  const progress = $('progress-fill');
  const assets = new Assets('./');
  await assets.loadData();
  bindSchemaToProject(assets.project);
  const settings: Settings = settingsFromUrl(loadSettings());
  const preset = params.get('preset') ?? currentPreset();
  document.body.classList.toggle('original', preset === 'original');
  // Image perso du sol (IndexedDB)
  const img = TEST ? null : await loadImage('planetImage');
  await assets.load((p) => (progress.style.width = `${Math.round(p * 100)}%`));
  if (img) {
    const bmp = await createImageBitmap(img);
    const t = new THREE.Texture(bmp);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    t.needsUpdate = true;
    assets.planetOverride = t;
  }
  await fontP;

  const hud = new Hud();
  const screens = new Screens();
  const input = new Input();
  const minimap = new Minimap($('minimap'));
  const canvas = $<HTMLCanvasElement>('game');
  const world = new World(assets, settings, canvas, {
    health: (hp, max, d) => {
      hud.health(hp, max, d);
      if (d < 0) vibrate(d <= -30 ? [60, 40, 90] : 45, settings.haptics === true);
    },
    message: (t, k) => hud.message(t, k),
    gameOver: (stats) => onGameOver(stats),
    turbo: (l, a) => hud.turbo(l, a),
  });

  // --- contrôles tactiles
  const touch = matchMedia('(pointer: coarse)').matches || params.has('touch');
  document.body.classList.toggle('no-touch', !touch);
  const stickZone = $('stick-zone');
  const stick = new VirtualStick(stickZone, settings.stickFloating === true, settings.stickSide === 'right' ? 'right' : 'left');
  stick.configure(settings.stickFloating === true, settings.stickSide === 'right' ? 'right' : 'left');
  input.stick = stick;
  const turboBtn = new TouchButton(hud.turboBtn);
  input.turboButton = turboBtn;
  hud.turboBtn.hidden = settings.turbo !== true;
  $('minimap').hidden = settings.minimap !== true;
  const click = () => {
    if (settings.extraSounds === true) world.audio.playOneShot('Click', 0.6);
  };

  // --- tailles (mises en cache, pas de mesure DOM par frame)
  const quality = String(settings.quality);
  let pixelRatio = Math.min(Number(settings.maxPixelRatio), window.devicePixelRatio || 1);
  if (quality === 'low') pixelRatio = Math.min(pixelRatio, 1);
  if (quality === 'medium') pixelRatio = Math.min(pixelRatio, 1.5);
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    world.resize(w, h, pixelRatio);
    stick.layout();
    minimap.resize(Math.round(Math.max(84, Math.min(140, Math.min(w, h) * 0.24))), window.devicePixelRatio || 1);
  };
  window.addEventListener('resize', resize);
  resize();

  $('loading-text').textContent = 'Préparation des shaders…';
  await world.precompile();
  world.enterMenu();
  $('loading').hidden = true;

  // --- états
  let paused = false;
  let portrait = false;
  const records = () => screens.records(loadRecords(), settings.saveRecords === true);
  $('preset-badge').textContent = preset === 'original' ? 'Préréglage : Original (Unity)' : 'Préréglage : Arcade';
  const toMenu = () => {
    paused = false;
    hud.show(false);
    hud.clearMessages();
    world.enterMenu();
    records();
    screens.show('menu-main');
  };
  const play = () => {
    paused = false;
    input.reset();
    hud.clearMessages();
    hud.show(true);
    screens.show(null);
    world.startGame();
    hud.setObjective(settings.stages === true ? world.stages.text : '');
  };
  const setPause = (p: boolean) => {
    if (world.mode !== 'play' && world.mode !== 'dying') return;
    paused = p;
    input.reset();
    screens.show(p ? 'menu-pause' : null);
    world.setPaused(p);
  };
  function onGameOver(stats: { distance: number; time: number; stage: number; clocks: number }): void {
    let rank = 0;
    if (settings.saveRecords === true) rank = submitRecord({ distance: stats.distance, time: stats.time, date: new Date().toISOString(), preset: preset === 'original' ? 'original' : 'arcade' });
    const best = settings.saveRecords === true ? loadRecords()[0]?.distance ?? null : null;
    screens.gameOver(stats, rank, rank === 1 ? null : best, preset !== 'original');
    hud.show(preset !== 'original');
    screens.show('menu-over');
    vibrate([80, 60, 160], settings.haptics === true);
  }

  const on = (id: string, fn: () => void) =>
    $(id).addEventListener('click', () => {
      click();
      fn();
    });
  on('btn-play', play);
  on('btn-help', () => screens.show('menu-help'));
  on('btn-help-back', () => screens.show('menu-main'));
  on('btn-pause', () => setPause(true));
  on('btn-resume', () => setPause(false));
  on('btn-restart', play);
  on('btn-pause-menu', toMenu);
  on('btn-retry', play); // GameOverManager.RetryGame
  on('btn-over-menu', toMenu); // GameOverManager.ReturnToMenu
  // Le bouton pause ne doit pas déclencher le stick
  $('btn-pause').addEventListener('pointerdown', (e) => e.stopPropagation());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (world.mode === 'play') setPause(true);
      world.audio.suspend();
    } else if (!paused) world.audio.resume();
  });
  setupOrientation((p) => {
    portrait = p;
    if (p && world.mode === 'play') setPause(true);
  });

  // Invitation à installer la PWA (Android / Chrome)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const hint = $('install-hint');
    hint.hidden = false;
    hint.textContent = 'Installer le jeu sur l’écran d’accueil';
    hint.style.pointerEvents = 'auto';
    hint.onclick = () => void (e as Event & { prompt: () => Promise<void> }).prompt();
  });

  // --- boucle
  let last = performance.now();
  let fpsAcc = 0;
  let fpsN = 0;
  let slow = 0;
  let fast = 0;
  const maxPR = Math.min(Number(settings.maxPixelRatio), window.devicePixelRatio || 1);
  const items: MapItem[] = [];
  const center = new THREE.Vector3();
  const frame = (dt: number) => {
    input.update(dt);
    if (input.consumePause()) {
      if (screens.current === 'menu-pause') setPause(false);
      else setPause(true);
    }
    if (!paused && !portrait) world.step(dt, input);
    world.render();
    if (world.mode === 'play' || world.mode === 'dying') {
      hud.setChrono(world.chrono);
      hud.setDistance(world.tracker.totalDistance, preset === 'original');
      if (settings.stages === true) hud.setObjective(world.stages.text);
      if (settings.minimap === true) {
        items.length = 0;
        world.planet.updateMatrixWorld();
        const toWorld = (p: THREE.Vector3) => world.planet.localToWorld(p.clone()).sub(world.planet.getWorldPosition(center));
        for (const p of world.clocks.positions()) items.push({ pos: toWorld(p), kind: 'clock' });
        if (settings.meteorWarning === true) for (const p of world.meteors.targets()) items.push({ pos: toWorld(p), kind: 'meteor' });
        for (const c of world.craters.list) items.push({ pos: toWorld(c.pos), kind: 'crater' });
        minimap.draw(world.car, world.planet.getWorldPosition(center), items, world.chrono);
      }
    }
  };
  const loop = (now: number) => {
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    frame(dt);
    // FPS et qualité adaptative (densité de pixels, quantité de particules)
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 1) {
      const fps = fpsN / fpsAcc;
      hud.setFps(settings.showFps === true ? fps : null);
      if (quality === 'auto' && !paused) {
        if (fps < 45) {
          slow++;
          fast = 0;
        } else if (fps > 57) {
          fast++;
          slow = 0;
        }
        if (slow >= 2 && pixelRatio > 1) {
          pixelRatio = Math.max(1, pixelRatio - 0.25);
          world.setEffectsScale(0.7);
          resize();
          slow = 0;
        } else if (fast >= 6 && pixelRatio < maxPR) {
          pixelRatio = Math.min(maxPR, pixelRatio + 0.25);
          resize();
          fast = 0;
        }
      }
      fpsAcc = 0;
      fpsN = 0;
    }
    requestAnimationFrame(loop);
  };

  records();
  screens.show('menu-main');
  if (TEST) {
    // Mode test : pas de boucle rAF, simulation pilotée par Playwright
    const w = window as unknown as Record<string, unknown>;
    w.__mpp = {
      world,
      seed: (n: number) => world.seed(n),
      play,
      toMenu,
      step: (n: number, dt = 1 / 60, h = 0, turbo = false) => {
        for (let i = 0; i < n; i++) {
          world.step(dt, { horizontal: h, turbo });
        }
      },
      render: () => frame(0),
      hud,
      screens,
      input,
      settings: () => settings,
    };
    document.body.classList.add('test');
    w.__mppReady = true;
  } else {
    requestAnimationFrame((t) => {
      last = t;
      requestAnimationFrame(loop);
    });
  }
  // Rechargement des réglages après retour de la page Réglages (bfcache)
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) location.reload();
  });
}

main().catch((e) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = 'Erreur de chargement : ' + (e instanceof Error ? e.message : String(e));
});
