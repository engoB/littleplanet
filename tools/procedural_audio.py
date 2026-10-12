"""Effets sonores générés procéduralement (numpy, graine fixe) pour le
préréglage Arcade : le projet Unity n'a ni son d'explosion, ni sifflement de
météore, ni turbo.

Usage : python tools/procedural_audio.py <dossier de sortie (wav)>
"""
from __future__ import annotations

import os
import sys
import wave

import numpy as np

SR = 44100
RNG = np.random.default_rng(424242)


def lowpass(x: np.ndarray, cutoff: np.ndarray | float) -> np.ndarray:
    """Filtre passe-bas à un pôle, fréquence de coupure variable."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def norm(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    return x / (np.abs(x).max() + 1e-9) * peak


def save(x: np.ndarray, path: str) -> None:
    data = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print('  ', os.path.basename(path), f'{len(x) / SR:.2f} s')


def explosion() -> np.ndarray:
    n = int(SR * 1.6)
    t = np.arange(n) / SR
    noise = RNG.uniform(-1, 1, n)
    rumble = lowpass(noise, 120 + 2500 * np.exp(-t / 0.08)) * env(n, 0.002, 0.45)
    crack = lowpass(noise, 6000) * env(n, 0.001, 0.05) * 0.5
    sub = np.sin(2 * np.pi * (55 * t - 25 * t * t)) * env(n, 0.004, 0.35) * 0.8
    return norm(rumble * 1.4 + crack + sub)


def crunch() -> np.ndarray:
    n = int(SR * 0.45)
    t = np.arange(n) / SR
    noise = RNG.uniform(-1, 1, n)
    grit = lowpass(noise, 900) * env(n, 0.002, 0.12)
    thump = np.sin(2 * np.pi * 70 * t * (1 - t)) * env(n, 0.002, 0.09)
    clicks = (RNG.random(n) > 0.995) * RNG.uniform(-1, 1, n) * env(n, 0.001, 0.15)
    return norm(grit + thump + lowpass(clicks, 3000) * 2)


def whistle() -> np.ndarray:
    n = int(SR * 2.4)
    t = np.arange(n) / SR
    f = 1500 * np.exp(-t * 0.55) + 180
    phase = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(phase) * 0.35 + lowpass(RNG.uniform(-1, 1, n), f * 1.5) * 0.6
    e = np.minimum(1, t / 0.6) * np.minimum(1, (2.4 - t) / 0.15)
    return norm(tone * e, 0.6)


def whoosh() -> np.ndarray:
    n = int(SR * 0.8)
    t = np.arange(n) / SR
    cutoff = 300 + 3500 * np.sin(np.pi * t / 0.8) ** 2
    w = lowpass(RNG.uniform(-1, 1, n), cutoff) * np.sin(np.pi * t / 0.8) ** 1.5
    return norm(w, 0.7)


def chime() -> np.ndarray:
    n = int(SR * 0.7)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in ((880, 0.25), (1320, 0.2), (1760, 0.15)))
    x[int(SR * 0.08):] += (np.sin(2 * np.pi * 1175 * t) * np.exp(-t / 0.25))[: n - int(SR * 0.08)]
    return norm(x * env(n, 0.003, 0.4), 0.6)


def engine() -> np.ndarray:
    """Boucle moteur (1 s, raccord exact) : harmoniques d'un régime de 4 cylindres."""
    n = SR
    t = np.arange(n) / SR
    base = 40  # Hz, entier → boucle sans clic
    x = sum(np.sin(2 * np.pi * base * k * t + k) / k ** 1.2 for k in range(1, 9))
    x *= 0.8 + 0.2 * np.sin(2 * np.pi * 8 * t)
    noise = RNG.uniform(-1, 1, n)
    x += 0.25 * np.roll(lowpass(np.tile(noise, 2), 500)[n:], 0)
    return norm(x, 0.7)


def main(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    for name, fn in (('sfx_explosion', explosion), ('sfx_crunch', crunch), ('sfx_whistle', whistle),
                     ('sfx_whoosh', whoosh), ('sfx_chime', chime), ('sfx_engine', engine)):
        save(fn(), os.path.join(out, name + '.wav'))


if __name__ == '__main__':
    main(sys.argv[1])
