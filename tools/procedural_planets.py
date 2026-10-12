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


SURF_GROUND, SURF_WATER, SURF_LAVA, SURF_ICE, SURF_PATH, SURF_GRASS, SURF_OFFROAD, SURF_BOOST = 0, 1, 2, 3, 4, 5, 6, 7
# Carte de surface : valeur du pixel = classe × SURF_SCALE (lue par le jeu)
SURF_SCALE = 30

# Repère des pistes : la voiture part de (0, 1, 0) en regardant vers +Z
T_E1, T_E2, T_N = np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0]), np.array([1.0, 0.0, 0.0])


def track_fields(d: np.ndarray, tr: dict) -> tuple[np.ndarray, np.ndarray]:
    """Piste en boucle autour de la planète : latitude f(φ) dans le repère de départ.
    Renvoie la distance signée à l'axe de la piste (radians) et l'abscisse φ (−π..π).
    Même formule que src/game/track.ts."""
    a, b, c = (tr['wave'] + [0, 0, 0])[:3]
    phi = np.arctan2(d @ T_E2, d @ T_E1)
    lat = np.arcsin(np.clip(d @ T_N, -1, 1))
    f = a * np.sin(2 * phi) + b * np.sin(3 * phi) + c * np.sin(5 * phi)
    fp = 2 * a * np.cos(2 * phi) + 3 * b * np.cos(3 * phi) + 5 * c * np.cos(5 * phi)
    cl = np.cos(lat)
    return (lat - f) * cl / np.sqrt(fp * fp + cl * cl), phi


def ang_diff(a: np.ndarray, b: float) -> np.ndarray:
    return (a - b + np.pi) % (2 * np.pi) - np.pi


def paint_track_marks(d, tr, dist, phi, col, emis_rgb, surf, chevron='#ffb400', chevron2='#ffe46a'):
    """Ligne de départ en damier et accélérateurs (chevrons) ; renvoie col, emis, masques."""
    w = tr['width']
    ad = np.abs(dist)
    on = ad < w
    # Damier de départ/arrivée juste derrière la voiture
    sl = (np.abs(ang_diff(phi, -0.02)) < 0.022) & on
    chk = ((np.floor((phi + 0.042) / 0.011) + np.floor((dist + w) / 0.011)) % 2) == 0
    col = np.where((sl & chk)[..., None], np.array([0.97, 0.97, 0.97]), np.where(sl[..., None], np.array([0.08, 0.08, 0.1]), col))
    emis_rgb = emis_rgb + (sl & chk)[..., None] * 0.15
    # Accélérateurs : chevrons pointant vers l'avant
    boost = np.zeros(d.shape[:-1], bool)
    for pb in tr.get('boosts', []):
        da = ang_diff(phi, pb)
        m = (np.abs(da) < 0.055) & (ad < w * 0.55)
        v = (da * 40 - np.abs(dist) * 35) % 1.0
        stripe = v < 0.5
        cc = np.where(stripe[..., None], hexc(chevron2), hexc(chevron))
        col = np.where(m[..., None], cc, col)
        emis_rgb = emis_rgb + m[..., None] * cc * 0.9
        boost |= m
    surf[boost] = SURF_BOOST
    return col, emis_rgb, boost


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
        axis = np.array([0.25, 0.15, 0.96])
        axis /= np.linalg.norm(axis)
        band = np.abs(d @ axis) + 0.035 * (nz.fbm(d * 4 + 5, 2) - 0.5)
        paint(band < 0.12, pal['pathDark'], 10, smooth(0.125, 0.112, band) * 0.8)
        paint(band < 0.10, pal['path'], 11, smooth(0.104, 0.094, band))
        surf[band < 0.11] = SURF_PATH
        sec = nz.fbm(d * 3.3 + 40, 3)
        far = smooth(0.13, 0.16, band)
        paint((sec > 0.68) & (band > 0.14), pal['pathDark'], 12, smooth(0.675, 0.69, sec) * far * 0.7)
        paint((sec > 0.71) & (band > 0.14), pal['path'], 13, smooth(0.705, 0.72, sec) * far)
    elif kind == 'emeraude':
        w = nz.fbm(d * 2.6 + 70, 4)
        paint(w < 0.33, pal['accent1'], 10, smooth(0.335, 0.32, w) * 0.8)
        paint(w < 0.31, pal['path'], 11, smooth(0.315, 0.3, w))
        paint(w < 0.24, pal['pathDark'], 12, smooth(0.25, 0.22, w))
        surf[w < 0.31] = SURF_WATER
    elif kind == 'banquise':
        w = nz.fbm(d * 2.4 + 90, 4)
        paint(w < 0.36, pal['path'], 10, smooth(0.365, 0.35, w))
        surf[w < 0.36] = SURF_ICE
        paint(w < 0.27, pal['pathDark'], 11, smooth(0.28, 0.255, w) * 0.7)
        r = 1 - np.abs(2 * nz.fbm(d * 5 + 120, 3) - 1)
        paint((r > 0.93) & (w >= 0.36), pal['pathDark'], 12, smooth(0.925, 0.95, r) * smooth(0.36, 0.38, w) * 0.5)
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
        # Route jaune autour de l'équateur (planète d'entraînement)
        band = np.abs(d[..., 1] + 0.04 * (nz.fbm(d * 3 + 7, 2) - 0.5))
        paint(band < 0.11, pal['pathDark'], 10, smooth(0.115, 0.1, band) * 0.85)
        paint(band < 0.095, pal['path'], 11, smooth(0.098, 0.088, band))
        surf[band < 0.1] = SURF_PATH
    elif kind == 'ocean':
        # Océan, hauts-fonds, écume et îles de sable et d'herbe
        w = nz.fbm(d * 1.7 + 5, 5)
        deep, mid, light = hexc(pal['dark']), hexc(pal['mid']), hexc(pal['light'])
        col = lerp(lerp(deep, mid, smooth(0.42, 0.5, w)), light, smooth(0.57, 0.62, w))
        # Vaguelettes stylisées
        wave = np.sin(d @ np.array([3.0, 41.0, 7.0]) + 9 * nz.fbm(d * 3 + 50, 2)) * np.sin(d @ np.array([37.0, 5.0, 11.0]) + 6 * nz.fbm(d * 4 + 90, 2))
        streak = smooth(0.82, 0.9, wave) * smooth(0.6, 0.5, w)
        col = col * (1 - 0.5 * streak[..., None]) + np.ones(3) * 0.5 * streak[..., None]
        cls = np.zeros(d.shape[:-1], int)
        surf[:] = SURF_WATER
        paint(np.abs(w - 0.635) < 0.012, pal['accent1'], 9, smooth(0.012, 0.004, np.abs(w - 0.635)))
        paint(w > 0.64, pal['path'], 10, smooth(0.64, 0.648, w))
        paint(w > 0.675, pal['accent2'], 11, smooth(0.675, 0.685, w))
        surf[w > 0.64] = SURF_GROUND
    elif kind == 'champi':
        # Collines rondes (taches plus sombres avec reflet), chemins de terre
        hills = nz.fbm(d * 3.0 + 60, 3)
        paint(hills > 0.6, pal['dark'], 5, smooth(0.6, 0.615, hills))
        paint(hills > 0.66, pal['mid'], 6, smooth(0.66, 0.675, hills) * 0.8)
        axis = np.array([0.6, 0.5, 0.62])
        axis /= np.linalg.norm(axis)
        band = np.abs(d @ axis) + 0.03 * (nz.fbm(d * 4 + 5, 2) - 0.5)
        paint(band < 0.1, pal['pathDark'], 10, smooth(0.105, 0.092, band))
        paint(band < 0.085, pal['path'], 11, smooth(0.088, 0.078, band))
        surf[band < 0.09] = SURF_PATH
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
        # Glaçage rose, rivière de chocolat, gros bonbons ronds et vermicelles
        axis = np.array([0.3, 0.8, 0.5])
        axis /= np.linalg.norm(axis)
        band = np.abs(d @ axis + 0.07 * np.sin(d @ np.array([0.0, 2.0, 9.0]) * 0.9)) + 0.02 * (nz.fbm(d * 3, 2) - 0.5)
        paint(band < 0.12, pal['pathDark'], 10, smooth(0.125, 0.112, band))
        paint(band < 0.1, pal['path'], 11, smooth(0.104, 0.094, band))
        ribbon = smooth(0.02, 0.0, np.abs(band - 0.05)) * (band < 0.1)
        col = col * (1 - 0.35 * ribbon[..., None]) + 0.35 * ribbon[..., None] * np.array([0.75, 0.5, 0.35])
        surf[band < 0.1] = SURF_PATH
        candies = ['#ff3b4e', '#ff9a1f', '#ffe14d', '#3fd65a', '#3a8bff', '#a54dff']
        pts = sphere_points(70, 77)
        ci, cr = spots(d, pts, np.full(70, 0.07))
        ok = (ci >= 0) & (band > 0.14)
        for k, c in enumerate(candies):
            m = ok & (ci % len(candies) == k)
            paint(m, c, 30 + k, smooth(1.0, 0.9, cr) * m)
        # Reflet blanc en haut à gauche de chaque bonbon
        paint(ok & (cr < 0.35), '#ffffff', 36, smooth(0.35, 0.2, cr) * ok * 0.55)
        cell = np.floor(d * 70)
        hh = np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
        hh = hh - np.floor(hh)
        cen = (cell + 0.5) / 70
        dist = np.linalg.norm(d - cen / np.linalg.norm(cen, axis=-1, keepdims=True), axis=-1)
        spr = (dist < 0.0045) & (hh < 0.07) & (cls <= 2)
        for k, c in enumerate(candies):
            m = spr & (np.floor(hh * 100) % 6 == k)
            paint(m, c, 40 + k, m * 0.9)
    elif kind == 'futur':
        # Banlieue des années 50/80 : pelouses, rues en damier (asphalte, trottoirs, tirets jaunes)
        lat = np.arcsin(np.clip(d[..., 1], -1, 1))
        lon = np.arctan2(d[..., 2], d[..., 0])
        step = np.radians(30)
        dl = np.abs((lat / step + 0.5) % 1 - 0.5) * step
        dm = np.abs((lon / step + 0.5) % 1 - 0.5) * step * np.cos(lat)
        dm = np.where(np.abs(d[..., 1]) > 0.93, 9, dm)  # pas de méridiens aux pôles
        road = np.minimum(dl, dm)
        paint(road < 0.075, pal['accent2'], 10, smooth(0.077, 0.07, road))  # trottoir
        paint(road < 0.06, pal['path'], 11, smooth(0.062, 0.056, road))  # asphalte
        surf[road < 0.06] = SURF_PATH
        dash_l = (dl < 0.005) & (np.sin(lon * 60) > 0.2) & (dl <= dm)
        dash_m = (dm < 0.005) & (np.sin(lat * 60) > 0.2) & (dm < dl)
        paint(dash_l | dash_m, pal['pathDark'], 12)
        # Parterres de fleurs et allées dans les pâtés de maisons
        bed = nz.fbm(d * 6 + 20, 2)
        paint((bed > 0.7) & (road > 0.09), '#4f9a3a', 13, smooth(0.7, 0.72, bed) * (road > 0.09))
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
        lane = np.abs(d @ (np.array([0.2, 0.9, 0.4]) / np.linalg.norm([0.2, 0.9, 0.4])) + 0.06 * np.sin(d[..., 0] * 7)) 
        paint(lane < 0.05, pal['path'], 11, smooth(0.052, 0.045, lane))
        surf[lane < 0.05] = SURF_PATH
        pond = nz.fbm(d * 3 + 400, 3)
        paint(pond > 0.74, '#5fb4e6', 12, smooth(0.74, 0.75, pond))
        surf[pond > 0.74] = SURF_WATER
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
        for ax, w in ((np.array([0.1, 0.3, 0.95]), 0.085), (np.array([0.9, 0.2, -0.3]), 0.07)):
            ax = ax / np.linalg.norm(ax)
            band = np.abs(d @ ax) + 0.03 * (nz.fbm(d * 4 + ax[0] * 9, 2) - 0.5)
            paint(band < w, pal['pathDark'], 10, smooth(w + 0.006, w - 0.004, band))
            paint(band < w - 0.014, pal['path'], 11, smooth(w - 0.012, w - 0.02, band))
            surf[band < w - 0.014] = SURF_PATH
        pond = nz.fbm(d * 2.6 + 700, 3)
        paint(pond > 0.73, '#bfe8ff', 12, smooth(0.728, 0.735, pond))
        paint(pond > 0.74, '#3f9ce8', 13, smooth(0.74, 0.75, pond))
        surf[pond > 0.74] = SURF_WATER
    elif kind == 'enchante':
        # Royaume enchanté : prairies émeraude, prés de fleurs roses, douves bleues, allée dorée
        mead = nz.fbm(d * 2.8 + 800, 3)
        paint(mead > 0.62, pal['accent2'], 5, smooth(0.62, 0.64, mead) * 0.85)
        w = np.abs(d @ np.array([0.0, 1.0, 0.0]) - 0.35 + 0.05 * np.sin(d[..., 0] * 9) * np.cos(d[..., 2] * 7))
        paint(w < 0.07, '#d8f4ff', 10, smooth(0.072, 0.064, w))
        paint(w < 0.055, '#4aa8ff', 11, smooth(0.057, 0.05, w))
        surf[w < 0.055] = SURF_WATER
        band = np.abs(d @ np.array([0.0, 0.0, 1.0]) + 0.04 * (nz.fbm(d * 4, 2) - 0.5))
        paint(band < 0.06, pal['pathDark'], 12, smooth(0.064, 0.056, band))
        paint(band < 0.046, pal['path'], 13, smooth(0.049, 0.043, band))
        surf[(band < 0.046) & (w >= 0.055)] = SURF_PATH
    elif kind == 'nuages':
        # Papier peint de chambre d'enfant : ciel bleu et gros nuages blancs dessinés
        pts = sphere_points(46, 1995)
        c = np.zeros(d.shape[:-1])
        rng = np.random.default_rng(1996)
        for i in range(46):
            # Nuage = trois bulles (centre + deux côtés), ombre bleutée en dessous
            base = pts[i]
            t = np.cross(base, [0, 1, 0])
            t = t / (np.linalg.norm(t) + 1e-9)
            r = rng.uniform(0.09, 0.15)
            for off, rr in ((0, 1.0), (-1.1, 0.75), (1.1, 0.7), (0.5, 0.8)):
                cen = base + t * off * r + (np.array([0, 1, 0]) - base * base[1]) * (0.35 * r if off == 0.5 else 0)
                cen = cen / np.linalg.norm(cen)
                ang = np.arccos(np.clip(d @ cen, -1, 1))
                c = np.maximum(c, smooth(r * rr, r * rr * 0.92, ang))
        shadow = np.zeros_like(c)
        paint(c > 0.5, pal['accent1'], 10, c * 0.98)
        cls = np.where(c > 0.5, 10, 0)
    elif kind in ('arcenciel', 'wario', 'bowser', 'circuit', 'fantome'):
        tr = pl['track']
        w = tr['width']
        dist, phi = track_fields(d, tr)
        ad = np.abs(dist)
        on = ad < w
        across = np.clip((dist / w + 1) / 2, 0, 1)
        emis = np.zeros(d.shape)
        cls = np.where(on, 10, 0)
        surf[:] = SURF_OFFROAD
        surf[on] = SURF_PATH
        if kind == 'arcenciel':
            # Route arc-en-ciel sur fond d'espace : bandes de couleurs, rails lumineux
            neb = nz.fbm(d * 2.5 + 3, 4)
            col = lerp(hexc('#07061e'), hexc('#1a1450'), smooth(0.4, 0.7, neb))
            col = col + (smooth(0.6, 0.8, nz.fbm(d * 4 + 70, 3)) [..., None] * np.array([0.12, 0.03, 0.18]))
            cell = np.floor(d * 90)
            hh = np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
            hh = hh - np.floor(hh)
            cen = (cell + 0.5) / 90
            sd = np.linalg.norm(d - cen / np.linalg.norm(cen, axis=-1, keepdims=True), axis=-1)
            star = smooth(0.006, 0.002, sd) * (hh < 0.12)
            col = col + star[..., None] * 0.9
            emis = emis + star[..., None] * 0.6
            rb = ['#ff4a5a', '#ff9a3a', '#ffe24a', '#5ae26a', '#3ac8ff', '#5a7aff', '#b05aff']
            band = np.minimum(6, np.floor(across * 7)).astype(int)
            rc = np.stack([hexc(c) for c in rb])[band]
            seg = (np.floor(phi / 0.05) % 2)[..., None]
            rc = rc * (0.88 + 0.12 * seg)
            col = np.where(on[..., None], rc, col)
            emis = emis + on[..., None] * rc * 0.55
            rail = (ad > w - 0.012) & (ad < w + 0.004)
            col = np.where(rail[..., None], np.array([1.0, 1.0, 1.0]), col)
            emis = emis + rail[..., None] * 1.0
            col, emis, _ = paint_track_marks(d, tr, dist, phi, col, emis, surf)
        elif kind == 'wario':
            mud = nz.fbm(d * 3.5 + 20, 4)
            col = lerp(hexc('#4a2e1a'), hexc('#6a4428'), smooth(0.35, 0.65, mud))
            pud = nz.fbm(d * 5 + 90, 3)
            col = np.where((pud > 0.66)[..., None], hexc('#2e1c10'), col)
            col = np.where(((pud > 0.66) & (pud < 0.68))[..., None], hexc('#8a6a4a'), col)
            dirt = lerp(hexc('#b07a44'), hexc('#c8905a'), smooth(0.3, 0.7, nz.fbm(d * 9 + 5, 3)))
            mog = 0.5 + 0.5 * np.sin(phi * 70)
            dirt = dirt * (0.9 + 0.12 * mog[..., None])
            rut = (np.abs(np.abs(dist) - w * 0.45) < 0.008)
            dirt = np.where(rut[..., None], dirt * 0.72, dirt)
            col = np.where(on[..., None], dirt, col)
            line = (ad > w - 0.012) & (ad < w - 0.004)
            col = np.where(line[..., None], np.array([0.95, 0.95, 0.92]), col)
            tires = (ad >= w) & (ad < w + 0.026)
            tq = ((phi / 0.026) % 1 - 0.5) ** 2 + (((ad - w) / 0.026) - 0.5) ** 2
            tcol = np.where((tq < 0.06)[..., None], np.array([0.42, 0.42, 0.45]), np.array([0.09, 0.09, 0.1]))
            col = np.where(tires[..., None], tcol, col)
            col, emis, _ = paint_track_marks(d, tr, dist, phi, col, emis, surf)
        elif kind == 'bowser':
            # Dalles de pierre sombres, fissures de lave ; piste en briques claires
            r = 1 - np.abs(2 * nz.fbm(d * 3.0 + 150, 4) - 1)
            lat = np.arcsin(np.clip(d @ T_N, -1, 1))
            row = np.floor(lat / 0.03)
            brick_u = (phi / 0.05 + 0.5 * (row % 2)) % 1
            brick_v = (lat / 0.03) % 1
            grout = (brick_u < 0.06) | (brick_v < 0.1)
            stone = lerp(hexc('#3a3438'), hexc('#4a4248'), smooth(0.3, 0.7, nz.fbm(d * 8 + 3, 3)))
            col = np.where(grout[..., None], hexc('#221e22'), stone)
            lava = (r > 0.965) & (ad > w + 0.06)
            lc = lerp(hexc('#ff5a10'), hexc('#ffd040'), smooth(0.965, 0.99, r))
            col = np.where(lava[..., None], lc, col)
            emis = emis + lava[..., None] * lc
            surf[lava] = SURF_LAVA
            road = lerp(hexc('#9a96a0'), hexc('#b8b4bc'), smooth(0.3, 0.7, nz.fbm(d * 10 + 8, 3)))
            road = np.where(grout[..., None], hexc('#6a666e'), road)
            col = np.where(on[..., None], road, col)
            edge = (ad > w - 0.014) & (ad < w + 0.008)
            col = np.where(edge[..., None], hexc('#8a1a1a'), col)
            gold = (ad > w - 0.016) & (ad < w - 0.012)
            col = np.where(gold[..., None], hexc('#ffc93a'), col)
            col, emis, _ = paint_track_marks(d, tr, dist, phi, col, emis, surf)
        elif kind == 'circuit':
            # Herbe tondue en bandes, asphalte, vibreurs rouge et blanc
            mow = np.floor(np.abs(dist) / 0.05) % 2  # tonte parallèle à la piste
            col = lerp(hexc('#5cc84a'), hexc('#7ad85a'), mow) * (1 + 0.06 * (nz.fbm(d * 6, 2)[..., None] - 0.5))
            asphalt = hexc('#5c6068') * (0.95 + 0.1 * nz.fbm(d * 30 + 1, 2)[..., None])
            col = np.where(on[..., None], asphalt, col)
            wl = (ad > w - 0.016) & (ad < w - 0.01)
            col = np.where(wl[..., None], np.array([0.96, 0.96, 0.96]), col)
            curb = (ad >= w - 0.006) & (ad < w + 0.022)
            cc = np.where(((np.floor(phi / 0.028) % 2) == 0)[..., None], hexc('#e8333a'), np.array([0.97, 0.97, 0.97]))
            col = np.where(curb[..., None], cc, col)
            surf[curb] = SURF_PATH
            col, emis, _ = paint_track_marks(d, tr, dist, phi, col, emis, surf)
        elif kind == 'fantome':
            # Eau sombre violette à rides ; pont de planches de bois
            rip = np.sin(d @ np.array([40.0, 13.0, 27.0]) + 8 * nz.fbm(d * 3 + 40, 2))
            col = lerp(hexc('#1c1838'), hexc('#2e2858'), smooth(0.3, 0.7, nz.fbm(d * 2.5 + 7, 3)))
            col = col + (smooth(0.85, 0.95, rip) * 0.12)[..., None] * np.array([0.6, 0.6, 1.0])
            plank = np.floor(phi / 0.024)
            hp = np.sin(plank * 12.9898) * 43758.5453
            hp = hp - np.floor(hp)
            woods = np.stack([hexc('#b98a5a'), hexc('#a87a4a'), hexc('#c89a6a')])
            pc = woods[(hp * 3).astype(int) % 3] * (0.92 + 0.12 * nz.fbm(d * 40 + 2, 2)[..., None])
            gap = ((phi / 0.024) % 1) < 0.1
            pc = np.where(gap[..., None], hexc('#3a2a1a'), pc)
            nail = (np.abs(((phi / 0.024) % 1) - 0.5) < 0.08) & (np.abs(ad - w * 0.8) < 0.004)
            pc = np.where(nail[..., None], hexc('#3a3a3a'), pc)
            col = np.where(on[..., None], pc, col)
            beam = (ad > w - 0.012) & (ad < w + 0.006)
            col = np.where(beam[..., None], hexc('#5a3a22'), col)
            emis = emis + on[..., None] * pc * 0.08
            col, emis, _ = paint_track_marks(d, tr, dist, phi, col, emis, surf)
    elif kind == 'naine':
        sv = np.sin(d[..., 1] * 18 + 3 * nz.fbm(d * 3, 2))
        paint(sv > 0.55, pal['path'], 10, smooth(0.5, 0.62, sv))
    # Petits points (fleurs, cristaux, paillettes) sur une grille 3D
    cell = np.floor(d * 34)
    h = np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
    h = h - np.floor(h)
    center = (cell + 0.5) / 34
    dist = np.linalg.norm(d - center / np.linalg.norm(center, axis=-1, keepdims=True), axis=-1)
    density = {'prairie': 0.05, 'emeraude': 0.02, 'banquise': 0.03, 'volcan': 0.0, 'naine': 0.05, 'ocean': 0.0, 'cubes': 0.0, 'sage': 0.04, 'champi': 0.05,
               'petitprince': 0.02, 'candy': 0.0, 'futur': 0.02, 'comte': 0.03, 'herbes': 0.04, 'enchante': 0.08, 'nuages': 0.0,
               'arcenciel': 0.0, 'wario': 0.0, 'bowser': 0.0, 'circuit': 0.03, 'fantome': 0.0}.get(kind, 0.03)
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
    2 lave, 3 glace, 4 chemin, 5 hautes herbes, 6 hors-piste, 7 accélérateur (× SURF_SCALE)."""
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
