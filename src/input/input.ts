/**
 * Agrégation des entrées : stick tactile, clavier (axe « Horizontal » du
 * InputManager Unity : sensibilité 3, gravité 3, snap), manette.
 */
import type { TouchButton, VirtualStick } from './stick';

export class Input {
  private keys = new Set<string>();
  private kbAxis = 0;
  horizontal = 0;
  turbo = false;
  private pauseEdge = false;
  private padPausePrev = false;
  stick: VirtualStick | null = null;
  turboButton: TouchButton | null = null;
  lastDevice: 'touch' | 'keyboard' | 'gamepad' = 'touch';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseEdge = true;
      if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.lastDevice = 'touch';
    });
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** À appeler une fois par frame avec le temps réel écoulé. */
  update(dt: number): void {
    // Clavier : Input.GetAxis (sensibilité / gravité 3 unités/s, snap)
    const right = this.key('ArrowRight', 'KeyD');
    const left = this.key('ArrowLeft', 'KeyA', 'KeyQ');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      if (Math.sign(this.kbAxis) !== target && this.kbAxis !== 0) this.kbAxis = 0; // snap
      this.kbAxis = Math.max(-1, Math.min(1, this.kbAxis + target * 3 * dt));
    } else {
      const g = 3 * dt;
      this.kbAxis = Math.abs(this.kbAxis) <= g ? 0 : this.kbAxis - Math.sign(this.kbAxis) * g;
    }
    let h = this.kbAxis;
    let turbo = this.key('Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'KeyW', 'KeyZ');
    // Manette
    const pads = navigator.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      const dpad = (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      const v = Math.abs(ax) > 0.15 ? ax : dpad;
      if (v !== 0) {
        h = v;
        this.lastDevice = 'gamepad';
      }
      if (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed || gp.buttons[5]?.pressed) turbo = true;
      const p = !!gp.buttons[9]?.pressed;
      if (p && !this.padPausePrev) this.pauseEdge = true;
      this.padPausePrev = p;
    }
    if (this.stick?.active) h = this.stick.x;
    if (this.turboButton?.held) turbo = true;
    this.horizontal = Math.max(-1, Math.min(1, h));
    this.turbo = turbo;
  }

  consumePause(): boolean {
    const p = this.pauseEdge;
    this.pauseEdge = false;
    return p;
  }

  reset(): void {
    this.keys.clear();
    this.kbAxis = 0;
    this.horizontal = 0;
    this.turbo = false;
    this.stick?.reset();
    this.turboButton?.reset();
  }
}

/** Retour haptique (téléphone + manette si disponible). */
export function vibrate(ms: number | number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supporté */
  }
  const pads = navigator.getGamepads?.() ?? [];
  for (const gp of pads) {
    const act = (gp as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    void act?.playEffect?.('dual-rumble', { duration: Array.isArray(ms) ? ms[0] : ms, strongMagnitude: 0.6, weakMagnitude: 0.4 })?.catch(() => undefined);
  }
}
