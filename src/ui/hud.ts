/**
 * HUD : pause à gauche (avec la barre de santé du Slider Unity), chrono au
 * centre et objectif dessous, compteur de distance à droite (+ mini-carte),
 * messages d'étape, bouton turbo et stick.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  readonly root = $('hud');
  private readonly healthFill = $('health-fill');
  private readonly healthText = $('health-text');
  private readonly chrono = $('chrono');
  private readonly objective = $('objective');
  private readonly objStage = $('obj-stage');
  private readonly objIco = $('obj-ico');
  private readonly objText = $('obj-text');
  private readonly objFill = $('obj-fill');
  private readonly banner = $('stage-banner');
  private bannerTimer = 0;
  private lastKind = '';
  private lastFill = -1;
  private readonly distance = $('distance');
  private readonly messages = $('messages');
  private readonly turboRing = $<HTMLCanvasElement>('turbo-ring');
  private readonly turboCtx = this.turboRing.getContext('2d');
  private turboLevel = -1;
  private turboShown = 0;
  readonly turboBtn = $('btn-turbo');
  private readonly fps = $('fps');
  private readonly flash = $('damage-flash');
  private lastChrono = '';
  private lastDist = '';
  private lastObj = '';

  show(v: boolean): void {
    this.root.hidden = !v;
  }

  health(hp: number, max: number, delta: number): void {
    const k = Math.max(0, Math.min(1, hp / max));
    this.healthFill.style.transform = `scaleX(${k})`;
    this.healthFill.style.setProperty('--hp', String(k));
    this.healthText.textContent = `${Math.round(hp)}`;
    if (delta < 0) {
      this.flash.classList.remove('on');
      void this.flash.offsetWidth; // relance l'animation CSS
      this.flash.classList.add('on');
    }
  }

  setChrono(t: number, countdown = false): void {
    this.chrono.classList.toggle('hurry', countdown && t < 10);
    if (countdown) t = Math.ceil(t);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const txt = `${m}:${String(s).padStart(2, '0')}`;
    if (txt !== this.lastChrono) {
      this.chrono.textContent = txt;
      this.lastChrono = txt;
    }
  }

  setDistance(d: number, original: boolean): void {
    // Texte original : « Distance: 12.34 m »
    const txt = original ? `Distance: ${d.toFixed(2)} m` : `${Math.floor(d)} m`;
    if (txt !== this.lastDist) {
      this.distance.textContent = txt;
      this.lastDist = txt;
    }
  }

  /** Bannière d'objectif : numéro d'étape, icône, texte et barre de progression. */
  setObjective(t: string, stage = 1, kind = 'distance', progress = 0): void {
    if (t !== this.lastObj) {
      this.objText.textContent = t;
      this.objStage.textContent = String(stage);
      this.objective.hidden = !t;
      this.lastObj = t;
    }
    if (kind !== this.lastKind) {
      this.objIco.className = `obj-ico ${kind}`;
      this.lastKind = kind;
    }
    const f = Math.round(progress * 100) / 100;
    if (f !== this.lastFill) {
      this.objFill.style.transform = `scaleX(${f})`;
      this.lastFill = f;
    }
  }

  /** Grande annonce au centre de l'écran : « Étape 2 » + nouvel objectif. */
  private readonly count = $('countdown');
  private countTimer = 0;
  /** Compte à rebours de départ (0 : « Partez ! »). */
  countdown(n: number): void {
    const c = this.count;
    c.textContent = n > 0 ? String(n) : 'Partez !';
    c.hidden = false;
    c.classList.toggle('go', n <= 0);
    c.classList.remove('tick');
    void c.offsetWidth;
    c.classList.add('tick');
    clearTimeout(this.countTimer);
    if (n <= 0) this.countTimer = window.setTimeout(() => (c.hidden = true), 800);
  }

  stageBanner(stage: number, sub: string, title = `Étape ${stage}`): void {
    const b = this.banner;
    $('sb-title').textContent = title;
    $('sb-sub').textContent = sub;
    b.hidden = false;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.hidden = true), 2300);
    this.objective.classList.remove('pop');
    void this.objective.offsetWidth;
    this.objective.classList.add('pop');
  }

  message(text: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    const el = document.createElement('div');
    el.className = `msg ${kind}`;
    el.textContent = text;
    this.messages.appendChild(el);
    while (this.messages.children.length > 3) this.messages.firstElementChild?.remove();
    setTimeout(() => el.remove(), 1900);
  }

  /**
   * Jauge du turbo : anneau de flammes autour d'un centre vide (sous le pouce).
   * La partie allumée (depuis le haut, sens horaire) suit la jauge ; les
   * flammes ondulent et grandissent quand le turbo est enclenché.
   */
  turbo(level: number, active: boolean, time = performance.now() / 1000): void {
    this.turboBtn.classList.toggle('active', active);
    this.turboBtn.classList.toggle('empty', level < 0.05);
    const g = this.turboCtx;
    if (!g || this.turboBtn.hidden) return;
    // Lissage visuel de la jauge
    this.turboShown += (level - this.turboShown) * 0.35;
    const lvl = this.turboShown;
    if (!active && Math.abs(lvl - this.turboLevel) < 0.002 && Math.floor(time * 30) % 2) return; // 30 i/s au repos
    this.turboLevel = lvl;
    const W = 160;
    const c = W / 2;
    g.clearRect(0, 0, W, W);
    const r0 = 54; // bord du bouton (108 px de diamètre, canvas décalé de 26 px)
    // Piste éteinte
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.arc(c, c, r0 - 3, 0, Math.PI * 2);
    g.stroke();
    if (lvl <= 0.005) return;
    const n = 40;
    const lit = Math.max(1, Math.round(n * lvl));
    const boost = active ? 1.6 : 1;
    g.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < lit; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const wob = Math.sin(time * 9 + i * 1.7) * 0.5 + Math.sin(time * 15.3 + i * 3.1) * 0.5;
        const len = (pass === 0 ? 13 : 8) * boost * (0.75 + 0.35 * wob) * (i === lit - 1 ? 0.6 : 1);
        const w = (Math.PI * 2) / n * (pass === 0 ? 0.95 : 0.6);
        const tipA = a + Math.sin(time * 5 + i) * 0.04;
        const x0 = c + Math.cos(a - w) * (r0 - 4);
        const y0 = c + Math.sin(a - w) * (r0 - 4);
        const x1 = c + Math.cos(a + w) * (r0 - 4);
        const y1 = c + Math.sin(a + w) * (r0 - 4);
        const tx = c + Math.cos(tipA) * (r0 + len);
        const ty = c + Math.sin(tipA) * (r0 + len);
        const grad = g.createLinearGradient(c + Math.cos(a) * (r0 - 4), c + Math.sin(a) * (r0 - 4), tx, ty);
        if (pass === 0) {
          grad.addColorStop(0, 'rgba(255,120,20,0.95)');
          grad.addColorStop(0.6, 'rgba(255,60,10,0.55)');
          grad.addColorStop(1, 'rgba(255,40,0,0)');
        } else {
          grad.addColorStop(0, 'rgba(255,245,180,1)');
          grad.addColorStop(0.7, 'rgba(255,200,60,0.6)');
          grad.addColorStop(1, 'rgba(255,160,40,0)');
        }
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(c + Math.cos(a - w * 0.3) * (r0 + len * 0.6), c + Math.sin(a - w * 0.3) * (r0 + len * 0.6), tx, ty);
        g.quadraticCurveTo(c + Math.cos(a + w * 0.3) * (r0 + len * 0.6), c + Math.sin(a + w * 0.3) * (r0 + len * 0.6), x1, y1);
        g.closePath();
        g.fill();
      }
    }
    // Base de l'anneau allumé
    g.lineWidth = 6;
    g.strokeStyle = active ? '#ffe9a0' : '#ffb340';
    g.beginPath();
    g.arc(c, c, r0 - 3, -Math.PI / 2, -Math.PI / 2 + lvl * Math.PI * 2);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  }

  setFps(v: number | null): void {
    this.fps.hidden = v === null;
    if (v !== null) this.fps.textContent = `${v.toFixed(0)} fps`;
  }

  clearMessages(): void {
    this.messages.textContent = '';
  }
}
