"""Composition des illustrations du tutoriel (rendus du moteur, voir render_tuto.mjs).
    python3 tools/tuto_compose.py [.cache/tuto] [public/tuto]
Images 2:1 (720 × 360), JPEG ; la planche « ramasser » assemble quatre gros plans."""
import os
import sys

from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else '.cache/tuto'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/tuto'
W, H = 720, 360


def cover(im: Image.Image, w: int, h: int) -> Image.Image:
    """Recadre au centre pour remplir w × h."""
    k = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def save(im: Image.Image, name: str) -> None:
    im.convert('RGB').save(os.path.join(OUT, name + '.jpg'), quality=82, optimize=True, progressive=True)


os.makedirs(OUT, exist_ok=True)
for n in ('histoire', 'eviter', 'progresser'):
    save(cover(Image.open(os.path.join(SRC, n + '.png')), W, H), n)
# Piloter : capture portrait (HUD compris) au centre, fond flou de la même image
p = Image.open(os.path.join(SRC, 'piloter.png')).convert('RGB')
bg = cover(p, W, H).filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v * 0.55))
ph = p.resize((round(p.width * H / p.height), H), Image.LANCZOS)
bg.paste(ph, ((W - ph.width) // 2, 0))
save(bg, 'piloter')
# Ramasser : 2 × 2 gros plans (caisse, basket, accélérateur, ressort)
sheet = Image.new('RGB', (W, H))
for i, n in enumerate(('box', 'item', 'pad', 'spring')):
    tile = cover(Image.open(os.path.join(SRC, f'obj_{n}.png')), W // 2, H // 2)
    sheet.paste(tile, ((i % 2) * (W // 2), (i // 2) * (H // 2)))
save(sheet, 'ramasser')
print('tutoriel :', OUT)
