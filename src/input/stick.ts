/**
 * Stick virtuel tactile (remplace le FixedJoystick du Joystick Pack Unity).
 *  - analogique dans le cercle, valeur maximale dès 85 % de la course ;
 *  - mode flottant : la base apparaît sous le doigt et le suit hors du cercle ;
 *  - mode fixe : base à l'emplacement d'origine (bas droite) ;
 *  - pointer capture et multi-touch (un pointeur par stick).
 */
export class VirtualStick {
  x = 0;
  y = 0;
  active = false;
  private pointer = -1;
  private baseX = 0;
  private baseY = 0;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private radius = 60;

  constructor(private readonly zone: HTMLElement, public floating: boolean, private side: 'left' | 'right') {
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    zone.appendChild(this.base);
    zone.addEventListener('pointerdown', this.down);
    zone.addEventListener('pointermove', this.move);
    zone.addEventListener('pointerup', this.up);
    zone.addEventListener('pointercancel', this.up);
    zone.addEventListener('lostpointercapture', this.up);
    this.layout();
  }

  configure(floating: boolean, side: 'left' | 'right'): void {
    this.floating = floating;
    this.side = side;
    this.zone.classList.toggle('right', side === 'right');
    this.layout();
  }

  /** Taille et position de repos (à appeler au redimensionnement). */
  layout(): void {
    const r = this.zone.getBoundingClientRect();
    this.radius = Math.max(42, Math.min(80, Math.min(window.innerWidth, window.innerHeight) * 0.13));
    this.base.style.width = this.base.style.height = `${this.radius * 2}px`;
    this.knob.style.width = this.knob.style.height = `${this.radius * 0.9}px`;
    if (!this.active) {
      this.baseX = this.side === 'right' ? r.width - this.radius * 1.6 : this.radius * 1.6;
      this.baseY = r.height - this.radius * 1.4;
      this.place();
      this.base.classList.toggle('idle', true);
    }
  }

  private place(kx = 0, ky = 0): void {
    this.base.style.transform = `translate(${this.baseX - this.radius}px, ${this.baseY - this.radius}px)`;
    this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.zone.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private readonly down = (e: PointerEvent): void => {
    if (this.pointer !== -1) return;
    const [lx, ly] = this.local(e);
    if (!this.floating && Math.hypot(lx - this.baseX, ly - this.baseY) > this.radius * 1.6) return;
    this.pointer = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* ignoré */
    }
    if (this.floating) {
      this.baseX = lx;
      this.baseY = ly;
    }
    this.active = true;
    this.base.classList.remove('idle');
    this.update(lx, ly);
    e.preventDefault();
  };

  private readonly move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    const [lx, ly] = this.local(e);
    this.update(lx, ly);
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.active = false;
    this.x = this.y = 0;
    this.layout();
  };

  private update(lx: number, ly: number): void {
    let dx = lx - this.baseX;
    let dy = ly - this.baseY;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      if (this.floating) {
        // La base suit le doigt : le doigt reste sur le bord du cercle
        this.baseX = lx - (dx / d) * this.radius;
        this.baseY = ly - (dy / d) * this.radius;
      }
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    const full = this.radius * 0.85;
    let vx = dx / full;
    let vy = -dy / full;
    const m = Math.hypot(vx, vy);
    if (m > 1) {
      vx /= m;
      vy /= m;
    }
    this.x = vx;
    this.y = vy;
    this.place(dx, dy);
  }

  reset(): void {
    this.pointer = -1;
    this.active = false;
    this.x = this.y = 0;
    this.layout();
  }
}

/**
 * Bouton tactile. Action « maintenue » : relâchement géré sur pointerup,
 * pointercancel et lostpointercapture (un doigt qui glisse hors du bouton
 * ne laisse pas l'action bloquée).
 */
export class TouchButton {
  held = false;
  private pointer = -1;
  pressed = false;

  constructor(readonly el: HTMLElement, private readonly onPress?: () => void) {
    el.addEventListener('pointerdown', (e) => {
      if (this.pointer !== -1) return;
      this.pointer = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignoré */
      }
      this.held = true;
      this.pressed = true;
      el.classList.add('down');
      this.onPress?.();
      e.preventDefault();
      e.stopPropagation();
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = -1;
      this.held = false;
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  /** Front montant consommé (une seule fois par appui). */
  consume(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  reset(): void {
    this.held = false;
    this.pressed = false;
    this.pointer = -1;
    this.el.classList.remove('down');
  }
}
