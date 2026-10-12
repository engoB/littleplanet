"""Compose l'icône du jeu à partir d'un rendu du moteur (tools/render_icon.mjs).

  python3 tools/icon_compose.py rendu.png public/icons

Ajoute au rendu : nébuleuse douce, traînées lumineuses des réacteurs, petit
météore enflammé ; écrit les icônes PWA (192, 512, maskable, apple-touch).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def glow_line(size, pts, width, color, blur):
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    n = len(pts)
    for i in range(n - 1):
        t = 1 - i / (n - 1)
        w = max(1, int(width * t))
        a = int(255 * t)
        d.line([pts[i], pts[i + 1]], fill=color + (a,), width=w)
    return layer.filter(ImageFilter.GaussianBlur(blur)), layer


def main(src, out):
    im = Image.open(src).convert('RGB').resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    h, w = a.shape[:2]
    y, x = (np.mgrid[0:h, 0:w] + 0.5) / h
    # Nébuleuse : deux halos colorés, uniquement là où le ciel est sombre
    neb = (np.exp(-((x - 0.18) ** 2 + (y - 0.12) ** 2) / 0.09)[..., None] * np.array([0.42, 0.16, 0.62])
           + np.exp(-((x - 0.9) ** 2 + (y - 0.35) ** 2) / 0.05)[..., None] * np.array([0.08, 0.32, 0.5]))
    dark = np.clip(1 - a.max(-1, keepdims=True) * 3, 0, 1)
    a = a + neb * dark * 0.8
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
    # Traînées des réacteurs (vers l'arrière, à gauche) et météore en haut à droite
    trails = Image.new('RGBA', img.size, (0, 0, 0, 0))
    for (nx, ny) in [(318, 312), (492, 292)]:
        pts = [(nx - i * 26, ny + i * 3.2 + (i * i) * 0.25) for i in range(13)]
        g, core = glow_line(img.size, pts, 34, (90, 220, 255), 14)
        trails = Image.alpha_composite(trails, g)
        c2, core2 = glow_line(img.size, pts, 12, (230, 250, 255), 3)
        trails = Image.alpha_composite(trails, c2)
    mx, my = 900, 70
    pts = [(mx + i * 24, my - i * 13) for i in range(9)]
    g, _ = glow_line(img.size, pts, 30, (255, 150, 40), 10)
    trails = Image.alpha_composite(trails, g)
    c2, _ = glow_line(img.size, pts, 10, (255, 236, 170), 2)
    trails = Image.alpha_composite(trails, c2)
    d = ImageDraw.Draw(trails)
    d.ellipse([mx - 15, my - 15, mx + 15, my + 15], fill=(255, 240, 200, 255))
    # Les traînées passent derrière la voiture : masque des pixels clairs du véhicule
    car = np.asarray(img).astype(np.float32)
    lum = car[..., :3].mean(-1)
    sat = car[..., :3].max(-1) - car[..., :3].min(-1)
    region = np.zeros(lum.shape, bool)
    region[150:400, 300:860] = True
    mask = ((lum > 150) | (sat > 90)) & region
    tr = np.asarray(trails).copy()
    tr[mask, 3] = 0
    trails = Image.fromarray(tr)
    img = Image.alpha_composite(img, trails).convert('RGB')
    # Vignette légère
    v = np.asarray(img).astype(np.float32) / 255
    r = np.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2)
    v *= (1 - np.clip((r - 0.45) * 0.9, 0, 0.35))[..., None]
    img = Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8))
    os.makedirs(out, exist_ok=True)
    for size in (192, 512):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon-{size}.png'), optimize=True)
    # Maskable : la voiture et la planète restent dans la zone sûre (cercle de 80 %)
    m = Image.new('RGB', (1024, 1024), tuple(int(c) for c in np.asarray(img)[:16].reshape(-1, 3).mean(0)))
    m.paste(img.resize((880, 880), Image.LANCZOS), (72, 72))
    m.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-maskable-512.png'), optimize=True)
    img.resize((180, 180), Image.LANCZOS).save(os.path.join(out, 'apple-touch-icon.png'), optimize=True)
    print('icônes écrites dans', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
