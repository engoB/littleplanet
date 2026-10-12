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
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255


def pattern(d: np.ndarray, pl: dict, nz: Noise3) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Classe de région (entier), couleur RGB, émission [0,1] pour des directions d."""
    pal = pl['palette']
    kind = pl['pattern']
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
        sec = nz.fbm(d * 3.3 + 40, 3)
        far = smooth(0.13, 0.16, band)
        paint((sec > 0.68) & (band > 0.14), pal['pathDark'], 12, smooth(0.675, 0.69, sec) * far * 0.7)
        paint((sec > 0.71) & (band > 0.14), pal['path'], 13, smooth(0.705, 0.72, sec) * far)
    elif kind == 'emeraude':
        w = nz.fbm(d * 2.6 + 70, 4)
        paint(w < 0.33, pal['accent1'], 10, smooth(0.335, 0.32, w) * 0.8)
        paint(w < 0.31, pal['path'], 11, smooth(0.315, 0.3, w))
        paint(w < 0.24, pal['pathDark'], 12, smooth(0.25, 0.22, w))
    elif kind == 'banquise':
        w = nz.fbm(d * 2.4 + 90, 4)
        paint(w < 0.36, pal['path'], 10, smooth(0.365, 0.35, w))
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
    elif kind == 'naine':
        sv = np.sin(d[..., 1] * 18 + 3 * nz.fbm(d * 3, 2))
        paint(sv > 0.55, pal['path'], 10, smooth(0.5, 0.62, sv))
    # Petits points (fleurs, cristaux, paillettes) sur une grille 3D
    cell = np.floor(d * 34)
    h = np.sin(cell @ np.array([12.9898, 78.233, 37.719])) * 43758.5453
    h = h - np.floor(h)
    center = (cell + 0.5) / 34
    dist = np.linalg.norm(d - center / np.linalg.norm(center, axis=-1, keepdims=True), axis=-1)
    density = {'prairie': 0.05, 'emeraude': 0.02, 'banquise': 0.03, 'volcan': 0.0, 'naine': 0.05}.get(kind, 0.03)
    dots = (dist < 0.009) & (h < density) & (cls <= 2)
    soft = smooth(0.009, 0.004, dist) * 0.85
    paint(dots & (h < density / 2), pal['accent1'], 20, soft * (dots & (h < density / 2)))
    paint(dots & (h >= density / 2), pal['accent2'], 21, soft * (dots & (h >= density / 2)))
    return cls, col, emis


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


def planet(pl: dict, out: str, size: int = 512) -> dict:
    nz = Noise3(sum(map(ord, pl['id'])) * 7919)  # graine stable par planète
    files = {}
    emissive = pl['pattern'] == 'volcan'
    for f in FACES:
        d = face_dirs(f, size)
        cls, col, emis = pattern(d, pl, nz)
        rgb = col  # pas de contour noir : rendu « film d'animation » (cel-shading doux)
        fn = f"planet_{pl['id']}_{f}.jpg"
        to_img(rgb).save(os.path.join(out, fn), quality=88, optimize=True)
        files[f] = fn
        if emissive:
            e = Image.fromarray((emis * 255).astype(np.uint8)).resize((256, 256), Image.BILINEAR)
            efn = f"planet_{pl['id']}_e_{f}.jpg"
            e.convert('RGB').save(os.path.join(out, efn), quality=85)
            files['e_' + f] = efn
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
    rgb = shadow + (col - shadow) * lit + emis[..., None] * hexc(pl['palette']['path']) * 0.5
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


def main(src: str, out: str) -> dict:
    os.makedirs(out, exist_ok=True)
    data = json.load(open(src, encoding='utf-8'))
    result = {'space': space(out), 'planets': {}}
    for pl in data['planets']:
        if pl.get('style') == 'toon':
            result['planets'][pl['id']] = planet(pl, out)
    return result


if __name__ == '__main__':
    print(json.dumps(main(sys.argv[1], sys.argv[2]), indent=1)[:300])
