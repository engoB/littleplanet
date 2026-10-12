# Ma Petite Planète — portage web

Portage en **Three.js + TypeScript** du jeu Unity
[engoB/MaPetitePlanet](https://github.com/engoB/MaPetitePlanet) (Unity 2022.3.25f1, URP),
jouable sur mobile et installable en **PWA hors ligne**.

Ta voiture roule toute seule sur une petite planète. Des météores tombent
sans arrêt et laissent des cratères : rouler dedans coûte de la santé.
Les horloges en rendent. Le but : aller le plus loin possible.

- **Préréglage Arcade** (par défaut) : le jeu original + des ajouts
  (roche visible, annonce des impacts, mini-carte, turbo, étapes, records…).
- **Préréglage Original** : le comportement exact du jeu Unity.

Chaque ajout est un réglage (page **Réglages**) avec une valeur Arcade et une valeur Original.

### Planètes (préréglage Arcade)

Sept planètes décrites dans un fichier unique, `src/game/planets.json`, lu par
le générateur de textures et par le jeu. En Arcade, **la planète rétrécit**
au fil de la partie (jusqu'à 40 % en 150 s) et la **caméra s'adapte** : proche
de la voiture tant que la planète est grosse, elle recule pour la montrer en
entier quand elle devient petite.

| Planète | Difficulté | Particularité |
|---|---|---|
| Planète d'origine | ★★ | la planète Unity, telle quelle |
| Prairie | ★ | route de terre, maison-dôme ; météores plus lents et plus rares |
| Néon | ★★★ | planète nocturne à grille lumineuse, voiture et impacts qui brillent |
| Émeraude | ★★★ | étangs ; météores plus rapides |
| Banquise | ★★★ | sol gelé : la voiture glisse (adhérence 0,35) |
| Volcan | ★★★★ | rivières de lave lumineuses ; pluie de météores, cratères ×1,5 |
| Naine | ★★★★★ | rayon 0,7 : tout arrive très vite |

Chaque planète se débloque en parcourant 100 m sur la précédente (réglage
« Toutes les planètes débloquées » pour tout ouvrir). Records par planète.

### Style graphique Arcade

Cel-shading doux « film d'animation » (inspiration Zelda récents) : deux aplats
séparés par un terminateur adouci, ombres légères (tout reste lisible en jeu),
liseré lumineux, **pas de contours noirs**. Décor volontairement rare. Textures des planètes peintes
procéduralement en cubemaps (fonction de la direction 3D : ni couture ni
pincement aux pôles), décor (arbres, rochers, maison-dôme) en InstancedMesh,
aura d'atmosphère diffuse, ciel spatial (nébuleuse + étoiles en points 3D),
bloom à seuil HDR + étalonnage (saturation, contraste, épaule douce), police
ronde Fredoka.

---

## Lancement

```bash
npm install          # dépendances (three, vite, vite-plugin-pwa, typescript, playwright-core)
npm run dev          # serveur de développement (http://localhost:5173, accessible en réseau local)
npm run build        # tsc strict + build Vite + service worker PWA → dist/
npm run preview      # sert dist/ (test PWA / hors ligne)
npm run test:visual  # tests visuels déterministes (Chromium headless) → tests/out/
npm run assets       # régénère tous les assets depuis le projet Unity (voir plus bas)
```

Sur téléphone : ouvre l'URL GitHub Pages (ou `npm run dev` puis l'adresse IP
de l'ordinateur), puis **Ajouter à l'écran d'accueil**. Le jeu est ensuite
jouable sans réseau.

### Commandes

| Action | Tactile | Clavier | Manette |
|---|---|---|---|
| Tourner | stick (flottant, côté réglable) | ← → / A D (Q en AZERTY) | stick gauche, croix |
| Turbo (Arcade, maintenu) | bouton TURBO | Espace, Maj, ↑ | A, RB, RT |
| Pause | bouton ❙❙ | Échap, P | Start |

Le stick est analogique dans son cercle, au maximum dès 85 % de la course ;
en mode flottant la base apparaît sous le doigt et le suit s'il sort du cercle.

---

## Préréglages et réglages

Les réglages sont décrits par **un schéma unique** (`src/settings/schema.ts`)
d'où est générée la page `settings.html`. Les valeurs « Original » ne sont
pas retapées : elles sont lues dans `public/data/scene.json`
(`src/settings/bindings.ts`), donc dans les valeurs d'inspecteur Unity.
Stockage : `localStorage` (réglages, records), IndexedDB (image perso du sol).
Les boutons **Arcade / Original** effacent les valeurs enregistrées
(sinon d'anciennes valeurs masqueraient les nouveaux défauts).

Pour les tests, tout réglage peut être forcé par l'URL :
`index.html?preset=original&maxHealth=20&cameraTilt=0`.

| Réglage | Arcade | Original (Unity) |
|---|---|---|
| Fatigue de virage (`maxDirectionDuration`) | désactivée | 4 s |
| Inclinaison caméra | 26° | 0° (vue de dessus) |
| Roche des météores visible | oui | non (maillage de 2 cm) |
| Annonce du point d'impact | oui | non |
| Météores qui touchent la voiture | oui (−40, `damageItems`) | non |
| Intervalle des météores | 1,4 s, puis de plus en plus court | 1 s fixe |
| Aspect / durée des cratères | brûlure, 40 s | cube, permanents |
| Horloges par partie | illimitées | 10 |
| Invulnérabilité après un choc | 0,8 s | 0 |
| Turbo, étapes, mini-carte, vibrations | oui | non |
| Animation de fin | explosion + ralenti | `Time.timeScale = 0` |
| Musique | en boucle, 70 % | une fois, 100 % |
| Records (HighScoreManager) | enregistrés | non (jamais appelé dans l'original) |
| Ombres | oui | non (aucune lumière Unity n'en projette) |
| Style dessin animé, ciel spatial, réticules, balises des horloges | oui | non |
| Bloom + étalonnage | oui | non (bloom inactif dans le profil URP) |
| Cratères qui dévient la voiture | oui (25 à 60°, au hasard) | non |
| Fumée puis feu selon les dégâts | oui | non |
| Moteur | boucle procédurale, volume 0,45, hauteur selon la vitesse | `AccelerationLow`, volume 0,052, hauteur 0,65 |
| Sons ajoutés (explosions, chocs, sifflement, turbo, carillon) | oui | non |
| Orientation | libre (portrait ou paysage) | paysage |
| Planète qui rétrécit | oui (150 s, jusqu'à 40 %) | non (ShrinkPlanet non attaché) |
| Caméra | adaptative, 6,2 u au-dessus, 30° | fixe, 12 u, vue de dessus |
| Joystick | fixe, en bas à gauche | fixe, en bas à droite |

---

## Correspondance Unity → TypeScript

| Unity (C# / composant) | Portage |
|---|---|
| `PlayerController.cs` (`VehicleController`) | `src/game/VehicleController.ts` |
| `HealthManager.cs` | `src/game/HealthManager.ts` |
| `GameOverManager.cs`, `GameOver.cs` | `World.triggerGameOver()` + écran de fin (`src/ui/screens.ts`) |
| `MeteorSpawner.cs`, `MeteorCollision.cs` | `src/game/Meteors.ts` |
| `CollectibleSpawner.cs`, `CollectibleRotation.cs`, `DestructionCollectible.cs` | `src/game/Collectibles.ts` |
| `VehiculeDistanceTracker.cs` | `src/game/VehicleDistanceTracker.ts` |
| `SCoreManager.cs` (`HighScoreManager`) | `submitRecord()` dans `src/settings/store.ts` |
| `RotatePlanet.cs`, `ShrinkPlanet.cs` | `src/game/RotatePlanet.ts` |
| `StartGame.cs` | bouton « GO ! » (`src/main.ts`) |
| `Camerafollow.cs`, `VehicleShrink.cs` | non attachés dans les scènes → non portés (logique reprise par `CameraRig` et l'option « planète qui rétrécit ») |
| Prefab `Crater` (cube + trigger) | `src/game/Craters.ts` (InstancedMesh) |
| Prefab `CFXR Explosion 1` + `CFXR_Effect` | `src/game/Explosions.ts`, `src/unity/cfxr.ts` (secousse et lumières animées exactes) |
| Main Camera enfant de la voiture | `src/game/CameraRig.ts` |
| ParticleSystem (Shuriken) | `src/unity/particles.ts` (un seul `THREE.Points`, atlas) |
| Light (URP) | `src/unity/lights.ts` (pool de lumières pré-créées) |
| Volume URP (aberration chromatique, vignette) | `src/unity/postprocess.ts` |
| Matériaux URP Lit | `Assets.material()` dans `src/unity/assets.ts` |
| AudioSource | `src/unity/audio.ts` (Web Audio) |
| `Mathf.SmoothDamp`, `Random`, `Quaternion.Euler/LookRotation`, `Time` | `src/unity/math.ts`, `src/unity/time.ts` |
| AnimationCurve, MinMaxCurve, Gradient | `src/unity/curves.ts` |
| FixedJoystick (Joystick Pack) | `src/input/stick.ts` |
| Axe « Horizontal » (InputManager : sensibilité 3, gravité 3) | `src/input/input.ts` |

Le mini-runtime `src/unity/` ne contient que ce que ce projet utilise.
Le projet Unity n'a **ni Animator de personnage, ni Animation Rigging, ni
Cinemachine, ni DOTween, ni Shader Graph** dans ses scènes : ces modules ne
sont donc pas portés dans cette première itération (les contrôleurs
d'animation des portières de la voiture existent dans `Assets/` mais ne sont
utilisés par aucune scène).

### Conventions de conversion (main gauche Unity → main droite three.js)

Appliquées par `tools/export_scene.py` et `src/unity/math.ts` :

- position `(x, y, z)` → `(−x, y, z)` ; quaternion `(x, y, z, w)` → `(x, −y, −z, w)` ;
- Euler Unity : ordre Z, X puis Y (`unityEuler`) ; une rotation Unity `+a`
  autour de Y devient `−a` en three (`transform.Rotate(0, a, 0)` → `rotateY(−a)`) ;
- échelle d'import = GLB brut × `globalScale` × facteur d'unité (FBX2glTF
  convertit déjà les cm en m ; la voiture Collada a `globalScale = 0,01`) ;
- caméras : Unity regarde vers +Z, three vers −Z → `PerspectiveCamera`
  enfant du nœud Unity, tournée de 180° ;
- lumières URP : intensité × π (éclairage physique de three) ; atténuation
  identique (inverse du carré lissé jusqu'à la portée) ;
- couleurs : sRGB pour les couleurs ≤ 1, linéaires pour les couleurs HDR (> 1) ;
- ambiance « Skybox » : environnement PMREM de la skybox (intensité 1, la
  teinte 0,5 × 2 du shader Skybox/Cubemap valant 1).

---

## Écarts connus avec l'original

- **Matériaux de la voiture** : ils ne sont référencés par aucune scène ;
  l'importeur Unity les retrouve par leur nom (`materialSearch`). L'export
  reproduit cette recherche (`models[].materials` dans `scene.json`).
- **Matériau du cratère** : il manque dans le dépôt Unity (GUID
  `31321ba1…` introuvable, rendu magenta chez Unity). Préréglage Original :
  cube brun sombre ; Arcade : brûlure procédurale avec carte de normales.
- **Physique** : PhysX remplacé par des tests boîte orientée / sphère.
  Dans l'original, un météore qui heurte la voiture la pousse (Rigidbody non
  cinématique) puis rebondit ; ce n'est pas reproduit (en Original il la
  traverse sans dégâts, comme il ne déclenche aucun trigger).
- **Particules** : simulation Shuriken simplifiée (forme, émission, rafales,
  couleur/taille/rotation sur la durée de vie, planche de textures,
  vitesse, limite de vitesse, force, bruit approché). Pas de traînées
  (Trail module des « Wind Trails » / « Wandering Spirits » : rendues comme
  particules étirées), pas de distorsion UV ni de dissolution CFXR, les
  particules « mesh » sont des billboards.
- **Lumières des météores** : au plus *N* lumières ponctuelles réelles
  (réglage, 3 en Arcade, 4 en Original) attribuées aux plus visibles.
- **Post-process** : aberration chromatique et vignette exactes (formules
  URP) ; le flou de mouvement (0,1) n'est pas porté. Profondeur de champ,
  grain, bloom et ajustements de couleur sont inactifs dans le profil.
- **Cratères** : 400 au maximum (les plus anciens sont recyclés) ; infinis chez Unity.
- **Orientation** : le jeu est en paysage comme l'APK (`LandscapeLeft`) ;
  le HUD est réorganisé (la référence du Canvas Unity était 800 × 1280).
- **Interface** : HTML/CSS avec la police LiberationSans de TextMeshPro
  (métriques verticales corrigées) au lieu des Canvas Unity ; textes et
  couleurs repris des composants. Ajouts : pause, chrono, objectif,
  mini-carte, menus « Comment jouer » et « Pause ».
- **Scoring** : `HighScoreManager` et `SaveDistance()` ne sont jamais appelés
  dans l'original ; les records ne sont enregistrés qu'en Arcade (réglable).
- **Musique** : dans l'original elle ne boucle pas (99 s) ; option en Arcade.
- **Skybox** : convertie en 6 faces 512 px ; visible autour du halo.
- Le collider de la voiture reste aligné sur le rayon **non mis à l'échelle**
  de la planète (comme `PlayerController.cs`) ; avec l'option « planète qui
  rétrécit », le rayon mis à l'échelle est utilisé (logique de `VehicleShrink.cs`).

---

## Régénération des assets

Tous les assets de `public/` sont produits par les outils Python versionnés
dans `tools/` (rien n'est édité à la main) :

```bash
bash tools/build_assets.sh                      # clone engoB/MaPetitePlanet dans .cache/
bash tools/build_assets.sh "/chemin/Ma petite planete"   # ou un projet local
```

Prérequis : Python 3.10+, `ffmpeg`, accès réseau pour télécharger FBX2glTF
(v0.9.7, Linux x64). Étapes :

1. `export_scene.py` : scènes `Menu` et `SampleScene`, prefabs référencés,
   matériaux, valeurs des MonoBehaviours, systèmes de particules,
   CFXR_Effect, volume de post-process, TagManager → `public/data/scene.json`
   (Infinity/NaN remplacés par des valeurs finies).
2. `convert_assets.py` :
   - FBX → GLB (FBX2glTF), Collada → GLB (`dae2glb.py`, hiérarchie et noms conservés) ;
   - textures ≤ 1024 px (PSD aplatis), skybox en croix → 6 faces, moyenne d'ambiance ;
   - atlas des particules `fx_atlas.png` (textures « canal unique » CFXR : R → alpha) ;
   - sons → MP3 ;
   - police TextMeshPro : contrôle ascent/descent avec fonttools, copie
     corrigée si des glyphes dépassent (cas de LiberationSans) ;
   - icônes PWA depuis `Graphics/Icon.png` ;
   - inventaire → `public/data/assets.json`.
3. `procedural_textures.py` (numpy, graine fixe, textures périodiques avec
   carte de normales) : relief du sol, cratère, anneau et point de l'atlas FX.
4. `procedural_planets.py` : cubemaps peintes des planètes (couleur +
   émission de la lave), aperçus du menu, nébuleuse du ciel spatial.
5. `procedural_audio.py` : explosion, choc, sifflement de météore, turbo,
   carillon, boucle moteur (les boucles restent en WAV : le MP3 ajoute un
   silence qui casse la boucle).
6. Police Fredoka (SIL OFL) prise du paquet npm `@fontsource/fredoka`,
   métriques verticales corrigées avec fonttools.

---

## Tests

`npm run build && npm run test:visual` :

- Chromium headless avec SwiftShader ; la page est ouverte avec `?test=1`
  (pas de boucle `requestAnimationFrame`) ; la simulation est appelée à
  1/60 s sans rendu intermédiaire, puis **une seule capture** par scénario
  (menu, départ et 6 s en Arcade/Original, impact, pause, réglages, fin) ;
- mesures écrites dans `tests/out/metrics.json` (distance, santé, cratères,
  météores, particules, appels de dessin…) ;
- test fonctionnel du stick (pointer events) : 40 % de course → 0,47,
  85 % → 1, relâché → 0.

Le dépôt Unity ne contient pas de captures d'écran ; la seule image de
référence est son icône (`tests/reference/unity-icon.png`, rendu de la planète).

---

## Déploiement

`.github/workflows/deploy.yml` : à chaque push sur `main`, `npm ci`,
`npm run build`, puis publication de `dist/` sur GitHub Pages (activer
*Settings → Pages → Source : GitHub Actions*). `base: './'` : le jeu
fonctionne dans un sous-dossier (`https://<utilisateur>.github.io/littleplanet/`).

---

## Arborescence

```
littleplanet/
├── index.html                 # jeu
├── settings.html              # réglages (générés depuis le schéma)
├── vite.config.ts             # multipage, PWA (standalone, paysage, précache)
├── public/
│   ├── data/scene.json        # export du projet Unity
│   ├── data/assets.json       # inventaire des assets convertis
│   ├── models/*.glb           # planète, voiture, météore, horloge
│   ├── textures/              # textures ≤ 1024 px, skybox, atlas FX, procédurales
│   ├── audio/*.mp3
│   ├── fonts/LiberationSans.ttf
│   └── icons/                 # icônes PWA
├── src/
│   ├── main.ts                # chargement, menus, boucle, qualité adaptative, PWA
│   ├── styles.css
│   ├── unity/                 # mini-runtime « Unity » réutilisable
│   │   ├── assets.ts          #   chargement + matériaux URP → three
│   │   ├── gameobject.ts      #   reconstruction des GameObjects / prefabs
│   │   ├── particles.ts       #   Shuriken simplifié, un seul Points
│   │   ├── lights.ts          #   pool de lumières (aucun ajout en jeu)
│   │   ├── cfxr.ts            #   secousse caméra + lumières animées CFXR
│   │   ├── postprocess.ts     #   aberration chromatique, vignette (URP)
│   │   ├── audio.ts, curves.ts, math.ts, time.ts, types.ts
│   ├── game/                  # scripts portés (un fichier par script C#)
│   │   ├── planets.json       #   planètes (source unique jeu + générateur)
│   │   ├── toon.ts, fx.ts     #   cel-shading, aura, réticules, balises
│   │   ├── Decor.ts, Starfield.ts
│   ├── input/                 # stick, boutons, clavier, manette, vibrations
│   ├── ui/                    # HUD, mini-carte, menus, orientation
│   └── settings/              # schéma, stockage, liaisons scene.json, page
├── tools/                     # pipeline d'assets Python
├── tests/visual.mjs           # tests visuels Playwright
└── .github/workflows/deploy.yml
```

## Plein écran

PWA installée en `display: fullscreen` (repli `standalone`), canvas en
`100lvh` dimensionné sur sa taille réelle : pas de bande vide en bas de
l'écran (barre d'accueil iOS, barres Android escamotées).

## Son

Web Audio, déverrouillé au premier toucher. Sur iOS 17+, la session audio
passe en « lecture » (`navigator.audioSession`) pour que le son sorte même
avec le bouton silencieux ; pour les iOS plus anciens, un `<audio>` muet est
joué pendant le geste.

## À vérifier sur téléphone

- fluidité (qualité adaptative : densité de pixels 2 → 1, particules) ;
- stick flottant et bouton turbo maintenu (multi-touch) ;
- plein écran + verrouillage paysage au premier toucher (Android) ;
  sur iOS, installer la PWA pour masquer la barre d'adresse ;
- zones sûres (encoche) ;
- son au premier toucher (politique d'autoplay), y compris bouton silencieux sur iPhone ;
- mode portrait et mode paysage ;
- installation PWA et lancement hors ligne.
