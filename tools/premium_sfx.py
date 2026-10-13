"""Sons « premium » du préréglage Arcade.

1. Effets d'interface et de ramassage : sons CC0 du paquet npm `uisfx`
   (0.4.0, audio CC0-1.0 — https://github.com/romainsimon/uisfx), copiés et
   renommés selon leur rôle dans le jeu.
2. Explosion, choc et souffle resynthétisés en couches (sub-basse, corps,
   craquements) avec une réverbération à convolution (réponse impulsionnelle
   de bruit à décroissance exponentielle).

Usage : python tools/premium_sfx.py <dossier sounds de uisfx> <dossier audio de sortie> <assets.json>
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import procedural_audio as pa  # noqa: E402

SR = pa.SR
RNG = np.random.default_rng(777)

# Rôle dans le jeu → style/cue du paquet uisfx
UISFX = {
    'ui_click': 'glass/press',
    'ui_select': 'glass/select',
    'ui_back': 'glass/back',
    'ui_toggle_on': 'glass/toggle-on',
    'ui_toggle_off': 'glass/toggle-off',
    'sfx_pickup': 'arcade/bonus',
    'sfx_turbo_pickup': 'scifi/level-up',
    'sfx_boost': 'scifi/forward',
    'sfx_jump': 'rubber/release',
    'sfx_land': 'rubber/drop',
    'sfx_spin': 'arcade/streak',
    'sfx_stage': 'arcade/achievement',
    'sfx_star': 'dreamy/unlock',
    'sfx_launch': 'cinematic/start',
    'sfx_warning': 'cinematic/warning',
    'sfx_snitch': 'glass/achievement',
    'sfx_hurt': 'cinematic/error',
}


def reverb(x: np.ndarray, decay: float = 0.6, mix: float = 0.25) -> np.ndarray:
    n = int(SR * decay * 2)
    t = np.arange(n) / SR
    ir = RNG.uniform(-1, 1, n) * np.exp(-t / (decay / 3))
    ir = pa.lowpass(ir, 4500)
    ir /= np.abs(ir).sum() ** 0.5 * 40
    m = len(x) + n - 1
    size = 1 << (m - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:m]
    dry = np.concatenate([x, np.zeros(n - 1)])
    return dry * (1 - mix) + pa.norm(wet, np.abs(dry).max()) * mix


def explosion() -> np.ndarray:
    n = int(SR * 1.4)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(35 + 70 * np.exp(-t / 0.06)) / SR) * pa.env(n, 0.002, 0.32)
    noise = RNG.uniform(-1, 1, n)
    body = pa.lowpass(noise, 180 + 3200 * np.exp(-t / 0.07)) * pa.env(n, 0.001, 0.38) * 1.5
    crack = pa.lowpass(noise, 8000) * pa.env(n, 0.0005, 0.03) * 0.6
    sparks = (RNG.random(n) > 0.9975) * RNG.uniform(-1, 1, n) * np.exp(-t / 0.5)
    debris = pa.lowpass(sparks, 5000) * 3
    return pa.norm(reverb(sub * 1.1 + body + crack + debris, 0.9, 0.3), 0.92)


def crunch() -> np.ndarray:
    n = int(SR * 0.35)
    t = np.arange(n) / SR
    noise = RNG.uniform(-1, 1, n)
    thump = np.sin(2 * np.pi * np.cumsum(60 + 90 * np.exp(-t / 0.03)) / SR) * pa.env(n, 0.001, 0.08)
    grit = pa.lowpass(noise, 1400) * pa.env(n, 0.001, 0.07)
    snap = pa.lowpass(noise, 7000) * pa.env(n, 0.0005, 0.012) * 0.6
    return pa.norm(reverb(thump * 1.2 + grit + snap, 0.4, 0.2), 0.85)


def whoosh() -> np.ndarray:
    n = int(SR * 0.7)
    t = np.arange(n) / SR
    shape = np.sin(np.pi * t / 0.7) ** 1.6
    lo = pa.lowpass(RNG.uniform(-1, 1, n), 250 + 2200 * shape)
    hi = pa.lowpass(RNG.uniform(-1, 1, n), 1500 + 6000 * shape) - pa.lowpass(RNG.uniform(-1, 1, n), 1500)
    tone = np.sin(2 * np.pi * np.cumsum(180 + 420 * shape) / SR) * 0.12
    return pa.norm(reverb((lo + hi * 0.4 + tone) * shape, 0.5, 0.2), 0.7)


def main(sounds: str, out: str, manifest: str) -> None:
    os.makedirs(out, exist_ok=True)
    m = json.load(open(manifest, encoding='utf-8'))
    audio = m.setdefault('audio', {})
    if os.path.isdir(sounds):
        for name, cue in UISFX.items():
            src = os.path.join(sounds, cue + '.mp3')
            shutil.copy(src, os.path.join(out, name + '.mp3'))
            audio[name] = f'audio/{name}.mp3'
        print('  sons uisfx :', len(UISFX))
    tmp = os.path.join(out, '_tmp.wav')
    for name, fn in (('sfx_explosion', explosion), ('sfx_crunch', crunch), ('sfx_whoosh', whoosh)):
        pa.save(fn(), tmp)
        dst = os.path.join(out, name + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-ac', '1', '-b:a', '112k', dst], check=True)
        audio[name] = f'audio/{name}.mp3'
    os.remove(tmp)
    json.dump(m, open(manifest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
