/**
 * Commande tactile « deux zones » (préréglage Arcade) : l'écran est coupé
 * en deux, appuyer n'importe où à gauche fait tourner à gauche, à droite
 * fait tourner à droite. Multi-touch : le dernier doigt posé décide.
 * Les boutons (turbo, pause) capturent leur propre pointeur et ne
 * déclenchent donc jamais de virage.
 */
export class TouchZones {
  private readonly pointers = new Map<number, -1 | 1>();
  private order: number[] = [];
  /** −1 gauche, 0 rien, +1 droite. */
  value = 0;
  private readonly hintL: HTMLDivElement;
  private readonly hintR: HTMLDivElement;
  enabled = true;

  constructor(zone: HTMLElement) {
    this.hintL = document.createElement('div');
    this.hintL.className = 'zone-hint left';
    this.hintR = document.createElement('div');
    this.hintR.className = 'zone-hint right';
    zone.append(this.hintL, this.hintR);
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      const side: -1 | 1 = e.clientX < window.innerWidth / 2 ? -1 : 1;
      this.pointers.set(e.pointerId, side);
      this.order = this.order.filter((id) => id !== e.pointerId).concat(e.pointerId);
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* ignoré */
      }
      this.refresh();
      e.preventDefault();
    });
    // Glisser le doigt d'un côté à l'autre change de direction
    zone.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const side: -1 | 1 = e.clientX < window.innerWidth / 2 ? -1 : 1;
      if (side !== this.pointers.get(e.pointerId)) {
        this.pointers.set(e.pointerId, side);
        this.refresh();
      }
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      this.order = this.order.filter((id) => id !== e.pointerId);
      this.refresh();
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);
  }

  private refresh(): void {
    const last = this.order[this.order.length - 1];
    this.value = last !== undefined ? this.pointers.get(last) ?? 0 : 0;
    this.hintL.classList.toggle('on', this.value === -1);
    this.hintR.classList.toggle('on', this.value === 1);
  }

  get active(): boolean {
    return this.pointers.size > 0;
  }

  reset(): void {
    this.pointers.clear();
    this.order = [];
    this.refresh();
  }
}
