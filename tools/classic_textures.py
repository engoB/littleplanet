"""Textures de la planète classique (écran titre), tirées du projet Unity d'origine :
herbe réaliste (Texture_Grass_Diffuse), terre du chemin (Texture_Dirt_Diffuse),
brins d'herbe (Brush_Grass_01). Réduites et compressées pour le web.
    python3 tools/classic_textures.py <projet Unity> <public/textures>"""
import os
import sys

from PIL import Image

SRC = [
    ('Graphics/Textures/Texture_Grass_Diffuse.png', 'classic_grass.jpg', 1024),
    ('Graphics/Textures/Texture_Dirt_Diffuse.png', 'classic_dirt.jpg', 512),
]


def main(project: str, out: str) -> None:
    assets = os.path.join(project, 'Assets')
    os.makedirs(out, exist_ok=True)
    for src, dst, size in SRC:
        im = Image.open(os.path.join(assets, src)).convert('RGB').resize((size, size), Image.LANCZOS)
        im.save(os.path.join(out, dst), quality=86, optimize=True, progressive=True)
        print('   ', dst, os.path.getsize(os.path.join(out, dst)) // 1024, 'Ko')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
