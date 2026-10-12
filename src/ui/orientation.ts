/**
 * Plein écran + verrouillage paysage au premier geste, écran « tourne ton
 * téléphone » en portrait (appareils tactiles), zones sûres via CSS.
 */
export function setupOrientation(onPortraitChange: (portrait: boolean) => void): void {
  const touch = matchMedia('(pointer: coarse)').matches;
  const overlay = document.getElementById('rotate')!;
  let last: boolean | null = null;
  const check = () => {
    const portrait = touch && window.innerHeight > window.innerWidth;
    overlay.hidden = !portrait;
    if (portrait !== last) {
      last = portrait;
      onPortraitChange(portrait);
    }
  };
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  check();
  if (!touch) return;
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const first = async () => {
    window.removeEventListener('pointerup', first);
    try {
      if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      /* refusé (iOS Safari) */
    }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      /* non supporté */
    }
  };
  window.addEventListener('pointerup', first);
}
