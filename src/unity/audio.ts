/**
 * Audio (AudioSource / AudioSource.PlayClipAtPoint) sur Web Audio.
 * Les sons Unity du projet sont tous en 2D (spatialBlend = 0).
 * Le contexte est déverrouillé au premier geste de l'utilisateur.
 */
export class AudioSourceLite {
  private node: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  pitch: number;
  private startedAt = 0;
  constructor(private readonly mgr: AudioManager, readonly clip: string, public volume: number, pitch: number, public loop: boolean, readonly bus: 'music' | 'sfx' = 'sfx') {
    this.pitch = pitch;
    this.gain = mgr.ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(bus === 'music' ? mgr.music : mgr.sfx);
  }

  get isPlaying(): boolean {
    return this.node !== null;
  }

  play(): void {
    this.stop();
    const buf = this.mgr.buffers.get(this.clip);
    if (!buf) return;
    const n = this.mgr.ctx.createBufferSource();
    n.buffer = buf;
    n.loop = this.loop;
    n.playbackRate.value = this.pitch;
    n.connect(this.gain);
    n.onended = () => {
      if (this.node === n) this.node = null;
    };
    n.start();
    this.startedAt = this.mgr.ctx.currentTime;
    this.node = n;
  }

  stop(): void {
    if (this.node) {
      try {
        this.node.stop();
      } catch {
        /* déjà arrêté */
      }
      this.node.disconnect();
      this.node = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    this.gain.gain.setTargetAtTime(v, this.mgr.ctx.currentTime, 0.05);
  }

  setPitch(p: number): void {
    this.pitch = p;
    if (this.node) this.node.playbackRate.setTargetAtTime(p, this.mgr.ctx.currentTime, 0.05);
  }

  get time(): number {
    return this.node ? this.mgr.ctx.currentTime - this.startedAt : 0;
  }
}

export class AudioManager {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
  readonly buffers = new Map<string, AudioBuffer>();

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    // iOS 17+ : session « lecture » (le son passe malgré le bouton silencieux)
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* non supporté */
    }
    const unlock = () => {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      if (!this.htmlUnlocked) {
        // iOS < 17 : un <audio> joué pendant le geste fait sortir la page du mode silencieux
        this.htmlUnlocked = true;
        const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');
        a.setAttribute('playsinline', '');
        void a.play().catch(() => undefined);
      }
      // Quelques navigateurs exigent un son démarré pendant le geste
      const b = this.ctx.createBuffer(1, 1, 22050);
      const n = this.ctx.createBufferSource();
      n.buffer = b;
      n.connect(this.ctx.destination);
      n.start();
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.userSuspended) void this.ctx.resume();
    });
  }

  private htmlUnlocked = false;
  private userSuspended = false;

  /** Charge tous les sons de l'inventaire (assets.json). */
  async loadAll(base: string, files: Record<string, string>): Promise<void> {
    await Promise.all(Object.entries(files).map(([n, f]) => this.load(n, base + f)));
  }

  async load(name: string, url: string): Promise<void> {
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      const buf = await new Promise<AudioBuffer>((ok, ko) => this.ctx.decodeAudioData(data, ok, ko));
      this.buffers.set(name, buf);
    } catch (e) {
      console.warn('Son non chargé', name, e);
    }
  }

  source(clip: string, volume = 1, pitch = 1, loop = false, bus: 'music' | 'sfx' = 'sfx'): AudioSourceLite {
    return new AudioSourceLite(this, clip, volume, pitch, loop, bus);
  }

  /** AudioSource.PlayClipAtPoint (2D). */
  playOneShot(clip: string, volume = 1, pitch = 1, pan = 0): void {
    const buf = this.buffers.get(clip);
    if (!buf || volume <= 0.001) return;
    if (this.ctx.state === 'closed') return;
    const n = this.ctx.createBufferSource();
    n.buffer = buf;
    n.playbackRate.value = pitch;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    let out: AudioNode = g;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      out = p;
    }
    n.connect(g);
    out.connect(this.sfx);
    n.onended = () => {
      g.disconnect();
      out.disconnect();
    };
    n.start();
  }

  setVolumes(music: number, sfx: number): void {
    this.music.gain.value = music;
    this.sfx.gain.value = sfx;
  }

  suspend(): void {
    this.userSuspended = true;
    void this.ctx.suspend();
  }

  resume(): void {
    this.userSuspended = false;
    void this.ctx.resume();
  }
}
