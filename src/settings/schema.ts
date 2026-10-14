/**
 * Schéma unique des réglages. Chaque réglage a une valeur « arcade »
 * (préréglage par défaut, avec les ajouts) et une valeur « original »
 * (comportement exact du jeu Unity). La page settings.html est générée
 * à partir de ce tableau ; le jeu lit les valeurs via store.ts.
 */
export type SettingType = 'bool' | 'number' | 'select' | 'color' | 'image';

export interface SettingDef {
  key: string;
  label: string;
  group: string;
  type: SettingType;
  arcade: number | boolean | string | null;
  original: number | boolean | string | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export const GROUPS = ['Modes de jeu', 'Jeu', 'Météores', 'Horloges', 'Caméra', 'Graphismes', 'Audio', 'Contrôles', 'Personnalisation'] as const;

export const SCHEMA: SettingDef[] = [
  // --- Modes de jeu (cumulables, activables aussi depuis le menu « Modes »)
  { key: 'modeTimeAttack', label: 'Contre-la-montre', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: '60 s au départ, chaque horloge ajoute 5 s ; la partie s’arrête à 0 (pas de record).' },
  { key: 'modeStorm', label: 'Tempête de météores', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: 'Deux fois plus de météores, 30 % plus rapides.' },
  { key: 'modeSnitch', label: 'Attrape le Vif d’or', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: 'Une balle dorée ailée file au ras de la planète : rattrape-la (+10 santé à chaque prise).' },
  { key: 'modeBullet', label: 'Fuis le Bullet Bill', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: 'Des obus te prennent en chasse : esquive-les jusqu’à ce qu’ils s’éteignent (turbo conseillé).' },
  { key: 'galaxyCount', label: 'Voyage : nombre de planètes', group: 'Modes de jeu', type: 'select', arcade: '5', original: '5', options: [
    { value: '3', label: '3 planètes' }, { value: '5', label: '5 planètes' }, { value: '8', label: '8 planètes' }, { value: '0', label: 'Sans fin' },
  ], help: 'Voyage galactique : planètes tirées au hasard à traverser.' },
  { key: 'galaxyTime', label: 'Voyage : temps par planète', group: 'Modes de jeu', type: 'select', arcade: '90', original: '90', options: [
    { value: '60', label: '1 min' }, { value: '90', label: '1 min 30' }, { value: '120', label: '2 min' }, { value: '0', label: 'Illimité' },
  ], help: 'Temps pour réussir l’objectif de chaque planète et rejoindre l’étoile de lancement.' },
  { key: 'modeZen', label: 'Zen', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: 'Ni météores ni dégâts : on roule tranquille, on ramasse et on explore. La partie ne compte pas (ni objectifs, ni succès, ni records).' },
  { key: 'modeMirror', label: 'Commandes inversées', group: 'Modes de jeu', type: 'bool', arcade: false, original: false, help: 'Gauche et droite échangées.' },
  // --- Jeu
  { key: 'difficulty', label: 'Difficulté', group: 'Jeu', type: 'select', arcade: 'normal', original: 'hard', options: [
    { value: 'normal', label: 'Normal : aucune contrainte, montée douce' }, { value: 'hard', label: 'Difficile : poteaux, planète qui rétrécit, montée en puissance' },
  ], help: 'Les contraintes (poteaux, rétrécissement, météores de plus en plus nombreux) sont réservées au niveau Difficile.' },
  { key: 'carSpeed', label: 'Vitesse de la voiture', group: 'Jeu', type: 'number', arcade: 5, original: 5, min: 2, max: 10, step: 0.5, unit: 'u/s', help: 'VehicleController.speed' },
  { key: 'steerSpeed', label: 'Vitesse de braquage', group: 'Jeu', type: 'number', arcade: 200, original: 200, min: 60, max: 400, step: 10, unit: '°/s', help: 'rotationSpeed × rotationMultiplier (8 × 25)' },
  { key: 'steerFatigue', label: 'Fatigue de virage', group: 'Jeu', type: 'number', arcade: 3.4, original: 4, min: 0, max: 10, step: 0.5, unit: 's', help: 'maxDirectionDuration : le braquage s’éteint si on garde la même direction. 0 = désactivé.' },
  { key: 'steerFatigueHold', label: 'Virage à pleine force pendant', group: 'Jeu', type: 'number', arcade: 1.6, original: 0, min: 0, max: 5, step: 0.1, unit: 's', help: 'Puis la voiture repart en ligne droite. 0 = atténuation dès le début (original).' },
  { key: 'maxHealth', label: 'Santé maximale', group: 'Jeu', type: 'number', arcade: 150, original: 100, min: 20, max: 400, step: 10, help: 'HealthManager.maxHealth' },
  { key: 'craterDamage', label: 'Dégâts d’un cratère', group: 'Jeu', type: 'number', arcade: 15, original: 10, min: 0, max: 50, step: 1 },
  { key: 'invulnerability', label: 'Invulnérabilité après un choc', group: 'Jeu', type: 'number', arcade: 0.8, original: 0, min: 0, max: 3, step: 0.1, unit: 's' },
  { key: 'turbo', label: 'Turbo (bouton maintenu)', group: 'Jeu', type: 'bool', arcade: true, original: false },
  { key: 'stages', label: 'Étapes et objectifs', group: 'Jeu', type: 'bool', arcade: true, original: false, help: 'Objectifs successifs, la difficulté augmente à chaque étape.' },
  { key: 'deathAnimation', label: 'Animation de fin', group: 'Jeu', type: 'bool', arcade: true, original: false, help: 'Explosion et ralenti avant l’écran de fin (l’original fige tout : Time.timeScale = 0).' },
  { key: 'craterBump', label: 'Les cratères font dévier', group: 'Jeu', type: 'bool', arcade: false, original: false, help: 'Rouler dans un cratère dévie la voiture au hasard.' },
  { key: 'healthDisplay', label: 'Affichage de la santé', group: 'Jeu', type: 'select', arcade: 'ring', original: 'bar', options: [
    { value: 'ring', label: 'Anneau au sol autour du véhicule' }, { value: 'bar', label: 'Barre en haut de l’écran (Slider d’origine)' },
  ], help: 'La barre du HUD est difficile à regarder en pleine partie.' },
  { key: 'weather', label: 'Climat', group: 'Graphismes', type: 'select', arcade: 'auto', original: 'none', options: [
    { value: 'auto', label: 'Celui de chaque monde' }, { value: 'none', label: 'Beau temps' }, { value: 'rain', label: 'Pluie' }, { value: 'snow', label: 'Neige' }, { value: 'leaves', label: 'Feuilles qui volent' }, { value: 'wind', label: 'Vent' }, { value: 'storm', label: 'Orage (pluie, rafales, foudre)' },
  ], help: 'Chaque monde a son climat ; on peut aussi en imposer un partout.' },
  { key: 'oceanWaves', label: 'Vagues et écume (océan)', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Houle animée, crêtes d’écume et reflets sur le Grand Océan.' },
  { key: 'hitStars', label: 'Étoiles d’étourdissement', group: 'Jeu', type: 'bool', arcade: true, original: false, help: 'Après un choc, des étoiles tournent au-dessus du véhicule (à la place du flash rouge).' },
  { key: 'damageSmoke', label: 'Fumée selon les dégâts', group: 'Jeu', type: 'bool', arcade: true, original: false },
  { key: 'unlockAll', label: 'Toutes les planètes débloquées', group: 'Jeu', type: 'bool', arcade: false, original: false, help: 'Sinon, chaque planète se débloque en réussissant 3 objectifs sur la précédente ; la dernière débloque les défis et le voyage galactique.' },
  { key: 'planetShrink', label: 'Planète qui rétrécit', group: 'Jeu', type: 'bool', arcade: true, original: false, help: 'La planète rapetisse au fil de la partie (activé par défaut, désactivable dans les Options ; script ShrinkPlanet, non attaché dans l’original).' },
  { key: 'shrinkDuration', label: 'Durée du rétrécissement', group: 'Jeu', type: 'number', arcade: 150, original: 0, min: 0, max: 400, step: 10, unit: 's', help: 'Temps pour atteindre la taille minimale. 0 = comportement de ShrinkPlanet.cs (× 0,99 par seconde).' },
  { key: 'shrinkMin', label: 'Taille minimale', group: 'Jeu', type: 'number', arcade: 0.4, original: 0.45, min: 0.2, max: 1, step: 0.05 },
  { key: 'saveRecords', label: 'Enregistrer les records', group: 'Jeu', type: 'bool', arcade: true, original: false, help: 'HighScoreManager existe mais n’est jamais appelé dans l’original.' },
  // --- Météores
  { key: 'meteorInterval', label: 'Intervalle entre météores', group: 'Météores', type: 'number', arcade: 1.4, original: 1, min: 0.3, max: 4, step: 0.1, unit: 's', help: 'MeteorSpawner : WaitForSeconds(1)' },
  { key: 'meteorRamp', label: 'Difficulté progressive', group: 'Météores', type: 'bool', arcade: true, original: false },
  { key: 'meteorSpeed', label: 'Vitesse des météores', group: 'Météores', type: 'number', arcade: 5, original: 5, min: 2, max: 15, step: 0.5, unit: 'u/s' },
  { key: 'meteorVisible', label: 'Roche visible', group: 'Météores', type: 'bool', arcade: true, original: false, help: 'Dans l’original, le maillage du météore mesure 2 cm : seuls les effets sont visibles.' },
  { key: 'meteorWarning', label: 'Annonce du point d’impact', group: 'Météores', type: 'bool', arcade: true, original: false },
  { key: 'meteorHitsCar', label: 'Les météores touchent la voiture', group: 'Météores', type: 'bool', arcade: true, original: false, help: 'Dans l’original, le collider du météore n’est pas un trigger : aucun dégât direct.' },
  { key: 'meteorDamage', label: 'Dégâts d’un météore', group: 'Météores', type: 'number', arcade: 40, original: 40, min: 0, max: 100, step: 5 },
  { key: 'craterStyle', label: 'Aspect des cratères', group: 'Météores', type: 'select', arcade: 'decal', original: 'box', options: [
    { value: 'decal', label: 'Brûlure au sol' }, { value: 'box', label: 'Cube (original)' },
  ], help: 'Le matériau du cratère manque dans le dépôt Unity.' },
  { key: 'craterLifetime', label: 'Durée de vie des cratères', group: 'Météores', type: 'number', arcade: 40, original: 0, min: 0, max: 120, step: 5, unit: 's', help: '0 = permanents (original).' },
  // --- Horloges
  { key: 'clockInterval', label: 'Intervalle d’apparition', group: 'Horloges', type: 'number', arcade: 5, original: 5, min: 1, max: 20, step: 0.5, unit: 's' },
  { key: 'clockMax', label: 'Nombre maximal par partie', group: 'Horloges', type: 'number', arcade: 0, original: 10, min: 0, max: 50, step: 1, help: '0 = illimité' },
  { key: 'clockLifetime', label: 'Durée de vie', group: 'Horloges', type: 'number', arcade: 10, original: 10, min: 3, max: 30, step: 1, unit: 's' },
  { key: 'clockHeal', label: 'Santé rendue', group: 'Horloges', type: 'number', arcade: 10, original: 20, min: 5, max: 100, step: 5 },
  // --- Caméra
  { key: 'cameraTilt', label: 'Inclinaison de la caméra', group: 'Caméra', type: 'number', arcade: 30, original: 0, min: 0, max: 60, step: 1, unit: '°', help: '0 = vue de dessus exacte de l’original' },
  { key: 'cameraAdaptive', label: 'Caméra adaptative', group: 'Caméra', type: 'bool', arcade: true, original: false, help: 'Proche de la voiture sur une grosse planète, planète entière quand elle devient petite.' },
  { key: 'cameraHeight', label: 'Hauteur de la caméra (proche)', group: 'Caméra', type: 'number', arcade: 4.0, original: 12, min: 3, max: 14, step: 0.2, unit: 'u', help: 'L’original place la caméra à 12 unités au-dessus de la voiture.' },
  { key: 'cameraShake', label: 'Secousses (explosions)', group: 'Caméra', type: 'bool', arcade: true, original: true },
  // --- Graphismes
  { key: 'quality', label: 'Qualité', group: 'Graphismes', type: 'select', arcade: 'auto', original: 'auto', options: [
    { value: 'auto', label: 'Adaptative' }, { value: 'high', label: 'Haute' }, { value: 'medium', label: 'Moyenne' }, { value: 'low', label: 'Basse' },
  ] },
  { key: 'shadows', label: 'Ombres', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Les lumières Unity n’ont pas d’ombres.' },
  { key: 'premiumFx', label: 'Style dessin animé et effets', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Cel-shading, contours, réticules, balises des horloges, ciel spatial.' },
  { key: 'bloom', label: 'Halo lumineux (bloom) et étalonnage', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Le bloom est inactif dans le profil URP du jeu.' },
  { key: 'postProcess', label: 'Post-process (aberration, vignette)', group: 'Graphismes', type: 'bool', arcade: true, original: true },
  { key: 'dynamicLights', label: 'Lumières des météores', group: 'Graphismes', type: 'number', arcade: 3, original: 4, min: 0, max: 6, step: 1, help: 'Nombre de lumières ponctuelles réservées (rechargement nécessaire).' },
  { key: 'planetDetail', label: 'Relief du sol', group: 'Graphismes', type: 'bool', arcade: true, original: false },
  { key: 'maxPixelRatio', label: 'Densité de pixels max', group: 'Graphismes', type: 'number', arcade: 2, original: 2, min: 0.5, max: 2, step: 0.25 },
  { key: 'showFps', label: 'Afficher les FPS', group: 'Graphismes', type: 'bool', arcade: false, original: false },
  // --- Audio
  { key: 'musicVolume', label: 'Musique', group: 'Audio', type: 'number', arcade: 0.7, original: 1, min: 0, max: 1, step: 0.05 },
  { key: 'sfxVolume', label: 'Effets', group: 'Audio', type: 'number', arcade: 1, original: 1, min: 0, max: 1, step: 0.05 },
  { key: 'loopMusic', label: 'Musique en boucle', group: 'Audio', type: 'bool', arcade: true, original: false },
  { key: 'engineVolume', label: 'Moteur', group: 'Audio', type: 'number', arcade: 0.45, original: 0.052, min: 0, max: 1, step: 0.01, help: 'AudioSource de la voiture : 0,052 dans Unity (presque inaudible).' },
  { key: 'countdown', label: 'Compte à rebours avant le départ', group: 'Jeu', type: 'bool', arcade: true, original: false, help: '3, 2, 1, Partez ! : la partie ne démarre pas brusquement.' },
  { key: 'neonCar', label: 'Néons sous la voiture (mondes sombres)', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Anneaux lumineux magenta et cyan autour des patins et halo au sol, style années 80, sur les mondes de nuit ou dans l’espace.' },
  { key: 'impactSmoke', label: 'Fumée et incandescence des impacts', group: 'Graphismes', type: 'bool', arcade: true, original: false, help: 'Colonne de fumée noire qui monte des cratères (elle peut passer devant la caméra) et cratère incandescent quelques instants.' },
  { key: 'extraSounds', label: 'Sons supplémentaires (explosions, chocs, turbo…)', group: 'Audio', type: 'bool', arcade: true, original: false },
  // --- Contrôles
  { key: 'orientation', label: 'Orientation de l’écran', group: 'Contrôles', type: 'select', arcade: 'portrait', original: 'portrait', options: [
    { value: 'auto', label: 'Libre (portrait ou paysage)' }, { value: 'landscape', label: 'Paysage' }, { value: 'portrait', label: 'Portrait' },
  ], help: 'Le jeu se joue en portrait (l’APK Unity était en paysage, LandscapeLeft).' },
  { key: 'controlMode', label: 'Commande tactile', group: 'Contrôles', type: 'select', arcade: 'zones', original: 'stick', options: [
    { value: 'zones', label: 'Écran coupé en deux (gauche / droite)' }, { value: 'stick', label: 'Joystick' },
  ] },
  { key: 'stickSide', label: 'Côté du stick', group: 'Contrôles', type: 'select', arcade: 'left', original: 'right', options: [
    { value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' },
  ], help: 'Le joystick Unity est en bas à droite.' },
  { key: 'stickFloating', label: 'Stick flottant', group: 'Contrôles', type: 'bool', arcade: false, original: false, help: 'Désactivé : joystick fixe en bas (à gauche par défaut).' },
  { key: 'haptics', label: 'Vibrations', group: 'Contrôles', type: 'bool', arcade: true, original: false },
  { key: 'minimap', label: 'Mini-carte', group: 'Contrôles', type: 'bool', arcade: true, original: false },
  // --- Personnalisation
  { key: 'carColor', label: 'Couleur de la voiture', group: 'Personnalisation', type: 'color', arcade: '#ff0000', original: '#ff0000', help: 'Matériau « body »' },
  { key: 'planetImage', label: 'Image du sol de la planète', group: 'Personnalisation', type: 'image', arcade: null, original: null, help: 'Stockée dans IndexedDB sur cet appareil.' },
];

export type Preset = 'arcade' | 'original';
