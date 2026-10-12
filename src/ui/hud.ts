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
  private readonly distance = $('distance');
  private readonly messages = $('messages');
  private readonly turboFill = $('turbo-fill');
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

  setChrono(t: number): void {
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

  setObjective(t: string): void {
    if (t !== this.lastObj) {
      this.objective.textContent = t;
      this.objective.hidden = !t;
      this.lastObj = t;
    }
  }

  message(text: string, kind: 'good' | 'bad' | 'info' = 'info'): void {
    const el = document.createElement('div');
    el.className = `msg ${kind}`;
    el.textContent = text;
    this.messages.appendChild(el);
    while (this.messages.children.length > 3) this.messages.firstElementChild?.remove();
    setTimeout(() => el.remove(), 1900);
  }

  turbo(level: number, active: boolean): void {
    this.turboFill.style.transform = `scaleY(${level})`;
    this.turboBtn.classList.toggle('active', active);
  }

  setFps(v: number | null): void {
    this.fps.hidden = v === null;
    if (v !== null) this.fps.textContent = `${v.toFixed(0)} fps`;
  }

  clearMessages(): void {
    this.messages.textContent = '';
  }
}
