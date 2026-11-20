"""Chroma-key Codex sprites (#00FF00) into trimmed transparent PNGs + a sprite manifest."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

GEN = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

manifest = {}
for src in sorted(GEN.glob("*.png")):
    name = src.stem
    if name in ("island",):
        continue
    im = Image.open(src).convert("RGB")
    if name.startswith("bg") or name.endswith("cutin"):
        im.convert("RGBA").save(OUT / f"{name}.png")
        manifest[name] = {"w": im.width, "h": im.height, "file": f"{name}.png"}
        continue
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    # Start with green regions connected to the canvas border, preserving shaded
    # green eyes, markings and crystals enclosed by the fighter's dark outline.
    candidates = Image.fromarray((spill > 40).astype(np.uint8) * 255)
    connected = ImageOps.expand(candidates, border=1, fill=255)
    ImageDraw.floodfill(connected, (0, 0), 128)
    background = np.asarray(connected)[1:-1, 1:-1] == 128
    # The reserved near-pure chroma color also occurs in enclosed gaps (e.g.
    # between tail and body). It cannot distinguish artwork painted in the exact
    # key color; review those cases rather than desaturating every green pixel.
    background |= (g >= 230) & (r <= 20) & (b <= 20)
    alpha = np.where(background, 1 - np.clip((spill - 40) / 70, 0, 1), 1)
    # Despill only the keyed edge, never opaque character colors.
    edge = background & (alpha > 0) & (alpha < 1)
    g2 = np.where(edge, np.maximum(r, b), g)
    rgba = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)
    # Remove dust: zero alpha below 8.
    rgba[..., 3][rgba[..., 3] < 8] = 0
    out = Image.fromarray(rgba, "RGBA")
    box = out.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    if not box:
        raise ValueError("Sprite is fully transparent")
    out = out.crop(box)
    # Per-pose framing differs, so the engine sets each sprite's on-stage height explicitly.
    out.save(OUT / f"{name}.png", optimize=True)
    manifest[name] = {"w": out.width, "h": out.height, "file": f"{name}.png"}
    print(name, out.size)

(OUT / "sprites.json").write_text(json.dumps(manifest, indent=1))
