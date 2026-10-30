"""Chroma-key Codex sprites (#00FF00) into trimmed transparent PNGs + a sprite manifest."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

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
    # Soft matte: fully transparent when strongly green-dominant, opaque below a small margin.
    alpha = 1 - np.clip((spill - 40) / (110 - 40), 0, 1)
    # Despill: pull residual green down on semi-transparent edge pixels and anything green-dominant.
    g2 = np.where(spill > 0, np.maximum(r, b) + np.minimum(spill, 0), g)
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
