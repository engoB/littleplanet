/**
 * Plein écran + verrouillage paysage au premier geste, écran « tourne ton
 * téléphone » en portrait (appareils tactiles), zones sûres via CSS.
 */
export function setupOrientation(mode: 'auto' | 'landscape' | 'portrait', onPortraitChange: (blocked: boolean) => void): void {
  const touch = matchMedia('(pointer: coarse)').matches;
  const overlay = document.getElementById('rotate')!;
  document.getElementById('rotate-text')!.innerHTML = mode === 'portrait' ? 'Tourne ton téléphone<br />en mode portrait' : 'Tourne ton téléphone<br />en mode paysage';
  let last: boolean | null = null;
  const check = () => {
    const isPortrait = window.innerHeight > window.innerWidth;
    // Écran « tourne ton téléphone » seulement si une orientation est imposée
    const portrait = touch && mode !== 'auto' && (mode === 'landscape' ? isPortrait : !isPortrait);
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
      if (mode !== 'auto') await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(mode);
    } catch {
      /* non supporté */
    }
  };
  window.addEventListener('pointerup', first);
}
