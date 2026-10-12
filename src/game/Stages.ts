/**
 * Étapes et objectifs (ajout du préréglage Arcade).
 * Chaque étape fixe un objectif ; une fois atteint, un message s'affiche et
 * la difficulté augmente (météores plus fréquents et mieux visés).
 */
export type ObjectiveKind = 'distance' | 'clocks' | 'survive';

export interface Objective {
  kind: ObjectiveKind;
  target: number;
  progress: number;
}

export class Stages {
  stage = 1;
  objective: Objective = { kind: 'distance', target: 60, progress: 0 };
  private startDistance = 0;
  private startTime = 0;
  private startClocks = 0;
  onComplete: (stage: number) => void = () => undefined;

  start(): void {
    this.stage = 1;
    this.setup(0, 0, 0);
  }

  private setup(distance: number, time: number, clocks: number): void {
    const s = this.stage;
    const kinds: ObjectiveKind[] = ['distance', 'clocks', 'survive'];
    const kind = kinds[(s - 1) % 3];
    const level = Math.floor((s - 1) / 3);
    const target = kind === 'distance' ? 60 + level * 60 : kind === 'clocks' ? 2 + level : 20 + level * 10;
    this.objective = { kind, target, progress: 0 };
    this.startDistance = distance;
    this.startTime = time;
    this.startClocks = clocks;
  }

  update(distance: number, time: number, clocks: number): void {
    const o = this.objective;
    o.progress =
      o.kind === 'distance' ? distance - this.startDistance : o.kind === 'clocks' ? clocks - this.startClocks : time - this.startTime;
    if (o.progress >= o.target) {
      this.stage++;
      this.onComplete(this.stage - 1);
      this.setup(distance, time, clocks);
    }
  }

  /** Texte de l'objectif affiché sous le chrono. */
  get text(): string {
    const o = this.objective;
    const left = Math.max(0, o.target - o.progress);
    switch (o.kind) {
      case 'distance':
        return `Étape ${this.stage} · parcours encore ${Math.ceil(left)} m`;
      case 'clocks':
        return `Étape ${this.stage} · ramasse ${Math.ceil(left)} horloge${Math.ceil(left) > 1 ? 's' : ''}`;
      default:
        return `Étape ${this.stage} · survis encore ${Math.ceil(left)} s`;
    }
  }

  /** Multiplicateur d'intervalle entre météores pour l'étape courante. */
  get intervalFactor(): number {
    return Math.max(0.3, Math.pow(0.86, this.stage - 1));
  }

  get aim(): number {
    return Math.min(0.6, 0.25 + 0.05 * (this.stage - 1));
  }
}
