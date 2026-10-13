"""Planètes et ciel étoilé générés procéduralement (numpy, graines fixes).

Pour chaque planète « toon » de src/game/planets.json :
  - une cubemap couleur 6 × 512 px dans un style dessin animé (aplats de
    couleur, contours sombres) : la texture est une fonction de la direction
    3D, donc sans couture ni pincement aux pôles ;
  - une cubemap d'émission 6 × 256 px (lave) si nécessaire ;
  - un aperçu 256 px pour le menu de choix.
Plus un ciel spatial (nébuleuse + étoiles) en cubemap 6 × 512 px.

Les faces suivent la convention des cubemaps WebGL (ordre px, nx, py, ny, pz, nz).

Usage : python tools/procedural_planets.py <planets.json> <dossier de sortie>
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz']


def face_dirs(face: str, n: int) -> np.ndarray:
    """Directions unitaires (n, n, 3) d'une face de cubemap WebGL."""
    s = (np.arange(n) + 0.5) / n * 2 - 1
    sc, tc = np.meshgrid(s, s)  # sc : colonnes, tc : lignes (haut → bas)
    one = np.ones_like(sc)
    d = {
        'px': (one, -tc, -sc), 'nx': (-one, -tc, sc),
        'py': (sc, one, tc), 'ny': (sc, -one, -tc),
        'pz': (sc, -tc, one), 'nz': (-sc, -tc, -one),
    }[face]
    v = np.stack(d, axis=-1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


class Noise3:
    """Bruit de valeurs 3D (grille 64³ répétée) + fBm."""

    def __init__(self, seed: int) -> None:
        self.g = np.random.default_rng(seed).random((64, 64, 64))

    def value(self, p: np.ndarray) -> np.ndarray:
        q = np.floor(p).astype(np.int64)
        f = p - q
        f = f * f * (3 - 2 * f)
        out = np.zeros(p.shape[:-1])
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                    out += w * self.g[(q[..., 0] + dx) % 64, (q[..., 1] + dy) % 64, (q[..., 2] + dz) % 64]
        return out

    def fbm(self, p: np.ndarray, octaves: int = 4) -> np.ndarray:
        amp, tot, out = 1.0, 0.0, np.zeros(p.shape[:-1])
        for o in range(octaves):
            out += amp * self.value(p * (2 ** o) + o * 17.3)
            tot += amp
            amp *= 0.5
        return out / tot


def hexc(h: str) -> np.ndarray:
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255


SURF_GROUND, SURF_WATER, SURF_LAVA, SURF_ICE, SURF_PATH, SURF_GRASS = 0, 1, 2, 3, 4, 5
# Carte de surface : valeur du pixel = classe × SURF_SCALE (lue par le jeu)
SURF_SCALE = 30

def sphere_points(n: int, seed: int) -> np.ndarray:
    """n directions aléatoires (graine fixe)."""
    p = np.random.default_rng(seed).normal(size=(n, 3))
    return p / np.linalg.norm(p, axis=-1, keepdims=True)


def voronoi(d: np.ndarray, pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cellule la plus proche et écart angulaire à la frontière (0 sur les bords)."""
    dots = d.reshape(-1, 3) @ pts.T
    part = np.argpartition(-dots, 1, axis=1)[:, :2]
    a = np.take_along_axis(dots, part, 1)
    order = np.argsort(-a, axis=1)
    part = np.take_along_axis(part, order, 1)
    a = np.take_along_axis(a, order, 1)
    edge = np.arccos(np.clip(a[:, 1], -1, 1)) - np.arccos(np.clip(a[:, 0], -1, 1))
    return part[:, 0].reshape(d.shape[:-1]), edge.reshape(d.shape[:-1])


def spots(d: np.ndarray, pts: np.ndarray, radii: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Disques sur la sphère : indice du disque touché (-1 sinon) et distance normalisée au centre."""
    ang = np.arccos(np.clip(d.reshape(-1, 3) @ pts.T, -1, 1)) / radii[None, :]
    i = np.argmin(ang, axis=1)
    r = ang[np.arange(len(i)), i]
    i = np.where(r < 1, i, -1)
    return i.reshape(d.shape[:-1]), r.reshape(d.shape[:-1])


def road_band(d: np.ndarray, nz: Noise3, a: float = 0.1, b: float = 0.05, phase: float = 0.0) -> np.ndarray:
    """Distance (≈ angulaire) à une route décorative qui fait le tour de la planète
    autour de l'équateur, en courbes douces (comme le chemin de la planète du Sage)."""
    lon = np.arctan2(d[..., 2], d[..., 0])
    off = a * np.sin(2 * lon + phase) + b * np.sin(3 * lon + 1.3 + phase) + 0.02 * (nz.fbm(d * 3 + 17, 2) - 0.5)
    return np.abs(d[..., 1] - off)


def pattern(d: np.ndarray, pl: dict, nz: Noise3) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Classe de région (entier), couleur RGB, émission [0,1] pour des directions d."""
    cls, col, emis, _ = pattern_full(d, pl, nz)
    return cls, col, emis


def pattern_full(d: np.ndarray, pl: dict, nz: Noise3) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Comme pattern() + type de surface (sol, eau, lave, glace, chemin) pour le jeu."""
    pal = pl['palette']
    kind = pl['pattern']
    if kind == 'cubes':
        # Monde de cubes : directions quantifiées → régions en blocs
        q = np.floor(d * 26) + 0.5
        d = q / np.linalg.norm(q, axis=-1, keepdims=True)
    base = nz.fbm(d * 2.2 + 3.1, 4)
    detail = nz.fbm(d * 7.0 + 11.0, 3)
    v = base + 0.25 * (detail - 0.5)
    # Aplats doux (cel-shading « film d'animation ») : transitions étroites mais lissées
    t1 = smooth(0.40, 0.445, v)
    t2 = smooth(0.565, 0.61, v)
    col = lerp(lerp(hexc(pal['dark']), hexc(pal['mid']), t1), hexc(pal['light']), t2)
    # Variation de teinte à grande échelle + grain pictural très léger
    hue = nz.fbm(d * 1.1 + 200, 2)[..., None] - 0.5
    col = col * (1 + 0.10 * hue) + 0.025 * (nz.fbm(d * 26 + 9, 2)[..., None] - 0.5)
    tone = np.digitize(v, [0.42, 0.59])
    cls = tone.copy()
    emis = np.zeros(d.shape[:-1])
    surf = np.zeros(d.shape[:-1], np.uint8)

    def paint(mask: np.ndarray, c: str, k: int, soft: np.ndarray | None = None) -> None:
        """Peint une région ; `soft` (0..1) donne un bord adouci."""
        nonlocal col, cls
        a = (soft if soft is not None else mask.astype(np.float64))[..., None]
        col = col * (1 - a) + hexc(c) * a
        cls = np.where(mask, k, cls)

    if kind == 'prairie':
        # Prairie : clairières de terre et prés fleuris (taches, aucune route)
        patch = nz.fbm(d * 3.3 + 40, 3)
        paint(patch > 0.69, pal['pathDark'], 12, smooth(0.685, 0.7, patch) * 0.7)
        paint(patch > 0.715, pal['path'], 13, smooth(0.71, 0.725, patch))
    elif kind == 'emeraude':
        w = nz.fbm(d * 2.6 + 70, 4)
        paint(w < 0.33, pal['accent1'], 10, smooth(0.335, 0.32, w) * 0.8)
        paint(w < 0.31, pal['path'], 11, smooth(0.315, 0.3, w))
        paint(w < 0.24, pal['pathDark'], 12, smooth(0.25, 0.22, w))
        surf[w < 0.31] = SURF_WATER
    elif kind == 'banquise':
        # Monde de cases gelées : dalles de glace (grille 3D), joints de neige, fissures
        g = d * 16
        fr = np.abs(g - np.round(g))
        joint = np.min(np.where(np.abs(d) > 0.5, 9, fr), axis=-1)
        tint = nz.fbm(np.floor(g) * 0.41 + 3, 2)
        ice = lerp(hexc(pal['path']), hexc(pal['light']), smooth(0.3, 0.7, tint))
        # Reflet en biseau sur chaque dalle
        bevel = smooth(0.12, 0.05, joint)
        ice = ice * (1 + 0.18 * bevel[..., None])
        col = np.where((joint < 0.04)[..., None], hexc('#f4fbff'), ice)
        r = 1 - np.abs(2 * nz.fbm(d * 6 + 120, 3) - 1)
        col = np.where(((r > 0.955) & (joint > 0.05))[..., None], hexc(pal['pathDark']), col)
        snow = nz.fbm(d * 3 + 60, 3)
        paint(snow > 0.7, '#ffffff', 12, smooth(0.7, 0.72, snow))
        cls = np.where(joint < 0.04, 10, 0)
        surf[:] = SURF_ICE
    elif kind == 'volcan':
        r = 1 - np.abs(2 * nz.fbm(d * 3.2 + 150, 4) - 1)
        paint(r > 0.88, pal['path'], 10, smooth(0.875, 0.9, r))
        paint(r > 0.94, pal['pathDark'], 11, smooth(0.935, 0.955, r))
        emis = smooth(0.9, 0.97, r)
        pools = nz.fbm(d * 2.0 + 300, 3)
        paint(pools > 0.74, pal['path'], 12, smooth(0.735, 0.75, pools))
        paint(pools > 0.78, pal['pathDark'], 13, smooth(0.775, 0.79, pools))
        emis = np.maximum(emis, smooth(0.75, 0.8, pools))
        surf[(r > 0.88) | (pools > 0.74)] = SURF_LAVA
    elif kind == 'neon':
        # Grille « rétro-futuriste » : parallèles cyan, méridiens magenta
        lat = np.arcsin(np.clip(d[..., 1], -1, 1))
        lon = np.arctan2(d[..., 2], d[..., 0])
        step = np.radians(12)
        dl = np.abs((lat / step + 0.5) % 1 - 0.5) * step
        dm = np.abs((lon / step + 0.5) % 1 - 0.5) * step * np.cos(lat)
        w = 0.0035
        gl = smooth(w * 2.2, w * 0.6, dl)
        gm = smooth(w * 2.2, w * 0.6, dm) * smooth(0.97, 0.9, np.abs(d[..., 1]))
        cy, mg = hexc(pal['path']), hexc(pal['pathDark'])
        col = col * (1 - 0.6 * np.maximum(gl, gm)[..., None]) + (gl[..., None] * cy + gm[..., None] * mg) * 0.35
        emis_rgb = gl[..., None] * cy + gm[..., None] * mg
        # Halo doux autour des lignes
        emis_rgb = emis_rgb + (smooth(w * 7, w, dl)[..., None] * cy + (smooth(w * 7, w, dm) * smooth(0.97, 0.9, np.abs(d[..., 1])))[..., None] * mg) * 0.25
        emis = emis_rgb
    elif kind == 'sage':
        # Route jaune autour de l'équateur (décor : on roule où l'on veut) et prés dorés
        band = np.abs(d[..., 1] + 0.04 * (nz.fbm(d * 3 + 7, 2) - 0.5))
        paint(band < 0.11, pal['pathDark'], 10, smooth(0.115, 0.1, band) * 0.85)
        paint(band < 0.095, pal['path'], 11, smooth(0.098, 0.088, band))
        mead = nz.fbm(d * 2.6 + 7, 3)
        paint((mead > 0.68) & (band > 0.13), pal['accent2'], 12, smooth(0.68, 0.7, mead) * 0.6 * (band > 0.13))
    elif kind == 'ocean':
        # Grand océan : uniquement de l'eau (hauts-fonds, vaguelettes, écume)
        w = nz.fbm(d * 1.7 + 5, 5)
        deep, mid, light = hexc(pal['dark']), hexc(pal['mid']), hexc(pal['light'])
        col = lerp(lerp(deep, mid, smooth(0.42, 0.5, w)), light, smooth(0.6, 0.68, w))
        wave = np.sin(d @ np.array([3.0, 41.0, 7.0]) + 9 * nz.fbm(d * 3 + 50, 2)) * np.sin(d @ np.array([37.0, 5.0, 11.0]) + 6 * nz.fbm(d * 4 + 90, 2))
        streak = smooth(0.82, 0.9, wave)
        col = col * (1 - 0.5 * streak[..., None]) + np.ones(3) * 0.5 * streak[..., None]
        foam = nz.fbm(d * 6 + 300, 3)
        col = col + (smooth(0.74, 0.8, foam) * 0.35)[..., None]
        cls = np.zeros(d.shape[:-1], int)
        surf[:] = SURF_WATER
    elif kind == 'champi':
        # Collines rondes (taches plus sombres avec reflet)
        hills = nz.fbm(d * 3.0 + 60, 3)
        paint(hills > 0.6, pal['dark'], 5, smooth(0.6, 0.615, hills))
        paint(hills > 0.66, pal['mid'], 6, smooth(0.66, 0.675, hills) * 0.8)
        dirt = nz.fbm(d * 3.4 + 300, 3)
        paint(dirt > 0.72, pal['path'], 10, smooth(0.715, 0.73, dirt))
    elif kind == 'cubes':
        h = nz.fbm(d * 2.0 + 30, 4)
        dirt = nz.fbm(d * 3.0 + 70, 3)
        stone = nz.fbm(d * 3.5 + 110, 3)
        col = lerp(hexc(pal['mid']), hexc(pal['light']), (h > 0.55).astype(float))
        col = np.where((dirt > 0.62)[..., None], hexc(pal['path']), col)
        col = np.where((stone > 0.68)[..., None], hexc(pal['accent2']), col)
        sand = (h > 0.37) & (h < 0.41)
        water = h <= 0.37
        col = np.where(sand[..., None], np.array([0.89, 0.83, 0.6]), col)
        col = np.where(water[..., None], hexc(pal['accent1']), col)
        cls = np.where(water, 30, np.where(sand, 31, cls))
        surf[water] = SURF_WATER
        surf[(dirt > 0.62) & ~water & ~sand] = SURF_PATH
    elif kind == 'petitprince':
        # Astéroïde B 612 : sable doré, dunes douces, petits cratères ronds
        dune = np.sin(d @ np.array([2.0, 9.0, 3.0]) * 3 + 6 * nz.fbm(d * 2 + 4, 3))
        paint(dune > 0.75, pal['light'], 5, smooth(0.72, 0.8, dune) * 0.6)
        pts = sphere_points(9, 612)
        rad = np.random.default_rng(613).uniform(0.09, 0.18, 9)
        ci, cr = spots(d, pts, rad)
        hit = ci >= 0
        paint(hit & (cr > 0.72), pal['pathDark'], 10, (smooth(0.7, 0.78, cr) * smooth(1.0, 0.94, cr)) * hit * 0.9)
        paint(hit & (cr <= 0.72), pal['path'], 11, smooth(0.74, 0.66, cr) * hit * 0.8)
    elif kind == 'candy':
        # Glaçage rose ondulé et flaques de chocolat (sans petits points)
        swirl = nz.fbm(d * 2.0 + 2.5 * nz.fbm(d * 1.5 + 4, 2)[..., None], 3)
        col = lerp(col, hexc(pal['light']), smooth(0.55, 0.6, swirl) * 0.8)
        choc = nz.fbm(d * 2.4 + 33, 4)
        paint(choc > 0.69, pal['pathDark'], 10, smooth(0.685, 0.7, choc))
        paint(choc > 0.71, pal['path'], 11, smooth(0.705, 0.72, choc))
        gloss = (choc > 0.735) & (choc < 0.745)
        paint(gloss, '#a0644a', 12, gloss * 0.8)
    elif kind == 'futur':
        # Banlieue : pelouses, massifs de fleurs, haies et places pavées (taches, aucune rue)
        bed = nz.fbm(d * 6 + 20, 2)
        paint(bed > 0.7, '#4f9a3a', 13, smooth(0.7, 0.72, bed))
        plaza = nz.fbm(d * 2.8 + 120, 3)
        cell = np.floor(d * 120)
        tile = ((cell.sum(-1)) % 2)[..., None]
        pc = lerp(hexc(pal['accent2']), hexc('#c8c2b4'), tile[..., 0])
        a = smooth(0.7, 0.715, plaza)[..., None]
        col = col * (1 - a) + pc * a
        cls = np.where(plaza > 0.7, 10, cls)
        flowers = nz.fbm(d * 9 + 60, 2)
        paint((flowers > 0.74) & (plaza < 0.69), '#e05a6a', 14, smooth(0.74, 0.75, flowers) * 0.9)
        # Rue de Hill Valley qui fait le tour : trottoirs, asphalte, ligne jaune pointillée
        band = road_band(d, nz, 0.09, 0.05)
        lon = np.arctan2(d[..., 2], d[..., 0])
        paint(band < 0.1, '#d8d2c4', 15, smooth(0.102, 0.096, band))
        paint(band < 0.082, '#4a4a52', 16, smooth(0.084, 0.078, band))
        dash = (band < 0.006) & ((np.floor(lon * 30) % 2) == 0)
        paint(dash, '#f2c230', 17, dash * 1.0)
        surf[band < 0.082] = SURF_PATH
    elif kind == 'comte':
        # Bocage : champs en patchwork bordés de haies, chemins creux, mare
        pts = sphere_points(46, 1937)
        cell, edge = voronoi(d, pts)
        fields = [pal['light'], pal['mid'], pal['accent2'], pal['dark'], '#c8dc6a', '#9fd060', '#e6c55a']
        h = (cell * 7919) % len(fields)
        for k, c in enumerate(fields):
            m = h == k
            col = np.where(m[..., None], hexc(c) * (0.97 + 0.06 * (nz.fbm(d * 18 + k, 2)[..., None] - 0.5)), col)
        # Sillons dans les champs dorés
        furrow = np.sin(d @ np.array([31.0, 17.0, 23.0]) + cell) > 0.6
        col = np.where(((h == 2) | (h == 6))[..., None] & furrow[..., None], col * 0.9, col)
        cls = (h + 50).astype(int)
        paint(edge < 0.022, pal['pathDark'], 10, smooth(0.024, 0.016, edge))  # haies
        pond = nz.fbm(d * 3 + 400, 3)
        paint(pond > 0.74, '#5fb4e6', 12, smooth(0.74, 0.75, pond))
        surf[pond > 0.74] = SURF_WATER
        # Chemin creux de la Comté (terre, bordé d'herbe haute)
        band = road_band(d, nz, 0.12, 0.05, 4.0)
        paint(band < 0.075, '#3f7a2e', 13, smooth(0.078, 0.07, band))
        paint(band < 0.06, pal['path'], 14, smooth(0.062, 0.056, band))
        surf[band < 0.06] = SURF_PATH
    elif kind == 'herbes':
        # Route de départ : herbe claire, hautes herbes en touffes, routes de terre, mares
        tall = nz.fbm(d * 3.6 + 500, 3)
        tg = tall > 0.6
        blades = np.sin(d @ np.array([0.0, 140.0, 0.0]) + np.sin(d @ np.array([90.0, 0.0, 70.0])) * 2.0)
        bcol = np.where((blades > 0.3)[..., None], hexc(pal['dark']), hexc(pal['accent2']))
        a = smooth(0.6, 0.615, tall)[..., None]
        col = col * (1 - a) + bcol * a
        cls = np.where(tg, 5, cls)
        surf[tg] = SURF_GRASS
        dirt = nz.fbm(d * 3.2 + 260, 3)
        paint((dirt > 0.72) & ~tg, pal['pathDark'], 10, smooth(0.715, 0.73, dirt) * ~tg)
        paint((dirt > 0.74) & ~tg, pal['path'], 11, smooth(0.735, 0.75, dirt) * ~tg)
        pond = nz.fbm(d * 2.6 + 700, 3)
        paint(pond > 0.73, '#bfe8ff', 12, smooth(0.728, 0.735, pond))
        paint(pond > 0.74, '#3f9ce8', 13, smooth(0.74, 0.75, pond))
        surf[pond > 0.74] = SURF_WATER
    elif kind == 'enchante':
        # Royaume enchanté : prairies émeraude, prés de fleurs roses, lacs bleus
        mead = nz.fbm(d * 2.8 + 800, 3)
        paint(mead > 0.62, pal['accent2'], 5, smooth(0.62, 0.64, mead) * 0.85)
        lake = nz.fbm(d * 2.4 + 900, 3)
        paint(lake > 0.71, '#d8f4ff', 10, smooth(0.708, 0.716, lake))
        paint(lake > 0.72, '#4aa8ff', 11, smooth(0.72, 0.73, lake))
        surf[lake > 0.72] = SURF_WATER
        gold = nz.fbm(d * 5 + 950, 2)
        paint((gold > 0.74) & (lake < 0.7), pal['path'], 12, smooth(0.74, 0.75, gold) * 0.85)
    elif kind == 'moquette':
        # Moquette de chambre d'enfant (fibres) et un tapis de couloir qui fait le tour
        fib = nz.fbm(d * 140 + 3, 2)
        tuft = nz.fbm(d * 18 + 9, 2)
        col = col * (0.9 + 0.16 * fib[..., None]) * (0.95 + 0.1 * tuft[..., None])
        band = road_band(d, nz, 0.1, 0.04)
        run = band < 0.1
        lon = np.arctan2(d[..., 2], d[..., 0])
        # Motif de losanges et bordures à franges
        u = lon * 18
        v = (band / 0.1) * 2.2
        diamond = (np.abs((u % 2) - 1) + np.abs(v % 2 - 1)) < 0.55
        border = (band > 0.075) & run
        fringe = (band >= 0.1) & (band < 0.108) & ((np.floor(lon * 220) % 2) == 0)
        rc = np.where(diamond[..., None], hexc(pal['accent1']), hexc(pal['pathDark']))
        rc = np.where(border[..., None], hexc(pal['path']), rc) * (0.9 + 0.16 * fib[..., None])
        col = np.where(run[..., None], rc, col)
        col = np.where(fringe[..., None], hexc('#f4ead2'), col)
        cls = np.where(run | fringe, 10, 0)
        surf[run] = SURF_PATH
    elif kind == 'arcenciel':
        # Planète de verre (on voit l'espace et la face opposée au travers) et deux
        # tronçons de route arc-en-ciel bien droits (grand cercle du départ), qui accélèrent
        x = d[..., 0]
        phi = np.arctan2(d[..., 2], d[..., 1])
        w = 0.1
        L = 1.05
        over = np.minimum(np.maximum(np.abs(phi) - L, 0), np.maximum(np.abs(np.abs(phi) - np.pi) - L, 0))
        dist = np.sqrt(x * x + over * over)
        road = dist < w
        t = np.clip(x / w * 0.5 + 0.5, 0, 1)
        hh = ((t * 0.82)[..., None] * 6 + np.array([0.0, 4.0, 2.0])) % 6
        rb = np.clip(np.abs(hh - 3) - 1, 0, 1) * 0.85 + 0.15
        seam = (np.abs((phi / 0.07) - np.round(phi / 0.07)) < 0.08)
        rail = dist > w * 0.86
        rc = np.where(seam[..., None], rb * 0.7, rb)
        rc = np.where(rail[..., None], np.array([1.0, 0.97, 0.9]), rc)
        glass = lerp(hexc('#0a0a2a'), hexc('#24206a'), smooth(0.35, 0.75, nz.fbm(d * 2.5 + 3, 3)))
        col = np.where(road[..., None], rc, glass)
        emis = road[..., None] * (rc * 0.75 + rail[..., None] * 0.5)
        cls = np.where(road, 40, 0)
        surf[road] = SURF_PATH
    elif kind == 'wario':
        # Stade de terre : boue, bosses de terre claire, flaques
        mud = nz.fbm(d * 3.5 + 20, 4)
        col = lerp(hexc('#4a2e1a'), hexc('#6a4428'), smooth(0.35, 0.65, mud))
        bump = nz.fbm(d * 6 + 40, 3)
        col = lerp(col, hexc('#b07a44'), smooth(0.58, 0.66, bump) * 0.85)
        pud = nz.fbm(d * 5 + 90, 3)
        col = np.where((pud > 0.68)[..., None], hexc('#2e1c10'), col)
        col = np.where(((pud > 0.68) & (pud < 0.695))[..., None], hexc('#8a6a4a'), col)
        surf[pud > 0.68] = SURF_WATER
        cls = np.where(pud > 0.68, 10, 0)
    elif kind == 'bowser':
        # Pavés de pierre clairs (grille 3D) et une seule route de lave qui fait le tour
        emis = np.zeros(d.shape)
        g = d * 24
        fr = np.abs(g - np.round(g))
        grout = np.min(np.where(np.abs(d) > 0.5, 9, fr), axis=-1) < 0.07
        stone = lerp(hexc('#8e8894'), hexc('#b0aab6'), smooth(0.3, 0.7, nz.fbm(np.floor(g) * 0.37, 2)))
        col = np.where(grout[..., None], hexc('#5e5864'), stone)
        band = road_band(d, nz, 0.12, 0.06)
        flow = nz.fbm(d * 9 + 5, 3)
        lava = band < 0.075
        lc = lerp(hexc('#ff4a08'), hexc('#ffd040'), smooth(0.4, 0.75, flow) * smooth(0.075, 0.02, band))
        rim = (band >= 0.075) & (band < 0.095)
        col = np.where(rim[..., None], hexc('#3a2a2e'), col)
        col = np.where(lava[..., None], lc, col)
        emis = emis + lava[..., None] * lc + (rim * 0.25)[..., None] * hexc('#ff6a20')
        surf[lava] = SURF_LAVA
        cls = np.where(lava, 10, np.where(rim, 11, 0))
    elif kind == 'circuit':
        # Pelouse de stade en damier tondu (grille 3D) et massifs de fleurs
        q = np.floor(d * 7)
        chk = (q.sum(-1) % 2)
        col = lerp(hexc('#5cc84a'), hexc('#7ad85a'), chk) * (1 + 0.06 * (nz.fbm(d * 6, 2)[..., None] - 0.5))
        bed = nz.fbm(d * 5 + 70, 3)
        paint(bed > 0.72, '#3fa83a', 10, smooth(0.72, 0.73, bed))
    elif kind == 'fantome':
        # Eau sombre violette à rides et radeaux de planches (taches)
        rip = np.sin(d @ np.array([40.0, 13.0, 27.0]) + 8 * nz.fbm(d * 3 + 40, 2))
        col = lerp(hexc('#1c1838'), hexc('#2e2858'), smooth(0.3, 0.7, nz.fbm(d * 2.5 + 7, 3)))
        col = col + (smooth(0.85, 0.95, rip) * 0.12)[..., None] * np.array([0.6, 0.6, 1.0])
        surf[:] = SURF_WATER
        raft = nz.fbm(d * 3.2 + 500, 3)
        on = raft > 0.66
        pl_i = np.floor(d @ np.array([0.0, 60.0, 34.0]))
        hp = (np.sin(pl_i * 12.9898) * 43758.5453) % 1
        woods = np.stack([hexc('#b98a5a'), hexc('#a87a4a'), hexc('#c89a6a')])
        pc = woods[(hp * 3).astype(int) % 3]
        gap = ((d @ np.array([0.0, 60.0, 34.0])) % 1) < 0.1
        pc = np.where(gap[..., None], hexc('#3a2a1a'), pc)
        edge = on & (raft < 0.675)
        col = np.where(on[..., None], pc, col)
        col = np.where(edge[..., None], hexc('#5a3a22'), col)
        surf[on] = SURF_GROUND
        cls = np.where(on, 10, 0)
        emis = np.zeros(d.shape) + on[..., None] * pc * 0.08
    elif kind == 'naine':
        # Planète bonbon : taches tourbillonnantes (aucune rayure)
        sw = nz.fbm(d * 3.0 + 3 * nz.fbm(d * 2 + 9, 2)[..., None], 3)
        paint(sw > 0.6, pal['path'], 10, smooth(0.6, 0.63, sw))
    elif kind == 'poudlard':
        # Hautes terres : herbe sombre, bruyère violette, rochers, lac noir
        heath = nz.fbm(d * 3.0 + 10, 3)
        paint(heath > 0.64, pal['accent2'], 5, smooth(0.64, 0.66, heath) * 0.8)
        rock = nz.fbm(d * 4.2 + 40, 3)
        paint(rock > 0.7, pal['path'], 10, smooth(0.7, 0.71, rock))
        paint(rock > 0.74, pal['pathDark'], 11, smooth(0.74, 0.75, rock) * 0.6)
        lake = nz.fbm(d * 2.2 + 70, 3)
        paint(lake > 0.71, '#2a3a4a', 12, smooth(0.71, 0.72, lake))
        paint(lake > 0.72, '#14202e', 13, smooth(0.72, 0.73, lake))
        surf[lake > 0.72] = SURF_WATER
    elif kind == 'halloween':
        # Ville d'Halloween : terre violacée, herbe morte, champs de citrouilles, brume
        dead = nz.fbm(d * 7 + 5, 2)
        col = col * (0.9 + 0.2 * dead[..., None])
        field = nz.fbm(d * 2.6 + 30, 3)
        paint(field > 0.68, pal['path'], 10, smooth(0.68, 0.7, field))
        rows = (np.sin(d @ np.array([60.0, 11.0, 37.0])) > 0.6) & (field > 0.7)
        paint(rows, pal['pathDark'], 11, rows * 0.8)
        # Chemin pavé tortueux qui fait le tour de la ville
        band = road_band(d, nz, 0.14, 0.07, 2.1)
        g = d * 70
        fr = np.abs(g - np.round(g))
        joint = np.min(np.where(np.abs(d) > 0.5, 9, fr), axis=-1)
        cob = lerp(hexc('#6e6478'), hexc('#8a8094'), smooth(0.3, 0.7, nz.fbm(np.floor(g) * 0.29, 2)))
        cob = np.where((joint < 0.1)[..., None], hexc('#3a3240'), cob)
        a = smooth(0.082, 0.074, band)[..., None]
        col = col * (1 - a) + cob * a
        cls = np.where(band < 0.078, 12, cls)
        surf[band < 0.078] = SURF_PATH
        mist = nz.fbm(d * 1.8 + 90, 3)
        col = col + (smooth(0.6, 0.75, mist) * 0.12)[..., None] * np.array([0.6, 0.7, 0.8])
    elif kind == 'noel':
        # Neige épaisse, ombres bleutées, plaques de glace et paillettes
        drift = nz.fbm(d * 2.5 + 5, 4)
        col = lerp(hexc(pal['dark']), hexc(pal['light']), smooth(0.35, 0.65, drift))
        ice = nz.fbm(d * 3.0 + 50, 3)
        paint(ice > 0.71, pal['path'], 10, smooth(0.71, 0.72, ice))
        surf[ice > 0.71] = SURF_ICE
    elif kind == 'meuh':
        # Prairie Meuh Meuh : herbe éclatante, bosquets de fleurs, coins de terre battue
        mead = nz.fbm(d * 2.4 + 3, 3)
        paint(mead > 0.64, pal['accent2'], 5, smooth(0.64, 0.66, mead) * 0.5)
        dirt = nz.fbm(d * 3.6 + 200, 3)
        paint(dirt > 0.73, pal['path'], 10, smooth(0.725, 0.74, dirt))
        # Chemin de terre qui serpente autour de la prairie (traces de roues)
        band = road_band(d, nz, 0.13, 0.06, 0.7)
        paint(band < 0.085, pal['path'], 11, smooth(0.088, 0.078, band))
        ruts = (np.abs(band - 0.035) < 0.008)
        paint(ruts & (band < 0.085), pal['pathDark'], 12, ruts * 0.6)
        surf[band < 0.085] = SURF_PATH
    # Petits points (fleurs, cristaux, paillettes) sur une grille 3D
    cell = np.floor(d * 34)
    h = np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
    h = h - np.floor(h)
    center = (cell + 0.5) / 34
    dist = np.linalg.norm(d - center / np.linalg.norm(center, axis=-1, keepdims=True), axis=-1)
    density = {'prairie': 0.05, 'emeraude': 0.02, 'banquise': 0.03, 'volcan': 0.0, 'naine': 0.05, 'ocean': 0.0, 'cubes': 0.0, 'sage': 0.04, 'champi': 0.05,
               'petitprince': 0.02, 'candy': 0.0, 'futur': 0.02, 'comte': 0.03, 'herbes': 0.04, 'enchante': 0.08, 'nuages': 0.0,
               'arcenciel': 0.0, 'wario': 0.0, 'bowser': 0.0, 'circuit': 0.03, 'fantome': 0.0,
               'moquette': 0.0, 'poudlard': 0.02, 'halloween': 0.015, 'noel': 0.06, 'meuh': 0.07}.get(kind, 0.03)
    dots = (dist < 0.009) & (h < density) & (cls <= 2)
    soft = smooth(0.009, 0.004, dist) * 0.85
    paint(dots & (h < density / 2), pal['accent1'], 20, soft * (dots & (h < density / 2)))
    paint(dots & (h >= density / 2), pal['accent2'], 21, soft * (dots & (h >= density / 2)))
    if kind == 'cubes':
        # Grain « pixel art » : variation par petit pixel de bloc
        pq = np.floor(d * 160)
        ph = np.sin(pq @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
        ph = ph - np.floor(ph)
        col = col * (0.9 + 0.18 * ph[..., None])
    return cls, col, emis, surf


def smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a: np.ndarray, b: np.ndarray, t: np.ndarray) -> np.ndarray:
    return a + (b - a) * np.asarray(t)[..., None]


def outline(cls: np.ndarray, col: np.ndarray, line: str, width: int = 1) -> np.ndarray:
    """Contour sombre aux frontières de régions (style dessin animé)."""
    edge = np.zeros(cls.shape, bool)
    for ax in (0, 1):
        for s in range(1, width + 1):
            edge |= cls != np.roll(cls, s, axis=ax)
            edge |= cls != np.roll(cls, -s, axis=ax)
    # Pas de contour entre les nuances d'herbe proches (seulement aplats ↔ motifs)
    def sft(c: np.ndarray) -> np.ndarray:
        return (c <= 2) | (c >= 20)
    soft = sft(cls) & sft(np.roll(cls, 1, 0)) & sft(np.roll(cls, 1, 1)) & sft(np.roll(cls, -1, 0)) & sft(np.roll(cls, -1, 1))
    lc = hexc(line)
    out = np.where((edge & ~soft)[..., None], lc, col)
    # Liseré léger entre nuances d'herbe
    out = np.where((edge & soft)[..., None], col * 0.88 + lc * 0.12, out)
    return out


def to_img(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))


def surface_map(pl: dict, out: str, nz: 'Noise3 | None' = None) -> str:
    """Carte de surface équirectangulaire (1024 × 512) lue par le jeu : 0 sol, 1 eau,
    2 lave, 3 glace, 4 chemin, 5 hautes herbes (× SURF_SCALE)."""
    nz = nz or Noise3(sum(map(ord, pl['id'])) * 7919)
    lat = (0.5 - (np.arange(512) + 0.5) / 512) * np.pi
    lon = ((np.arange(1024) + 0.5) / 1024) * 2 * np.pi - np.pi
    lo, la = np.meshgrid(lon, lat)
    dd = np.stack([np.cos(la) * np.cos(lo), np.sin(la), np.cos(la) * np.sin(lo)], -1)
    surf = pattern_full(dd, pl, nz)[3]
    fn = f"planet_{pl['id']}_surface.png"
    Image.fromarray((surf * SURF_SCALE).astype(np.uint8)).save(os.path.join(out, fn), optimize=True)
    return fn


def planet(pl: dict, out: str, size: int = 512) -> dict:
    nz = Noise3(sum(map(ord, pl['id'])) * 7919)  # graine stable par planète
    files = {}
    emissive = pl['pattern'] in ('volcan', 'neon') or 'emis' in pl
    glass = bool(pl.get('glass'))
    esize = 512 if pl['pattern'] == 'neon' or 'emis' in pl else 256
    for f in FACES:
        d = face_dirs(f, size)
        cls, col, emis = pattern(d, pl, nz)
        rgb = col  # pas de contour noir : rendu « film d'animation » (cel-shading doux)
        fn = f"planet_{pl['id']}_{f}.jpg"
        to_img(rgb).save(os.path.join(out, fn), quality=88, optimize=True)
        files[f] = fn
        if emissive:
            arr = emis if emis.ndim == 3 else emis[..., None] * np.ones(3)
            e = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).resize((esize, esize), Image.BILINEAR)
            efn = f"planet_{pl['id']}_e_{f}.jpg"
            e.save(os.path.join(out, efn), quality=88)
            files['e_' + f] = efn
        if glass:
            # Masque d'opacité (planète de verre) : 255 sur la route, 0 sur le verre
            mfn = f"planet_{pl['id']}_m_{f}.png"
            Image.fromarray(((cls >= 40) * 255).astype(np.uint8)).resize((256, 256), Image.BILINEAR).save(os.path.join(out, mfn), optimize=True)
            files['m_' + f] = mfn
    files['surface'] = surface_map(pl, out, nz)
    # Aperçu : sphère éclairée façon cel-shading
    n = 256
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n * 2 - 1
    r2 = x * x + y * y
    inside = r2 < 0.86 ** 2
    zz = np.sqrt(np.clip(0.86 ** 2 - r2, 0, None))
    nrm = np.stack([x, -y, zz], -1) / 0.86
    a = 0.6
    rot = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    tilt = np.array([[1, 0, 0], [0, np.cos(0.5), -np.sin(0.5)], [0, np.sin(0.5), np.cos(0.5)]])
    d = nrm @ (rot @ tilt).T
    cls, col, emis = pattern(d, pl, nz)
    light = np.array([-0.5, 0.6, 0.62])
    light /= np.linalg.norm(light)
    ndl = nrm @ light
    lit = smooth(-0.05, 0.12, ndl)[..., None]
    shadow = col * np.array([0.55, 0.6, 0.8])
    em = emis if emis.ndim == 3 else emis[..., None] * hexc(pl['palette']['path'])
    rgb = shadow + (col - shadow) * lit + em * (1.0 if emis.ndim == 3 else 0.5)
    rim = smooth(0.6, 0.86, np.sqrt(r2))[..., None] * 0.35
    rgb = rgb + rim * hexc(pl['atmosphere'])
    atm = hexc(pl['atmosphere'])
    rr = np.sqrt(r2)
    glow = np.clip(1 - np.abs(rr - 0.9) / 0.1, 0, 1) ** 2
    img = np.zeros((n, n, 4))
    img[..., :3] = atm
    img[..., 3] = glow * 0.75
    img[inside, :3] = rgb[inside]
    img[inside, 3] = 1
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, f"planet_{pl['id']}_preview.png"), optimize=True)
    files['preview'] = f"planet_{pl['id']}_preview.png"
    print('   planète', pl['id'])
    return files


def space(out: str, size: int = 512) -> dict:
    """Ciel spatial : nébuleuse colorée (les étoiles sont des points 3D au runtime)."""
    nz = Noise3(2024)
    files = {}
    for f in FACES:
        d = face_dirs(f, size)
        n1 = nz.fbm(d * 1.6 + 2, 5)
        n2 = nz.fbm(d * 2.4 + 40, 4)
        n3 = nz.fbm(d * 5.0 + 80, 3)
        neb = np.clip((n1 - 0.45) * 2.2, 0, 1) ** 1.6 * (0.6 + 0.6 * n3)
        neb2 = np.clip((n2 - 0.5) * 2.5, 0, 1) ** 2
        col = np.array([0.012, 0.014, 0.04]) + neb[..., None] * np.array([0.36, 0.13, 0.55]) + neb2[..., None] * np.array([0.06, 0.30, 0.42])
        col += np.clip(d[..., 1:2] * 0.5 + 0.5, 0, 1) * np.array([0.01, 0.015, 0.03])
        rgb = col  # étoiles rendues en 3D (nettes à toute résolution)
        fn = f'space_{f}.jpg'
        to_img(rgb ** (1 / 1.0)).save(os.path.join(out, fn), quality=88, optimize=True)
        files[f] = fn
    print('   ciel spatial')
    return files


def sky_db(out: str, size: int = 256) -> dict:
    """Ciel doré de l'au-delà : dégradé jaune-orangé et nuages roses."""
    nz = Noise3(77)
    files = {}
    for f in FACES:
        d = face_dirs(f, size)
        y = d[..., 1:2]
        col = lerp(hexc('#f7b955'), hexc('#fff0b0'), np.clip(y[..., 0] * 0.8 + 0.5, 0, 1))
        c = nz.fbm(d * np.array([2.2, 4.5, 2.2]) + 10, 5)
        puff = smooth(0.5, 0.62, c)[..., None]
        col = col * (1 - puff * 0.75) + (hexc('#f6a6c8') * 0.75 + hexc('#fff') * 0.25) * puff * 0.75
        fn = f'sky_db_{f}.jpg'
        to_img(col).save(os.path.join(out, fn), quality=86, optimize=True)
        files[f] = fn
    print('   ciel doré')
    return files


def sky_red(out: str, size: int = 256) -> dict:
    """Ciel de forteresse : rouge sombre, nuées de fumée et lueurs de braise."""
    nz = Noise3(666)
    files = {}
    for f in FACES:
        d = face_dirs(f, size)
        y = d[..., 1]
        col = lerp(hexc('#1a0608'), hexc('#5a1410'), np.clip(0.55 - y * 0.6, 0, 1))
        c = nz.fbm(d * np.array([2.0, 4.0, 2.0]) + 5, 5)
        col = col * (1 - smooth(0.5, 0.7, c)[..., None] * 0.6) + smooth(0.62, 0.75, c)[..., None] * hexc('#ff6a2a') * 0.18
        fn = f'sky_red_{f}.jpg'
        to_img(col).save(os.path.join(out, fn), quality=86, optimize=True)
        files[f] = fn
    print('   ciel rouge')
    return files


def sky_generic(out: str, name: str, fn, size: int = 256) -> dict:
    files = {}
    nz = Noise3(len(name) * 101)
    for f in FACES:
        d = face_dirs(f, size)
        col = fn(d, nz)
        fname = f'sky_{name}_{f}.jpg'
        to_img(col).save(os.path.join(out, fname), quality=86, optimize=True)
        files[f] = fname
    print('   ciel', name)
    return files


def _sky_clouds(d, nz):
    """Ciel bleu et gros nuages de dessin animé (bulles blanches ombrées)."""
    y = d[..., 1]
    col = lerp(hexc('#5aa8f0'), hexc('#bfe4ff'), np.clip(0.6 - y * 0.6, 0, 1))
    pts = sphere_points(60, 404)
    rng = np.random.default_rng(405)
    c = np.zeros(d.shape[:-1])
    sh = np.zeros(d.shape[:-1])
    for i in range(60):
        base = pts[i]
        t = np.cross(base, [0, 1, 0])
        t = t / (np.linalg.norm(t) + 1e-9)
        r = rng.uniform(0.08, 0.16)
        for off, rr, lift in ((0, 1.0, 0.3), (-1.1, 0.75, 0), (1.1, 0.7, 0), (0.5, 0.8, 0.5)):
            cen = base + t * off * r + (np.array([0, 1, 0]) - base * base[1]) * lift * r
            cen = cen / np.linalg.norm(cen)
            ang = np.arccos(np.clip(d @ cen, -1, 1))
            c = np.maximum(c, smooth(r * rr, r * rr * 0.93, ang))
            cen2 = base + t * off * r - (np.array([0, 1, 0]) - base * base[1]) * 0.25 * r
            cen2 = cen2 / np.linalg.norm(cen2)
            sh = np.maximum(sh, smooth(r * rr, r * rr * 0.93, np.arccos(np.clip(d @ cen2, -1, 1))))
    cloud = lerp(hexc('#dbe8f8'), hexc('#ffffff'), np.clip(c - 0.6 * sh + 0.6, 0, 1))
    return lerp(col, cloud, c)


def _sky_halloween(d, nz):
    """Nuit d'Halloween : bleu-vert sombre, grosse lune pâle, nuées."""
    y = d[..., 1]
    col = lerp(hexc('#0e1a24'), hexc('#2a3a48'), np.clip(0.5 - y * 0.5, 0, 1))
    moon = np.array([0.35, 0.55, -0.76])
    moon = moon / np.linalg.norm(moon)
    a = np.arccos(np.clip(d @ moon, -1, 1))
    disc = smooth(0.2, 0.19, a)
    crater = nz.fbm(d * 18 + 4, 3)
    mc = lerp(hexc('#e8e4c8'), hexc('#fffbe6'), crater)
    col = col + smooth(0.6, 0.18, a)[..., None] * np.array([0.25, 0.28, 0.22])
    col = lerp(col, mc, disc)
    wisp = nz.fbm(d * np.array([2.0, 5.0, 2.0]) + 7, 4)
    col = col * (1 - smooth(0.55, 0.7, wisp)[..., None] * 0.5 * (1 - disc[..., None]))
    return col


def _sky_xmas(d, nz):
    """Nuit de Noël : bleu profond, aurore verte et violette, flocons."""
    y = d[..., 1]
    col = lerp(hexc('#081830'), hexc('#1c3a66'), np.clip(0.5 - y * 0.5, 0, 1))
    band = nz.fbm(d * np.array([1.5, 6.0, 1.5]) + 11, 4)
    au = smooth(0.55, 0.72, band) * np.clip(y * 1.5 + 0.2, 0, 1)
    col = col + au[..., None] * (np.array([0.2, 0.9, 0.5]) * 0.5 + np.array([0.5, 0.2, 0.7]) * 0.2 * smooth(0.65, 0.8, band)[..., None])
    cell = np.floor(d * 70)
    hh = (np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453) % 1
    cen = (cell + 0.5) / 70
    sd = np.linalg.norm(d - cen / np.linalg.norm(cen, axis=-1, keepdims=True), axis=-1)
    col = col + (smooth(0.0035, 0.001, sd) * (hh < 0.12))[..., None] * 0.8
    return col


def main(src: str, out: str, only: list[str] | None = None) -> dict:
    """Génère tout, ou seulement les planètes `only` (le ciel n'est alors pas régénéré)."""
    os.makedirs(out, exist_ok=True)
    data = json.load(open(src, encoding='utf-8'))
    result = {'planets': {}} if only else {'space': space(out), 'skyDb': sky_db(out), 'planets': {}}
    for pl in data['planets']:
        if pl.get('style') == 'toon' and (not only or pl['id'] in only):
            result['planets'][pl['id']] = planet(pl, out)
    return result


if __name__ == '__main__':
    print(json.dumps(main(sys.argv[1], sys.argv[2]), indent=1)[:300])
