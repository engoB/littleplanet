/** Équivalent de UnityEngine.Time, piloté par la boucle de jeu. */
export const Time = {
  /** Durée de la frame en temps de jeu (× timeScale). */
  deltaTime: 0,
  /** Durée réelle de la frame (secondes). */
  unscaledDeltaTime: 0,
  /** Temps de jeu écoulé. */
  time: 0,
  /** Temps réel écoulé depuis le chargement. */
  realtimeSinceStartup: 0,
  timeScale: 1,
  frameCount: 0,
  /** Plafond de deltaTime (Time.maximumDeltaTime de Unity : 1/3 s). */
  maximumDeltaTime: 1 / 3,
  advance(realDt: number): void {
    this.unscaledDeltaTime = realDt;
    this.realtimeSinceStartup += realDt;
    this.deltaTime = Math.min(realDt, this.maximumDeltaTime) * this.timeScale;
    this.time += this.deltaTime;
    this.frameCount++;
  },
  reset(): void {
    this.time = 0;
    this.deltaTime = 0;
    this.timeScale = 1;
  },
};
