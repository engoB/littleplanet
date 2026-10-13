/**
 * Point d'entrée : chargement, menus, boucle de jeu, PWA.
 */
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION } from './version';
import { Input, vibrate } from './input/input';
import { TouchButton, VirtualStick } from './input/stick';
import { TouchZones } from './input/zones';
import { bindSchemaToProject } from './settings/bindings';
import { currentPreset, loadImage, loadRecords, loadSettings, saveSetting, settingsFromUrl, submitRecord, type Settings } from './settings/store';
import { SCHEMA } from './settings/schema';
import { Hud } from './ui/hud';
import { Minimap, type MapItem } from './ui/minimap';
import { setupOrientation } from './ui/orientation';
import { Screens } from './ui/screens';
import { Assets } from './unity/assets';
import { World } from './game/World';
import { FIRST, PLANETS, type PlanetDef, setWorldChallenges, worldChallenges, planetById, recordDistance, resetProgress, selectPlanet, selectedPlanet, bestDistances } from './game/planets';
import { GOALS, completion, defiHint, defiUnlocked, goalsOf, isUnlocked, migrateProgress, recordRun, setUnlockAll, trophies, unlockHint, voyageUnlocked, type RunStats } from './game/progress';
import * as THREE from 'three';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Difficulté en pastilles (pleines / vides), indépendante des glyphes de la police. */
function stars(el: HTMLElement, n: number): void {
  el.textContent = '';
  el.setAttribute('aria-label', `Difficulté ${n} sur 5`);
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('i');
    d.className = i < n ? 'st on' : 'st';
    d.textContent = '★';
    el.appendChild(d);
  }
}
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

async function loadFont(): Promise<void> {
  const faces = [
    new FontFace('Liberation', 'url(./fonts/LiberationSans.ttf)'),
    new FontFace('Fredoka', 'url(./fonts/Fredoka-600.woff2)', { weight: '400 600' }),
    new FontFace('Fredoka', 'url(./fonts/Fredoka-700.woff2)', { weight: '700 900' }),
    new FontFace('Lilita', 'url(./fonts/LilitaOne.woff2)'),
  ];
  await Promise.all(
    faces.map(async (f) => {
      try {
        document.fonts.add(await f.load());
      } catch {
        /* police système de repli */
      }
    }),
  );
}

/**
 * Mise à jour de l'application installée : une PWA reste souvent en mémoire
 * sur mobile et ne recharge jamais la page. On vérifie donc la présence d'une
 * nouvelle version au retour au premier plan, au retour du réseau et toutes
 * les 30 min ; une version prête est appliquée dès qu'on n'est pas en pleine
 * partie (menus, fin de partie).
 */
let updatePending = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let canUpdateNow = () => true;
function maybeUpdate(): void {
  if (!updatePending || !applyUpdate || !canUpdateNow()) return;
  updatePending = false;
  const hint = document.getElementById('install-hint');
  if (hint) {
    hint.hidden = false;
    hint.textContent = 'Nouvelle version : mise à jour…';
  }
  void applyUpdate(true);
}
function setupUpdates(): void {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updatePending = true;
      maybeUpdate();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine !== false) reg.update().catch(() => undefined);
      };
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      window.addEventListener('online', check);
      window.addEventListener('focus', check);
    },
  });
}

async function main(): Promise<void> {
  if (!TEST && 'serviceWorker' in navigator) setupUpdates();
  for (const el of document.querySelectorAll('.app-version')) el.textContent = `v${APP_VERSION}`;
  const fontP = loadFont();
  const progress = $('progress-fill');
  const assets = new Assets('./');
  await assets.loadData();
  bindSchemaToProject(assets.project);
  // Nouvelle version de la progression : tout est à refaire (une seule fois)
  if (!TEST) migrateProgress(resetProgress);
  const settings: Settings = settingsFromUrl(loadSettings());
  // Tests : ?planet= ouvre directement le monde demandé
  setUnlockAll(settings.unlockAll === true || (TEST && params.has('planet')));
  // Tests déterministes : pas de compte à rebours sauf demande explicite
  if (TEST && !params.has('countdown')) settings.countdown = false;
  // Paramètres d'URL (tests) : les bascules du menu ne sont pas enregistrées
  const urlOverride = new URLSearchParams(location.search).has('preset');
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
  $('loading-text').textContent = 'Chargement des sons…';

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
    stage: (n, label, title) => {
      hud.stageBanner(n, label, title);
      vibrate([30, 40, 30], settings.haptics === true);
    },
    countdown: (n) => hud.countdown(n),
  });

  const audioP = world.audio.loadAll('./', assets.manifest.audio);
  const isOriginal = preset === 'original';
  // Planète : la planète d'origine en préréglage Original, sinon la dernière choisie
  let planetId = isOriginal ? 'origine' : params.get('planet') ?? selectedPlanet();
  if (!isUnlocked(planetById(planetId)) || planetById(planetId).style === 'galaxy') planetId = FIRST.id;
  world.planetDef = planetById(planetId);
  // ?planet=galaxie (tests) : lance directement le voyage galactique
  if (params.get('planet') === 'galaxie') world.planetDef = planetById('galaxie');

  // --- contrôles tactiles
  const touch = matchMedia('(pointer: coarse)').matches || params.has('touch');
  document.body.classList.toggle('no-touch', !touch);
  const stickZone = $('stick-zone');
  const stick = new VirtualStick(stickZone, settings.stickFloating === true, settings.stickSide === 'right' ? 'right' : 'left');
  stick.configure(settings.stickFloating === true, settings.stickSide === 'right' ? 'right' : 'left');
  input.stick = stick;
  // Commande « écran coupé en deux » (Arcade) ou joystick
  const zonesMode = settings.controlMode !== 'stick';
  const zones = new TouchZones($('touch-zones'));
  zones.enabled = zonesMode;
  $('touch-zones').hidden = !zonesMode;
  stickZone.hidden = zonesMode;
  input.zones = zonesMode ? zones : null;
  if (zonesMode) input.stick = null;
  const turboBtn = new TouchButton(hud.turboBtn);
  input.turboButton = turboBtn;
  hud.turboBtn.hidden = settings.turbo !== true;
  // Santé : anneau au sol (Arcade) ou barre du HUD (Original)
  (document.querySelector('.health') as HTMLElement).hidden = settings.healthDisplay === 'ring';
  $('minimap').hidden = settings.minimap !== true;
  const click = () => {
    if (settings.extraSounds === true) world.audio.playOneShot('ui_click', 0.5);
  };

  // --- tailles (mises en cache, pas de mesure DOM par frame)
  let quality = String(settings.quality);
  let pixelRatio = 1;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const basePixelRatio = () => {
    quality = String(settings.quality);
    pixelRatio = Math.min(Number(settings.maxPixelRatio), window.devicePixelRatio || 1);
    if (quality === 'low') pixelRatio = Math.min(pixelRatio, 1);
    if (quality === 'medium') pixelRatio = Math.min(pixelRatio, 1.5);
    // Mobile en qualité auto : départ à 1,5 (la boucle monte si le 60 Hz tient)
    if (quality === 'auto' && coarse) pixelRatio = Math.min(pixelRatio, 1.5);
  };
  basePixelRatio();
  const resize = () => {
    // Taille réelle du canvas (100lvh) : pas de bande vide en bas de l'écran
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    world.resize(w, h, pixelRatio);
    stick.layout();
    // Portrait : mini-carte plus compacte (l'objectif tient sous le chrono)
    minimap.resize(Math.round(h > w ? Math.max(70, Math.min(96, w * 0.2)) : Math.max(84, Math.min(140, Math.min(w, h) * 0.24))), window.devicePixelRatio || 1);
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  document.addEventListener('fullscreenchange', () => setTimeout(resize, 100));
  resize();

  $('loading-text').textContent = 'Préparation des shaders…';
  await world.precompile();
  await audioP;
  world.enterMenu();
  $('loading').hidden = true;

  // --- états
  let paused = false;
  // Mise à jour : jamais pendant une partie, même en pause (seulement menus et fin de partie)
  canUpdateNow = () => world.mode === 'menu' || world.mode === 'over';
  let portrait = false;
  const records = () => screens.records(loadRecords(), settings.saveRecords === true);
  $('preset-badge').textContent = preset === 'original' ? 'Préréglage : Original (Unity)' : '';
  $('preset-badge').hidden = preset !== 'original';
  const portraitNow = () => window.innerHeight > window.innerWidth;
  /** Cadrage de la planète selon l'écran affiché (menus premium). */
  const compose = (where: 'home' | 'planets' | 'game' | 'title') => {
    if (where === 'game') world.rig.setComposition(0, 0);
    else if (where === 'title') world.rig.setComposition(0, portraitNow() ? 0.12 : 0);
    else if (where === 'planets') world.rig.setComposition(0, portraitNow() ? 0.22 : 0.14);
    else world.rig.setComposition(portraitNow() ? 0 : 0.2, portraitNow() ? 0.2 : 0);
  };
  const updateChip = () => {
    const p = planetById(planetId);
    $('chip-name').textContent = p.name;
    stars($('chip-stars'), p.difficulty);
    const img = $<HTMLImageElement>('chip-img');
    const prev = assets.planetPreviews.get(p.id);
    img.hidden = !prev;
    if (prev) img.src = prev;
  };
  const toMenu = () => {
    paused = false;
    world.select.show(false);
    if (world.planetDef.style === 'galaxy') world.planetDef = planetById(planetId);
    compose('home');
    updateChip();
    hud.show(false);
    hud.clearMessages();
    world.enterMenu();
    records();
    screens.show('menu-main');
    maybeUpdate();
  };
  // --- Choix de la planète : carrousel 3D (façon sélection de royaume)
  const choosable = PLANETS.filter((p) => p.style !== 'galaxy');
  const diffLabel = ['', 'Facile', 'Tranquille', 'Corsé', 'Difficile', 'Extrême'];
  const renderPlanets = () => {
    world.select.setPlanets(choosable.map((def) => ({ def, locked: !isUnlocked(def) })));
    world.select.select(Math.max(0, choosable.findIndex((p) => p.id === planetId)), true);
    updatePlanetCard();
  };
  const updatePlanetCard = () => {
    const i = world.select.target;
    const p = choosable[i];
    if (!p) return;
    const unlocked = isUnlocked(p);
    const best = bestDistances()[p.id];
    const goals = Math.min(GOALS, goalsOf(p.id));
    $('ps-count').textContent = `${i + 1} / ${choosable.length}`;
    $('ps-kicker').textContent = `Monde ${i + 1} · ${diffLabel[p.difficulty] ?? ''}`;
    $('ps-name').textContent = p.name;
    stars($('ps-stars'), p.difficulty);
    $('ps-info').textContent = p.tagline;
    $('ps-best').textContent = !unlocked ? unlockHint(p) ?? '' : preset === 'original' ? (best ? `Record : ${Math.floor(best)} m` : '') : `Objectifs ${'●'.repeat(goals)}${'○'.repeat(GOALS - goals)}${best ? ` · record ${Math.floor(best)} m` : ''}`;
    $('ps-best').classList.toggle('locked', !unlocked);
    $('ps-defi-help').textContent = '';
    renderDefis(p, !unlocked);
    ($('btn-planet-go') as HTMLButtonElement).disabled = !unlocked;
    document.querySelector('.ps-card')!.classList.toggle('locked', !unlocked);
    if (unlocked && p.id !== planetId) {
      planetId = p.id;
      selectPlanet(p.id);
      world.planetDef = p;
      updateChip();
    }
  };
  const movePlanet = (d: number) => {
    const n = Math.max(0, Math.min(choosable.length - 1, world.select.target + d));
    if (n === world.select.target) return;
    world.select.select(n);
    if (settings.extraSounds === true) world.audio.playOneShot('ui_select', 0.45);
    updatePlanetCard();
  };
  {
    // Glisser horizontalement pour faire défiler
    const sw = $('ps-swipe');
    let x0: number | null = null;
    sw.addEventListener('pointerdown', (e) => (x0 = e.clientX));
    sw.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 30) movePlanet(dx < 0 ? 1 : -1);
    });
    $('ps-prev').addEventListener('click', () => movePlanet(-1));
    $('ps-next').addEventListener('click', () => movePlanet(1));
    window.addEventListener('keydown', (e) => {
      if (screens.current !== 'menu-planets') return;
      if (e.key === 'ArrowLeft') movePlanet(-1);
      else if (e.key === 'ArrowRight') movePlanet(1);
    });
  }
  const showPlanets = () => {
    paused = false;
    if (world.planetDef.style === 'galaxy') world.planetDef = planetById(planetId);
    compose('planets');
    hud.show(false);
    if (world.mode !== 'menu') world.enterMenu();
    renderPlanets();
    world.select.show(true);
    screens.show('menu-planets');
  };
  const play = () => {
    paused = false;
    world.select.show(false);
    compose('game');
    input.reset();
    hud.clearMessages();
    hud.show(true);
    if (!zonesMode) stick.layout();
    screens.show(null);
    applyDefis(world.planetDef);
    world.startGame();
    hud.setObjective(settings.stages === true ? world.stages.label : '', world.stages.stage, world.stages.objective.kind, 0);
    showHudModes();
  };
  const setPause = (p: boolean) => {
    if (world.mode !== 'play' && world.mode !== 'dying') return;
    paused = p;
    input.reset();
    screens.show(p ? 'menu-pause' : null);
    world.setPaused(p);
  };
  // --- Défis : choisis monde par monde, directement sur la carte du monde
  const MODE_ORDER = ['modeTimeAttack', 'modeStorm', 'modeMirror', 'modeSnitch', 'modeBullet', 'planetShrink'];
  const modeDefs = MODE_ORDER.map((k) => SCHEMA.find((d) => d.key === k)!).filter(Boolean);
  const SHORT: Record<string, string> = { modeTimeAttack: 'Chrono', modeStorm: 'Tempête', modeMirror: 'Miroir', modeSnitch: 'Vif d’or', modeBullet: 'Bullet Bill', planetShrink: 'Rétrécit' };
  // Valeurs par défaut (réglages) : un monde jamais réglé reprend celles-ci
  const defaultDefis = MODE_ORDER.filter((k) => settings[k] === true);
  const defisOf = (id: string) => (worldChallenges(id) ?? defaultDefis).filter((k) => defiUnlocked(k));
  /** Applique les défis du monde (ou aucun pour le voyage) avant une partie. */
  // Voyage : ses propres défis (sans Chrono ni Rétrécit, il a son compte à rebours)
  const VOYAGE_DEFIS = ['modeStorm', 'modeMirror', 'modeSnitch', 'modeBullet'];
  const applyDefis = (def: PlanetDef) => {
    if (urlOverride) return; // tests : réglages imposés par l'URL
    const on = def.style === 'galaxy' ? (worldChallenges('galaxie') ?? []).filter((k) => VOYAGE_DEFIS.includes(k) && defiUnlocked(k)) : defisOf(def.id);
    for (const k of MODE_ORDER) settings[k] = on.includes(k);
    world.applySettings(settings);
  };
  const renderDefis = (def: PlanetDef, locked: boolean, boxId = 'ps-defis') => {
    const box = $(boxId);
    box.innerHTML = '';
    box.hidden = locked || preset === 'original';
    const voyage = def.style === 'galaxy';
    const on = new Set((voyage ? worldChallenges('galaxie') ?? [] : defisOf(def.id)).filter((k) => defiUnlocked(k)));
    const help = $(voyage ? 'voy-defi-help' : 'ps-defi-help');
    for (const d of modeDefs.filter((x) => !voyage || VOYAGE_DEFIS.includes(x.key))) {
      const b = document.createElement('button');
      b.className = 'defi';
      if (!defiUnlocked(d.key)) {
        // Défi encore verrouillé : cadenas, et l'aide dit comment l'ouvrir
        b.classList.add('locked');
        b.innerHTML = `<i class="mode-ico mi-${d.key}"></i><span></span>`;
        b.querySelector('span')!.textContent = SHORT[d.key] ?? d.label;
        b.title = defiHint(d.key);
        b.addEventListener('click', () => {
          if (settings.extraSounds === true) world.audio.playOneShot('ui_toggle_off', 0.4, 0.7);
          help.textContent = defiHint(d.key);
        });
        box.appendChild(b);
        continue;
      }
      b.classList.toggle('on', on.has(d.key));
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on.has(d.key)));
      b.title = `${d.label} : ${d.help ?? ''}`;
      b.innerHTML = `<i class="mode-ico mi-${d.key}"></i><span></span>`;
      b.querySelector('span')!.textContent = SHORT[d.key] ?? d.label;
      b.addEventListener('click', () => {
        if (on.has(d.key)) on.delete(d.key);
        else on.add(d.key);
        setWorldChallenges(def.id, MODE_ORDER.filter((k) => on.has(k)));
        if (settings.extraSounds === true) world.audio.playOneShot(on.has(d.key) ? 'ui_toggle_on' : 'ui_toggle_off', 0.5);
        renderDefis(def, locked, boxId);
        help.textContent = on.has(d.key) ? `${d.label} : ${d.help ?? ''}` : '';
      });
      box.appendChild(b);
    }
  };
  const updateModes = () => {
    if (!voyageUnlocked()) return;
    const t = world.galaxyTime;
    $('modes-summary').textContent = `${world.galaxyCount ? `${world.galaxyCount} planètes` : 'Sans fin'} · ${t ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} / planète` : 'temps libre'}`;
  };
  // Voyage galactique : nombre de planètes et temps par planète (choix segmentés)
  const syncSegs = () => {
    for (const seg of document.querySelectorAll<HTMLElement>('.seg')) {
      const key = seg.dataset.key!;
      for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', String(settings[key]) === b.dataset.v);
    }
  };
  for (const seg of document.querySelectorAll<HTMLElement>('.seg')) {
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const key = seg.dataset.key!;
      settings[key] = b.dataset.v!;
      if (!urlOverride) saveSetting(key, settings[key]);
      click();
      syncSegs();
      updateModes();
      if (key === 'quality') {
        basePixelRatio();
        resize();
      }
      if (key === 'difficulty') diffHelp();
    });
  }
  syncSegs();
  updateModes();
  // Modes actifs affichés en jeu (icône + nom, qui se replient en icônes après quelques secondes)
  let hudModesTimer = 0;
  const showHudModes = () => {
    const el = $('hud-modes');
    const list: { key: string; label: string }[] = modeDefs.filter((d) => settings[d.key] === true).map((d) => ({ key: d.key, label: d.label }));
    if (world.planetDef.style === 'galaxy') list.unshift({ key: 'galaxy', label: world.galaxyCount ? `Voyage · ${world.galaxyCount} planètes` : 'Voyage sans fin' });
    el.innerHTML = '';
    for (const m of list) {
      const c = document.createElement('div');
      c.className = 'hm';
      c.innerHTML = `<i class="mode-ico mi-${m.key}"></i><span class="t"></span>`;
      c.querySelector('.t')!.textContent = m.label;
      el.appendChild(c);
    }
    el.hidden = list.length === 0 || preset === 'original';
    el.classList.remove('compact');
    clearTimeout(hudModesTimer);
    hudModesTimer = window.setTimeout(() => el.classList.add('compact'), 4500);
  };

  /** Annonce d'un succès, d'un monde ou d'un défi débloqué (petite carte en haut). */
  const toast = (title: string, text: string, icon = '🏆', delay = 0) => {
    window.setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<span class="toast-ico"></span><span class="toast-text"><b></b><small></small></span>';
      el.querySelector('.toast-ico')!.textContent = icon;
      el.querySelector('b')!.textContent = title;
      el.querySelector('small')!.textContent = text;
      $('toasts').appendChild(el);
      if (settings.extraSounds === true) world.audio.playOneShot('sfx_stage', 0.5, 1.25);
      window.setTimeout(() => el.classList.add('out'), 3200);
      window.setTimeout(() => el.remove(), 3700);
    }, delay);
  };
  const updateProgress = () => {
    const pct = `${Math.round(completion() * 100)} %`;
    $('home-progress').textContent = pct;
    $('tro-pct').textContent = pct;
    $('tro-fill').style.transform = `scaleX(${completion()})`;
    const locked = !voyageUnlocked();
    $('btn-modes').classList.toggle('locked', locked);
    if (locked) $('modes-summary').textContent = `🔒 Débloque ${choosable[choosable.length - 1].name}`;
    else updateModes();
  };
  const renderTrophies = () => {
    const list = $('tro-list');
    list.innerHTML = '';
    for (const { t, got } of trophies()) {
      const row = document.createElement('div');
      row.className = `tro${got ? ' got' : ''}`;
      row.innerHTML = '<span class="tro-badge"></span><span class="tro-text"><b></b><small></small></span>';
      row.querySelector('.tro-badge')!.textContent = got ? t.icon : '🔒';
      row.querySelector('b')!.textContent = t.name;
      const mode = t.unlocks ? modeDefs.find((d) => d.key === t.unlocks) : undefined;
      row.querySelector('small')!.textContent = t.desc + (mode ? ` · débloque le défi ${SHORT[mode.key] ?? mode.label}` : '');
      list.appendChild(row);
    }
    updateProgress();
  };
  /** Confettis de la victoire (éléments CSS, retirés à la sortie de l'écran). */
  const confetti = () => {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#ffe066', '#ff6b9a', '#6be4ff', '#9b7bff', '#7dff9b', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 2.5}s`;
      c.style.animationDuration = `${2.6 + Math.random() * 2.2}s`;
      c.style.setProperty('--dx', `${Math.random() * 120 - 60}px`);
      c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      box.appendChild(c);
    }
  };

  function onGameOver(stats: RunStats): void {
    document.querySelector('#menu-over .gameover')!.textContent = 'GAME OVER';
    let rank = 0;
    // Modes « faciles » ou au score différent : pas de record
    const noRecord = settings.modeTimeAttack === true;
    if (settings.saveRecords === true && !noRecord) rank = submitRecord({ distance: stats.distance, time: stats.time, date: new Date().toISOString(), preset: preset === 'original' ? 'original' : 'arcade' });
    const best = settings.saveRecords === true ? loadRecords()[0]?.distance ?? null : null;
    $('stage-banner').hidden = true;
    if (!isOriginal && !noRecord) recordDistance(world.planetDef.id, stats.distance);
    // Progression classique : mondes, défis et succès débloqués
    const lines: string[] = [];
    if (!isOriginal) {
      const got = recordRun(world.planetDef, stats);
      for (const w of got.worlds) {
        lines.push(`Nouveau monde débloqué : ${w.name} !`);
        toast('Nouveau monde', w.name, '🪐');
      }
      if (got.voyage) {
        lines.push('Défis et Voyage galactique débloqués !');
        toast('Voyage galactique', 'Défis et voyage débloqués', '🚀', 600);
      }
      got.trophies.forEach((t, i) => toast('Succès débloqué', t.name, t.icon, 900 + i * 700));
      updateProgress();
    }
    vibrate([80, 60, 160], settings.haptics === true);
    if (stats.victory) {
      // Vrai écran de victoire du voyage
      hud.show(false);
      $('vic-planets').textContent = String(stats.planets ?? world.galaxyCount);
      $('vic-distance').textContent = `${Math.floor(stats.distance)} m`;
      $('vic-time').textContent = `${Math.floor(stats.time / 60)}:${String(Math.floor(stats.time % 60)).padStart(2, '0')}`;
      const vu = $('vic-unlock');
      vu.hidden = lines.length === 0;
      vu.textContent = lines.join(' ');
      confetti();
      screens.show('menu-victory');
      if (settings.extraSounds === true) world.audio.playOneShot('sfx_stage', 0.9, 0.9);
      maybeUpdate();
      return;
    }
    screens.gameOver(stats, rank, rank === 1 ? null : best, preset !== 'original', world.stages.item);
    const un = $('over-unlock');
    un.hidden = lines.length === 0;
    un.textContent = lines.join(' ');
    hud.show(preset !== 'original');
    screens.show('menu-over');
    maybeUpdate();
  }

  const on = (id: string, fn: () => void) =>
    $(id).addEventListener('click', () => {
      click();
      fn();
    });
  on('btn-play', play);
  on('btn-current-planet', showPlanets);
  on('btn-planet-go', play);
  on('btn-planets-back', toMenu);
  on('btn-pause-planets', showPlanets);
  on('btn-over-planets', showPlanets);
  on('btn-modes', () => {
    if (!voyageUnlocked()) {
      $('btn-modes').classList.remove('shake');
      void $('btn-modes').offsetWidth;
      $('btn-modes').classList.add('shake');
      return;
    }
    syncSegs();
    renderDefis(planetById('galaxie'), false, 'voy-defis');
    screens.show('menu-modes');
  });
  on('btn-modes-back', () => screens.show('menu-main'));
  // Voyage galactique : un mode à part entière (suite de planètes)
  on('btn-galaxy', () => {
    world.planetDef = planetById('galaxie');
    play();
  });
  // Tutoriel en diapositives
  let slide = 0;
  const slides = [...document.querySelectorAll<HTMLElement>('.tuto-slide')];
  const dots = $('tuto-dots');
  dots.innerHTML = slides.map(() => '<i></i>').join('');
  const showSlide = (i: number) => {
    slide = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((el, k) => el.classList.toggle('on', k === slide));
    [...dots.children].forEach((el, k) => el.classList.toggle('on', k === slide));
    $('btn-tuto-prev').style.visibility = slide === 0 ? 'hidden' : 'visible';
    $('btn-help-back').textContent = slide === slides.length - 1 ? "C'est parti !" : 'Suivant';
  };
  on('btn-help', () => {
    showSlide(0);
    screens.show('menu-help');
  });
  on('btn-tuto-prev', () => showSlide(slide - 1));
  on('btn-help-back', () => {
    if (slide < slides.length - 1) showSlide(slide + 1);
    else screens.show('menu-main');
  });
  on('btn-pause', () => setPause(true));
  on('btn-resume', () => setPause(false));
  on('btn-restart', play);
  on('btn-pause-menu', toMenu);
  on('btn-retry', play); // GameOverManager.RetryGame
  on('btn-over-menu', toMenu); // GameOverManager.ReturnToMenu
  on('btn-vic-again', () => {
    world.planetDef = planetById('galaxie');
    play();
  });
  on('btn-vic-menu', toMenu);
  // Options (roue dentée) : difficulté, sons, vibrations, qualité ; tout le reste dans l'Espace perso
  const diffHelp = () => {
    const d = String(settings.difficulty);
    $('opt-diff-help').textContent = d === 'easy' ? 'Météores rares et lents, dégâts réduits, aucune contrainte.' : d === 'hard' ? 'Poteaux, planète qui rétrécit, météores de plus en plus nombreux.' : 'Aucune contrainte, la pluie de météores monte doucement.';
  };
  const optRange = (id: string, key: string) => {
    const el = $<HTMLInputElement>(id);
    el.value = String(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      world.applySettings(settings);
    });
    el.addEventListener('change', () => {
      if (!urlOverride) saveSetting(key, settings[key]);
      click();
    });
  };
  optRange('opt-music', 'musicVolume');
  optRange('opt-sfx', 'sfxVolume');
  const syncHaptics = () => {
    $('opt-haptics').classList.toggle('on', settings.haptics === true);
    $('opt-haptics').setAttribute('aria-checked', String(settings.haptics === true));
  };
  on('opt-haptics', () => {
    settings.haptics = settings.haptics !== true;
    if (!urlOverride) saveSetting('haptics', settings.haptics);
    syncHaptics();
    vibrate(40, settings.haptics === true);
  });
  let optionsFrom: 'menu-main' | 'menu-planets' = 'menu-main';
  on('btn-settings', () => {
    optionsFrom = 'menu-main';
    syncSegs();
    syncHaptics();
    diffHelp();
    screens.show('menu-options');
  });
  on('btn-options-back', () => {
    if (screens.current === 'menu-options') screens.show(optionsFrom);
  });
  on('btn-trophies', () => {
    renderTrophies();
    screens.show('menu-trophies');
  });
  on('btn-opt-trophies', () => {
    renderTrophies();
    screens.show('menu-trophies');
  });
  on('btn-trophies-back', () => screens.show('menu-main'));
  // Le bouton pause ne doit pas déclencher le stick
  $('btn-pause').addEventListener('pointerdown', (e) => e.stopPropagation());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (world.mode === 'play') setPause(true);
      world.audio.suspend();
    } else if (!paused) world.audio.resume();
  });
  setupOrientation(String(settings.orientation) as 'auto' | 'landscape' | 'portrait', (p) => {
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
  let ceiling = Infinity;
  let degraded = false;
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
      const ta = world.countdown;
      hud.setChrono(ta ? world.timeLeft : world.chrono, ta);
      hud.setDistance(world.tracker.totalDistance, preset === 'original');
      if (settings.stages === true) hud.setObjective(world.stages.label, world.stages.stage, world.stages.objective.kind, world.stages.progress01);
      if (settings.minimap === true) {
        items.length = 0;
        world.planet.updateMatrixWorld();
        const toWorld = (p: THREE.Vector3) => world.planet.localToWorld(p.clone()).sub(world.planet.getWorldPosition(center));
        for (const p of world.clocks.positions()) items.push({ pos: toWorld(p), kind: 'clock' });
        if (settings.meteorWarning === true) for (const p of world.meteors.targets()) items.push({ pos: toWorld(p), kind: 'meteor' });
        for (const c of world.craters.list) items.push({ pos: toWorld(c.pos), kind: 'crater' });
        const sd = world.starDir;
        if (sd) items.push({ pos: toWorld(sd.clone().multiplyScalar(5)), kind: 'star' });
        const sn = world.snitch.dir;
        if (sn) items.push({ pos: toWorld(sn.clone().multiplyScalar(5)), kind: 'star' });
        for (const b of world.bills.dirs()) items.push({ pos: toWorld(b.clone().multiplyScalar(5)), kind: 'meteor' });
        minimap.draw(world.car, world.planet.getWorldPosition(center), items, world.chrono);
      }
    }
  };
  // Pas de temps lissé : les horodatages rAF ont une gigue de quelques ms qui,
  // appliquée telle quelle, fait trembler la caméra et le véhicule
  let avgDt = 1 / 60;
  const loop = (now: number) => {
    const raw = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    avgDt += (raw - avgDt) * 0.12;
    const dt = Math.abs(raw - avgDt) < avgDt * 0.35 ? avgDt : raw;
    frame(dt);
    // FPS et qualité adaptative (densité de pixels, quantité de particules)
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 1) {
      const fps = fpsN / fpsAcc;
      hud.setFps(settings.showFps === true ? fps : null);
      if (quality === 'auto' && !paused && document.visibilityState === 'visible') {
        // Objectif 60 Hz : sous 54 i/s pendant 2 s on baisse la qualité ; au-dessus
        // de 58 pendant 6 s on remonte, sans dépasser le palier qui a déjà ramé
        if (fps < 54) {
          slow++;
          fast = 0;
        } else if (fps > 58) {
          fast++;
          slow = 0;
        } else {
          slow = 0;
          fast = 0;
        }
        if (slow >= 2) {
          slow = 0;
          if (pixelRatio > 1) {
            ceiling = pixelRatio - 0.25;
            pixelRatio = Math.max(1, pixelRatio - 0.25);
            world.setEffectsScale(0.75);
            resize();
          } else if (!degraded) {
            degraded = true;
            world.setMsaa(0);
            world.setEffectsScale(0.5);
          }
        } else if (fast >= 6 && pixelRatio < Math.min(maxPR, ceiling)) {
          pixelRatio = Math.min(maxPR, ceiling, pixelRatio + 0.25);
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
  updateChip();
  updateProgress();
  compose('home');
  window.addEventListener('resize', () => {
    if (screens.current === 'menu-main') compose('home');
    else if (screens.current === 'menu-title') compose('title');
    else if (screens.current === 'menu-planets') compose('planets');
  });
  // Écran titre (Arcade) : planète classique, la voiture boucle sur le chemin
  const showTitle = preset !== 'original' && (!TEST || params.has('title'));
  if (showTitle) {
    world.enterTitle();
    compose('title');
    screens.show('menu-title');
    const leave = () => {
      if (screens.current !== 'menu-title') return;
      click();
      world.leaveTitle();
      world.planetDef = planetById(planetId);
      world.enterMenu();
      compose('home');
      screens.show('menu-main');
    };
    $('menu-title').addEventListener('click', leave);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') leave();
    });
  } else screens.show('menu-main');
  if (TEST) {
    // Mode test : pas de boucle rAF, simulation pilotée par Playwright
    const w = window as unknown as Record<string, unknown>;
    w.__mpp = {
      world,
      seed: (n: number) => world.seed(n),
      play,
      toMenu,
      showPlanets,
      planet: (id: string) => {
        planetId = id;
        world.planetDef = planetById(id);
        world.enterMenu();
      },
      // h = 'auto' : pilote automatique (suit la piste ou va vers l'étoile de lancement)
      step: (n: number, dt = 1 / 60, h: number | 'auto' = 0, turbo = false) => {
        for (let i = 0; i < n; i++) {
          world.step(dt, { horizontal: h === 'auto' ? world.autoSteer() : h, turbo });
        }
      },
      render: () => frame(0),
      gameOver: (st: RunStats) => onGameOver(st),
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
