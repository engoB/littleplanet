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

Vingt-cinq planètes décrites dans un fichier unique, `src/game/planets.json`,
lu par le générateur de textures et par le jeu. En Arcade, **la planète
rétrécit** au fil de la partie (jusqu'à 40 % en 150 s) et la **caméra
s'adapte** : proche du véhicule tant que la planète est grosse, elle recule
pour la montrer en entier quand elle devient petite. On roule toujours
librement tout autour de la planète : les routes dessinées (Sage) ne sont
qu'un décor.

Elles s'inspirent d'univers de dessins animés, de films et de jeux très
connus, avec un style évident mais sans reprendre de personnage ni de logo :

| Planète | Diff. | Inspiration | Particularité |
|---|---|---|---|
| Planète d'origine | ★★ | — | la planète Unity, telle quelle (voiture Unity) |
| Stade Champignon | ★★ | Circuit Mario | grosse planète : pelouse de stade en damier, tuyaux, arbres |
| Prairie Meuh Meuh | ★ | Prairie Meuh Meuh | prés éclatants, vaches tachetées, clôtures, grange rouge, bottes de foin |
| Stade de Terre | ★★★ | Stade Wario | boue, bosses, flaques, tremplins (sans décor) |
| Lac Fantôme | ★★★ | Vallée Fantôme | eau violette et radeaux de planches (sans décor) |
| Forteresse de Lave | ★★★★ | Château de Bowser | pavés clairs, fissures de lave, torches ; **blocs écraseurs qui tombent du ciel** |
| Arc-en-ciel Céleste | ★★★★★ | Route Arc-en-ciel | damier arc-en-ciel lumineux et translucide, anneaux dorés |
| Planète du Sage | ★★ | Dragon Ball | route jaune (décor), prés dorés, maison-dôme, ciel doré « au-delà » |
| Prairie | ★ | — | clairières de terre, maison-dôme ; météores lents et rares |
| La Comté | ★ | les hobbits | collines-terriers à porte ronde, champs en patchwork, haies, mares |
| Prairie des Herbes Hautes | ★★ | Pokémon | hautes herbes (brins qui volent en les traversant), mares (sans décor) |
| Royaume Champignon | ★★ | Mario | tuyaux verts, champignons à pois, blocs « ? » |
| Planète Bonbons | ★★ | Candy Crush | glaçage rose ondulé, flaques de chocolat, sucettes, boules de gomme |
| Chambre de Jouets | ★★★ | Pixar | **moquette** et tapis ronds, ciel de gros nuages, **jouets bousculables** (ballons, cubes) |
| Royaume Enchanté | ★★ | Disney | prés en fleurs, lacs, ciel étoilé (sans décor) |
| Poudlard | ★★★ | Harry Potter | hautes terres, lac noir, château aux tours pointues, anneaux de Quidditch, chandelles flottantes |
| Ville d'Halloween | ★★★ | L'Étrange Noël de M. Jack | colline en spirale, citrouilles illuminées, tombes, lune géante |
| Village de Noël | ★★ | Noël | neige, plaques de glace, sapins illuminés, cadeaux, sucres d'orge, bonshommes de neige, aurore |
| Grand Océan | ★★★ | One Piece | **rien que de l'eau** : tremplins, accélérateurs, tourbillons ; adhérence 0,7 |
| Émeraude | ★★★ | — | étangs (éclaboussures) ; météores plus rapides (sans décor) |
| Monde de Cubes | ★★★ | Minecraft | tout en blocs |
| Hill Valley | ★★★ | Retour vers le futur | pelouses, places pavées, tour de l'horloge, **panneau « Welcome to Hill Valley » qui flotte** ; « 88 mph ! » et traînées de feu en turbo |
| Astéroïde B 612 | ★★★★ | Le Petit Prince | plus grosse au départ (×1,2) : sable doré, rose sous sa cloche, volcans, baobabs |
| Banquise | ★★★ | — | **monde de cases gelées** : la voiture glisse (adhérence 0,35) |
| Naine | ★★★★★ | — | rayon 0,7 : tout arrive très vite |

Émeraude, Banquise et Naine se débloquent en parcourant 100 m sur la planète
précédente (réglage « Toutes les planètes débloquées » pour tout ouvrir).
Records par planète.

Chaque planète a une **carte de surface** générée avec ses textures (sol, eau,
lave, glace, hautes herbes) : le jeu sait sur quoi roule la voiture et
déclenche éclaboussures, sillage, braises ou brins d'herbe.

### Objets sur toutes les planètes

Placés au hasard (graine fixe par planète, nombre selon la taille) :

- **cases « ? »** arc-en-ciel : elles remplacent les horloges (même apparition
  et même soin que l'original) et éclatent en gerbe de particules ;
- **baskets du futur** (montantes, lacets lumineux) : turbo plein ;
- **accélérateurs** (dalles à chevrons) : ×1,55 pendant 1,1 s ;
- **tremplins** : saut, aucun cratère ne fait mal pendant le saut ;
- **pylônes tournoyants** : le véhicule fait une toupie et accélère.

### Voyage galactique (mode de jeu)

Un mode à part (bouton « Modes de jeu » → « Partir ») : une suite de petites
planètes. La planète suivante flotte dans le ciel. L'**étoile de lancement**
n'apparaît qu'une fois l'**objectif de la planète réussi** et au moins 30 m
parcourus dessus (étoile dorée sur la mini-carte, elle attire le véhicule à
l'approche). Le lancement s'inspire de la « Launch Star » de Mario Galaxy :
le véhicule est **aspiré** au centre de l'étoile en tournoyant, l'étoile se
**tasse** pour prendre son élan, puis il est **éjecté** sur une courbe de
Bézier (départ très rapide, arrivée qui ralentit, tonneau, champ de vision
élargi, caméra de poursuite qui glisse du véhicule vers la destination). À
l'arrivée : écrasement et rebond élastique du véhicule, gerbe de poussière,
et la caméra **fond** doucement de la pose de vol vers le suivi normal.

### Modes de jeu (bouton « Modes de jeu » de l'accueil)

Défis cumulables, pour toutes les planètes :

| Mode | Effet |
|---|---|
| Contre-la-montre | 60 s au départ, chaque case ajoute 5 s, fin à 0 (pas de record) |
| Tempête de météores | deux fois plus de météores, 30 % plus rapides |
| Commandes inversées | gauche et droite échangées |
| **Attrape le Vif d'or** | une balle dorée ailée file au ras de la planète, zigzague et fuit : +10 de santé par prise |
| **Fuis le Bullet Bill** | des obus te prennent en chasse (virage limité, un peu plus rapides que toi) : esquive-les jusqu'à ce qu'ils s'éteignent |
| Mort subite | le moindre choc est fatal |
| Zen | aucun dégât, météores plus rares (pas de record) |
| Turbo infini | la jauge ne se vide jamais (pas de record) |
| Planète qui rétrécit | activé par défaut en Arcade |

### Menus

- **Choix de la planète** façon « sélection de royaume » (Mario Odyssey) :
  les planètes flottent en arc dans l'espace, celle du centre est grande avec
  son aura ; glisser, flèches ou clavier pour défiler ; carte de nom (monde,
  difficulté, description, record).
- **Comment jouer** : tutoriel illustré en 5 diapositives (histoire, tourner,
  éviter, ramasser, progresser).
- **Réglages** : petite roue discrète en haut à droite.

### Véhicule (préréglage Arcade)

Voiture volante (inspiration aéro-voitures des dessins animés japonais) :
coque blanche compacte à bandes rouges, bulle de cockpit avec pilote, **quatre
patins anti-gravité lumineux aux coins** (silhouette de voiture vue de
dessus), aileron, deux réacteurs arrière (jets de particules, plus forts en
turbo). Elle flotte et s'incline dans les virages. La boîte de collision reste
celle de la voiture d'origine : le gameplay ne change pas.

### HUD Arcade

- **Santé** : anneau segmenté au sol autour du véhicule (vert → jaune →
  rouge, clignote sous 30 %, flash blanc à chaque choc, traînée claire de la
  part perdue). Réglage « Affichage de la santé » pour revenir à la barre.
- **Objectif** : bannière sous le chrono (pastille d'étape, icône, texte en
  gros, barre de progression) et grande annonce « Étape N » au centre quand
  une étape est réussie.
- **Turbo** : bouton au centre vide (sous le pouce) entouré d'un **anneau de
  flammes** qui représente la jauge ; jauge vide → turbo verrouillé jusqu'au
  relâchement et 20 % de recharge (plus de turbo par à-coups).
- Les cratères ne font plus dévier le véhicule (réglage « Les cratères font
  dévier », désactivé par défaut).

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
| Tourner | appui n'importe où sur la moitié gauche / droite de l'écran (Arcade) ou stick (Original) | ← → / A D (Q en AZERTY) | stick gauche, croix |
| Turbo (Arcade, maintenu) | bouton TURBO | Espace, Maj, ↑ | A, RB, RT |
| Pause | bouton ❙❙ | Échap, P | Start |

**Deux zones** (Arcade, réglage « Commande tactile ») : l'écran est coupé en
deux ; tant qu'un doigt est posé à gauche la voiture tourne à gauche, à droite
elle tourne à droite (le dernier doigt posé décide, glisser d'un côté à
l'autre change de sens). Le bouton turbo et la pause capturent leur propre
doigt : on peut tourner et turbo en même temps, sans virage parasite.

**Pas de virage infini** : après 1,6 s de braquage dans le même sens, le
virage s'éteint progressivement et la voiture repart en ligne droite
(réglages « Fatigue de virage » et « Virage à pleine force pendant » ; c'est
le `maxDirectionDuration` de l'original, prolongé en Arcade).

Le stick (préréglage Original) est analogique, au maximum dès 85 % de la course.

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
| Cratères qui dévient la voiture | non (réglable) | non |
| Santé | anneau au sol autour du véhicule | barre (Slider) |
| Fumée puis feu selon les dégâts | oui | non |
| Moteur | boucle procédurale, volume 0,45, hauteur selon la vitesse | `AccelerationLow`, volume 0,052, hauteur 0,65 |
| Sons ajoutés (explosions, chocs, sifflement, turbo, carillon) | oui | non |
| Orientation | libre (portrait ou paysage) | paysage |
| Planète qui rétrécit | oui (150 s, jusqu'à 40 %) | non (ShrinkPlanet non attaché) |
| Caméra | adaptative, 6,2 u au-dessus, 30° | fixe, 12 u, vue de dessus |
| Commande tactile | deux demi-écrans (gauche / droite) | stick fixe, en bas à droite |
| Virage maintenu | pleine force 1,6 s puis retour en ligne droite (3,4 s) | `maxDirectionDuration` 4 s |
| Véhicule | voiture volante | voiture Unity |
| Modes de jeu (mort subite, zen, contre-la-montre…) | au choix | non |
| Effets de surface (éclaboussures, sillage, braises, tourbillons) | oui | non |
| Objets kart (accélérateurs, cubes bonus, tremplins) et voyage galactique | oui | non |

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
- **Véhicule** : la voiture volante est un ajout Arcade construit en code ;
  la voiture Unity reste celle du préréglage Original.
- **Commandes tactiles** : l'APK utilise des boutons ; Arcade utilise deux
  demi-écrans, Original un stick.
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
   - icônes PWA depuis `Graphics/Icon.png` seulement si aucune n'existe
     (l'icône actuelle est rendue par le moteur, voir « Icône ») ;
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
- test fonctionnel des **deux zones** (pointer events) : moitié gauche → −1,
  moitié droite → +1, relâché → 0, bouton turbo → turbo sans virage,
  **vrai clic sur le bouton pause** (il doit passer au-dessus des zones) ;
  vérification que la barre de vie ne chevauche jamais le chrono (paysage
  et portrait).

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

Sons premium (Arcade) : interface, ramassages, accélérateurs, sauts,
pylônes, étoile, décollage et atterrissage tirés du paquet npm **uisfx**
(audio **CC0-1.0**, styles glass, arcade, sci-fi, rubber, dreamy, cinematic) ;
explosion, choc et souffle resynthétisés en couches avec réverbération à
convolution (`tools/premium_sfx.py`).

Web Audio, déverrouillé au premier toucher. Sur iOS 17+, la session audio
passe en « lecture » (`navigator.audioSession`) pour que le son sorte même
avec le bouton silencieux ; pour les iOS plus anciens, un `<audio>` muet est
joué pendant le geste.

## Fluidité (objectif 60 Hz)

- simulation : ~0,2 ms par image ; écriture des particules ~0,1 ms (tri par
  clé numérique dans un tableau typé, copies sans allocation) ;
- un seul appel de dessin pour toutes les particules, décor en InstancedMesh,
  lumières pré-créées, shaders précompilés (aucun gel en cours de partie) ;
- pas de MSAA sur le framebuffer final quand le post-process est actif (il
  est fait dans la cible intermédiaire : 4 échantillons sur ordinateur, 2 sur
  mobile) ;
- qualité « auto » : départ à 1,5× sur mobile ; sous 54 i/s pendant 2 s la
  densité de pixels baisse par paliers de 0,25 (jusqu'à 1×, puis MSAA coupé
  et particules réduites) ; au-dessus de 58 i/s pendant 6 s elle remonte,
  sans repasser au palier qui a ramé.

## Icône

Rendue par le moteur lui-même (voiture volante au-dessus de la Prairie,
bloom et cel-shading du jeu) puis composée (nébuleuse, traînées des
réacteurs, météore) :
`npm run build && node tools/render_icon.mjs && python3 tools/icon_compose.py .cache/icon_render.png public/icons`.

## À vérifier sur téléphone

- fluidité 60 Hz (afficher les FPS dans les réglages) ;
- deux zones tactiles + bouton turbo maintenu (multi-touch) ;
- plein écran + verrouillage paysage au premier toucher (Android) ;
  sur iOS, installer la PWA pour masquer la barre d'adresse ;
- zones sûres (encoche) ;
- son au premier toucher (politique d'autoplay), y compris bouton silencieux sur iPhone ;
- mode portrait et mode paysage ;
- installation PWA et lancement hors ligne.
