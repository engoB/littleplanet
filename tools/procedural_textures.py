"""Textures nouvelles générées procéduralement (numpy).

Toutes les textures de surface sont périodiques (raccord parfait en U et V)
et livrées avec leur carte de normales :
  - planet_detail_n.png : relief fin du sol de la planète (préréglage Arcade) ;
  - crater.png / crater_n.png : brûlure + creux d'impact de météore ;
  - fx_ring.png, fx_dot.png : sprites de l'atlas de particules (anneau
    procédural de « cfxr proc ring », point doux).

Usage : python tools/procedural_textures.py <dossier de sortie>
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

RNG = np.random.default_rng(20240425)  # graine fixe : sortie reproductible


def value_noise(size: int, cells: int) -> np.ndarray:
    """Bruit de valeurs périodique : grille aléatoire cells×cells repliée sur
    elle-même, interpolée en smoothstep (raccord exact en U et V)."""
    g = RNG.random((cells, cells))
    t = np.arange(size) / size * cells
    i0 = np.floor(t).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = t - np.floor(t)
    f = f * f * (3 - 2 * f)
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


def periodic_noise(size: int, octaves: int = 5, base: int = 4, persistence: float = 0.55) -> np.ndarray:
    """Bruit fractal périodique (somme d'octaves de bruit de valeurs)."""
    h = np.zeros((size, size))
    amp = 1.0
    for o in range(octaves):
        h += amp * value_noise(size, base * 2 ** o)
        amp *= persistence
    h -= h.min()
    return h / (h.max() + 1e-9)


def normal_map(h: np.ndarray, strength: float) -> np.ndarray:
    """Carte de normales (espace tangent, convention OpenGL / three.js)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def save(arr: np.ndarray, path: str) -> None:
    Image.fromarray(arr).save(path, optimize=True)
    print('  ', os.path.basename(path), arr.shape)


def main(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    # 1. Relief du sol (périodique)
    h = periodic_noise(512, octaves=5, base=3)
    save(normal_map(h, 6.0), os.path.join(out, 'planet_detail_n.png'))

    # 2. Cratère : creux radial bruité, bord surélevé, brûlure sombre
    s = 256
    y, x = (np.mgrid[0:s, 0:s] + 0.5) / s * 2 - 1
    r = np.sqrt(x * x + y * y)
    ang = np.arctan2(y, x)
    wobble = 0.05 * np.sin(3 * ang + 1.3) + 0.03 * np.sin(7 * ang + 0.4)
    rr = r / (0.82 + wobble)
    n = periodic_noise(s, octaves=4, base=4)
    bowl = -np.clip(1 - rr ** 2, 0, 1) ** 1.5
    rim = 0.35 * np.exp(-((rr - 1.0) / 0.12) ** 2)
    height = bowl + rim + 0.08 * (n - 0.5) * (rr < 1.3)
    save(normal_map(height, 18.0), os.path.join(out, 'crater_n.png'))
    burn = np.clip(1.15 - rr, 0, 1) ** 0.6
    alpha = np.clip((1.35 - rr) / 0.35, 0, 1) * (0.75 + 0.25 * n)
    col = np.dstack([0.16 + 0.10 * n, 0.11 + 0.06 * n, 0.07 + 0.04 * n]) * (1 - 0.55 * burn[..., None])
    glow = np.clip(1 - r / 0.3, 0, 1) ** 2
    col[..., 0] += 0.55 * glow
    col[..., 1] += 0.18 * glow
    rgba = np.dstack([np.clip(col, 0, 1), alpha])
    save((rgba * 255).astype(np.uint8), os.path.join(out, 'crater.png'))

    # 3. Sprites FX (canal unique → alpha, RGB blanc)
    s = 256
    y, x = (np.mgrid[0:s, 0:s] + 0.5) / s * 2 - 1
    r = np.sqrt(x * x + y * y)
    ring = np.exp(-((r - 0.78) / 0.09) ** 2) * (r < 1)
    save(np.dstack([np.full((s, s, 3), 255, np.uint8), (ring * 255).astype(np.uint8)]), os.path.join(out, 'fx_ring.png'))
    s = 128
    y, x = (np.mgrid[0:s, 0:s] + 0.5) / s * 2 - 1
    r = np.sqrt(x * x + y * y)
    dot = np.clip(1 - r, 0, 1) ** 2
    save(np.dstack([np.full((s, s, 3), 255, np.uint8), (dot * 255).astype(np.uint8)]), os.path.join(out, 'fx_dot.png'))


if __name__ == '__main__':
    main(sys.argv[1])
