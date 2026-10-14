/**
 * Petite histoire du jeu : quelques répliques à l'arrivée sur chaque monde
 * (première visite), quand sa mission est réussie, et une fin quand la
 * dernière mission tombe.
 */
export interface Line {
  /** Qui parle (nom affiché) et son portrait (émoji). */
  who: string;
  face: string;
  text: string;
}

const DOC = { who: 'Doc', face: '🧑‍🔬' };
const d = (text: string): Line => ({ ...DOC, text });
const npc = (who: string, face: string, text: string): Line => ({ who, face, text });

export const STORY: Record<string, { intro: Line[]; done: Line[] }> = {
  prairie: {
    intro: [d('Nom d’un boulon ! Une pluie de météores s’abat sur toute la galaxie des petits mondes.'), d('Ta DeLorean volante est notre seul espoir. On commence par la Prairie : les poules se sont échappées, bouscule-les vers le poulailler !')],
    done: [npc('La fermière', '👩‍🌾', 'Mes poules ! Merci, voyageur. Le chemin vers la Prairie Meuh Meuh est ouvert.')],
  },
  meuh: {
    intro: [npc('Le fermier', '👨‍🌾', 'Les météores ont affolé mes vaches, elles se promènent partout !'), d('Rien de tel qu’un petit coup de pare-chocs pour les faire bouger. Gentiment !')],
    done: [d('Les vaches sont calmées. Direction la Comté, j’y ai capté un drôle de signal.')],
  },
  comte: {
    intro: [npc('Un hobbit', '🧑‍🦱', 'Nos moutons se sont dispersés dans le bocage, et le second petit-déjeuner refroidit !'), d('Rassemble-les en les bousculant, la DeLorean adore la laine.')],
    done: [npc('Un hobbit', '🧑‍🦱', 'Merveilleux ! Prends cette lanterne, le Royaume champignon t’attend.')],
  },
  champi: {
    intro: [d('Le Royaume champignon ! Les météores ont fait pousser du décor partout.'), d('Fonce dans le décor pour dégager la route. Attention, les gros monuments, eux, ne bougent pas.')],
    done: [npc('Un champignon', '🍄', 'Youpi ! Le circuit est dégagé, les pilotes t’attendent.')],
  },
  circuit: {
    intro: [npc('Le commissaire', '🏁', 'Bienvenue sur le circuit ! Pour être qualifié, il faut tenir la distance.'), d('Utilise les accélérateurs et le turbo, mais garde un œil sur le ciel.')],
    done: [npc('Le commissaire', '🏁', 'Qualifié ! Un vieux sage veut te voir sur sa planète.')],
  },
  sage: {
    intro: [npc('Le vieux sage', '🧓', 'Ho ho ! Les météores ont abîmé ma maison. Rapporte-moi des caisses de réparation.'), d('Ramasse les caisses qui apparaissent, elles te soignent aussi.')],
    done: [npc('Le vieux sage', '🧓', 'Parfait ! Va donc goûter la Planète Bonbons, tu l’as mérité.')],
  },
  candy: {
    intro: [d('La Planète Bonbons ! Les météores ont semé des bonbons partout sur la route en sucre d’orge.'), d('Lance-les en orbite à pleine vitesse : les étoiles adorent le sucre.')],
    done: [d('Les étoiles sont rassasiées ! Brr… cap sur le Village de Noël.')],
  },
  noel: {
    intro: [npc('Le Père Noël', '🎅', 'Ho ho ho ! Mes cadeaux sont tombés du traîneau pendant l’averse !'), d('Pousse-les vers la route de neige, les lutins s’occupent du reste.')],
    done: [npc('Le Père Noël', '🎅', 'Joyeux Noël ! Une chambre d’enfant t’attend tout là-haut.')],
  },
  pixar: {
    intro: [d('On dirait une chambre d’enfant géante… Les jouets ont pris vie !'), d('Envoie les jouets en orbite au turbo, ça les fait rire.')],
    done: [d('Vers l’infini et au-delà ! Prochain arrêt : le château des sorciers.')],
  },
  poudlard: {
    intro: [npc('Un sorcier', '🧙', 'Les balais volants se sont échappés du terrain de jeu !'), d('Ils volent bas : percute-les pour les ramener.')],
    done: [npc('Un sorcier', '🧙', 'Dix points pour ta DeLorean ! Méfie-toi de la ville d’Halloween…')],
  },
  halloween: {
    intro: [npc('Le roi des citrouilles', '🎃', 'L’orage gronde et mes citrouilles roulent partout !'), d('Bouscule-les avant que la foudre ne les transforme en soupe.')],
    done: [npc('Le roi des citrouilles', '🎃', 'Quel frisson ! La mer t’appelle, voyageur.')],
  },
  ocean: {
    intro: [d('Le Grand Océan : pas une île, rien que des vagues et des canards en plastique.'), d('Tiens bon sous la pluie : il faut survivre assez longtemps pour capter le signal.')],
    done: [d('Signal capté ! Il vient d’un monde… tout en cubes ?')],
  },
  cubes: {
    intro: [npc('Un cochon cube', '🐷', 'Groin ! Nos cochons se sont carrément éparpillés.'), d('Bouscule-les, ils sont plus solides qu’ils n’en ont l’air.')],
    done: [d('Bloc par bloc, la galaxie se répare. Allons à Hill Valley, c’est là que tout a commencé !')],
  },
  futur: {
    intro: [d('Hill Valley ! Les robots du futur sont détraqués par les météores.'), d('Fonce dans les robots pour les remettre à zéro. Et à 88 mph, si possible !')],
    done: [d('Nom d’un boulon, ça marche ! Le froid de la Banquise ne me dit rien qui vaille…')],
  },
  banquise: {
    intro: [npc('Un pingouin', '🐧', 'Kwaaa ! La glace craque et nous glissons partout !'), d('Ça glisse : bouscule les pingouins vers la terre ferme.')],
    done: [npc('Un pingouin', '🐧', 'Merci ! Une forteresse de lave brûle au loin…')],
  },
  bowser: {
    intro: [d('La forteresse de lave… c’est d’ici que partent les météores !'), d('Tiens bon sous les bombardements, je cherche la source.')],
    done: [d('La forteresse cède ! La source est plus loin : sur un tout petit astéroïde.')],
  },
  petitprince: {
    intro: [npc('Le petit prince', '👦', 'S’il te plaît… dessine-moi un mouton. Ou fais simplement le tour de mon astéroïde.'), d('Roule longtemps, les baobabs ne doivent pas tout envahir.')],
    done: [npc('Le petit prince', '👦', 'On ne voit bien qu’avec le cœur… et avec des phares. L’arc-en-ciel t’attend.')],
  },
  arcenciel: {
    intro: [d('La route arc-en-ciel ! On voit les étoiles à travers le sol de verre.'), d('Envoie un maximum d’objets en orbite pour rallumer le ciel.')],
    done: [d('Le ciel se rallume ! Il ne reste qu’une petite planète : la Naine, au cœur de la tempête.')],
  },
  naine: {
    intro: [d('La Naine… c’est elle qui attire tous les météores !'), d('Tiens jusqu’à l’étape 5, la tempête finira par s’essouffler.')],
    done: [],
  },
};

/** Fin de l'histoire : la dernière mission est réussie. */
export const ENDING: Line[] = [
  d('Ça y est ! La tempête de météores s’est éteinte, la galaxie des petits mondes est sauvée.'),
  d('Mais il reste tant de planètes à visiter… Le Voyage galactique et tous les défis sont ouverts. En route !'),
];

const SEEN = 'mpp.story.v1';

export function storySeen(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]).includes(id);
  } catch {
    return true;
  }
}

export function markStorySeen(id: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[];
    if (!all.includes(id)) all.push(id);
    localStorage.setItem(SEEN, JSON.stringify(all));
  } catch {
    /* stockage indisponible */
  }
}
