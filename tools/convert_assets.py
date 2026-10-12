"""Conversion des assets Unity pour le web.

  - modèles FBX → GLB (FBX2glTF), Collada → GLB (tools/dae2glb.py) ;
  - textures réduites à 1024 px max (PSD aplatis en PNG, opaques en JPG) ;
  - skybox en croix horizontale → 6 faces ;
  - atlas des textures de particules (une seule texture pour un seul Points) ;
  - sons WAV/MP3 → MP3 (lecture iOS / Android / desktop) ;
  - polices TextMeshPro : contrôle des métriques verticales (fonttools) ;
  - icônes PWA depuis Graphics/Icon.png.

Usage : python tools/convert_assets.py <projet Unity> <dossier public/> <FBX2glTF>
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dae2glb  # noqa: E402
import procedural_audio  # noqa: E402
import procedural_planets  # noqa: E402
import procedural_textures  # noqa: E402

MAX_TEX = 1024
# Textures secondaires des shaders CFXR (dissolution, distorsion UV) non portées
SKIP_TEXTURES = {'cfxr smoke cloud x4 dissolve', 'cfxr uv distortion fire smudge'}
# Sons supplémentaires du projet utilisés par le préréglage Arcade
EXTRA_AUDIO = ['Graphics/Audio/Click.wav', 'Graphics/Audio/Skid.wav', 'Graphics/Audio/Joyful Jubilation_1.mp3']

# Atlas FX 1024×1024 : nom de texture → rectangle en pixels (x, y, l, h)
# « single » : texture à canal unique (R → alpha, RGB blanc) comme le mot-clé
# _CFXR_SINGLE_CHANNEL des shaders Cartoon FX Remaster.
ATLAS = {
    'cfxr smoke cloud x4': ((0, 0, 512, 512), False),
    'cfxr spikes impact': ((512, 0, 256, 256), True),
    'fx_ring': ((768, 0, 256, 256), False),
    'CFX2_T_Glow': ((512, 256, 256, 256), False),
    'CFX_T_RayRounded': ((768, 256, 256, 256), False),
    'cfxr flamme blur': ((0, 512, 128, 256), True),
    'cfxr ember blur': ((128, 512, 256, 128), True),
    'fx_dot': ((128, 640, 128, 128), False),
    'cfxr stretch trait': ((384, 512, 512, 128), True),
    'cfxr stretch smoke fume': ((384, 640, 512, 128), True),
}


def stem(p: str) -> str:
    return os.path.splitext(os.path.basename(p))[0]


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def convert_models(assets: str, out: str, scene: dict, fbx2gltf: str) -> None:
    os.makedirs(os.path.join(out, 'models'), exist_ok=True)
    for name, m in scene['models'].items():
        src = os.path.join(assets, m['source'])
        dst = os.path.join(out, 'models', name + '.glb')
        if src.lower().endswith('.dae'):
            dae2glb.convert(src, dst)
        else:
            run([fbx2gltf, '--binary', '--input', src, '--output', dst[:-4]])
        print('  modèle', name, os.path.getsize(dst) // 1024, 'Ko')


def save_texture(img: Image.Image, dst_base: str) -> str:
    if max(img.size) > MAX_TEX:
        r = MAX_TEX / max(img.size)
        img = img.resize((max(1, round(img.size[0] * r)), max(1, round(img.size[1] * r))), Image.LANCZOS)
    has_alpha = img.mode in ('RGBA', 'LA') and np.asarray(img.convert('RGBA'))[..., 3].min() < 255
    if has_alpha:
        path = dst_base + '.png'
        img.convert('RGBA').save(path, optimize=True)
    else:
        path = dst_base + '.jpg'
        img.convert('RGB').save(path, quality=86, optimize=True, progressive=True)
    return os.path.basename(path)


def convert_textures(assets: str, out: str, scene: dict) -> dict:
    tdir = os.path.join(out, 'textures')
    os.makedirs(tdir, exist_ok=True)
    index = {}
    for p in scene['textures']:
        if not p.lower().endswith(('.png', '.jpg', '.psd', '.tga')):
            continue
        n = stem(p)
        if n in ATLAS or n in SKIP_TEXTURES:
            continue
        img = Image.open(os.path.join(assets, p))
        img.load()
        if n.startswith('FS0'):  # skybox : croix horizontale → 6 faces
            index[n] = skybox_faces(img, tdir, n)
            continue
        index[n] = save_texture(img, os.path.join(tdir, n))
        print('  texture', n, '→', index[n])
    return index


def skybox_faces(img: Image.Image, tdir: str, name: str) -> dict:
    """Croix horizontale 4×3 (convention Unity) → faces px, nx, py, ny, pz, nz."""
    w, h = img.size
    f = w // 4
    cells = {'nx': (0, 1), 'pz': (1, 1), 'px': (2, 1), 'nz': (3, 1), 'py': (1, 0), 'ny': (1, 2)}
    faces = {}
    for k, (cx, cy) in cells.items():
        face = img.crop((cx * f, cy * f, (cx + 1) * f, (cy + 1) * f)).convert('RGB')
        if f > 512:
            face = face.resize((512, 512), Image.LANCZOS)
        fn = f'{name}_{k}.jpg'
        face.save(os.path.join(tdir, fn), quality=86, optimize=True)
        faces[k] = fn
    # Couleurs d'ambiance « Skybox » (ambientMode 0) : moyenne haut / horizon / bas
    arr = np.asarray(img.convert('RGB'), dtype=np.float64) / 255.0
    lin = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)

    def mean(cx: int, cy: int) -> list[float]:
        return lin[cy * f:(cy + 1) * f, cx * f:(cx + 1) * f].reshape(-1, 3).mean(axis=0).tolist()
    sides = np.mean([mean(0, 1), mean(1, 1), mean(2, 1), mean(3, 1)], axis=0).tolist()
    faces['ambientLinear'] = {'sky': mean(1, 0), 'equator': sides, 'ground': mean(1, 2)}
    print('  skybox', name, '6 faces', f'{f}px')
    return faces


def build_atlas(assets: str, out: str, scene: dict, proc_dir: str) -> dict:
    atlas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    paths = {stem(p): os.path.join(assets, p) for p in scene['textures']}
    paths['fx_ring'] = os.path.join(proc_dir, 'fx_ring.png')
    paths['fx_dot'] = os.path.join(proc_dir, 'fx_dot.png')
    # Textures de particules non référencées directement par un matériau exporté
    for extra in ['JMO Assets/Cartoon FX (legacy)/Textures/CFX_T_RayRounded.png']:
        paths.setdefault(stem(extra), os.path.join(assets, extra))
    meta = {}
    for n, ((x, y, w, h), single) in ATLAS.items():
        if n not in paths:
            print('  atlas : texture absente', n)
            continue
        img = Image.open(paths[n]).convert('RGBA').resize((w, h), Image.LANCZOS)
        if single:
            a = np.asarray(img)[..., 0]
            img = Image.fromarray(np.dstack([np.full_like(a, 255)] * 3 + [a]))
        atlas.paste(img, (x, y))
        # UV three.js : origine en bas à gauche
        meta[n] = [x / 1024, 1 - (y + h) / 1024, (x + w) / 1024, 1 - y / 1024]
    atlas.save(os.path.join(out, 'textures', 'fx_atlas.png'), optimize=True)
    print('  atlas FX', len(meta), 'sprites')
    return meta


# Sons en boucle : WAV (le MP3 ajoute un silence d'encodeur qui casse la boucle)
LOOPS = {'AccelerationLow', 'Skid', 'sfx_engine'}


def convert_audio(assets: str, out: str, scene: dict, tmp: str) -> dict:
    adir = os.path.join(out, 'audio')
    os.makedirs(adir, exist_ok=True)
    for f in os.listdir(adir):
        os.remove(os.path.join(adir, f))
    files = {k: os.path.join(assets, v['source']) for k, v in scene['audio'].items()}
    for p in EXTRA_AUDIO:
        files[stem(p)] = os.path.join(assets, p)
    # Effets procéduraux (préréglage Arcade)
    procedural_audio.main(tmp)
    for f in sorted(os.listdir(tmp)):
        if f.endswith('.wav'):
            files[f[:-4]] = os.path.join(tmp, f)
    index = {}
    for n, src in files.items():
        safe = n.replace(' ', '_')
        long = n in ('Totyputy', 'Joyful Jubilation_1')
        if n in LOOPS:
            dst = os.path.join(adir, safe + '.wav')
            run(['ffmpeg', '-y', '-i', src, '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', dst])
        else:
            dst = os.path.join(adir, safe + '.mp3')
            run(['ffmpeg', '-y', '-i', src, '-ac', '2' if long else '1', '-b:a', '128k' if long else '96k', dst])
        index[n] = 'audio/' + os.path.basename(dst)
        print('  son', n, os.path.getsize(dst) // 1024, 'Ko')
    return index


def check_font(src: str, dst: str, flavor: str | None = None) -> dict:
    """Vérifie que ascent/descent couvrent les glyphes (sinon texte coupé sur
    Safari / Chrome Android) ; écrit une copie corrigée si nécessaire."""
    from fontTools.ttLib import TTFont
    f = TTFont(src)
    head, hhea, os2 = f['head'], f['hhea'], f['OS/2']
    ymax, ymin = head.yMax, head.yMin
    report = {'unitsPerEm': head.unitsPerEm, 'yMax': ymax, 'yMin': ymin, 'hheaAscent': hhea.ascent, 'hheaDescent': hhea.descent,
              'winAscent': os2.usWinAscent, 'winDescent': os2.usWinDescent, 'typoAscender': os2.sTypoAscender,
              'typoDescender': os2.sTypoDescender, 'fixed': False}
    if hhea.ascent < ymax or -hhea.descent < -ymin or os2.usWinAscent < ymax or os2.usWinDescent < -ymin:
        hhea.ascent = max(hhea.ascent, ymax)
        hhea.descent = min(hhea.descent, ymin)
        os2.usWinAscent = max(os2.usWinAscent, ymax)
        os2.usWinDescent = max(os2.usWinDescent, -ymin)
        os2.sTypoAscender, os2.sTypoDescender = hhea.ascent, hhea.descent
        os2.sTypoLineGap = 0
        if os2.version >= 4:
            os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
        report['fixed'] = True
        f.flavor = flavor
        f.save(dst)
    elif flavor and f.flavor != flavor:
        f.flavor = flavor
        f.save(dst)
    else:
        shutil.copy(src, dst)
    print('  police', os.path.basename(dst), 'corrigée' if report['fixed'] else 'OK', report)
    return report


def make_icons(assets: str, out: str) -> None:
    idir = os.path.join(out, 'icons')
    os.makedirs(idir, exist_ok=True)
    src = Image.open(os.path.join(assets, 'Graphics/Icon.png')).convert('RGB')
    s = min(src.size)
    src = src.crop(((src.size[0] - s) // 2, (src.size[1] - s) // 2, (src.size[0] + s) // 2, (src.size[1] + s) // 2))
    for size in (192, 512):
        src.resize((size, size), Image.LANCZOS).save(os.path.join(idir, f'icon-{size}.png'), optimize=True)
    # Icône « maskable » : zone sûre de 80 %, fond de la couleur du bord
    bg = tuple(int(c) for c in np.asarray(src)[:8].reshape(-1, 3).mean(axis=0))
    m = Image.new('RGB', (512, 512), bg)
    m.paste(src.resize((410, 410), Image.LANCZOS), (51, 51))
    m.save(os.path.join(idir, 'icon-maskable-512.png'), optimize=True)
    src.resize((180, 180), Image.LANCZOS).save(os.path.join(idir, 'apple-touch-icon.png'), optimize=True)
    print('  icônes PWA')


def main() -> None:
    project, out, fbx2gltf = sys.argv[1], sys.argv[2], sys.argv[3]
    assets = os.path.join(project, 'Assets')
    scene = json.load(open(os.path.join(out, 'data', 'scene.json'), encoding='utf-8'))
    proc_dir = os.path.join(out, 'textures')
    os.makedirs(proc_dir, exist_ok=True)
    print('Textures procédurales')
    procedural_textures.main(proc_dir)
    print('Modèles')
    convert_models(assets, out, scene, fbx2gltf)
    print('Textures')
    tex = convert_textures(assets, out, scene)
    atlas = build_atlas(assets, out, scene, proc_dir)
    for n in ('fx_ring.png', 'fx_dot.png'):
        os.remove(os.path.join(proc_dir, n))  # intégrés à l'atlas
    print('Sons')
    audio = convert_audio(assets, out, scene, os.path.join(proc_dir, '..', '..', '.cache', 'sfx'))
    print('Polices')
    os.makedirs(os.path.join(out, 'fonts'), exist_ok=True)
    font = check_font(os.path.join(assets, 'TextMesh Pro/Fonts/LiberationSans.ttf'), os.path.join(out, 'fonts', 'LiberationSans.ttf'))
    fonts = {'LiberationSans': {'file': 'fonts/LiberationSans.ttf', 'metrics': font}}
    # Police ronde et épaisse (Fredoka, SIL OFL, paquet npm @fontsource/fredoka)
    fk = os.path.join(HERE, '..', '.cache', 'package', 'files')
    if os.path.isdir(fk):
        for w in (600, 700):
            src = os.path.join(fk, f'fredoka-latin-{w}-normal.woff2')
            fonts[f'Fredoka-{w}'] = {'file': f'fonts/Fredoka-{w}.woff2', 'weight': w,
                                     'metrics': check_font(src, os.path.join(out, 'fonts', f'Fredoka-{w}.woff2'), 'woff2')}
        shutil.copy(os.path.join(fk, '..', 'LICENSE'), os.path.join(out, 'fonts', 'OFL-Fredoka.txt'))
    make_icons(assets, out)
    print('Planètes et ciel')
    planets = procedural_planets.main(os.path.join(HERE, '..', 'src', 'game', 'planets.json'), os.path.join(out, 'textures'))
    manifest = {'textures': tex, 'fxAtlas': atlas, 'audio': audio, 'fonts': fonts,
                'planets': planets['planets'], 'space': planets['space'],
                'procedural': ['planet_detail_n.png', 'crater.png', 'crater_n.png']}
    with open(os.path.join(out, 'data', 'assets.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print('assets.json écrit')


if __name__ == '__main__':
    main()
