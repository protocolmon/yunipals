"""Synthesise anime SFX from the engine's cue sheet and mix them over the music bed.

usage: python3 mix.py film.cues.json music.mp3 out.wav
Deterministic: seeded noise, no samples beyond the CC-BY music bed.
"""
import json
import subprocess
import sys
import wave

import numpy as np

SR = 48000
cues_path, music_path, out_path = sys.argv[1:4]
sheet = json.load(open(cues_path))
dur = sheet["duration"]
n = int(dur * SR) + SR
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def env(t, attack, decay):
    return np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t / decay)


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def lowpass(x, alpha):
    # one-pole low-pass (alpha in 0..1, smaller = darker)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += alpha * (v - acc)
        y[i] = acc
    return y


def bandsweep(sec, f0, f1, alpha0=0.05, alpha1=0.6):
    t = t_axis(sec)
    x = noise(sec)
    a = np.linspace(alpha0, alpha1, len(t))
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a[i] * (v - acc)
        y[i] = acc
    return y


def sine_sweep(sec, f0, f1):
    t = t_axis(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def sfx(kind):
    if kind == "impact":
        t = t_axis(0.7)
        thump = sine_sweep(0.7, 140, 40) * env(t, 0.002, 0.16)
        crack = lowpass(noise(0.7), 0.5) * env(t, 0.001, 0.05)
        return 0.9 * thump + 0.7 * crack
    if kind == "ko":
        t = t_axis(1.8)
        boom = sine_sweep(1.8, 110, 28) * env(t, 0.003, 0.45)
        crack = lowpass(noise(1.8), 0.35) * env(t, 0.001, 0.12)
        ring = np.sin(2 * np.pi * 1320 * t) * env(t, 0.001, 0.5) * 0.12
        return 1.0 * boom + 0.8 * crack + ring
    if kind == "whoosh":
        t = t_axis(0.45)
        return bandsweep(0.45, 0, 0, 0.02, 0.35) * np.sin(np.pi * t / 0.45) ** 2 * 1.4
    if kind == "zap":
        t = t_axis(0.5)
        tone = sine_sweep(0.5, 1800, 420) * env(t, 0.002, 0.18)
        sparkle = np.sin(2 * np.pi * 2600 * t) * np.sin(2 * np.pi * 37 * t) * env(t, 0.001, 0.12)
        return 0.45 * tone + 0.2 * sparkle + 0.35 * bandsweep(0.5, 0, 0, 0.5, 0.05) * env(t, 0.001, 0.2)
    if kind == "whip":
        t = t_axis(0.4)
        swish = bandsweep(0.4, 0, 0, 0.03, 0.7) * np.sin(np.pi * np.clip(t / 0.25, 0, 1)) ** 2
        snap = noise(0.4) * env(np.maximum(t - 0.22, 0), 0.0005, 0.015) * (t > 0.22)
        return 0.9 * swish + 0.8 * snap
    if kind == "charge":
        t = t_axis(0.55)
        return 0.22 * sine_sweep(0.55, 220, 880) * np.minimum(t / 0.5, 1) * (1 - np.clip((t - 0.5) / 0.05, 0, 1))
    if kind == "fizzle":
        t = t_axis(0.5)
        return 0.35 * lowpass(noise(0.5), 0.6) * env(t, 0.001, 0.12) * (0.5 + 0.5 * np.sin(2 * np.pi * 60 * t))
    if kind == "thud":
        t = t_axis(0.6)
        return 0.9 * sine_sweep(0.6, 90, 35) * env(t, 0.002, 0.12) + 0.4 * lowpass(noise(0.6), 0.15) * env(t, 0.001, 0.1)
    if kind in ("slam", "title"):
        t = t_axis(0.9)
        return 0.8 * sine_sweep(0.9, 160, 45) * env(t, 0.002, 0.2) + 0.35 * lowpass(noise(0.9), 0.4) * env(t, 0.001, 0.06)
    if kind == "cutin":
        t = t_axis(0.6)
        return 0.6 * bandsweep(0.6, 0, 0, 0.05, 0.6) * env(t, 0.01, 0.2) + 0.25 * np.sin(2 * np.pi * 1760 * t) * env(t, 0.001, 0.25)
    if kind == "ready":
        t = t_axis(0.5)
        return 0.18 * (np.sin(2 * np.pi * 660 * t) + np.sin(2 * np.pi * 990 * t)) * env(t, 0.005, 0.2)
    if kind == "fanfare":
        out = np.zeros(int(2.4 * SR))
        for k, (f, at) in enumerate([(523, 0), (659, 0.14), (784, 0.28), (1047, 0.42)]):
            t = t_axis(2.4 - at)
            tone = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(4 * np.pi * f * t)) * env(t, 0.01, 0.5 if k < 3 else 1.0)
            i = int(at * SR)
            out[i:i + len(tone)] += 0.16 * tone[: len(out) - i]
        return out
    if kind == "splash":
        t = t_axis(0.7)
        return 0.8 * bandsweep(0.7, 0, 0, 0.6, 0.08) * env(t, 0.003, 0.18) + 0.3 * sine_sweep(0.7, 300, 90) * env(t, 0.002, 0.08)
    if kind == "guard":
        t = t_axis(0.6)
        clank = sum(np.sin(2 * np.pi * fr * t) for fr in (740, 1130, 1660)) * env(t, 0.001, 0.12)
        return 0.3 * clank + 0.5 * sine_sweep(0.6, 120, 60) * env(t, 0.002, 0.08)
    if kind == "orb":
        t = t_axis(0.6)
        return 0.5 * sine_sweep(0.6, 220, 90) * env(t, 0.01, 0.25) + 0.25 * np.sin(2 * np.pi * 660 * t) * np.sin(2 * np.pi * 9 * t) * env(t, 0.01, 0.2)
    raise ValueError(kind)


fx = np.zeros(n)
for c in sheet["cues"]:
    s = sfx(c["type"]) * c.get("gain", 1)
    i = int(c["t"] * SR)
    fx[i:i + len(s)] += s[: max(0, n - i)]

if music_path == "-":
    music = np.zeros(n)
else:
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", music_path, "-t", str(dur + 1), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"])
    music = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    xf = min(2 * SR, len(music) // 4)
    if xf < 1:
        raise ValueError("Music bed is empty")
    looped = music.copy()
    while len(looped) < n:
        ramp = np.linspace(0, 1, xf)
        looped[-xf:] = looped[-xf:] * (1 - ramp) + music[:xf] * ramp
        looped = np.concatenate([looped, music[xf:]])
    music = looped[:n]
t = np.arange(n) / SR
# Music bed: fade in, duck under the KO freeze, swell for the winner card, fade out.
gain = 0.42 * np.clip(t / 0.8, 0, 1)
for ko in [c["t"] for c in sheet["cues"] if c["type"] == "ko"]:
    gain *= 1 - 0.75 * np.clip((t - (ko - 0.05)) / 0.05, 0, 1) * np.clip(1 - (t - (ko + 2.0)) / 1.2, 0, 1)
gain *= np.clip((dur - t) / 1.2, 0, 1)
mix = music * gain + fx * 0.55
mix /= max(1.0, np.max(np.abs(mix)) / 0.95)
stereo = np.repeat((mix * 32767).astype(np.int16)[:, None], 2, axis=1)
with wave.open(out_path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(stereo.tobytes())
print("wrote", out_path, f"{dur:.1f}s", len(sheet["cues"]), "cues")
